// Generado desde src/comun/orden.js; no editar esta copia.
// Orden de identificadores por unidades de código UTF-16 (ECMAScript, IsLessThan), independiente del idioma y de ICU.
// Sirve para códigos, URI y rutas. En fechas ISO 8601 coincide con el orden cronológico solo con formato y zona
// uniformes. Los textos destinados a lectura se ordenan con compararTexto (orden-alfabetico.ts).

/**
 * Compara dos textos por unidades de código UTF-16, para ordenar identificadores.
 * @param {string} a @param {string} b
 * @returns {number} Negativo si `a` va antes, positivo si va después y 0 si son iguales.
 */
export function compararPorCodigo(a, b) {
  return Number(a > b) - Number(a < b);
}
