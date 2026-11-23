// Carga el diccionario de un idioma, solo cuando se usa: una página en castellano no tiene por qué descargar el
// catalán, y al revés. El idioma inicial lo decide
// scripts/idioma-inicial.js, que además precarga el módulo de entrada de ese idioma (idiomas/<idioma>.js, con
// modulepreload) mientras se pinta la página; las partes que ese módulo importa (es/*.js, ca/*.js) las descubre
// el navegador al analizarlo, así que la primera carga puede esperar a la red por ellas.
// Cargado una vez, se queda apuntado en scripts/textos.js: cambiar de idioma y volver no pide nada más a la red.
//
// Si un diccionario no llega (sin red), el navegador puede recordar el fallo de esa dirección y no volver a pedirla: un
// segundo import() con la misma dirección falla aunque la red ya haya vuelto. Por eso cada nuevo intento pide el
// módulo de entrada del idioma (es.js, ca.js) con otra marca (#reintento-1, #reintento-2…): para el navegador es otro
// módulo, pero el fragmento no llega al servidor ni cambia lo que sirve la copia sin conexión. La marca no alcanza a
// las partes que ese módulo importa de forma estática (es/*.js, ca/*.js): si la que falló es una parte, el reintento
// depende de que el navegador vuelva a pedirla.
//
// El primer intento de cada idioma es un import() literal: el empaquetado de la web lo resuelve y publica cada
// diccionario en su dirección estable (idiomas/es.js, idiomas/ca.js). Solo el nuevo intento calcula la dirección, desde
// la de este módulo y con la marca, porque la marca es la única forma de pedir otro módulo con el mismo archivo: lleva
// el mismo archivo escrito aquí y es una de las importaciones calculadas que admite el empaquetado.

import { esIdioma, hayDiccionario, registrarDiccionario } from '../scripts/textos.js';

/** @import { Diccionario, Idioma } from '../scripts/textos.js' */

/**
 * Cada idioma de la web con su diccionario, escrito a mano: la política de contenidos solo admite rutas de la web, y
 * la comprobación del inventario web ve así qué archivo usa cada uno. `marca` es la de un nuevo
 * intento, o '' en el primero.
 * @type {Record<Idioma, (marca: string) => Promise<{ default: Diccionario }>>}
 */
const DICCIONARIOS = {
  es: (marca) => (marca ? import(new URL(`./es.js${marca}`, import.meta.url).href) : import('./es.js')),
  ca: (marca) => (marca ? import(new URL(`./ca.js${marca}`, import.meta.url).href) : import('./ca.js')),
};

/**
 * Los intentos fallidos de cada idioma (entero ≥ 1): el siguiente se pide con la marca de su número. Vive lo que la
 * página y solo lo cambia cargarDiccionario; no tiene tope porque solo crece cuando la persona reintenta tras un fallo.
 * @type {Map<Idioma, number>}
 */
const fallos = new Map();

/**
 * La marca del siguiente intento de un idioma.
 * @param {Idioma} idioma - Un idioma de la web.
 * @returns {string} '' si nunca ha fallado; si no, `#reintento-N` con N el número de fallos.
 */
function marcaDelIntento(idioma) {
  const intentos = fallos.get(idioma);
  return intentos === undefined ? '' : `#reintento-${intentos}`;
}

/**
 * Deja listo el diccionario de `idioma` para escribir sus textos. Un idioma que no es de la web, o uno ya cargado, no
 * pide nada. Si no llega, el error se propaga y la siguiente llamada lo vuelve a pedir con otra marca.
 * @param {Idioma} idioma - El idioma que se va a usar.
 * @returns {Promise<void>} Se cumple cuando el diccionario está registrado en scripts/textos.js.
 * @throws {Error} El error del import() si el diccionario no se pudo cargar.
 */
export async function cargarDiccionario(idioma) {
  if (!esIdioma(idioma) || hayDiccionario(idioma)) {
    return;
  }
  try {
    const modulo = await DICCIONARIOS[idioma](marcaDelIntento(idioma));
    registrarDiccionario(idioma, modulo.default);
  } catch (error) {
    fallos.set(idioma, (fallos.get(idioma) ?? 0) + 1);
    throw error;
  }
}
