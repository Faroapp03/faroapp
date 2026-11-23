// Detalle opcional de lo que la ficha oficial declara; no completa ausencias.
import { crear } from '../../dom.js';
import { escribir } from '../../idioma.js';
import { traducible } from '../../textos.js';

/** @import { OpcionPlan } from '../../../../src/seleccion-formacion/contrato.ts' */
/** Va dentro de «Ver detalles» de la fila del curso: un rótulo y la lista en la lengua de la ficha.
 * @param {OpcionPlan['aprendizaje']} ficha @returns {HTMLElement|null} */
export function detalleDeFicha(ficha) {
  if (!ficha) {
    return null;
  }
  const objetivos = ficha.aprendizaje.afirmaciones.filter(
    (a) => a.dimension === 'resultado_previsto' && a.origen === 'extraccion_oficial' && a.descripcion,
  );
  if (!objetivos.length) {
    return null;
  }
  const detalle = crear('div', { className: 'rc-ficha-objetivos' });
  detalle.append(escribir(crear('p'), traducible('formacion.dos.objetivos')));
  const lista = crear('ul', {}, ...objetivos.map((a) => crear('li', { textContent: a.descripcion ?? '' })));
  if (ficha.idioma_ficha) {
    lista.lang = ficha.idioma_ficha;
  }
  detalle.append(lista);
  return detalle;
}
