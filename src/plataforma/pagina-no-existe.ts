/**
 * Cuándo una dirección que no existe recibe la página de Faro que lo explica (web/no-existe.html), igual en el Worker y
 * en el servidor local. Solo la carga de una página con GET: un guion, una API, un recurso o un HEAD reciben el 404 de
 * siempre. La página no es una dirección propia: pedida por su nombre, también es una dirección que no existe.
 */
import { esCargaDePagina, type PeticionLeida } from './navegacion.ts';

/** El archivo de la web con la página que explica que la dirección no existe. */
export const PAGINA_NO_EXISTE = '/no-existe.html';

/**
 * Si se contesta con la página de una dirección que no existe: la carga de una página de una dirección sin archivo o
 * de la propia página por su nombre.
 *
 * @param peticion - La petición.
 * @param ruta - Su ruta en la web, empezando por «/».
 * @param existe - Si los archivos de la web tienen esa ruta.
 */
export function seSirveLaPaginaNoExiste(peticion: PeticionLeida, ruta: string, existe: boolean): boolean {
  return esCargaDePagina(peticion) && (!existe || ruta === PAGINA_NO_EXISTE);
}
