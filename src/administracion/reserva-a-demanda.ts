/**
 * Recibe la petición con la que un run lanzado a mano pide su reserva a demanda. Primero la identidad y después todo
 * lo demás: el cuerpo se lee y la autoridad se consulta solo con un token admitido, y cualquier identidad defectuosa
 * recibe el mismo 401, sin decir por qué.
 */
import { PlazoAgotado } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import type {
  AlmacenTrabajosDemanda,
  PeticionDemanda,
  ResultadoDemanda,
} from '../plataforma/acceso-publico/trabajos-durable.ts';
import { cabecerasDeDesafio } from '../seguridad/desafio-http.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { ACCIONES_DEMANDA, type AccionDemanda, leerConfiguracionDemanda } from './configuracion-demanda.ts';
import { crearVerificadorDemandaGitHub, type IdentidadDemandaGitHub, puedeReservar } from './oidc-demanda.ts';
import type { ConfianzaOidcGitHub } from './oidc-github.ts';

export const RUTA_RESERVA_A_DEMANDA = '/mantenimiento/reserva';
export const MAX_RESERVA_A_DEMANDA_BYTES = 1024;
const PLAZO_MS = 5000;
const MAX_TOKEN = 16_384;

interface OpcionesReceptorReserva {
  readonly origen: string;
  readonly permitirHttpLocal?: boolean;
  /** La misma confianza fijada que el panel y la programada dan a sus reservas. */
  readonly confianza: ConfianzaOidcGitHub;
  /** El texto de `FARO_ACTUALIZACION_DEMANDA` tal como llega; la autoridad lo vuelve a leer con sus techos. */
  readonly configuracionDemanda: string | undefined;
  readonly almacen: AlmacenTrabajosDemanda;
  readonly pedir?: typeof fetch;
  readonly ahora?: () => number;
}
/** Quién pide, ya verificado: solo su primer intento puede reservar; cualquier intento del run puede consultar. */
interface Solicitante {
  readonly puedeReservar: boolean;
  readonly identidad: IdentidadDemandaGitHub;
}
interface CuerpoReserva {
  readonly operacion: 'reservar' | 'consultar';
  readonly accion: AccionDemanda;
}

