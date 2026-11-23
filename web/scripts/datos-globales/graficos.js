// Piezas de los gráficos: la bandera del territorio y la disposición de las cifras en las series de evolución.

import { crear } from '../dom.js';
import { direccionDeLaBandera } from './banderas.js';

/** De una fracción a décimas de porcentaje, para las barras de celdas. */
export const DECIMAS_DE_PORCENTAJE = 1000;

/** El resto debajo, después España, la UE y, encima, Cataluña. */
export const ORDEN_DE_DIBUJO = Object.freeze({ resto: 0, esp: 1, ue: 2, cat: 3 });

/** Si no hay un año no comparable entre dos puntos, se dibuja el tramo que los une.
 * @param {import('./dibujo.js').Punto} a @param {import('./dibujo.js').Punto} b
 * @param {number[]} ocultos @returns {boolean} */
export function seUnen(a, b, ocultos) {
  return !ocultos.some((anio) => anio > a.anio && anio < b.anio);
}

/**
 * Sitúa las cifras de Cataluña y de la UE a lados opuestos de sus puntos; con una sola serie rotulada, encima.
 * @param {import('./dibujo.js').Serie[]} series
 * @returns {(papel: import('./dibujo.js').Papel, anio: number, valor: number) => 'encima' | 'debajo'}
 */
export function ladoDeLasCifras(series) {
  const valorDe = (/** @type {import('./dibujo.js').Papel} */ papel, /** @type {number} */ anio) =>
    series.find((serie) => serie.papel === papel && !serie.protagonista)?.puntos.find((p) => p.anio === anio)?.valor;
  return (papel, anio, valor) => {
    const otra = valorDe(papel === 'cat' ? 'ue' : 'cat', anio);
    if (otra === undefined) {
      return papel === 'ue' && !series.some((serie) => serie.protagonista) ? 'debajo' : 'encima';
    }
    return valor >= otra ? 'encima' : 'debajo';
  };
}

/**
 * La bandera de un territorio del dossier, como en el selector de idioma, o null si no tiene; con `delJuego`, también
 * las del juego de banderas de «El mundo» (banderas.js).
 * @param {string | null} codigo @param {{ delJuego?: boolean }} [opciones] @returns {HTMLImageElement | null}
 */
export function bandera(codigo, opciones) {
  const src = direccionDeLaBandera(codigo, opciones);
  if (!src) {
    return null;
  }
  return crear('img', {
    className: 'idioma-bandera',
    src,
    alt: '',
    width: 24,
    height: 16,
  });
}
