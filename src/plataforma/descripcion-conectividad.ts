/** Descripciones de los canales realmente habilitados. La autoridad la captura el montaje; los archivos no la deciden. */
import { type DocumentoControles, leerDocumentoControles } from '../administracion/controles.ts';
import { HERRAMIENTAS } from '../api/mcp/definiciones.ts';
import { dentroDelPlazo, PLAZO_PETICION_MS } from '../api/plazo.ts';
import { RUTA_SOCIOS } from '../api/socios/metadatos.ts';
import { esObjeto } from '../comun/json.ts';

export type RutaDescripcion = '/openapi.json' | '/llms.txt';
export type ControlesDescripcion = DocumentoControles | 'apagado-sin-administracion' | null;
type ServiciosConfirmados = Pick<DocumentoControles, 'api' | 'mcp' | 'a2a'>;
type Lector = (ruta: RutaDescripcion, senal: AbortSignal) => Promise<Response>;
export interface OpcionesDescripcion {
  diagnosticar(error: unknown): void;
  readonly plazoMs?: number;
}
const MAX_DESCRIPCION_BYTES = 524288;
const HTTP_OK = 200,
  HTTP_ERROR = 503,
  HTTP_METODO = 405,
  HTTP_SOLICITUD = 400;
export function esDescripcionDeConectividad(camino: string): camino is RutaDescripcion {
  return camino === '/openapi.json' || camino === '/llms.txt';
}
function respuesta(
  peticion: Request,
  cuerpo: string,
  estado: number,
  cabeceras: ConstructorParameters<typeof Headers>[0],
): Response {
  const headers = new Headers(cabeceras);
  headers.set('cache-control', 'no-store');
  for (const clave of ['etag', 'last-modified', 'expires', 'content-length', 'content-encoding']) {
    headers.delete(clave);
  }
  return new Response(peticion.method === 'HEAD' ? null : cuerpo, { status: estado, headers });
}
function fallo(peticion: Request, codigo: string, estado = HTTP_ERROR): Response {
  return respuesta(peticion, JSON.stringify({ error: codigo }), estado, {
    'content-type': 'application/json; charset=utf-8',
  });
}
async function leerCuerpo(origen: Response, senal: AbortSignal): Promise<string> {
  if (!origen.ok || !origen.body) {
    throw new Error('Descripción no disponible');
  }
  const lector = origen.body.getReader();
  const cancelar = () => {
    void lector.cancel(senal.reason).catch(() => {});
  };
  senal.addEventListener('abort', cancelar, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let leidos = 0,
    contenido = '',
    completa = false;
  try {
    senal.throwIfAborted();
    while (true) {
      const trozo = await lector.read();
      senal.throwIfAborted();
      if (trozo.done) {
        completa = true;
        break;
      }
      leidos += trozo.value.byteLength;
      if (leidos > MAX_DESCRIPCION_BYTES) {
        throw new Error('Descripción demasiado grande');
      }
      contenido += decoder.decode(trozo.value, { stream: true });
    }
    return contenido + decoder.decode();
  } finally {
    senal.removeEventListener('abort', cancelar);
    if (!completa) {
      void lector.cancel().catch(() => {});
    }
    lector.releaseLock();
  }
}
function openapi(contenido: string, controles: ServiciosConfirmados): string {
  const documento: unknown = JSON.parse(contenido);
  if (
    !esObjeto(documento) ||
    documento.openapi !== '3.1.0' ||
    !esObjeto(documento.paths) ||
    !esObjeto(documento.components)
  ) {
    throw new Error('OpenAPI no válido');
  }
  if (controles.api === 'deshabilitada') {
    documento.paths = Object.fromEntries(
      Object.entries(documento.paths).filter(([ruta]) => ruta !== RUTA_SOCIOS && !ruta.startsWith(`${RUTA_SOCIOS}/`)),
    );
    const seguridad = documento.components.securitySchemes;
    if (esObjeto(seguridad)) {
      delete seguridad.socios;
      delete seguridad.credencialesDeSocio;
      if (!Object.keys(seguridad).length) {
        delete documento.components.securitySchemes;
      }
    }
    if (esObjeto(documento.components.schemas)) {
      delete documento.components.schemas.ErrorDeOAuth;
    }
  }
  return `${JSON.stringify(documento, null, 2)}\n`;
}
function llms(contenido: string, controles: ServiciosConfirmados): string {
  if (!contenido.startsWith('# Faro\n')) {
    throw new Error('Descripción no válida');
  }
  const canales: string[] = [];
  if (controles.mcp) {
    canales.push(
      '- [MCP para asistentes de IA](/mcp): acceso abierto, sin clave. El nombre del cliente es declarado, no una identidad verificada.',
    );
  }
  if (controles.a2a) {
    canales.push(
      '- [A2A para agentes de IA](/a2a): acceso abierto, determinista. [Tarjeta del agente](/.well-known/agent-card.json).',
    );
  }
  if (controles.api === 'habilitada') {
    canales.push(
      '- API para instituciones: credenciales entregadas por invitación. [Contrato OpenAPI](/openapi.json).',
    );
  }
  if (!canales.length) {
    return contenido;
  }
  const consultas = HERRAMIENTAS.map(({ name, title }) => `- \`${name}\`: ${title}.`).join('\n');
  const registro =
    'Faro no guarda el contenido ni los argumentos de las consultas. Conserva recuentos por operación; en MCP, también el nombre técnico declarado y saneado del cliente.\n';
  return `${contenido.trimEnd()}\n\n## Conectividad disponible\n\n${canales.join('\n')}\n\nConsultas factuales disponibles en estos canales:\n\n${consultas}\n\n${registro}`;
}
/** El lector solo recibe estas dos rutas del propio despliegue. No se usa información del visitante para elegir un archivo. */
export async function respuestaDeDescripcion(
  peticion: Request,
  controles: ControlesDescripcion,
  leer: Lector,
  { diagnosticar, plazoMs = PLAZO_PETICION_MS }: OpcionesDescripcion,
): Promise<Response> {
  const url = new URL(peticion.url);
  if (!esDescripcionDeConectividad(url.pathname) || url.search) {
    return fallo(peticion, 'solicitud_invalida', HTTP_SOLICITUD);
  }
  if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
    const r = fallo(peticion, 'metodo_no_admitido', HTTP_METODO);
    r.headers.set('allow', 'GET, HEAD');
    return r;
  }
  if (!controles) {
    diagnosticar(new Error('Autoridad de controles no disponible'));
    return fallo(peticion, 'controles_no_disponibles');
  }
  let confirmados: ServiciosConfirmados;
  try {
    // Solo el montaje puede confirmar este apagado sin autoridad; no se inventa un documento durable.
    confirmados =
      controles === 'apagado-sin-administracion'
        ? { api: 'deshabilitada', mcp: false, a2a: false }
        : leerDocumentoControles(controles);
  } catch (error) {
    diagnosticar(error);
    return fallo(peticion, 'controles_no_disponibles');
  }
  const ruta = url.pathname;
  try {
    return await dentroDelPlazo(
      async (senal) => {
        const archivo = await leer(ruta, senal);
        if (senal.aborted) {
          void archivo.body?.cancel().catch(() => {});
          senal.throwIfAborted();
        }
        const contenido = await leerCuerpo(archivo, senal);
        const json = ruta === '/openapi.json';
        const cuerpo = json ? openapi(contenido, confirmados) : llms(contenido, confirmados);
        const headers = new Headers(archivo.headers);
        headers.set('content-type', json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
        return respuesta(peticion, cuerpo, HTTP_OK, headers);
      },
      plazoMs,
      peticion.signal,
    );
  } catch (error) {
    diagnosticar(error);
    return fallo(peticion, 'descripcion_no_disponible');
  }
}
