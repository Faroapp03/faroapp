/**
 * @typedef {'activada'|'vuelta-a-sombra'} CambioRetiradaDatos
 * @typedef {Readonly<{cambio:CambioRetiradaDatos,decisiones:number,en:string}>} RetiradaDatos
 * @typedef {Readonly<{retiradas:number,cursos:number,en:string}>} RetiradaAmpliaDatos
 */
// El aviso del cambio de modo de la regla de retirada de una fuente: se activó sola al reunir la evidencia o volvió
// a modo de prueba tras un error. Es el contrato cerrado que escribe la plataforma de datos
// (plataforma_datos/orquestacion/aviso_de_la_retirada.py) y solo viaja con valor. La retirada amplia es el otro aviso de
// la regla: su último ciclo retira, con evidencia, más del umbral de los cursos que leyó; el umbral avisa, no decide.

import { entero, exigir, instante, objeto, unoDe } from './lectura-estricta.js';

/** @type {readonly CambioRetiradaDatos[]} */
export const CAMBIOS_RETIRADA = ['activada', 'vuelta-a-sombra'];

/** @param {unknown} entrada @returns {RetiradaDatos} */
export function leerRetirada(entrada) {
  const valor = objeto(entrada, ['cambio', 'decisiones', 'en']);
  return Object.freeze({
    cambio: unoDe(valor.cambio, CAMBIOS_RETIRADA),
    decisiones: entero(valor.decisiones),
    en: instante(valor.en),
  });
}

/** @param {unknown} entrada @returns {RetiradaAmpliaDatos} */
export function leerRetiradaAmplia(entrada) {
  const valor = objeto(entrada, ['retiradas', 'cursos', 'en']);
  const retiradas = entero(valor.retiradas);
  const cursos = entero(valor.cursos);
  exigir(retiradas > 0 && retiradas <= cursos);
  return Object.freeze({ retiradas, cursos, en: instante(valor.en) });
}
