// El glosario de la guía «Qué es la IA», en el orden alfabético de la lengua de la página. Cada lista
// <dl data-glosario> tiene sus entradas (<div> con su <dt> y su <dd>) escritas en el orden del castellano, que es el del
// HTML; con el diccionario cargado, y después de cada cambio de idioma, se reordenan por el término que se lee, con la
// comparación de esa lengua (Intl.Collator): en catalán, «Intel·ligència» va detrás de «IA generativa» y «Biaix»
// detrás de «Al·lucinació». Solo cambia el orden de los nodos, no su contenido, sus id ni sus enlaces. Sin la lista en
// la página, no hace nada. Sin JavaScript, el glosario se lee en el orden del HTML. No usa red ni almacenamiento.

import './sitio.js';
import { alCambiarIdioma } from './idioma.js';
import { idiomaActual } from './textos.js';

/**
 * El término de una entrada, tal como se lee ahora: el texto de su <dt>, sin espacios de sobra.
 * @param {Element} entrada @returns {string}
 */
function terminoDe(entrada) {
  return (entrada.querySelector('dt')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Las entradas de una lista en el orden alfabético de `idioma`, sin distinguir mayúsculas ni acentos en la primera
 * pasada (el orden de un diccionario).
 * @param {readonly Element[]} entradas @param {string} idioma @returns {Element[]}
 */
export function enOrdenAlfabetico(entradas, idioma) {
  const comparar = new Intl.Collator(idioma, { sensitivity: 'base', ignorePunctuation: false }).compare;
  return [...entradas].sort((una, otra) => comparar(terminoDe(una), terminoDe(otra)));
}

/** Ordena cada lista del glosario de la página en la lengua en curso. Si ya lo está, no toca el DOM. */
export function ordenarGlosario() {
  for (const lista of document.querySelectorAll('[data-glosario]')) {
    const entradas = [...lista.children];
    const ordenadas = enOrdenAlfabetico(entradas, idiomaActual());
    if (ordenadas.some((entrada, posicion) => entrada !== entradas[posicion])) {
      lista.replaceChildren(...ordenadas);
    }
  }
}

ordenarGlosario();
alCambiarIdioma(ordenarGlosario);
