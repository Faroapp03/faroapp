// Lo escrito se conserva como una tarea literal tras el filtro compartido de datos personales. No se separa por
// significado, no se asigna una tarea oficial y no se inventa una estimación. La persona elige sus referencias.

import { traducible } from '../textos.js';
import { ERROR_SIN_LIMPIEZA, ErrorFaro } from './api/errores.js';
import { limpiarTareaDelRecorrido } from './api/transporte.js';
import { nuevaTarea } from './estado.js';

/**
 * Como máximo una tarea literal, si queda sitio y el filtro se ha cargado.
 * @param {string} texto @param {number} caben
 * @returns {Promise<{ tareas: import('./estado.js').Tarea[], avisos: import('./traduccion-api.js').Aviso[] }>}
 */
export async function tareasDeLoQueEscribe(texto, caben) {
  if (caben <= 0 || !texto.trim()) {
    return { tareas: [], avisos: [] };
  }
  const limpio = await limpiarTareaDelRecorrido(texto);
  if (!limpio) {
    throw new ErrorFaro(traducible(ERROR_SIN_LIMPIEZA), 0);
  }
  return { tareas: [nuevaTarea(limpio.texto)], avisos: limpio.avisos };
}
