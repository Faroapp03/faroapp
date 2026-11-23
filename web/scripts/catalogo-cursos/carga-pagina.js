/** En las fuentes se lee la entrega acreditada. La construcción materializa esta vista antes de empaquetarla con SRI. */
import { cargarCatalogo, proyectarListado } from '../../recursos/catalogo-cursos/lector.js';
import { REFERENCIA } from './referencia.js';
export async function cargarListado() {
  const catalogo = await cargarCatalogo(REFERENCIA, new URL('../../', import.meta.url), (peticion) => fetch(peticion));
  return proyectarListado(catalogo);
}
