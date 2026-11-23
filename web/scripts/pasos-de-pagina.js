// «‹ Anterior» y «Siguiente ›» de una paginación (la Biblioteca, lecturas.js, y Datos globales,
// datos-globales/paginacion.js): la misma caja que los números, con un chevron de trazo de adorno. En el móvil la hoja
// oculta la palabra y queda la flecha; el nombre del botón («Página anterior», «Página siguiente») lo leen siempre los
// lectores de pantalla. En la primera página «Anterior» queda desactivado; en la última, «Siguiente». Si el botón que
// tiene el foco se desactiva al llegar al extremo, el foco pasa al número de la página actual.

import { crear } from './dom.js';
import { escribir, escribirAtributo } from './idioma.js';
import { traducible } from './textos.js';

const SVG = 'http://www.w3.org/2000/svg';
/** El trazo de cada chevron, en una caja de 24 × 24. */
const TRAZOS = Object.freeze({ anterior: 'M15 6l-6 6 6 6', siguiente: 'M9 6l6 6-6 6' });

/** El chevron de un paso, de adorno. @param {'anterior' | 'siguiente'} paso @returns {SVGElement} */
function chevron(paso) {
  const svg = /** @type {SVGElement} */ (document.createElementNS(SVG, 'svg'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const trazo = document.createElementNS(SVG, 'path');
  trazo.setAttribute('d', TRAZOS[paso]);
  svg.append(trazo);
  return svg;
}

/**
 * El botón de un paso («Anterior» o «Siguiente»), dentro de su elemento de lista, con la clase de la hoja que lo pinta.
 * @param {'anterior' | 'siguiente'} paso @param {string} clase @param {() => void} alPulsar @returns {HTMLLIElement}
 */
export function pasoDePagina(paso, clase, alPulsar) {
  const palabra = escribir(crear('span', { className: `${clase}-texto` }), traducible(`comun.paginas.${paso}`));
  const boton = crear('button', { type: 'button', className: `${clase} ${clase}--${paso}` });
  boton.dataset.paso = paso;
  boton.append(...(paso === 'anterior' ? [chevron(paso), palabra] : [palabra, chevron(paso)]));
  escribirAtributo(boton, 'aria-label', traducible(`comun.paginas.${paso}.nombre`));
  boton.addEventListener('click', alPulsar);
  return crear('li', {}, boton);
}

/**
 * Desactiva los pasos en los extremos (`actual` desde 0, de `total` páginas). Si el foco estaba en un paso que se
 * desactiva, lo lleva a `numeroActual`.
 * @param {Element} lista @param {number} actual @param {number} total @param {HTMLElement | null} numeroActual
 */
export function marcarPasos(lista, actual, total, numeroActual) {
  for (const boton of lista.querySelectorAll('button[data-paso]')) {
    const desactivado = boton.getAttribute('data-paso') === 'anterior' ? actual <= 0 : actual >= total - 1;
    const teniaElFoco = document.activeElement === boton;
    if (desactivado) {
      boton.setAttribute('disabled', '');
    } else {
      boton.removeAttribute('disabled');
    }
    if (desactivado && teniaElFoco && numeroActual) {
      numeroActual.focus();
    }
  }
}
