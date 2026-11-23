// Revisión de las tareas antes de pedir el informe. Cada revisión devuelve false, con Faro explicando qué falta y el
// foco en lo que hay que corregir, si falta algo. Ese control queda además marcado como el del error (aria-invalid y
// aria-describedby al mensaje de Faro, pagina.js): el lector de pantalla lo lee al llegar el foco.

import { porId } from '../dom.js';
import { traducible } from '../textos.js';
import { enfocarCompositor } from './compositor.js';
import { anularEmparejamiento, emparejamientoCaducado, estado, MIN_LETRAS_TAREA } from './estado.js';
import { contarLetras } from './formato.js';
import { enfocar, mostrarErrorDe } from './pagina.js';
import { pintarTareas } from './paso-tareas.js';

/** @import { Tarea } from './estado.js' */

/** Falla si no hay ninguna tarea: Faro lo dice en el compositor y el foco va a él. @returns {boolean} */
function hayTareas() {
  if (estado.tareas.length) {
    return true;
  }
  mostrarErrorDe(porId('mensaje', HTMLTextAreaElement), traducible('recorrido.revision.sin-tareas'));
  enfocarCompositor();
  return false;
}

/**
 * Falla en la primera tarea con menos de MIN_LETRAS_TAREA letras: marca su campo y le lleva el foco.
 * @returns {boolean}
 */
function textosSuficientes() {
  const posicion = estado.tareas.findIndex((tarea) => contarLetras(tarea.texto) < MIN_LETRAS_TAREA);
  const corta = estado.tareas[posicion];
  if (corta === undefined) {
    return true;
  }
  const campo = porId(`tarea-${corta.id}`, HTMLInputElement);
  mostrarErrorDe(campo, traducible('recorrido.revision.corta', { minimo: MIN_LETRAS_TAREA, numero: posicion + 1 }));
  enfocar(campo);
  return false;
}

/**
 * Por si el texto se cambió y se envió sin salir del campo: ningún emparejamiento puede quedarse con otro texto.
 * Anula los caducados, repinta las tareas y lleva el foco al selector oficial del primero.
 * @returns {boolean}
 */
function emparejamientosVigentes() {
  const caducadas = estado.tareas.filter(emparejamientoCaducado);
  const primera = caducadas[0];
  if (primera === undefined) {
    return true;
  }
  for (const tarea of caducadas) {
    anularEmparejamiento(tarea);
  }
  pintarTareas();
  const cambiadas =
    caducadas.length === 1
      ? traducible('recorrido.revision.cambiada-una')
      : traducible('recorrido.revision.cambiadas', { numero: caducadas.length });
  const selector = porId(`oficial-${primera.id}`, HTMLSelectElement);
  mostrarErrorDe(selector, cambiadas);
  enfocar(selector);
  return false;
}

/**
 * Falla si alguna tarea no tiene tiempo: marca sus filas (data-falta) y lleva el foco al primer radio de la primera.
 * @returns {boolean}
 */
function tiemposIndicados() {
  const sinTiempo = estado.tareas.filter((tarea) => !tarea.tiempo);
  const primera = sinTiempo[0];
  if (primera === undefined) {
    return true;
  }
  // Las tareas contadas con palabras y las oficiales marcadas marcan su fila con data-tarea.
  /** @param {Tarea} tarea @returns {HTMLElement | null} */
  const filaDe = (tarea) => {
    const fila = document.querySelector(`[data-tarea="${tarea.id}"]`);
    return fila instanceof HTMLElement ? fila : null;
  };
  for (const tarea of sinTiempo) {
    const fila = filaDe(tarea);
    if (fila) {
      fila.dataset.falta = 'tiempo';
    }
  }
  const falta =
    sinTiempo.length === 1
      ? traducible('recorrido.revision.falta-tiempo-una')
      : traducible('recorrido.revision.falta-tiempo', { numero: sinTiempo.length });
  const radio = filaDe(primera)?.querySelector("input[type='radio']");
  const primerTiempo = radio instanceof HTMLInputElement ? radio : null;
  mostrarErrorDe(primerTiempo, falta);
  enfocar(primerTiempo);
  return false;
}

/**
 * Revisa las tareas antes de pedir el informe, en este orden, y se detiene en el primer problema. Aunque se lee
 * como un predicado, cada revisión que falla tiene efectos: muestra el error, marca el campo, repinta y mueve el foco.
 * @returns {boolean}
 */
export function tareasListas() {
  return hayTareas() && textosSuficientes() && emparejamientosVigentes() && tiemposIndicados();
}
