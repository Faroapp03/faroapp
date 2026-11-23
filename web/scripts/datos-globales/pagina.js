// La carga común de las tres páginas de «Datos globales» (datos-globales.html, datos-globales-ue.html y
// datos-globales-mundo.html): pide los datos oficiales de territorios (datos.js), los comprueba, escribe el aviso de
// cifras de muestra y la fecha de consulta, y entrega los datos a la página. Mientras llegan, o si no llegan, lo dice
// la región de estado, y sin ellos no se enseña ninguna cifra. Los textos van con su clave (idioma.js, `escribir`): el
// cambio de idioma los reescribe solo.

import { porId } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { DatosGlobalesNoDisponibles, DatosGlobalesNoValidos, pedirDatosGlobales } from './datos.js';

/**
 * @import { DatosGlobales } from './datos.js'
 */

/** Lo que se espera al archivo de datos, que es estático y pequeño, antes de decir que no ha llegado. */
const ESPERA_DE_LOS_DATOS_MS = 30_000;

/**
 * La fecha de consulta como se escribe en castellano y en catalán: «11/10/2026».
 * @param {string} generado la fecha ISO (AAAA-MM-DD) @returns {string} día, mes y año separados por barras
 */
export function fechaDeConsulta(generado) {
  return generado.split('-').reverse().join('/');
}

/**
 * Escribe la portada común: el aviso de muestra y la fecha de consulta de las fuentes (en las páginas que tienen la
 * sección «Fuentes»; «El mundo» no la lleva). @param {DatosGlobales} datos
 */
function escribirPortada(datos) {
  porId('datos-globales-muestra').hidden = !datos.muestra;
  // La fecha de consulta va en la sección «Fuentes» de la página; «El mundo» no la lleva: sus fuentes están en créditos.
  const consultadas = document.getElementById('datos-globales-consultadas');
  if (consultadas) {
    escribir(consultadas, traducible('datos-globales.fuentes.consultadas', { fecha: fechaDeConsulta(datos.generado) }));
  }
}

/**
 * Pide los datos y, ya comprobados, escribe la portada y se los pasa a `ensenar`. Si no llegan o no cumplen su
 * contrato, lo dice la región de estado y no se enseña ninguna cifra; un fallo de otra clase (del programa) también se
 * dice y sigue hacia la consola.
 * @param {(datos: DatosGlobales) => void | Promise<void>} ensenar @returns {Promise<void>}
 * @throws {unknown} el fallo de otra clase (del programa) que no sea de los datos, tras decirlo en la región de estado
 */
export async function cargarLaPagina(ensenar) {
  const estado = porId('datos-globales-estado');
  escribir(estado, traducible('datos-globales.estado.cargando'));
  const pedir = (/** @type {URL} */ direccion) =>
    fetch(direccion, { mode: 'same-origin', signal: AbortSignal.timeout(ESPERA_DE_LOS_DATOS_MS) });
  try {
    const datos = await pedirDatosGlobales(pedir, new URL('./', location.href));
    escribirPortada(datos);
    await ensenar(datos);
    escribir(estado, '');
  } catch (error) {
    const motivo = error instanceof DatosGlobalesNoValidos ? 'no-validos' : 'no-disponibles';
    escribir(estado, traducible(`datos-globales.estado.${motivo}`));
    if (error instanceof DatosGlobalesNoValidos || error instanceof DatosGlobalesNoDisponibles) {
      console.warn('Faro no puede enseñar los datos globales.', error);
      return;
    }
    throw error;
  }
}
