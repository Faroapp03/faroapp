// Las piezas de texto de «Datos globales» (datos-globales.html y datos-globales-ue.html) que dicen qué se cuenta y de
// dónde sale: la marca de «medido» o «estimado» (siempre con su palabra: el punto de color solo acompaña) y la ficha
// técnica plegada de cada capítulo, que es solo el método: qué mide, unidad, misma base, datos que no se muestran,
// margen de error y fuente con sus códigos. Las cifras están a la vista, en los gráficos y en sus tablas.

import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';

/**
 * @import { Naturaleza } from './datos.js'
 * @import { Parte } from '../textos.js'
 * @typedef {string} Apartado un apartado de la ficha técnica: su título es `datos-globales.ficha.<apartado>`
 */

/**
 * Un elemento con su texto escrito por `escribir`: con clave, con versiones o tal cual.
 * @template {keyof HTMLElementTagNameMap} Etiqueta
 * @param {Etiqueta} etiqueta @param {Partial<HTMLElementTagNameMap[Etiqueta]>} propiedades @param {Parte} parte
 * @returns {HTMLElementTagNameMap[Etiqueta]} el elemento creado, con su texto escrito
 */
export function conTexto(etiqueta, propiedades, parte) {
  return escribir(crear(etiqueta, propiedades), parte);
}

/**
 * La marca de «medido» o «estimado»: el punto (de adorno) y la palabra.
 * @param {Naturaleza} naturaleza @returns {HTMLSpanElement}
 */
export function marcaDeNaturaleza(naturaleza) {
  const punto = crear('span', { textContent: '●' });
  punto.setAttribute('aria-hidden', 'true');
  return crear(
    'span',
    { className: `dg-tipo dg-tipo--${naturaleza}` },
    punto,
    ' ',
    conTexto('span', {}, traducible(`datos-globales.naturaleza.${naturaleza}`)),
  );
}

/** El círculo hueco de las encuestas de opinión: de adorno, el lector de pantalla lee solo el texto que lo sigue.
 * @returns {HTMLSpanElement}
 */
export function circuloDeOpinion() {
  const circulo = crear('span', { textContent: '○' });
  circulo.setAttribute('aria-hidden', 'true');
  return circulo;
}

/**
 * La marca de las encuestas de opinión: círculo hueco (de adorno) y su nombre, en color tenue. Dicen lo que la gente
 * cree, no lo que pasa: nunca llevan la marca de «medido».
 * @returns {HTMLSpanElement}
 */
export function marcaDeOpinion() {
  return crear(
    'span',
    { className: 'dg-opinion' },
    circuloDeOpinion(),
    ' ',
    conTexto('span', {}, traducible('datos-globales.naturaleza.opinion')),
  );
}

/**
 * Si un valor de la ficha es un elemento ya hecho (la marca del tipo) y no un texto.
 * @param {Parte | HTMLElement} valor @returns {valor is HTMLElement}
 */
function esElemento(valor) {
  return typeof valor === 'object' && valor !== null && 'tagName' in valor;
}

/**
 * La ficha técnica de un capítulo, plegada: un par por apartado, en el orden dado.
 * @param {[Apartado, Parte | HTMLElement][]} apartados @returns {HTMLDetailsElement}
 */
export function fichaTecnica(apartados) {
  const pares = apartados.map(([apartado, valor]) =>
    crear(
      'div',
      {},
      conTexto('dt', {}, traducible(`datos-globales.ficha.${apartado}`)),
      esElemento(valor) ? crear('dd', {}, valor) : conTexto('dd', {}, valor),
    ),
  );
  return crear(
    'details',
    { className: 'dg-ficha' },
    conTexto('summary', {}, traducible('datos-globales.ficha.resumen')),
    crear('dl', {}, ...pares),
  );
}
