// Envío de los archivos de la web y del paquete en el servidor local, con los mismos métodos que el servicio de
// archivos de Cloudflare: GET y HEAD; cualquier otro, 405 con Allow y sin el archivo.
import { createReadStream } from 'node:fs';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';

/** Las cabeceras de toda respuesta de la web que se sirve. */
export type DeLaWeb = Readonly<Record<string, string>>;

/** Los métodos con que se leen los archivos de la web y del paquete. */
const METODOS_DE_ARCHIVO = 'GET, HEAD';

/** Responde un texto breve con las cabeceras de seguridad de la web: para los errores al servir archivos. */
export function responderTexto(res: ServerResponse, estado: number, texto: string, deLaWeb: DeLaWeb): void {
  res.writeHead(estado, { ...deLaWeb, 'content-type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

/**
 * Envía un archivo con estas cabeceras si el método lo lee (GET o HEAD); si no, 405 con Allow y las cabeceras de
 * seguridad, sin abrir el archivo. La respuesta empieza cuando el archivo ya está abierto: si no se puede abrir (se ha
 * borrado o no se puede leer), 404. Después, pipeline (no pipe, que no reenvía errores) recoge el error de la lectura y
 * el corte del cliente, y cierra el archivo y la respuesta.
 */
export function enviarArchivo(
  ruta: string,
  cabeceras: OutgoingHttpHeaders,
  res: ServerResponse,
  deLaWeb: DeLaWeb,
): void {
  if (res.req.method !== 'GET' && res.req.method !== 'HEAD') {
    responderTexto(res, ESTADO_HTTP.metodoNoAdmitido, 'Método no admitido', { ...deLaWeb, allow: METODOS_DE_ARCHIVO });
    return;
  }
  const archivo = createReadStream(ruta);
  const alNoAbrir = (): void => responderTexto(res, ESTADO_HTTP.noEncontrado, 'No encontrado', deLaWeb);
  archivo.once('error', alNoAbrir);
  archivo.once('open', () => {
    archivo.off('error', alNoAbrir);
    res.writeHead(ESTADO_HTTP.correcto, cabeceras);
    pipeline(archivo, res).catch(() => res.destroy());
  });
}
