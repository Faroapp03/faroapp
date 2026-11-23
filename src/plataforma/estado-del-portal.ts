/**
 * El estado del portal de acceso general que pide cada página (web/scripts/salir-portal.js) para ofrecer «Salir». Con el
 * portal, lo contesta el propio portal a una sesión activa (cloudflare/acceso-portal.ts). Sin portal (la instalación
 * pública, la privada con Basic y el servidor local) no hay ninguna sesión que consultar: la respuesta es siempre la
 * misma, sin leer cookies ni ninguna autoridad, así que no distingue a nadie ni dice nada de ninguna sesión.
 */
import { ESTADO_HTTP } from '../comun/estados-http.ts';

export const RUTA_ESTADO_DEL_PORTAL = '/acceso-web/estado';

/** El cuerpo, siempre el mismo, de una instalación sin portal. */
export const CUERPO_SIN_PORTAL = '{"portal":false}';

export const CABECERAS_SIN_PORTAL: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
});

/** La respuesta sin portal si `url` es la del estado del portal; si no, null. */
export function respuestaSinPortalEn(url: URL, metodo: string): Response | null {
  return url.pathname === RUTA_ESTADO_DEL_PORTAL ? respuestaSinPortal(metodo) : null;
}

/** La respuesta de una instalación sin portal: 200 con `{"portal":false}` a GET y HEAD; 405 a lo demás. */
export function respuestaSinPortal(metodo: string): Response {
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    return new Response(null, {
      status: ESTADO_HTTP.metodoNoAdmitido,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
  }
  return new Response(metodo === 'HEAD' ? null : CUERPO_SIN_PORTAL, {
    status: ESTADO_HTTP.correcto,
    headers: CABECERAS_SIN_PORTAL,
  });
}
