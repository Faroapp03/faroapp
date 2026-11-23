/**
 * La respuesta del Worker a una dirección que no existe (plataforma/pagina-no-existe.ts decide cuándo). Quien la
 * escribe en el navegador recibe un 404 con la página de Faro que lo explica y le lleva al inicio; un guion, una API o
 * un recurso reciben el 404 sin cuerpo, como siempre. Pedida por su nombre, la página también responde 404.
 */
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { conCabecerasWeb } from '../cabeceras-web.ts';
import { esCargaDePagina } from '../navegacion.ts';
import { PAGINA_NO_EXISTE, seSirveLaPaginaNoExiste } from '../pagina-no-existe.ts';

/** Lo que sirve los archivos de la web: el enlace ASSETS de Cloudflare. */
type LectorDeArchivos = { fetch(peticion: Request): Promise<Response> };

/** El 404 sin cuerpo y sin guardar: lo que recibe todo lo que no es la carga de una página. */
function noEncontradoSinCuerpo(): Response {
  return new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } });
}

/**
 * El 404 de una dirección inexistente. Una navegación GET recibe la página, sin guardar y con las cabeceras de toda
 * página de la web; si la página no se puede leer, el 404 sin cuerpo. Las rutas de la página son absolutas, así que se
 * pinta igual en cualquier dirección, también en una anidada.
 */
export async function respuestaNoExiste(peticion: Request, archivos: LectorDeArchivos): Promise<Response> {
  if (!esCargaDePagina(peticion)) {
    return conCabecerasWeb(noEncontradoSinCuerpo());
  }
  const pagina = await archivos.fetch(
    new Request(new URL(PAGINA_NO_EXISTE, peticion.url), { signal: peticion.signal }),
  );
  if (!pagina.ok) {
    return conCabecerasWeb(noEncontradoSinCuerpo());
  }
  const cabeceras = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  return conCabecerasWeb(
    new Response(pagina.body, { status: ESTADO_HTTP.noEncontrado, headers: cabeceras }),
    PAGINA_NO_EXISTE,
  );
}

/**
 * Si lo que han contestado los archivos de la web se sustituye por el 404 de una dirección inexistente: la página
 * pedida por su nombre, siempre (lo que no es una navegación, sin cuerpo); un 404, solo en la carga de una página. Lo
 * demás conserva la respuesta de los archivos tal cual.
 */
export function esDireccionInexistente(peticion: Request, ruta: string, respuesta: Response): boolean {
  return (
    ruta === PAGINA_NO_EXISTE || seSirveLaPaginaNoExiste(peticion, ruta, respuesta.status !== ESTADO_HTTP.noEncontrado)
  );
}
