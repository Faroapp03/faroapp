/** Disponibilidad pública consultada por petición; el catálogo y la autoridad permanecen separados. */
import {
  type DocumentoSecciones,
  leerDocumentoSecciones,
  politicaSeccionesInicial,
  seccionDeLaRuta,
} from '../administracion/secciones-web.js';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';

export const RUTA_SECCIONES = '/secciones.json';
/** Una lectura de navegación no espera el plazo completo de una operación administrativa. */
export const PLAZO_SECCIONES_MS = 2_000;
export type LectorSeccionesWeb = (senal: AbortSignal) => Promise<DocumentoSecciones>;

function sinContenido(estado: number): Response {
  return new Response(null, { status: estado, headers: { 'cache-control': 'no-store' } });
}

/**
 * El 503 de una lectura de la disponibilidad que ha fallado, con su motivo en el registro. Una retirada de la persona
 * no es un fallo de la autoridad: no se registra.
 */
function noDisponible(error: unknown, retirada: AbortSignal): Response {
  if (!retirada.aborted) {
    const motivo = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`La disponibilidad de las secciones de la web no se ha podido leer: ${motivo}`);
  }
  return sinContenido(ESTADO_HTTP.noDisponible);
}

/** No guarda copias del documento entre peticiones ni completa una respuesta parcial del almacén. */
async function leerDisponibilidad(lector: LectorSeccionesWeb, retirada: AbortSignal): Promise<DocumentoSecciones> {
  return dentroDelPlazo(
    async (senal) => {
      const documento = leerDocumentoSecciones(await lector(senal));
      senal.throwIfAborted();
      return documento;
    },
    PLAZO_SECCIONES_MS,
    retirada,
  );
}

/** Proyección sin credenciales ni estado de administración; HEAD comprueba la misma autoridad que GET. */
export async function respuestaDeSecciones(
  peticion: Pick<Request, 'method' | 'signal'>,
  lector?: LectorSeccionesWeb,
): Promise<Response> {
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    const respuesta = sinContenido(ESTADO_HTTP.metodoNoAdmitido);
    respuesta.headers.set('allow', 'GET, HEAD');
    return respuesta;
  }
  try {
    const documento = lector
      ? await leerDisponibilidad(lector, peticion.signal)
      : { version: 3, revision: 0, secciones: politicaSeccionesInicial() };
    return new Response(peticion.method === 'HEAD' ? null : JSON.stringify(documento), {
      headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    return noDisponible(error, peticion.signal);
  }
}

/** Reserva también alias sin convertirlos en rutas servibles. Solo una sección consulta el estado mutable. */
export async function comprobarSeccionWeb(
  camino: string,
  retirada: AbortSignal,
  lector?: LectorSeccionesWeb,
): Promise<Response | undefined> {
  const seccion = seccionDeLaRuta(camino);
  if (!seccion) {
    return undefined;
  }
  if (!lector) {
    return politicaSeccionesInicial()[seccion] ? undefined : sinContenido(ESTADO_HTTP.noEncontrado);
  }
  try {
    const documento = await leerDisponibilidad(lector, retirada);
    return documento.secciones[seccion] ? undefined : sinContenido(ESTADO_HTTP.noEncontrado);
  } catch (error) {
    return noDisponible(error, retirada);
  }
}
