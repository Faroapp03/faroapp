// Interacción del informe: impresión o PDF, compartir, escuchar y borrar.
// Lo usan la página de ejemplo (informe-ejemplo.js) y el recorrido (recorrido/paso-informe.js), cada vez que pinta un
// informe. El HTML lo pinta el motor; aquí se aplican medidas por CSSOM y se preparan controles.

import { prepararCompartir } from './compartir-informe.js';
import { prepararEscucha } from './escuchar-informe.js';
import { escribir } from './idioma.js';
import { prepararImpresion } from './pdf/impresion.js';
import { traducible } from './textos.js';

/**
 * El motor marca con atributos data-* las medidas que dependen de cada informe: el peso de cada tarea en la semana
 * (data-peso → --peso), el ancho de las barras de contratación en % (data-ancho → --ancho) y la nota de cada medidor
 * (data-valor → --valor). Se aplican por CSSOM, que la política de contenidos permite, y solo si son números.
 */
const MEDIDAS_DEL_MOTOR = Object.freeze([
  { atributo: 'data-peso', propiedad: '--peso', unidad: '' },
  { atributo: 'data-ancho', propiedad: '--ancho', unidad: '%' },
  { atributo: 'data-valor', propiedad: '--valor', unidad: '' },
]);
const VALOR_NUMERICO = /^\d+(\.\d+)?$/;
/** Las escuchas del informe pintado antes: un informe nuevo (o el borrado, retirarInforme) las retira.
 * @type {AbortController | null}
 */
let escuchasAnteriores = null;

/** Las medidas del motor (MEDIDAS_DEL_MOTOR), como propiedades de CSS de cada elemento. @param {HTMLElement} raiz */
function aplicarMedidas(raiz) {
  for (const { atributo, propiedad, unidad } of MEDIDAS_DEL_MOTOR) {
    for (const elemento of raiz.querySelectorAll(`[${atributo}]`)) {
      const valor = elemento.getAttribute(atributo) ?? '';
      // HTMLElement o SVGElement: los dos tienen style.
      if (!(elemento instanceof HTMLElement || elemento instanceof SVGElement)) {
        continue;
      }
      if (VALOR_NUMERICO.test(valor)) {
        elemento.style.setProperty(propiedad, `${valor}${unidad}`);
      }
    }
  }
}

/** Impresión nativa y borrado del informe.
 * @param {HTMLElement} raiz @param {(() => void) | undefined} alBorrar @param {AbortSignal} signal
 */
function prepararBotones(raiz, alBorrar, signal) {
  /** @type {HTMLElement | null} */
  const estado = raiz.querySelector('#estado');
  const borrar = () => {
    if (alBorrar) {
      alBorrar();
    } else if (estado) {
      escribir(estado, traducible('informe-ejemplo.no-guarda'));
    }
  };
  raiz.querySelector('#imprimir')?.addEventListener('click', () => window.print(), { signal });
  raiz.querySelector('#borrar')?.addEventListener('click', borrar, { signal });
}

/**
 * Prepara un informe ya pintado. Un informe nuevo sustituye al anterior: se retiran sus escuchas para no duplicarlas.
 * `alBorrar` es lo que hace «Borrar el informe y lo escrito»; si no se da, el botón explica que no se guarda este informe.
 * @param {HTMLElement} raiz
 * @param {{ alBorrar?: () => void }} [opciones] @returns {void}
 */
export function prepararInforme(raiz, { alBorrar } = {}) {
  escuchasAnteriores?.abort();
  escuchasAnteriores = new AbortController();
  const { signal } = escuchasAnteriores;
  aplicarMedidas(raiz);
  prepararImpresion(raiz, signal);
  prepararBotones(raiz, alBorrar, signal);
  // Los controles de compartir y escuchar pertenecen al informe presentado.
  prepararCompartir(raiz, signal);
  prepararEscucha(raiz, signal);
}

/**
 * El informe ya no está a la vista (se ha borrado): se retiran sus escuchas, y con ellas calla la lectura en voz alta.
 * @returns {void}
 */
export function retirarInforme() {
  escuchasAnteriores?.abort();
  escuchasAnteriores = null;
}
