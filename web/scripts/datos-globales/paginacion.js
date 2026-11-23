// La paginación de los capítulos de «Datos globales» (datos-globales.html y datos-globales-ue.html): un capítulo por
// página, con los mismos números que el índice de preguntas, como la Biblioteca (scripts/lecturas.js). Al cambiar de
// página la vista no salta: se corrige lo justo para que la barra de números quede donde estaba en la pantalla, el foco
// se queda en el número pulsado y el paso se anuncia («Página 2 de 8»). Un enlace a un capítulo (las preguntas del
// índice o una dirección con fragmento, #dg-…) abre su página y lleva el foco a su titular. Sin JavaScript no hay
// paginación: los capítulos los pinta el script, y Método y Fuentes, escritos en la página, se ven siempre.

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { marcarPasos, pasoDePagina } from '../pasos-de-pagina.js';
import { traducible } from '../textos.js';

/** La clave del nombre de cada número y del anuncio del paso: «Página {numero} de {total}». */
const CLAVE_PAGINA = 'datos-globales.pagina';

/**
 * @typedef {{ capitulos: HTMLElement[], barra: HTMLElement, lista: HTMLElement, estado: HTMLElement,
 *   actual: number }} Paginacion
 */

/** Marca con aria-current el número de la página que se ve. @param {Paginacion} paginacion */
function marcarActual({ lista, actual }) {
  const numeros = [...lista.querySelectorAll('button.dg-pagina')].filter((boton) => boton instanceof HTMLElement);
  for (const [posicion, boton] of numeros.entries()) {
    if (posicion === actual) {
      boton.setAttribute('aria-current', 'page');
    } else {
      boton.removeAttribute('aria-current');
    }
  }
  marcarPasos(lista, actual, numeros.length, numeros[actual] ?? null);
}

/** Deja a la vista solo el capítulo de la página actual. @param {Paginacion} paginacion */
function mostrar(paginacion) {
  for (const [posicion, capitulo] of paginacion.capitulos.entries()) {
    capitulo.hidden = posicion !== paginacion.actual;
  }
  marcarActual(paginacion);
}

/**
 * Pasa a otra página sin mover el foco ni la barra de números en la pantalla, y lo anuncia.
 * @param {Paginacion} paginacion @param {number} pagina
 */
function irAPagina(paginacion, pagina) {
  if (pagina === paginacion.actual || pagina < 0 || pagina >= paginacion.capitulos.length) {
    return;
  }
  const antes = paginacion.barra.getBoundingClientRect?.().top;
  paginacion.actual = pagina;
  mostrar(paginacion);
  const despues = paginacion.barra.getBoundingClientRect?.().top;
  if (antes !== undefined && despues !== undefined && despues !== antes) {
    window.scrollBy({ top: despues - antes, behavior: 'instant' });
  }
  escribir(paginacion.estado, traducible(CLAVE_PAGINA, { numero: pagina + 1, total: paginacion.capitulos.length }));
}

/**
 * Abre la página del capítulo que contiene `destino`, si está en uno; devuelve si lo estaba.
 * @param {Paginacion} paginacion @param {Element} destino @returns {boolean}
 */
export function abrirPaginaDe(paginacion, destino) {
  const posicion = paginacion.capitulos.findIndex((capitulo) => capitulo === destino || capitulo.contains(destino));
  if (posicion < 0) {
    return false;
  }
  paginacion.actual = posicion;
  mostrar(paginacion);
  return true;
}

/**
 * Pagina los capítulos: los números en la barra (uno por capítulo, con su nombre «Página N de M») y la página que pide el
 * fragmento de la dirección, o la primera. Con un solo capítulo no hay barra.
 * @param {{ capitulos: HTMLElement[], barra: HTMLElement, lista: HTMLElement, estado: HTMLElement }} partes
 * @returns {Paginacion}
 */
export function paginarCapitulos({ capitulos, barra, lista, estado }) {
  /** @type {Paginacion} */
  const paginacion = { capitulos, barra, lista, estado, actual: 0 };
  const total = capitulos.length;
  lista.replaceChildren(
    pasoDePagina('anterior', 'dg-paso', () => irAPagina(paginacion, paginacion.actual - 1)),
    ...capitulos.map((_, pagina) => {
      const boton = crear('button', { type: 'button', className: 'dg-pagina', textContent: String(pagina + 1) });
      escribirAtributo(boton, 'aria-label', traducible(CLAVE_PAGINA, { numero: pagina + 1, total }));
      boton.addEventListener('click', () => irAPagina(paginacion, pagina));
      return crear('li', {}, boton);
    }),
    pasoDePagina('siguiente', 'dg-paso', () => irAPagina(paginacion, paginacion.actual + 1)),
  );
  barra.hidden = total < 2;
  const fragmento = (globalThis.location?.hash ?? '').replace(/^#/, '');
  const pedida = /^[\w-]+$/.test(fragmento)
    ? capitulos.findIndex((capitulo) => capitulo.id === fragmento || capitulo.querySelector(`#${fragmento}`))
    : -1;
  paginacion.actual = Math.max(0, pedida);
  mostrar(paginacion);
  return paginacion;
}

// Abrir el desplegable (Método, Fuentes) que contiene lo que señala el fragmento vive ya en scripts/desplegables.js; se
// reexporta para quien la importaba de aquí.
export { abrirDesplegablesDelFragmento } from '../desplegables.js';
