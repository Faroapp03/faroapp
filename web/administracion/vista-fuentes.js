// El apartado de Fuentes pinta juntas las dos lecturas de una misma observación: el estado de cada fuente y los
// cambios retenidos. Así nunca se ve el estado de una observación con los retenidos de otra.
import { texto } from '../scripts/textos.js';
import { mostrarEstadoDatos } from './vista-datos.js';
import { mostrarRetenidos } from './vista-retenidos.js';

/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */

/**
 * `deLaActualizacionAnterior` es la marca que el servidor envía con los datos: después se ha reservado otra
 * actualización que todavía no ha dejado los suyos.
 * @param {{estadoDatos:HTMLElement,retenidos:HTMLElement,retenidosLista:HTMLElement}} vista
 * @param {EstadoDatosPanel|null} datos @param {boolean} [deLaActualizacionAnterior]
 */
export function mostrarFuentes(vista, datos, deLaActualizacionAnterior = false) {
  mostrarEstadoDatos(vista.estadoDatos, datos);
  if (datos && deLaActualizacionAnterior) {
    const nota = document.createElement('p');
    nota.className = 'panel-datos-anteriores';
    nota.setAttribute('data-requiere-atencion', 'si');
    nota.textContent = texto('panel.datos.de-la-actualizacion-anterior');
    vista.estadoDatos.replaceChildren(nota, ...Array.from(vista.estadoDatos.childNodes));
  }
  mostrarRetenidos({ bloque: vista.retenidos, lista: vista.retenidosLista }, datos);
}