class RechazoReserva extends Error {
  readonly estado: number;
  readonly codigo: string;
  constructor(estado: number, codigo: string) {
    super(codigo);
    this.estado = estado;
    this.codigo = codigo;
  }
}
const NO_AUTORIZADO = () => new RechazoReserva(ESTADO_HTTP.noAutenticado, 'no_autorizado');
const INVALIDA = () => new RechazoReserva(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
const DEMASIADO_GRANDE = () => new RechazoReserva(ESTADO_HTTP.demasiadoGrande, 'cuerpo_demasiado_grande');

/** Las mismas cabeceras y la misma forma que el permiso de inicio: un 401 de aquí es igual que uno de allí. */
function respuesta(estado: number, cuerpo: Readonly<Record<string, unknown>>): Response {
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
/** Con la vía cerrada la ruta no existe: la misma respuesta que da el Worker a cualquier ruta que no tiene. */
function rutaInexistente(): Response {
  return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
}
function frontera(peticion: Request): string {
  if (peticion.method !== 'POST') {
    throw new RechazoReserva(ESTADO_HTTP.metodoNoAdmitido, 'metodo_no_admitido');
  }
  const autorizacion = peticion.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(autorizacion)?.[1];
  if (!token || token.length > MAX_TOKEN) {
    throw NO_AUTORIZADO();
  }
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(peticion.headers.get('content-type') ?? '')) {
    throw new RechazoReserva(ESTADO_HTTP.tipoNoAdmitido, 'tipo_no_admitido');
  }
  const longitud = peticion.headers.get('content-length');
  if (longitud !== null && !/^(0|[1-9]\d*)$/.test(longitud)) {
    throw INVALIDA();
  }
  if (longitud !== null && Number(longitud) > MAX_RESERVA_A_DEMANDA_BYTES) {
    throw DEMASIADO_GRANDE();
  }
  return token;
}
/** Lee como mucho 1 KiB y corta en cuanto se supera o vence el plazo, sin esperar al resto del cuerpo. */
async function leerBytes(peticion: Request, senal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const lector = peticion.body?.getReader();
  if (!lector) {
    throw INVALIDA();
  }
  const cancelar = () => {
    void lector.cancel().catch(() => undefined);
  };
  senal.addEventListener('abort', cancelar, { once: true });
  const bytes = new Uint8Array(MAX_RESERVA_A_DEMANDA_BYTES);
  let total = 0;
  try {
    for (;;) {
      senal.throwIfAborted();
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        return bytes.slice(0, total);
      }
      if (total + value.byteLength > MAX_RESERVA_A_DEMANDA_BYTES) {
        throw DEMASIADO_GRANDE();
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
  } finally {
    senal.removeEventListener('abort', cancelar);
    cancelar();
    lector.releaseLock();
  }
}
/** Exactamente `{operacion, accion}`, con la operación y la acción de sus listas cerradas. */
function leerCuerpoReserva(bytes: Uint8Array<ArrayBuffer>): CuerpoReserva {
  let valor: unknown;
  try {
    valor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw INVALIDA();
  }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw INVALIDA();
  }
  if (Object.keys(valor).sort().join(',') !== 'accion,operacion') {
    throw INVALIDA();
  }
  const { operacion, accion: entrada } = valor as Record<string, unknown>;
  const accion = ACCIONES_DEMANDA.find((admitida) => admitida === entrada);
  if ((operacion !== 'reservar' && operacion !== 'consultar') || accion === undefined) {
    throw INVALIDA();
  }
  return { operacion, accion };
}
/** La petición a la autoridad; un reintento que intenta reservar es una identidad defectuosa más. */
function peticionDemanda(
  solicitante: Solicitante,
  cuerpo: CuerpoReserva,
  fijada: Readonly<{ confianza: ConfianzaOidcGitHub; configuracionDemanda: string | undefined }>,
): PeticionDemanda {
  if (cuerpo.operacion === 'consultar') {
    return { operacion: 'consultar', runId: solicitante.identidad.ejecucion.runId };
  }
  if (!solicitante.puedeReservar) {
    throw NO_AUTORIZADO();
  }
  const { confianza, configuracionDemanda } = fijada;
  const { accion } = cuerpo;
  const configuracion = configuracionDemanda ?? null;
  return { operacion: 'reservar', accion, identidad: solicitante.identidad, confianza, configuracion };
}
/** Solo la reserva y su revisión: nada del token ni del actor sale en la respuesta. */
function respuestaDemanda(resultado: ResultadoDemanda): Response {
  if (resultado.estado === 'reservada' || resultado.estado === 'repetida') {
    const { estado, solicitudId, revisionReserva } = resultado;
    return respuesta(ESTADO_HTTP.correcto, { estado, solicitudId, revisionReserva });
  }
  if (resultado.estado === 'rechazada') {
    return respuesta(ESTADO_HTTP.conflicto, { error: resultado.motivo });
  }
  // La autoridad vuelve a leer la configuración: si para ella la vía está cerrada, la ruta tampoco existe.
  return resultado.estado === 'cerrada'
    ? rutaInexistente()
    : respuesta(ESTADO_HTTP.noEncontrado, { error: 'sin_reserva' });
}
function respuestaDelError(error: unknown, peticion: Request): Response {
  if (peticion.signal.aborted) {
    throw peticion.signal.reason;
  }
  if (error instanceof RechazoReserva) {
    return respuesta(error.estado, { error: error.codigo });
  }
  return error instanceof PlazoAgotado
    ? respuesta(ESTADO_HTTP.tiempoAgotado, { error: 'plazo_agotado' })
    : respuesta(ESTADO_HTTP.noDisponible, { error: 'no_disponible' });
}
function descartarCuerpo(peticion: Request): void {
  if (!peticion.bodyUsed) {
    void peticion.body?.cancel().catch(() => undefined);
  }
}

/**
 * Las dos operaciones pasan el verificador de demanda completo, una sola vez por token: revisión y workflow
 * autorizados, lanzamiento manual, runner de GitHub y actor de la lista. Después solo cuenta el intento: reservar
 * exige el primero; consultar admite cualquiera del mismo run.
 */
function crearIdentificador(opciones: OpcionesReceptorReserva, actores: readonly string[]) {
  const { confianza, pedir = fetch, ahora = Date.now } = opciones;
  const verificar = crearVerificadorDemandaGitHub(confianza, actores, pedir, ahora);
  return async (token: string): Promise<Solicitante> => {
    const identidad = await verificar(token);
    if (identidad === null) {
      throw NO_AUTORIZADO();
    }
    return { puedeReservar: puedeReservar(identidad), identidad };
  };
}

export function crearReceptorReservaADemanda(
  opciones: OpcionesReceptorReserva,
): (peticion: Request) => Promise<Response> {
  const origen = validarOrigenAdministrativo(opciones.origen, opciones.permitirHttpLocal ?? false);
  const lectura = leerConfiguracionDemanda(opciones.configuracionDemanda);
  if (lectura.estado === 'cerrada') {
    return async (peticion) => {
      descartarCuerpo(peticion);
      return rutaInexistente();
    };
  }
  const identificar = crearIdentificador(opciones, lectura.configuracion.actores);
  const { almacen, confianza, configuracionDemanda } = opciones;
  const procesar = async (peticion: Request, token: string, senal: AbortSignal) => {
    const solicitante = await identificar(token);
    senal.throwIfAborted();
    const cuerpo = leerCuerpoReserva(await leerBytes(peticion, senal));
    const resultado = await almacen.operarDemanda(
      peticionDemanda(solicitante, cuerpo, { confianza, configuracionDemanda }),
    );
    senal.throwIfAborted();
    return respuestaDemanda(resultado);
  };
  return async (peticion) => {
    try {
      if (peticion.url !== `${origen}${RUTA_RESERVA_A_DEMANDA}`) {
        return rutaInexistente();
      }
      const token = frontera(peticion);
      return await dentroDelPlazo((senal) => procesar(peticion, token, senal), PLAZO_MS, peticion.signal);
    } catch (error) {
      return respuestaDelError(error, peticion);
    } finally {
      descartarCuerpo(peticion);
    }
  };
}
