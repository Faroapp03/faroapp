import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
/** Consulta una ejecución ya conocida; ausencia, cancelación solicitada o silencio no prueban que haya terminado. */

import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { esObjeto } from '../comun/json.ts';
import { pedirSinRedirecciones } from '../comun/salida-sin-redirecciones.ts';
import { type EvidenciaIntentoActivacionCompletado, leerEvidenciaIntentoActivacion } from './activacion.ts';
import { leerDestinoActualizacionGitHub } from './ejecutor-github.ts';
import { leerConfianzaOidcGitHub } from './oidc-github.ts';
import {
  type EvidenciaEjecucionCompletada,
  esIdEjecucion,
  exigirTrabajo,
  leerEvidenciaEjecucionCompletada,
  type TrabajoPrivado,
} from './trabajos.ts';

export type ResultadoConsultaEjecucion =
  | { readonly estado: 'completada'; readonly evidencia: EvidenciaEjecucionCompletada }
  | { readonly estado: 'en-curso' }
  | { readonly estado: 'no-disponible' };
export interface OpcionesConsultaEjecucion {
  readonly obtenerToken: () => Promise<string>;
  readonly pedir?: typeof fetch;
}
const PLAZO_MS = 3000;
const MAX_RESPUESTA_BYTES = 131_072;
const MAX_TOKEN = 4096;
const ESTADOS_EN_CURSO = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);

function destinoDelTrabajo(trabajo: TrabajoPrivado) {
  const confianza = leerConfianzaOidcGitHub(trabajo.confianza);
  const partes = /^([^/]+)\/([^/]+)\/\.github\/workflows\/([^@]+)@(.+)$/.exec(confianza.workflowRef);
  exigirTrabajo(partes !== null && partes[4] === confianza.ref);
  return leerDestinoActualizacionGitHub({
    propietario: partes[1] ?? '',
    repositorio: partes[2] ?? '',
    workflow: partes[3] ?? '',
    ref: confianza.ref,
  });
}

/** Se acota el flujo real, no solo Content-Length; nunca se siguen enlaces devueltos por GitHub. */
async function leerRespuesta(respuesta: Response, senal: AbortSignal): Promise<unknown> {
  const longitud = respuesta.headers.get('content-length');
  if (
    respuesta.status !== ESTADO_HTTP.correcto ||
    respuesta.redirected ||
    !respuesta.body ||
    !/^application\/json(?:;\s*charset=utf-8)?$/i.test(respuesta.headers.get('content-type') ?? '') ||
    (longitud !== null && (!/^(0|[1-9]\d*)$/.test(longitud) || Number(longitud) > MAX_RESPUESTA_BYTES))
  ) {
    void respuesta.body?.cancel().catch(() => undefined);
    throw new Error('Respuesta de ejecución no válida');
  }
  const lector = respuesta.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const cancelar = () => {
    void lector.cancel().catch(() => undefined);
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
      exigirTrabajo(total <= MAX_RESPUESTA_BYTES);
      texto += decoder.decode(value, { stream: true });
    }
  } finally {
    senal.removeEventListener('abort', cancelar);
    cancelar();
    lector.releaseLock();
  }
}

