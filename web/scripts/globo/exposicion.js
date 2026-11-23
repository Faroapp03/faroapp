// La tarjeta «Exposición a la IA generativa (calculada)» de la ficha de «El mundo» (datos.js, bloque «exposicion»):
// de cada 100 personas ocupadas, cuántas trabajan en ocupaciones con exposición alta según el índice de la OIT, con su
// intervalo de confianza del 95 %; si una parte del empleo no se puede asignar con exactitud, la cifra no se da y se
// dicen sus cotas («entre X y Y») y esa parte. Debajo, la de alguna exposición, igual, y la nota de que es exposición
// de las ocupaciones, no uso ni predicción. Las cifras con decimales (intervalo, cotas) van con uno, como en la página.

import { numeroEscrito } from '../datos-globales/cifras.js';
import { conTexto } from '../datos-globales/ficha.js';
import { crear } from '../dom.js';
import { traducible } from '../textos.js';

/**
 * @import { BloqueExposicion, Calculada } from './datos.js'
 * @import { Parte } from '../textos.js'
 */

/** Una cifra con un decimal: «4,8». @param {number} valor */
function conUnDecimal(valor) {
  return numeroEscrito(valor, 1);
}

/**
 * La cifra grande (adorno: la frase ya la dice) y la frase de una exposición, con su cifra o con sus cotas.
 * @param {Calculada} calculada @param {'alta' | 'alguna'} grado
 * @returns {{ grande: string, frase: Parte, detalle: Parte }}
 */
function frasesDe({ cifra }, grado) {
  const anio = String(cifra.anio);
  const { desde, hasta } = cifra.intervalo;
  if (cifra.valor !== null) {
    return {
      grande: numeroEscrito(cifra.valor, 0),
      frase: traducible(`globo.ficha.exposicion.${grado}`, { n: numeroEscrito(cifra.valor, 0), anio }),
      detalle: traducible('globo.ficha.exposicion.intervalo', {
        desde: conUnDecimal(desde),
        hasta: conUnDecimal(hasta),
      }),
    };
  }
  const cotas = /** @type {import('../datos-globales/calculados.js').Cotas} */ (cifra.cotas);
  const [inferior, superior] = [conUnDecimal(cotas.inferior), conUnDecimal(cotas.superior)];
  return {
    grande: `${inferior}–${superior}`,
    frase: traducible(`globo.ficha.exposicion.${grado}.cotas`, { inferior, superior, anio }),
    detalle: traducible('globo.ficha.exposicion.sin-correspondencia', {
      parte: conUnDecimal(cotas.parte_sin_correspondencia),
    }),
  };
}

/**
 * Lo que lleva dentro la tarjeta de la exposición calculada (el título lo pone la ficha).
 * @param {BloqueExposicion} bloque @returns {HTMLElement[]}
 */
export function contenidoDeLaExposicion({ alta, alguna }) {
  const principal = frasesDe(alta, 'alta');
  const grande = crear('p', { className: 'dg-clave-cifra', textContent: principal.grande });
  grande.setAttribute('aria-hidden', 'true');
  const contenido = [
    crear(
      'div',
      { className: 'dg-clave dg-clave--propia' },
      grande,
      conTexto('p', { className: 'dg-clave-texto' }, principal.frase),
    ),
    conTexto('p', { className: 'globo-dato-nota' }, principal.detalle),
  ];
  if (alguna) {
    const otra = frasesDe(alguna, 'alguna');
    contenido.push(conTexto('p', {}, otra.frase));
    // Si las dos cifras van en cotas por la misma parte del empleo sin asignar, se dice una sola vez.
    const parte = (/** @type {Calculada} */ { cifra }) => cifra.cotas?.parte_sin_correspondencia ?? null;
    const mismaParte = parte(alta) !== null && parte(alta) === parte(alguna);
    if (!mismaParte) {
      contenido.push(conTexto('p', { className: 'globo-dato-nota' }, otra.detalle));
    }
  }
  contenido.push(conTexto('p', { className: 'globo-dato-nota' }, traducible('globo.ficha.exposicion.nota')));
  return contenido;
}
