// El mismo caso y renderizador publican ES y CA: solo el idioma activo entra en la página y en el PDF.
// sitio.js prepara primero el selector y el idioma elegido; la versión alternativa permanece inerte.

import './sitio.js';
import { PaginaIncompleta } from './dom.js';
import { alCambiarIdioma } from './idioma.js';
import { prepararInforme } from './informe.js';
import { idiomaActual } from './textos.js';

/** @import { Idioma } from './textos.js' */

/** El contenedor estable de la página, validado antes de capturarlo en el consumidor de idioma.
 * @returns {HTMLElement}
 */
function contenidoDelEjemplo() {
  const contenido = document.querySelector('main.informe-breve');
  if (!(contenido instanceof HTMLElement)) {
    throw new PaginaIncompleta('La página no tiene <main class="informe-breve">');
  }
  return contenido;
}
const informe = contenidoDelEjemplo();
const plantilla = document.querySelector('#informe-ejemplo-ca');
if (!(plantilla instanceof HTMLTemplateElement)) {
  throw new PaginaIncompleta('La página no tiene la versión catalana del informe de ejemplo');
}
const catalan = plantilla.content.querySelector('main.informe-breve');
if (!(catalan instanceof HTMLElement)) {
  throw new PaginaIncompleta('La versión catalana no contiene el informe de ejemplo');
}
const versiones = { es: informe.cloneNode(true), ca: catalan };

/** Conserva el main que gobierna la disponibilidad de secciones; sustituye su contenido y sus escuchas.
 * @param {Idioma} idioma
 */
function presentar(idioma) {
  const siguiente = versiones[idioma].cloneNode(true);
  if (!(siguiente instanceof HTMLElement)) {
    throw new PaginaIncompleta('No se puede presentar el informe de ejemplo');
  }
  informe.replaceChildren(...siguiente.childNodes);
  for (const atributo of ['lang', 'data-titulo-pdf', 'data-marca-ia', 'data-fuente-digital']) {
    const valor = siguiente.getAttribute(atributo);
    if (valor === null) {
      informe.removeAttribute(atributo);
    } else {
      informe.setAttribute(atributo, valor);
    }
  }
  prepararInforme(informe);
}

presentar(idiomaActual());
alCambiarIdioma(presentar);
