/**
 * La página de una dirección que no existe en el servidor local, como en el Worker (cloudflare/pagina-no-existe.ts):
 * la carga de una página con GET de una dirección sin archivo, o de la propia página por su nombre, recibe un 404 con
 * web/no-existe.html, sin guardar y con las cabeceras de esa página. Lo demás lo responde el servidor como siempre.
 */
import { createReadStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { CabecerasDeLaWeb } from '../cabeceras-web.ts';
import { PAGINA_NO_EXISTE, seSirveLaPaginaNoExiste } from '../pagina-no-existe.ts';
import { responderTexto } from './envio-de-archivos.ts';

/** La web que se sirve: su carpeta y sus cabeceras. */
interface WebServida {
  readonly carpeta: string;
  readonly cabeceras: CabecerasDeLaWeb;
}

/** Las cabeceras de una petición de Node como las de Fetch: las repetidas, unidas por comas. */
function cabecerasDe(req: IncomingMessage): Headers {
  const cabeceras = new Headers();
  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor !== undefined) {
      cabeceras.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor);
    }
  }
  return cabeceras;
}

/** Si la petición recibe la página de una dirección que no existe. */
export function recibeLaPaginaNoExiste(req: IncomingMessage, ruta: string, existe: boolean): boolean {
  return seSirveLaPaginaNoExiste({ method: req.method ?? 'GET', headers: cabecerasDe(req) }, ruta, existe);
}

/**
 * Envía la página con 404. Si no se puede abrir, el 404 de texto que el servidor da a cualquier archivo que falta.
 * pipeline recoge el error de la lectura y el corte del cliente, y cierra el archivo y la respuesta.
 */
export function enviarPaginaNoExiste(web: WebServida, res: ServerResponse): void {
  const archivo = createReadStream(join(web.carpeta, PAGINA_NO_EXISTE.slice(1)));
  const alNoAbrir = (): void => responderTexto(res, ESTADO_HTTP.noEncontrado, 'No encontrado', web.cabeceras.web);
  archivo.once('error', alNoAbrir);
  archivo.once('open', () => {
    archivo.off('error', alNoAbrir);
    res.writeHead(ESTADO_HTTP.noEncontrado, {
      ...web.cabeceras.paraRuta(PAGINA_NO_EXISTE),
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    pipeline(archivo, res).catch(() => res.destroy());
  });
}
