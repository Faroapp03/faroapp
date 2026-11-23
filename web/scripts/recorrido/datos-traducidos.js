// Las traducciones de Faro de los datos oficiales (títulos de la CIUO-08 y de ESCO, tareas de la OIT) que ya han
// llegado del motor en esta página. Un dato oficial está en castellano; pedido en catalán, el motor lo acompaña de su
// traducción de Faro, hecha con IA, o de null si aún no la tiene. Aquí se apunta cada dato
// por su texto en castellano, con sus versiones y con las lecturas de las que sale (sus orígenes, traduccion-api.js):
//
// - lo que se pinta con `datoOficial` se escribe en el idioma de la página si su versión ha llegado y, si no, en
//   castellano, marcado; en cuanto llega, basta con volver a escribir la página (idioma.js, reescribirTextos);
// - si la página cambia a un idioma que un dato todavía no tiene, `origenesSinTraduccion` dice qué lecturas pedir.
//
// Vive solo en la memoria de la página y se olvida al borrar la conversación, como las llamadas (memoria-llamadas.js).
// Lógica pura, sin DOM ni red.

import { conVersiones, IDIOMA_DE_PARTIDA } from '../textos.js';

/** @import { ConVersiones, Idioma } from '../textos.js' */
/** @import { ParDeTraduccion } from './traduccion-api.js' */

/**
 * Lo apuntado de un dato oficial: sus versiones por idioma y las lecturas de las que sale.
 * @typedef {{ versiones: ConVersiones['versiones'], origenes: Set<string> }} Apunte
 */

/**
 * Castellano → { versiones: { es, ca? }, origenes }. `versiones.ca` es undefined si nunca se ha pedido en catalán. Lo
 * llenan apuntarTraducciones y datoOficial (apunteDe) y lo vacía olvidarTraducciones. Su tamaño tiene el tope del
 * conjunto de datos oficiales que la página muestra.
 * @type {Map<string, Apunte>}
 */
const apuntados = new Map();

/** Lo apuntado de un dato, que se crea vacío la primera vez. @param {string} castellano @returns {Apunte} */
function apunteDe(castellano) {
  let apunte = apuntados.get(castellano);
  if (!apunte) {
    apunte = { versiones: { [IDIOMA_DE_PARTIDA]: castellano }, origenes: new Set() };
    apuntados.set(castellano, apunte);
  }
  return apunte;
}

/**
 * Una traducción que ya llegó no la borra un null posterior: otra lectura puede no traer ese dato traducido.
 * @param {Apunte['versiones']} versiones @param {Idioma} idioma @param {string | null | undefined} traduccion
 */
function apuntarVersion(versiones, idioma, traduccion) {
  const hayTraduccion = typeof traduccion === 'string' && traduccion.trim() !== '';
  versiones[idioma] = hayTraduccion ? traduccion : (versiones[idioma] ?? null);
}

/**
 * Apunta los datos de una respuesta pedida en `idioma`: `pares` son { castellano, traduccion, origen }
 * (traduccion-api.js). En castellano solo se apunta el origen: la respuesta no trae traducciones, y no por eso le
 * faltan.
 * @param {ParDeTraduccion[]} pares @param {Idioma} idioma @returns {void}
 */
export function apuntarTraducciones(pares, idioma) {
  for (const { castellano, traduccion, origen } of pares) {
    if (!castellano) {
      continue;
    }
    const apunte = apunteDe(castellano);
    if (origen) {
      apunte.origenes.add(origen);
    }
    if (idioma !== IDIOMA_DE_PARTIDA) {
      apuntarVersion(apunte.versiones, idioma, traduccion);
    }
  }
}

/**
 * Un dato oficial para pintar (con `escribir`, o como valor de un traducible): su traducción en el idioma de la
 * página, si ha llegado, o el castellano. `forma` da forma a la versión que se ve (titulo-breve.js, tituloParaVer).
 * @param {string} castellano @param {ConVersiones['forma']} [forma] @returns {ConVersiones}
 */
export function datoOficial(castellano, forma) {
  return conVersiones(apunteDe(castellano).versiones, forma);
}

/**
 * El dato en `idioma` si su traducción ha llegado y, si no, en castellano. Para lo que se envía al motor en ese
 * idioma: el nombre de una tarea oficial marcada, en el informe.
 * @param {string} castellano @param {Idioma} idioma @returns {string}
 */
export function datoEn(castellano, idioma) {
  const version = apuntados.get(castellano)?.versiones[idioma];
  return typeof version === 'string' ? version : castellano;
}

/**
 * Las lecturas que hay que pedir en `idioma` porque traen datos apuntados que nunca se han pedido en él.
 * @param {Idioma} idioma @returns {string[]}
 */
export function origenesSinTraduccion(idioma) {
  /** @type {Set<string>} */
  const origenes = new Set();
  for (const { versiones, origenes: suyos } of apuntados.values()) {
    if (versiones[idioma] !== undefined) {
      continue;
    }
    for (const origen of suyos) {
      origenes.add(origen);
    }
  }
  return [...origenes];
}

/**
 * Si algún dato apuntado tiene ya su traducción de Faro en `idioma` (el castellano es el de los datos: nunca).
 * @param {Idioma} idioma @returns {boolean}
 */
export function hayTraduccionEn(idioma) {
  if (idioma === IDIOMA_DE_PARTIDA) {
    return false;
  }
  return [...apuntados.values()].some(({ versiones }) => typeof versiones[idioma] === 'string');
}

/**
 * Olvida todo lo apuntado: se usa al borrar la conversación.
 * @returns {void}
 */
export function olvidarTraducciones() {
  apuntados.clear();
}
