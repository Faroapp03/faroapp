// Los cuatro pasos del recorrido: cuál está en curso, qué tarjeta se ve bajo la conversación y el progreso (la guía, la
// pastilla «Paso 2 de 4» y la barra de avance de la cabecera, de guia.js). Adónde va el foco lo decide cada paso: solo
// se mueve cuando la persona tiene que actuar en la tarjeta; si Faro le pregunta algo, va a la barra de escritura.

import { porId } from '../dom.js';
import { traducible } from '../textos.js';
import { mostrarCompositor } from './compositor.js';
import { quitarSugerencias } from './conversacion.js';
import { limpiarEntregaFinal } from './entrega-final.js';
import { marcarPasoEnLaGuia } from './guia.js';

/** @import { Traducible } from '../textos.js' */

/** El primer paso: el relato, que se cuenta en la barra de escritura. Valor de data-volver y de data-paso. */
export const PASO_RELATO = 1;
/** El segundo paso: la ocupación. Valor de data-volver y de data-paso. */
export const PASO_OCUPACION = 2;
/** El tercer paso: las tareas. Valor de data-volver y de data-paso. */
export const PASO_TAREAS = 3;
/** El cuarto paso: el informe, el último. Valor de data-volver y de data-paso en la guía y en <body>. */
export const PASO_INFORME = 4;

/** Cada paso con tarjeta, con el id de su tarjeta. El relato no tiene: se cuenta en la barra de escritura. */
const TARJETAS = Object.freeze({ [PASO_OCUPACION]: 'tarjeta-ocupacion', [PASO_TAREAS]: 'tarjeta-tareas' });

/**
 * El nombre de cada paso: el mismo que en la guía de recorrido.html («Tu día a día», «Tu ocupación»…).
 * @param {number} paso
 * @returns {Traducible} el nombre traducible del paso
 */
function nombreDelPaso(paso) {
  return traducible(`recorrido.paso.${paso}.nombre`);
}

/**
 * Pasa a `paso`: marca el progreso, enseña su tarjeta (y esconde las demás), el informe solo en el paso 4 y la barra
 * de escritura en los demás. Las respuestas rápidas del paso anterior dejan de valer.
 * @param {number} paso @returns {void}
 */
export function irA(paso) {
  if (paso !== PASO_INFORME) {
    limpiarEntregaFinal();
  }
  quitarSugerencias();
  marcarPasoEnLaGuia({ paso, nombre: nombreDelPaso(paso), total: PASO_INFORME });
  for (const [suPaso, id] of Object.entries(TARJETAS)) {
    porId(id).hidden = Number(suPaso) !== paso;
  }
  porId(`paso-${PASO_INFORME}`).hidden = paso !== PASO_INFORME;
  // Pasar a un paso deja atrás la espera del agente (data-informe="oculto", paso-informe.js): en el 4, el informe ya
  // se ve como una página.
  delete document.body.dataset.informe;
  mostrarCompositor(paso !== PASO_INFORME);
}