/** Con `intento` null vale cualquier intento: el último de la ejecución, sea cual sea. */
function identificar(entrada: unknown, trabajo: TrabajoPrivado, intento: string | null = '1') {
  exigirTrabajo(esObjeto(entrada));
  const repositorio = entrada.repository;
  exigirTrabajo(esObjeto(repositorio) && esObjeto(repositorio.owner));
  exigirTrabajo(
    typeof entrada.id === 'number' && Number.isSafeInteger(entrada.id) && String(entrada.id) === trabajo.runId,
  );
  exigirTrabajo(
    typeof entrada.run_attempt === 'number' &&
      Number.isSafeInteger(entrada.run_attempt) &&
      (intento === null || String(entrada.run_attempt) === intento) &&
      entrada.event === 'workflow_dispatch',
  );
  exigirTrabajo(
    typeof repositorio.id === 'number' &&
      Number.isSafeInteger(repositorio.id) &&
      String(repositorio.id) === trabajo.confianza.repositorioId,
  );
  exigirTrabajo(
    typeof repositorio.owner.id === 'number' &&
      Number.isSafeInteger(repositorio.owner.id) &&
      String(repositorio.owner.id) === trabajo.confianza.propietarioId,
  );
  exigirTrabajo(entrada.head_sha === trabajo.confianza.sha);
  const destino = destinoDelTrabajo(trabajo);
  const workflowPath = `.github/workflows/${destino.workflow}`;
  // REST puede incluir el ref corto junto a la ruta. No se interpreta como un claim OIDC de workflow_sha.
  const refCorto = destino.ref.replace(/^refs\/(heads|tags)\//, '');
  exigirTrabajo(
    entrada.path === workflowPath ||
      entrada.path === `${workflowPath}@${refCorto}` ||
      entrada.path === `${workflowPath}@${destino.ref}`,
  );
  return { entrada, repositorioId: String(repositorio.id), propietarioId: String(repositorio.owner.id), workflowPath };
}

function resultadoDelRun(
  valor: unknown,
  trabajo: TrabajoPrivado,
  intento: string | null = '1',
): ResultadoConsultaIntentoActivacion {
  const { entrada, repositorioId, propietarioId, workflowPath } = identificar(valor, trabajo, intento);
  if (typeof entrada.status === 'string' && ESTADOS_EN_CURSO.has(entrada.status)) {
    exigirTrabajo(entrada.conclusion === null);
    return { estado: 'en-curso' };
  }
  exigirTrabajo(entrada.status === 'completed');
  return {
    estado: 'completada',
    evidencia: leerEvidenciaIntentoActivacion({
      estado: 'completed',
      evento: entrada.event,
      runId: String(entrada.id),
      runAttempt: intento ?? String(entrada.run_attempt),
      repositorioId,
      propietarioId,
      sha: entrada.head_sha,
      workflowPath,
      conclusion: entrada.conclusion,
    }),
  };
}

/** Un solo GET sin reintentos ni efectos. El almacén debe volver a cotejar la reserva antes de aplicar la evidencia. */
export type ResultadoConsultaIntentoActivacion =
  | { readonly estado: 'completada'; readonly evidencia: EvidenciaIntentoActivacionCompletado }
  | { readonly estado: 'en-curso' | 'no-disponible' };
function crearConsultor({ obtenerToken, pedir = fetch }: OpcionesConsultaEjecucion, exacto: boolean) {
  return async (
    trabajo: TrabajoPrivado,
    intento: string | null,
    retirada: AbortSignal,
  ): Promise<ResultadoConsultaIntentoActivacion> => {
    try {
      const destino = destinoDelTrabajo(trabajo);
      exigirTrabajo(esIdEjecucion(trabajo.runId) && (intento === null || esIdEjecucion(intento)));
      return await dentroDelPlazo(
        async (senal) => {
          const token = await obtenerToken();
          senal.throwIfAborted();
          exigirTrabajo(
            typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN && !/[^\x21-\x7e]/.test(token),
          );
          const peticion = new Request(
            `https://api.github.com/repos/${destino.propietario}/${destino.repositorio}/actions/runs/${trabajo.runId}${exacto ? `/attempts/${intento}` : ''}`,
            {
              method: 'GET',
              redirect: 'manual',
              signal: senal,
              headers: {
                ...cabecerasIdentidadWeb(),
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2026-03-10',
              },
            },
          );
          const respuesta = await pedirSinRedirecciones(peticion, undefined, pedir);
          const entrada = await leerRespuesta(respuesta, senal);
          senal.throwIfAborted();
          return resultadoDelRun(entrada, trabajo, intento);
        },
        PLAZO_MS,
        retirada,
      );
    } catch {
      return { estado: 'no-disponible' };
    }
  };
}

/** El primer intento es el único que ejecuta el motor, incluso si GitHub ya muestra una repetición. */
export function crearConsultorEjecucionGitHub(opciones: OpcionesConsultaEjecucion) {
  const consultar = crearConsultor(opciones, true);
  return async (trabajo: TrabajoPrivado, retirada: AbortSignal): Promise<ResultadoConsultaEjecucion> => {
    const resultado = await consultar(trabajo, '1', retirada);
    return resultado.estado === 'completada'
      ? { estado: 'completada', evidencia: leerEvidenciaEjecucionCompletada(resultado.evidencia) }
      : resultado;
  };
}

/** Nunca usa el punto de acceso de la ejecución vigente como prueba del intento anterior. */
export function crearConsultorIntentoActivacionGitHub(opciones: OpcionesConsultaEjecucion) {
  return crearConsultor(opciones, true);
}
/**
 * Si la ejecución entera ha terminado, en su último intento: un «Re-run jobs» en marcha cuenta como en curso. Lo usa
 * el cierre pedido desde el panel, que no puede saber cuántos intentos tuvo la ejecución.
 */
export function crearConsultorFinEjecucionGitHub(opciones: OpcionesConsultaEjecucion) {
  const consultar = crearConsultor(opciones, false);
  return (trabajo: TrabajoPrivado, retirada: AbortSignal) => consultar(trabajo, null, retirada);
}
