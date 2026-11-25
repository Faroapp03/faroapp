/** Autoriza el inicio de una reserva mediante OIDC; un resultado incierto nunca permite ejecutar la copia. */
import { PlazoAgotado } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { cabecerasDeDesafio } from '../seguridad/desafio-http.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { type ConfianzaOidcGitHub, crearClasificadorOidcGitHub, type IdentidadEjecucionGitHub } from './oidc-github.ts';
import { PLAZO_RECEPTOR_MANTENIMIENTO_MS } from './plazos-mantenimiento.ts';
import {
  type AlmacenTrabajosActualizacion,
  type InicioTrabajo,
  leerEstadoTrabajosPrivado,
  leerInicioTrabajo,
  leerResultadoTransicionTrabajo,
  MARGEN_RELOJ_GITHUB_MS,
  type TrabajoPrivado,
} from './trabajos.ts';

export const RUTA_INICIO_ACTUALIZACION = '/mantenimiento/inicio';
export const MAX_INICIO_ACTUALIZACION_BYTES = 4096;
const MS_SEGUNDO = 1000;
const MAX_TOKEN = 16_384;
/** Mantiene viva una tarea después de responder (en Cloudflare, `waitUntil` de la petición). */
export type EnSegundoPlano = (tarea: Promise<unknown>) => void;
interface OpcionesReceptorInicio {
  readonly origen: string;
  readonly permitirHttpLocal?: boolean;
  readonly almacen: AlmacenTrabajosActualizacion;
  readonly pedir?: typeof fetch;
  readonly ahora?: () => number;
  /** Evalúa el vigilante y envía el aviso que toque; no debe rechazar, porque nadie espera su resultado. */
  readonly avisarRechazo?: () => Promise<void>;
}
class RechazoInicio extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
function respuesta(estado: number, codigo: string): Response {
  return Response.json(estado === ESTADO_HTTP.correcto ? { estado: codigo } : { error: codigo }, {
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
  if (peticion.url !== `${origen}${RUTA_INICIO_ACTUALIZACION}`) {
    throw new RechazoInicio(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  if (peticion.method !== 'POST') {
    throw new RechazoInicio(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  const autorizacion = peticion.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(autorizacion)?.[1];
  if (!token || token.length > MAX_TOKEN) {
    throw new RechazoInicio(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    throw new RechazoInicio(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
  const longitud = peticion.headers.get('content-length');
  if (longitud !== null) {
    if (!/^(0|[1-9]\d*)$/.test(longitud)) {
      throw new RechazoInicio(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    if (Number(longitud) > MAX_INICIO_ACTUALIZACION_BYTES) {
      throw new RechazoInicio(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
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
function trabajoDelInicio(trabajo: TrabajoPrivado | null, inicio: InicioTrabajo): TrabajoPrivado {
  if (
    !trabajo ||
    trabajo.solicitudId !== inicio.solicitudId ||
    trabajo.revisionReserva !== inicio.revisionReserva ||
    trabajo.accion !== inicio.accion ||
    trabajo.protocoloInicio !== 'obligatorio' ||
    trabajo.estado === 'terminado'
  ) {
    throw new RechazoInicio(ESTADO_HTTP.conflicto, 'conflicto');
  }
  return trabajo;
}
async function leerCuerpo(peticion: Request, senal: AbortSignal) {
  const lector = peticion.body?.getReader();
  if (!lector) {
    throw new RechazoInicio(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
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
      if (total > MAX_INICIO_ACTUALIZACION_BYTES) {
        throw new RechazoInicio(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
      }
      partes.push(value);
    }
    const bytes = concatenar(partes, total);
    try {
      const valor: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return leerInicioTrabajo(valor);
    } catch {
      throw new RechazoInicio(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
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
  if (error instanceof RechazoInicio) {
    return respuesta(error.estado, error.codigo);
  }
  return error instanceof PlazoAgotado
    ? respuesta(ESTADO_HTTP.tiempoAgotado, 'plazo_agotado')
    : respuesta(ESTADO_HTTP.noDisponible, 'no_disponible');
}
/** El run es el primero de su ejecución, el de la reserva si ya consta, y su token no es anterior a la reserva. */
function runDeLaReserva(identidad: IdentidadEjecucionGitHub, trabajo: TrabajoPrivado): boolean {
  return (
    identidad.runAttempt === '1' &&
    (trabajo.runId === null || trabajo.runId === identidad.runId) &&
    identidad.emitidoEn * MS_SEGUNDO >= trabajo.creadoEn - MARGEN_RELOJ_GITHUB_MS
  );
}
interface RechazoConEvidencia {
  readonly almacen: AlmacenTrabajosActualizacion;
  readonly trabajo: TrabajoPrivado;
  readonly inicio: InicioTrabajo;
  readonly identidad: IdentidadEjecucionGitHub;
}
interface AvisoDelRechazo {
  readonly avisarRechazo: (() => Promise<void>) | undefined;
  readonly enSegundoPlano: EnSegundoPlano | undefined;
}
/**
 * Anota el hecho si la reserva aún no lo tiene. Solo el primer registro avisa, y en segundo plano: la respuesta no
 * espera al aviso ni depende de él, y el hecho ya está guardado cuando el aviso empieza.
 */
async function anotarRechazo(rechazo: RechazoConEvidencia, aviso: AvisoDelRechazo, senal: AbortSignal) {
  if (rechazo.trabajo.inicioRechazado !== undefined) {
    return;
  }
  const { almacen, inicio, identidad } = rechazo;
  const anotado = leerResultadoTransicionTrabajo(await almacen.anotarInicioRechazado(inicio, identidad));
  if (anotado.estado === 'aplicado' && aviso.avisarRechazo && aviso.enSegundoPlano) {
    aviso.enSegundoPlano(aviso.avisarRechazo());
  }
  senal.throwIfAborted();
}
function descartarCuerpo(peticion: Request): void {
  if (!peticion.bodyUsed) {
    void peticion.body?.cancel().catch(() => undefined);
  }
}
/**
 * La caché conserva un único verificador de los pins actuales, nunca una autorización. Su vuelo JWKS tiene
 * plazo propio compartido; la retirada de un receptor no cancela a otro. El plazo exterior y las comprobaciones
 * tras cada espera impiden confirmar un inicio tardío de una petición retirada.
 * Repetir el mismo inicio es seguro; solo una respuesta confirmada permite al workflow continuar.
 * Un run de este repositorio firmado para otra revisión recibe el mismo 401 que cualquier permiso negado; solo deja
 * en la reserva el hecho `revision_no_autorizada`, una vez, para que el vigilante lo diga sin esperar un plazo.
 */
export function crearReceptorInicioActualizacion({
  origen: entradaOrigen,
  permitirHttpLocal = false,
  almacen,
  pedir = fetch,
  ahora = Date.now,
  avisarRechazo,
}: OpcionesReceptorInicio): (peticion: Request, enSegundoPlano?: EnSegundoPlano) => Promise<Response> {
  const origen = validarOrigenAdministrativo(entradaOrigen, permitirHttpLocal);
  let cache: { clave: string; verificar: ReturnType<typeof crearClasificadorOidcGitHub> } | undefined;
  const verificador = (confianza: ConfianzaOidcGitHub) => {
    const clave = JSON.stringify(confianza);
    if (cache?.clave !== clave) {
      cache = { clave, verificar: crearClasificadorOidcGitHub(confianza, pedir, ahora) };
    }
    return cache.verificar;
  };
  const procesar = async (peticion: Request, token: string, senal: AbortSignal, enSegundoPlano?: EnSegundoPlano) => {
    const inicio = await leerCuerpo(peticion, senal);
    senal.throwIfAborted();
    const privado = leerEstadoTrabajosPrivado(await almacen.leerTrabajoPrivado());
    senal.throwIfAborted();
    const trabajo = trabajoDelInicio(privado.ultimoTrabajo, inicio);
    const verificacion = await verificador(trabajo.confianza)(token);
    senal.throwIfAborted();
    if (verificacion.estado === 'rechazada' || !runDeLaReserva(verificacion.identidad, trabajo)) {
      throw new RechazoInicio(ESTADO_HTTP.noAutenticado, 'no_autorizado');
    }
    const { identidad } = verificacion;
    if (verificacion.estado === 'revision_no_autorizada') {
      await anotarRechazo({ almacen, trabajo, inicio, identidad }, { avisarRechazo, enSegundoPlano }, senal);
      throw new RechazoInicio(ESTADO_HTTP.noAutenticado, 'no_autorizado');
    }
    const resultado = leerResultadoTransicionTrabajo(await almacen.confirmarInicio(inicio, identidad));
    senal.throwIfAborted();
    return resultado.estado === 'conflicto'
      ? respuesta(ESTADO_HTTP.conflicto, 'conflicto')
      : respuesta(ESTADO_HTTP.correcto, resultado.estado);
  };
  return async (peticion, enSegundoPlano) => {
    try {
      const token = frontera(peticion, origen);
      return await dentroDelPlazo(
        (senal) => procesar(peticion, token, senal, enSegundoPlano),
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
