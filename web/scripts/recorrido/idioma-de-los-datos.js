// Los datos oficiales en el idioma de la página. Lo ya pintado con `datoOficial` (datos-traducidos.js) cambia solo con
// la página si su traducción ya ha llegado; si no (la persona cambia de idioma a mitad del recorrido, o los datos
// llegaron sin la traducción oficial), se piden las lecturas de /api/grupos de las que
// salieron, en el idioma nuevo (api.js, completarTraducciones: sin IA y una vez por idioma), y se reescribe. Lo
// que ya dijo la IA (una pregunta, un aviso) no se vuelve a pedir: se queda en el idioma en que llegó.
//
// Que los títulos y las tareas oficiales están traducidos con IA se dice en un solo sitio: la marca del pie de la barra
// de escritura (#marca-traduccion), que enlaza con las fuentes y solo se ve cuando la hay.

import { porId } from '../dom.js';
import { alCambiarIdioma, reescribirTextos } from '../idioma.js';
import { idiomaActual } from '../textos.js';
import { completarTraducciones } from './api.js';
import { hayTraduccionEn } from './datos-traducidos.js';

/** La marca se ve si algún dato de esta conversación tiene ya su traducción de Faro en el idioma de la página. */
function mostrarMarca() {
  porId('marca-traduccion').hidden = !hayTraduccionEn(idiomaActual());
}

/**
 * Deja los datos oficiales pintados en el idioma de la página: pide las traducciones que falten y, si ha pedido
 * alguna, vuelve a escribir la página. Se llama después de pintar y al cambiar de idioma; sin nada pendiente, no pide
 * nada.
 * @returns {Promise<void>}
 */
export async function completarDatosEnIdioma() {
  mostrarMarca();
  if (!(await completarTraducciones())) {
    return;
  }
  reescribirTextos();
  mostrarMarca();
}

/**
 * Cada cambio de idioma completa los datos ya pintados.
 */
export function iniciarIdiomaDeLosDatos() {
  alCambiarIdioma(completarDatosEnIdioma);
}
