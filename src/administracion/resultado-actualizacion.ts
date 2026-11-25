/** Recibos de construcción autenticados por OIDC: no publican ni activan una generación. */
import { PlazoAgotado } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { sha256Hex } from '../comun/huella.ts';
import { cabecerasDeDesafio } from '../seguridad/desafio-http.ts';
import type { CatalogoPrivado } from './catalogo-privado.js';
import { type CierreSinRecibo, esCierreSinRecibo, leerCierreSinRecibo } from './cierre-sin-recibo.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { leerCatalogoDeRecibo, leerDatosDeRecibo, MAX_OBSERVACION_DATOS_BYTES } from './datos-trabajo.ts';
import type { EstadoDatosPanel } from './estado-datos.js';
import { type ConfianzaOidcGitHub, crearVerificadorOidcGitHub } from './oidc-github.ts';
import { PLAZO_RESULTADO_MS } from './plazos-mantenimiento.ts';
import {
  type AlmacenTrabajosActualizacion,
  leerEstadoTrabajosPrivado,
  leerReciboTrabajo,
  objetoTrabajo,
  type ReciboTrabajo,
  type TrabajoPrivado,
  tiempoReciboAdmitido,
} from './trabajos.ts';

export const RUTA_RESULTADO_ACTUALIZACION = '/mantenimiento/resultado';
export const MAX_RESULTADO_ACTUALIZACION_BYTES = MAX_OBSERVACION_DATOS_BYTES;
const VERSION_CON_CATALOGO = 3;
/** Desde la v4 el recibo lista los módulos que conservan su versión anterior y admite validar en ámbar. */
const VERSION_CON_CONSERVADOS = 4;
const MAX_TOKEN = 16_384;
interface OpcionesReceptorResultado {
  readonly origen: string;
  readonly permitirHttpLocal?: boolean;
  readonly almacen: AlmacenTrabajosActualizacion;
  readonly pedir?: typeof fetch;
  readonly ahora?: () => number;
}
/** Un módulo que conserva su última versión publicada y la fecha de esa versión (null si nunca publicó). */
export interface ModuloConservado {
  readonly id: string;
  readonly fecha: string | null;
}
interface ResultadoValidado {
  readonly recibo: ReciboTrabajo;
  readonly estado: EstadoDatosPanel | null;
  readonly catalogo?: CatalogoPrivado | null;
  readonly conservados?: readonly ModuloConservado[];
}
class RechazoResultado extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
function exigir(condicion: unknown): asserts condicion {
  if (!condicion) {
    throw new Error('Resultado de candidato no válido');
  }
}
/** Los módulos en ámbar del estado, en su orden: es lo único que puede decir «conservados». */
export function conservadosDelEstado(estado: EstadoDatosPanel | null): readonly ModuloConservado[] {
  return (estado?.modulos ?? [])
    .filter((modulo) => modulo.veredicto === 'ámbar')
    .map((modulo) => ({ id: modulo.id, fecha: modulo.ultimaVersionBuena?.fecha ?? null }));
}
function leerConservados(entrada: unknown, estado: EstadoDatosPanel | null): readonly ModuloConservado[] {
  const esperados = conservadosDelEstado(estado);
  exigir(Array.isArray(entrada) && entrada.length === esperados.length);
  return esperados.map((esperado, indice) => {
    const fila = objetoTrabajo(entrada[indice], 'fecha,id');
    exigir(fila.id === esperado.id && fila.fecha === esperado.fecha);
    return Object.freeze(esperado);
  });
}
const CAMPOS_COMUNES = 'error,estado,huellaPaquete,resultado,revisionReserva,solicitudId,terminadoEn,veredicto,version';
/** Campos de cada versión del recibo; las anteriores siguen siendo válidas con su forma. */
const CAMPOS_POR_VERSION: ReadonlyMap<unknown, string> = new Map([
  [1, `accion,${CAMPOS_COMUNES}`],
  [2, `accion,${CAMPOS_COMUNES}`],
  [VERSION_CON_CATALOGO, `accion,catalogo,${CAMPOS_COMUNES}`],
  [VERSION_CON_CONSERVADOS, `accion,catalogo,conservados,${CAMPOS_COMUNES}`],
]);
function versionDeclarada(entrada: unknown): unknown {
  const descriptor =
    typeof entrada === 'object' && entrada !== null ? Object.getOwnPropertyDescriptor(entrada, 'version') : null;
  return descriptor && 'value' in descriptor ? descriptor.value : null;
}
/** Contrato compartido por el receptor y la comprobación local del ejecutor. No autoriza ni activa datos. */
export function leerResultado(entrada: unknown): ResultadoValidado {
  const campos = CAMPOS_POR_VERSION.get(versionDeclarada(entrada));
  exigir(campos !== undefined);
  const o = objetoTrabajo(entrada, campos);
  exigir(o.version !== 1 || o.accion === 'actualizar-datos' || o.accion === 'reintentar-pendientes');
  // Validar en ámbar solo lo admite el contrato que dice qué quedó en su versión anterior.
  exigir(o.resultado !== 'validado' || o.veredicto === 'verde' || o.version === VERSION_CON_CONSERVADOS);
  const recibo = leerReciboTrabajo({
    solicitudId: o.solicitudId,
    revisionReserva: o.revisionReserva,
    accion: o.accion,
    resultado: o.resultado,
    veredicto: o.veredicto,
    terminadoEn: o.terminadoEn,
    huellaPaquete: o.huellaPaquete,
    error: o.error,
  });
  const estado = leerDatosDeRecibo(recibo, o.estado);
  const catalogo = 'catalogo' in o ? leerCatalogoDeRecibo(recibo, o.catalogo) : undefined;
  exigir(catalogo == null || estado !== null);
  if (!('conservados' in o)) {
    return { recibo, estado, ...(catalogo === undefined ? {} : { catalogo }) };
  }
  const conservados = Object.freeze(leerConservados(o.conservados, estado));
  exigir(recibo.resultado !== 'validado' || recibo.veredicto === 'verde' || conservados.length > 0);
  return { recibo, estado, ...(catalogo === undefined ? {} : { catalogo }), conservados };
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
  if (peticion.url !== `${origen}${RUTA_RESULTADO_ACTUALIZACION}`) {
    throw new RechazoResultado(ESTADO_HTTP.noEncontrado, 'ruta_no_encontrada');
  }
  if (peticion.method !== 'POST') {
    throw new RechazoResultado(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  const autorizacion = peticion.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(autorizacion)?.[1];
  if (!token || token.length > MAX_TOKEN) {
    throw new RechazoResultado(ESTADO_HTTP.noAutenticado, 'no_autorizado');
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    throw new RechazoResultado(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
  const longitud = peticion.headers.get('content-length');
  if (longitud !== null) {
    if (!/^(0|[1-9]\d*)$/.test(longitud)) {
      throw new RechazoResultado(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
    }
    if (Number(longitud) > MAX_RESULTADO_ACTUALIZACION_BYTES) {
      throw new RechazoResultado(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
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
/** El trabajo al que responde un recibo o un cierre; el cierre no trae hora: la pone el servidor al guardarlo. */
function trabajoDelEnvio(
  trabajo: TrabajoPrivado | null,
  envio: ReciboTrabajo | CierreSinRecibo,
  ahora: number,
): TrabajoPrivado {
  if (
    !trabajo ||
    trabajo.solicitudId !== envio.solicitudId ||
    trabajo.revisionReserva !== envio.revisionReserva ||
    trabajo.accion !== envio.accion ||
    ('terminadoEn' in envio && !tiempoReciboAdmitido(envio.terminadoEn, trabajo.creadoEn, ahora))
  ) {
    throw new RechazoResultado(ESTADO_HTTP.conflicto, 'conflicto');
  }
  return trabajo;
}
async function leerCuerpo(peticion: Request, senal: AbortSignal) {
  const lector = peticion.body?.getReader();
  if (!lector) {
    throw new RechazoResultado(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
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
      if (total > MAX_RESULTADO_ACTUALIZACION_BYTES) {
        throw new RechazoResultado(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');
      }
      partes.push(value);
    }
    const bytes = concatenar(partes, total);
    try {
      const valor: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      return esCierreSinRecibo(valor) ? { cierre: leerCierreSinRecibo(valor) } : { ...leerResultado(valor), bytes };
    } catch {
      throw new RechazoResultado(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
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
  if (error instanceof RechazoResultado) {
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
/**
 * La caché conserva un único verificador de los pins actuales, nunca una autorización. Su vuelo JWKS tiene
 * plazo propio compartido; la retirada de un receptor no cancela a otro. El plazo exterior y las comprobaciones
 * tras cada espera impiden registrar un recibo tardío de una petición retirada.
 * La huella usa los bytes completos validados: un reintento debe conservar exactamente el mismo cuerpo.
 */
export function crearReceptorResultadoActualizacion({
  origen: entradaOrigen,
  permitirHttpLocal = false,
  almacen,
  pedir = fetch,
  ahora = Date.now,
}: OpcionesReceptorResultado): (peticion: Request) => Promise<Response> {
  const origen = validarOrigenAdministrativo(entradaOrigen, permitirHttpLocal);
  let cache: { clave: string; verificar: ReturnType<typeof crearVerificadorOidcGitHub> } | undefined;
  const verificador = (confianza: ConfianzaOidcGitHub) => {
    const clave = JSON.stringify(confianza);
    if (cache?.clave !== clave) {
      cache = { clave, verificar: crearVerificadorOidcGitHub(confianza, pedir, ahora) };
    }
    return cache.verificar;
  };
  const procesar = async (peticion: Request, token: string, senal: AbortSignal): Promise<Response> => {
    const cuerpo = await leerCuerpo(peticion, senal);
    senal.throwIfAborted();
    const privado = leerEstadoTrabajosPrivado(await almacen.leerTrabajoPrivado());
    senal.throwIfAborted();
    const trabajo = trabajoDelEnvio(privado.ultimoTrabajo, 'cierre' in cuerpo ? cuerpo.cierre : cuerpo.recibo, ahora());
    const identidad = await verificador(trabajo.confianza)(token);
    senal.throwIfAborted();
    if (identidad?.runAttempt !== '1' || (trabajo.runId !== null && trabajo.runId !== identidad.runId)) {
      throw new RechazoResultado(ESTADO_HTTP.noAutenticado, 'no_autorizado');
    }
    const resultado =
      'cierre' in cuerpo
        ? await almacen.cerrarSinRecibo(cuerpo.cierre, identidad)
        : await almacen.registrarRecibo(
            cuerpo.recibo,
            sha256Hex(cuerpo.bytes),
            identidad,
            cuerpo.estado,
            cuerpo.catalogo,
          );
    senal.throwIfAborted();
    return resultado.estado === 'conflicto'
      ? respuesta(ESTADO_HTTP.conflicto, 'conflicto')
      : respuesta(ESTADO_HTTP.correcto, resultado.estado);
  };
  return async (peticion) => {
    try {
      const token = frontera(peticion, origen);
      return await dentroDelPlazo((senal) => procesar(peticion, token, senal), PLAZO_RESULTADO_MS, peticion.signal);
    } catch (error) {
      return respuestaDelError(error, peticion);
    } finally {
      descartarCuerpo(peticion);
    }
  };
}
