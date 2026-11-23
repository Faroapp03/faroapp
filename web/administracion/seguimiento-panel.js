// Presenta el límite de sondeo sin cambiar el trabajo observado.
import { texto } from '../scripts/textos.js';
import { trabajoPendiente } from './vista-trabajos.js';
/** @param {HTMLElement} destino @param {import('./estado-trabajos.js').EstadoTrabajos|null} trabajo @param {number} consultas */
export function mostrarSeguimiento(destino, trabajo, consultas) {
  let contenido = '';
  if (trabajoPendiente(trabajo)) {
    contenido = consultas > 0 ? texto('panel.seguimiento.limitado') : texto('panel.seguimiento.finalizado');
  }
  if (destino.textContent !== contenido) {
    destino.textContent = contenido;
  }
}
