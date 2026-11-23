/**
 * La entrada de la encuesta en el servidor local de Node: el mismo punto público que en el Worker, uno por servidor con
 * su ventana de envíos, sobre el almacén de la encuesta que lleva el montaje del panel (node/administracion-almacen.ts).
 * Sin panel no hay almacén y el punto responde 503, como el Worker sin su objeto durable. Recibe solo la petición que
 * arma el servidor: ni el socket ni su dirección llegan aquí.
 */
import type { ConAlmacenDeEncuesta } from './panel-http.ts';
import { crearPuntoDeEncuesta } from './punto-publico.ts';

export { RUTA_DE_LA_ENCUESTA } from './punto-publico.ts';

export function crearEntradaNode(montaje: ConAlmacenDeEncuesta | undefined): (peticion: Request) => Promise<Response> {
  const recibir = crearPuntoDeEncuesta();
  return (peticion) => recibir(peticion, montaje?.encuesta);
}
