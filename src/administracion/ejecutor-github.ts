/** Despacha un workflow fijo. La aceptación de GitHub no acredita ejecución, validación ni despliegue. */
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
import { pedirSinRedirecciones } from '../comun/salida-sin-redirecciones.ts';
import { type AccionActualizacion, accion, esIdEjecucion, exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';

export type { AccionActualizacion };
export interface SolicitudActualizacion {
  readonly revisarPaquetePendiente?: true;
  readonly solicitudId: string;
  readonly accion: AccionActualizacion;
  readonly revisionReserva: number;
}
export interface DestinoActualizacionGitHub {
  readonly propietario: string;
  readonly repositorio: string;
  readonly workflow: string;
  readonly ref: string;
}
export type ResultadoDespacho =
  | { readonly estado: 'despachada'; readonly runId: string }
  | { readonly estado: 'rechazada' | 'incierta' };
export interface OpcionesDespachoGitHub {
  readonly destino: DestinoActualizacionGitHub;
  /** Se resuelve en el servidor; nunca forma parte de los inputs ni del resultado. */
  readonly obtenerToken: () => Promise<string>;
  readonly pedir?: typeof fetch;
}

const PLAZO_DESPACHO_MS = 3000;
const MAX_RESPUESTA_BYTES = 4096;
const MAX_TOKEN_CARACTERES = 4096;
const VERSION_API_GITHUB = '2026-03-10';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOMBRE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RECHAZOS_DEFINITIVOS: ReadonlySet<number> = new Set([
  ESTADO_HTTP.noAutenticado,
  ESTADO_HTTP.prohibido,
  ESTADO_HTTP.noEncontrado,
  ESTADO_HTTP.contenidoNoProcesable,
]);

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Configuración o solicitud de actualización no válida');
  }
}
function referenciaValida(ref: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) &&
    !ref.includes('..') &&
    ref
      .split('/')
      .every((tramo) => tramo !== '' && !tramo.startsWith('.') && !tramo.endsWith('.') && !tramo.endsWith('.lock'))
  );
}
export function leerDestinoActualizacionGitHub(
  entrada: DestinoActualizacionGitHub,
): Readonly<DestinoActualizacionGitHub> {
  exigir(NOMBRE.test(entrada.propietario) && NOMBRE.test(entrada.repositorio));
  exigir(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.ya?ml$/.test(entrada.workflow));
  exigir(referenciaValida(entrada.ref));
  return Object.freeze({
    propietario: entrada.propietario,
    repositorio: entrada.repositorio,
    workflow: entrada.workflow,
    ref: entrada.ref,
  });
}
function solicitudComprobada(entrada: SolicitudActualizacion): SolicitudActualizacion {
  exigir(UUID.test(entrada.solicitudId));
  exigir(accion(entrada.accion));
  exigir(Number.isSafeInteger(entrada.revisionReserva) && entrada.revisionReserva > 0);
  const pendiente = entrada.revisarPaquetePendiente;
  exigir(pendiente === undefined || (pendiente === true && entrada.accion === 'comprobar-programada'));
  return {
    solicitudId: entrada.solicitudId,
    accion: entrada.accion,
    revisionReserva: entrada.revisionReserva,
    ...(pendiente ? { revisarPaquetePendiente: true } : {}),
  };
}
/** Copia cerrada del resultado de un despacho tal como lo anota la autoridad. */
export function leerResultadoDespacho(entrada: unknown): ResultadoDespacho {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  exigirTrabajo(descriptor !== undefined && 'value' in descriptor);
  const o = objetoTrabajo(entrada, descriptor.value === 'despachada' ? 'estado,runId' : 'estado');
  if (o.estado === 'despachada') {
    exigirTrabajo(esIdEjecucion(o.runId));
    return { estado: 'despachada', runId: o.runId };
  }
  exigirTrabajo(o.estado === 'rechazada' || o.estado === 'incierta');
  return { estado: o.estado };
}

