/** Frontera privada de activación: identidad de máquina y CAS durable, separados del acceso humano. */
import { PlazoAgotado } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { cabecerasDeDesafio } from '../seguridad/desafio-http.ts';
import {
  type AlmacenActivacion,
  type AlmacenRecuperacionActivacion,
  admiteRecuperacionActivacion,
  autoridadActivacion,
  leerEstadoActivacionPrivado,
  leerRegistroPasoActivacion,
  leerResultadoTransicionActivacion,
  leerSolicitudActivacion,
  leerSolicitudReintentoActivacion,
  type RegistroPasoActivacion,
  type ResultadoTransicionActivacion,
  type SolicitudActivacion,
  type SolicitudReintentoActivacion,
} from './activacion.ts';
import { leerRegistroCierreActivacion, type RegistroCierreActivacion } from './cierre-activacion.ts';
import { type ConsultarFinEjecucion, cumplirCierre } from './cierre-activacion-http.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import type { ResultadoConsultaIntentoActivacion } from './consulta-ejecucion-github.ts';
import { type ConfianzaOidcGitHub, crearVerificadorOidcGitHub, type IdentidadEjecucionGitHub } from './oidc-github.ts';
import { PLAZO_RECEPTOR_MANTENIMIENTO_MS } from './plazos-mantenimiento.ts';
import type { TrabajoPrivado } from './trabajos.ts';
import { objetoTrabajo } from './trabajos.ts';

