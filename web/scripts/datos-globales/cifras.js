// Las cifras del dossier «Datos globales» (datos-globales.html) escritas como las publican las estadísticas oficiales:
// coma decimal, redondeo con la mitad hacia arriba (Eurostat e Idescat: 19,95 → 20,0; 32,25 → 32,3) y un espacio que no
// se parte antes del símbolo de porcentaje (Ortografía de la RAE, 2010, 8.2.2; norma ISO 80000-1). Castellano y
// catalán las escriben igual, así que no dependen del idioma en curso.
// El redondeo se hace sobre la cifra decimal publicada y no sobre su aproximación binaria: 19.95 se guarda como
// 19,9499999…, y toFixed lo dejaría en 19,9. Las restas y los cocientes se hacen con las cifras sin redondear, como
// Eurostat: la diferencia de 24,04 y 19,95 es 4,09, que se escribe +4,1. Lógica pura, sin DOM.

/** Espacio que no se parte (U+00A0): la cifra y su «%» no se separan al final de una línea. */
const ESPACIO_FIJO = '\u00a0';
/** El signo menos tipográfico (U+2212), no el guion. */
const MENOS = '−';
/** El signo de multiplicar (U+00D7) de «×2,2». */
const POR = '×';
/** Cifras decimales que se tienen en cuenta al restar: las del archivo traen dos como mucho. */
const MAX_DECIMALES = 6;
/** Cifras decimales con que se escribe una cifra si no se dice otra cosa. */
const DECIMALES_POR_DEFECTO = 1;

/**
 * Cuántas cifras decimales tiene un número tal como se escribe (24.04 → 2). Dominio: cifras finitas en notación
 * decimal, como llegan validadas del archivo de datos (con notación exponencial, como 1e-7, da 0).
 * @param {number} valor
 */
function decimalesDe(valor) {
  const [, decimales = ''] = String(valor).split('.');
  return Math.min(decimales.length, MAX_DECIMALES);
}

/**
 * Redondea a `decimales` cifras con la mitad hacia arriba (lejos del cero en los negativos): 19,95 → 20,0. Desplaza la
 * coma en la escritura decimal del número («19.95e1» es 199,5 exacto), no multiplicando su aproximación binaria.
 * @param {number} valor @param {number} [decimales] @returns {number}
 */
export function redondear(valor, decimales = DECIMALES_POR_DEFECTO) {
  const absoluto = Math.abs(valor);
  const escrito = String(absoluto);
  const desplazado = escrito.includes('e') ? absoluto * 10 ** decimales : Number(`${escrito}e${decimales}`);
  const redondeado = Math.round(desplazado) / 10 ** decimales;
  return valor < 0 ? -redondeado : redondeado;
}

/**
 * La resta exacta de dos cifras del archivo, en decimal: 24,04 − 19,95 = 4,09 (y no 4,0899999…).
 * @param {number} cifra @param {number} referencia @returns {number}
 */
export function resta(cifra, referencia) {
  const escala = 10 ** Math.max(decimalesDe(cifra), decimalesDe(referencia));
  return (Math.round(cifra * escala) - Math.round(referencia * escala)) / escala;
}

/**
 * Un número con `decimales` cifras decimales y coma: «24,0», «24».
 * @param {number} valor @param {number} [decimales] @returns {string}
 */
export function numeroEscrito(valor, decimales = DECIMALES_POR_DEFECTO) {
  return redondear(valor, decimales).toFixed(decimales).replace('.', ',');
}

/**
 * Un porcentaje: «24,0 %» o, con `decimales` 0, «24 %».
 * @param {number} valor @param {number} [decimales] @returns {string}
 */
export function porcentajeEscrito(valor, decimales = DECIMALES_POR_DEFECTO) {
  return `${numeroEscrito(valor, decimales)}${ESPACIO_FIJO}%`;
}

/**
 * La distancia entre dos cifras en puntos, sin el «+» (el «−» solo si `cifra` es menor): «6,1». Es la de las barras
 * dobles, que ya dicen en su cabecera qué se resta.
 * @param {number} cifra @param {number} referencia @returns {string}
 */
export function distanciaEscrita(cifra, referencia) {
  const diferencia = redondear(resta(cifra, referencia), DECIMALES_POR_DEFECTO);
  return `${diferencia < 0 ? MENOS : ''}${numeroEscrito(Math.abs(diferencia))}`;
}

/**
 * Cuántas veces es `cifra` la `referencia`, sin redondear; null si la referencia no es positiva.
 * @param {number} cifra @param {number} referencia @returns {number | null}
 */
export function veces(cifra, referencia) {
  return referencia > 0 ? cifra / referencia : null;
}

/**
 * «×2,2», o null si la referencia no es positiva.
 * @param {number} cifra @param {number} referencia @returns {string | null}
 */
export function vecesEscritas(cifra, referencia) {
  const cociente = veces(cifra, referencia);
  return cociente === null ? null : `${POR}${numeroEscrito(cociente)}`;
}