/** Lectura acotada y cancelable; un cuerpo defectuoso deja el envío incierto, nunca autoriza repetirlo. */
async function leerRespuesta(respuesta: Response, senal: AbortSignal): Promise<unknown> {
  const tipo = respuesta.headers.get('content-type') ?? '';
  const longitud = respuesta.headers.get('content-length');
  if (
    respuesta.redirected ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(tipo) ||
    (longitud !== null && (!/^(0|[1-9]\d*)$/.test(longitud) || Number(longitud) > MAX_RESPUESTA_BYTES)) ||
    !respuesta.body
  ) {
    void respuesta.body?.cancel().catch(() => {});
    throw new Error('Respuesta de despacho no válida');
  }
  const lector = respuesta.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancelar = () => {
    void lector.cancel().catch(() => {});
  };
  senal.addEventListener('abort', cancelar, { once: true });
  let total = 0;
  let texto = '';
  try {
    for (;;) {
      senal.throwIfAborted();
      const { done, value } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        return JSON.parse(texto + decoder.decode());
      }
      total += value.byteLength;
      if (total > MAX_RESPUESTA_BYTES) {
        throw new Error('Respuesta de despacho demasiado grande');
      }
      texto += decoder.decode(value, { stream: true });
    }
  } finally {
    senal.removeEventListener('abort', cancelar);
    cancelar();
    lector.releaseLock();
  }
}

/** Las URL se cotejan, pero no se siguen ni se entregan al navegador. */
function runDelResultado(entrada: unknown, destino: DestinoActualizacionGitHub): string {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const fila = entrada as Record<string, unknown>;
  const id = fila.workflow_run_id;
  exigir(typeof id === 'number' && Number.isSafeInteger(id) && id > 0);
  const ruta = `${destino.propietario}/${destino.repositorio}/actions/runs/${id}`;
  exigir(
    typeof fila.run_url === 'string' &&
      fila.run_url.toLowerCase() === `https://api.github.com/repos/${ruta}`.toLowerCase(),
  );
  exigir(
    typeof fila.html_url === 'string' && fila.html_url.toLowerCase() === `https://github.com/${ruta}`.toLowerCase(),
  );
  return String(id);
}

function peticionDeDespacho(
  destino: DestinoActualizacionGitHub,
  solicitud: SolicitudActualizacion,
  token: string,
  senal: AbortSignal,
): Request {
  const url = `https://api.github.com/repos/${destino.propietario}/${destino.repositorio}/actions/workflows/${destino.workflow}/dispatches`;
  return new Request(url, {
    method: 'POST',
    redirect: 'manual',
    signal: senal,
    headers: {
      ...cabecerasIdentidadWeb(),
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': VERSION_API_GITHUB,
    },
    body: JSON.stringify({
      ref: destino.ref,
      inputs: {
        solicitud_id: solicitud.solicitudId,
        accion: solicitud.accion,
        revision_reserva: String(solicitud.revisionReserva),
        ...(solicitud.revisarPaquetePendiente ? { revisar_paquete_pendiente: 'true' } : {}),
      },
      return_run_details: true,
    }),
  });
}

/**
 * El llamador debe reservar la solicitud durable antes de invocar el despacho. No hay reintentos automáticos:
 * una pérdida de respuesta puede esconder un workflow ya aceptado. El recibo autenticado reconciliará ese caso.
 */
export function crearDespachadorGitHub({ destino: entrada, obtenerToken, pedir = fetch }: OpcionesDespachoGitHub) {
  const destino = leerDestinoActualizacionGitHub(entrada);
  return async (entradaSolicitud: SolicitudActualizacion, retirada: AbortSignal): Promise<ResultadoDespacho> => {
    const solicitud = solicitudComprobada(entradaSolicitud);
    let enviado = false;
    try {
      return await dentroDelPlazo(
        async (senal): Promise<ResultadoDespacho> => {
          const token = await obtenerToken();
          senal.throwIfAborted();
          if (
            typeof token !== 'string' ||
            token.length < 1 ||
            token.length > MAX_TOKEN_CARACTERES ||
            /[^\x21-\x7e]/.test(token)
          ) {
            return { estado: 'rechazada' };
          }
          const peticion = peticionDeDespacho(destino, solicitud, token, senal);
          enviado = true;
          const respuesta = await pedirSinRedirecciones(peticion, undefined, pedir);
          senal.throwIfAborted();
          if (respuesta.status !== ESTADO_HTTP.correcto) {
            void respuesta.body?.cancel().catch(() => {});
            return { estado: RECHAZOS_DEFINITIVOS.has(respuesta.status) ? 'rechazada' : 'incierta' };
          }
          const runId = runDelResultado(await leerRespuesta(respuesta, senal), destino);
          senal.throwIfAborted();
          return { estado: 'despachada', runId };
        },
        PLAZO_DESPACHO_MS,
        retirada,
      );
    } catch {
      return { estado: enviado ? 'incierta' : 'rechazada' };
    }
  };
}