export const RUTA_ACTIVACION = '/mantenimiento/activacion';
export const MAX_ACTIVACION_BYTES = 16_384;
const MAX_TOKEN = 16_384;
interface OpcionesReceptorActivacion {
  readonly origen: string;
  readonly permitirHttpLocal?: boolean;
  readonly almacen: AlmacenActivacion;
  readonly confianza: ConfianzaOidcGitHub;
  readonly pedir?: typeof fetch;
  readonly ahora?: () => number;
  /** Si la ejecución que manda en la activación ha terminado, en su último intento; la usa el cierre pedido. */
  readonly consultarFin?: ConsultarFinEjecucion;
  readonly consultarIntento?: (
    trabajo: TrabajoPrivado,
    intento: string,
    senal: AbortSignal,
  ) => Promise<ResultadoConsultaIntentoActivacion>;
}
class RechazoActivacion extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
function respuesta(estado: number, contenido: unknown): Response {
  const cuerpo = typeof contenido === 'string' ? { error: contenido } : contenido;
  if (new TextEncoder().encode(JSON.stringify(cuerpo)).byteLength > MAX_ACTIVACION_BYTES) {
    throw new Error('Respuesta privada demasiado grande');
  }
  return Response.json(cuerpo, {
    status: estado,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(estado === ESTADO_HTTP.metodoNoAdmitido ? { allow: 'POST' } : {}),
      ...cabecerasDeDesafio(estado),
    },
  });
}
function frontera(peticion: Request, origen: string): string {
  if (peticion.url !== `${origen}${RUTA_ACTIVACION}`) {
    throw new RechazoActivacion(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  if (peticion.method !== 'POST') {
    throw new RechazoActivacion(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  const autorizacion = peticion.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(autorizacion)?.[1];
  if (!token || token.length > MAX_TOKEN) {
    throw new RechazoActivacion(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    throw new RechazoActivacion(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
  const longitud = peticion.headers.get('content-length');
  if (longitud !== null) {
    if (!/^(0|[1-9]\d*)$/.test(longitud)) {
      throw new RechazoActivacion(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    if (Number(longitud) > MAX_ACTIVACION_BYTES) {
      throw new RechazoActivacion(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
    }
  }
  return token;
}
function concatenar(partes: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    bytes.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return bytes;
}
type OperacionActivacion =
  | { readonly operacion: 'leer' }
  | { readonly operacion: 'leer-recuperacion' }
  | { readonly operacion: 'reservar'; readonly solicitud: SolicitudActivacion }
  | { readonly operacion: 'recuperar'; readonly solicitud: SolicitudActivacion }
  | { readonly operacion: 'reintentar'; readonly solicitud: SolicitudReintentoActivacion }
  | { readonly operacion: 'cerrar-solicitado'; readonly solicitud: RegistroCierreActivacion }
  | { readonly operacion: 'paso'; readonly solicitud: RegistroPasoActivacion }
  | { readonly operacion: 'paso-recuperacion'; readonly solicitud: RegistroPasoActivacion };
function leerOperacion(entrada: unknown): OperacionActivacion {
  if (
    entrada !== null &&
    typeof entrada === 'object' &&
    ['leer', 'leer-recuperacion'].includes(Object.getOwnPropertyDescriptor(entrada, 'operacion')?.value)
  ) {
    const o = objetoTrabajo(entrada, 'operacion');
    return { operacion: o.operacion as 'leer' | 'leer-recuperacion' };
  }
  const o = objetoTrabajo(entrada, 'operacion,solicitud');
  if (o.operacion === 'reservar' || o.operacion === 'recuperar') {
    return { operacion: o.operacion, solicitud: leerSolicitudActivacion(o.solicitud) };
  }
  if (o.operacion === 'cerrar-solicitado') {
    return { operacion: o.operacion, solicitud: leerRegistroCierreActivacion(o.solicitud) };
  }
  if (o.operacion === 'reintentar') {
    return { operacion: o.operacion, solicitud: leerSolicitudReintentoActivacion(o.solicitud) };
  }
  if (o.operacion === 'paso' || o.operacion === 'paso-recuperacion') {
    return { operacion: o.operacion, solicitud: leerRegistroPasoActivacion(o.solicitud) };
  }
  throw new Error('Operación de activación no válida');
}
async function leerCuerpo(peticion: Request, senal: AbortSignal) {
  const lector = peticion.body?.getReader();
  if (!lector) {
    throw new RechazoActivacion(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const cancelar = () => {
    void lector.cancel().catch(() => undefined);
  };
  senal.addEventListener('abort', cancelar, { once: true });
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      senal.throwIfAborted();
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_ACTIVACION_BYTES) {
        throw new RechazoActivacion(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
      }
      partes.push(value);
    }
    const bytes = concatenar(partes, total);
    try {
      const valor: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return leerOperacion(valor);
    } catch {
      throw new RechazoActivacion(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
  } finally {
    senal.removeEventListener('abort', cancelar);
    cancelar();
    lector.releaseLock();
  }
}
function respuestaDelError(error: unknown, peticion: Request): Response {
  if (peticion.signal.aborted) {
    throw peticion.signal.reason;
  }
  if (error instanceof RechazoActivacion) {
    return respuesta(error.estado, error.codigo);
  }
  return error instanceof PlazoAgotado
    ? respuesta(ESTADO_HTTP.tiempoAgotado, 'plazo_agotado')
    : respuesta(ESTADO_HTTP.noDisponible, 'no_disponible');
}
function descartarCuerpo(peticion: Request): void {
  if (!peticion.bodyUsed) {
    void peticion.body?.cancel().catch(() => undefined);
  }
}
interface ContextoActivacion {
  readonly almacen: AlmacenActivacion;
  readonly verificar: ReturnType<typeof crearVerificadorOidcGitHub>;
  readonly consultarIntento: OpcionesReceptorActivacion['consultarIntento'];
  readonly consultarFin?: ConsultarFinEjecucion;
}
interface ContextoEscritura {
  readonly identidad: IdentidadEjecucionGitHub;
  readonly consultarIntento: OpcionesReceptorActivacion['consultarIntento'];
  readonly consultarFin?: ConsultarFinEjecucion;
  readonly senal: AbortSignal;
}
type EscrituraActivacion = Exclude<OperacionActivacion, { readonly operacion: 'leer' | 'leer-recuperacion' }>;
async function recuperar(
  almacen: AlmacenRecuperacionActivacion,
  solicitud: SolicitudActivacion,
  { identidad, consultarIntento, senal }: ContextoEscritura,
): Promise<ResultadoTransicionActivacion> {
  if (!consultarIntento) {
    throw new Error('Consulta de intento no disponible');
  }
  const actual = leerEstadoActivacionPrivado(await almacen.leerActivacionPrivada());
  const a = actual.ultimaActivacion;
  const autoridad = a === null ? null : autoridadActivacion(a);
  if (
    !a ||
    !autoridad ||
    autoridad.solicitudId !== solicitud.solicitudId ||
    autoridad.revisionReserva !== solicitud.revisionReserva ||
    autoridad.runId !== solicitud.runId
  ) {
    return { estado: 'conflicto', activacion: actual };
  }
  // GitHub se consulta por la ejecución que manda en la activación: en un reintento, la que reintenta.
  const consulta = await consultarIntento(
    { ...a.trabajo, ...autoridad },
    String(Number(identidad.runAttempt) - 1),
    senal,
  );
  senal.throwIfAborted();
  if (consulta.estado !== 'completada') {
    throw new Error('El intento anterior no está terminado');
  }
  return almacen.recuperarActivacion(solicitud, identidad, consulta.evidencia);
}
async function escribir(operacion: EscrituraActivacion, almacen: AlmacenActivacion, contexto: ContextoEscritura) {
  const { identidad } = contexto;
  if (identidad.runId !== operacion.solicitud.runId) {
    throw new RechazoActivacion(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  switch (operacion.operacion) {
    case 'reservar':
      return almacen.reservarActivacion(operacion.solicitud, identidad);
    case 'paso':
      return almacen.registrarPasoActivacion(operacion.solicitud, identidad);
    case 'cerrar-solicitado':
      return cumplirCierre(almacen, operacion.solicitud, contexto);
    case 'reintentar':
      return almacen.reservarActivacion(operacion.solicitud, identidad);
    default:
      if (!admiteRecuperacionActivacion(almacen)) {
        throw new Error('Recuperación no disponible');
      }
      return operacion.operacion === 'recuperar'
        ? recuperar(almacen, operacion.solicitud, contexto)
        : almacen.registrarPasoRecuperacionActivacion(operacion.solicitud, identidad);
  }
}
async function procesarActivacion(peticion: Request, token: string, contexto: ContextoActivacion, senal: AbortSignal) {
  const operacion = await leerCuerpo(peticion, senal);
  senal.throwIfAborted();
  const identidad = await contexto.verificar(token);
  senal.throwIfAborted();
  const esRecuperacion = ['leer-recuperacion', 'recuperar', 'paso-recuperacion'].includes(operacion.operacion);
  // El reintento lo puede pedir también un intento posterior: el almacén coteja la ejecución y su intento.
  const intentoValido =
    operacion.operacion === 'reintentar' ||
    (esRecuperacion ? Number(identidad?.runAttempt) > 1 : identidad?.runAttempt === '1');
  if (!identidad || !intentoValido) {
    throw new RechazoActivacion(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  if (operacion.operacion === 'leer' || operacion.operacion === 'leer-recuperacion') {
    const activacion = leerEstadoActivacionPrivado(await contexto.almacen.leerActivacionPrivada());
    senal.throwIfAborted();
    return respuesta(ESTADO_HTTP.correcto, { estado: 'leido', activacion });
  }
  const resultado = leerResultadoTransicionActivacion(
    await escribir(operacion, contexto.almacen, { ...contexto, identidad, senal }),
  );
  senal.throwIfAborted();
  return respuesta(ESTADO_HTTP.correcto, resultado);
}
/** El verificador reutiliza JWKS, nunca la autorización. SQL revalida identidad y revisión al escribir. */
export function crearReceptorActivacion({
  origen: entradaOrigen,
  permitirHttpLocal = false,
  almacen,
  confianza,
  pedir = fetch,
  ahora = Date.now,
  consultarIntento,
  consultarFin,
}: OpcionesReceptorActivacion): (peticion: Request) => Promise<Response> {
  const origen = validarOrigenAdministrativo(entradaOrigen, permitirHttpLocal);
  const verificar = crearVerificadorOidcGitHub(confianza, pedir, ahora);
  const contexto = { almacen, verificar, consultarIntento, ...(consultarFin ? { consultarFin } : {}) };
  return async (peticion) => {
    try {
      const token = frontera(peticion, origen);
      return await dentroDelPlazo(
        (senal) => procesarActivacion(peticion, token, contexto, senal),
        PLAZO_RECEPTOR_MANTENIMIENTO_MS,
        peticion.signal,
      );
    } catch (error) {
      return respuestaDelError(error, peticion);
    } finally {
      descartarCuerpo(peticion);
    }
  };
}
