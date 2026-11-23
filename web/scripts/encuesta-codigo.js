// La forma de los códigos de la encuesta en la página, sin DOM, para poder probarla aparte
// (pruebas/encuesta/codigo-tecleado.test.ts). Es la misma forma canónica que valida el servidor (src/encuesta/codigos.ts).

/** La forma canónica de un código: su tipo y siete grupos de cuatro símbolos de Crockford. */
export const FORMATO = /^(PART|PROF)(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;
const LARGO_DEL_PREFIJO = 4;
const SIMBOLOS_POR_GRUPO = 4;

/**
 * Lo tecleado, en la forma canónica: mayúsculas, sin espacios ni guiones de más y con un guion tras el tipo y cada
 * cuatro símbolos. En el tipo (PART o PROF), un 0 se lee como la O, que sí lleva. Tras el tipo, la O se lee como 0 y la
 * I y la L como 1, porque el alfabeto de los códigos no las usa para que no se confundan.
 * @param {string} tecleado @returns {string}
 */
export function normalizarCodigo(tecleado) {
  const limpio = tecleado.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const prefijo = limpio.slice(0, LARGO_DEL_PREFIJO).replace(/0/g, 'O');
  const resto = limpio.slice(LARGO_DEL_PREFIJO).replace(/O/g, '0').replace(/[IL]/g, '1');
  const grupos = [];
  for (let i = 0; i < resto.length; i += SIMBOLOS_POR_GRUPO) {
    grupos.push(resto.slice(i, i + SIMBOLOS_POR_GRUPO));
  }
  return [prefijo, ...grupos].join('-');
}
