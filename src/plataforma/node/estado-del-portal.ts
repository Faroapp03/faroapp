/** El estado del portal en el servidor local, que no tiene portal: siempre la misma respuesta (../estado-del-portal.ts). */
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { CUERPO_SIN_PORTAL, RUTA_ESTADO_DEL_PORTAL, respuestaSinPortal } from '../estado-del-portal.ts';

/**
 * Si `destino` es el estado del portal, escribe la respuesta sin portal con las cabeceras de la web y devuelve true;
 * si no, false y no escribe nada.
 */
export function servirSinPortal(
  destino: URL,
  { req, res }: { req: IncomingMessage; res: ServerResponse },
  cabeceras: OutgoingHttpHeaders,
): boolean {
  if (destino.pathname !== RUTA_ESTADO_DEL_PORTAL) {
    return false;
  }
  const respuesta = respuestaSinPortal(req.method ?? 'GET');
  res.writeHead(respuesta.status, { ...cabeceras, ...Object.fromEntries(respuesta.headers) });
  res.end(respuesta.status === ESTADO_HTTP.correcto && req.method !== 'HEAD' ? CUERPO_SIN_PORTAL : undefined);
  return true;
}
