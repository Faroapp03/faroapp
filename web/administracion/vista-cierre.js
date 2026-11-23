import { texto as textoPanel } from '../scripts/textos.js';

/**
 * Cerrar una publicación detenida o incierta desde el panel: el botón, con confirmación, y lo que pasó con la última
 * petición. El cierre lo hace Faro después y solo si la web sigue sirviendo la versión anterior.
 */
/** @typedef {import('./estado-activacion.js').ActivacionObservada} ActivacionObservada */
/** @typedef {import('./cliente-cierre.js').ResultadoCierre} ResultadoCierre */
/** @typedef {{cerrar?:()=>void, resultadoCierre?:ResultadoCierre|null, ahora?:number}} AccionesActivacion */

const TERMINALES = ['confirmada', 'rechazada', 'abandonada'];
/** @param {HTMLElement} destino @param {string} texto */
function parrafo(destino, texto) {
  const nodo = document.createElement('p');
  nodo.textContent = texto;
  destino.append(nodo);
}
/** @param {HTMLElement} destino @param {() => void} cerrar */
function boton(destino, cerrar) {
  const nodo = document.createElement('button');
  nodo.type = 'button';
  nodo.textContent = textoPanel('panel.activacion.cierre.boton');
  nodo.addEventListener('click', () => {
    if (window.confirm(textoPanel('panel.activacion.cierre.confirmar'))) {
      nodo.disabled = true;
      cerrar();
    }
  });
  destino.append(nodo);
}
/**
 * Qué dice el panel del cierre: pedido y en curso mientras su ejecución puede cumplirlo y no ha caducado; si no, que no
 * se ha cumplido; o que no se hizo porque la web había cambiado.
 * @param {NonNullable<ActivacionObservada['cierre']>} cierre @param {number} ahora @returns {string}
 */
function textoDelCierre(cierre, ahora) {
  if (cierre.estado === 'web-cambiada') {
    return 'panel.activacion.cierre.web-cambiada';
  }
  // Pasada su caducidad el servidor ya no puede cumplirlo, ni en curso ni pendiente de constar.
  if (cierre.estado === 'no-cumplido' || ahora >= cierre.caducaEn) {
    return 'panel.activacion.cierre.no-cumplido';
  }
  return cierre.estado === 'en-curso' ? 'panel.activacion.cierre.en-curso' : 'panel.activacion.cierre.sin-constancia';
}
/** @param {HTMLElement} destino @param {ActivacionObservada} activacion @param {AccionesActivacion} acciones */
export function mostrarCierre(destino, activacion, acciones) {
  if (TERMINALES.includes(activacion.fase)) {
    return;
  }
  const ahora = acciones.ahora ?? Date.now();
  const resultado = acciones.resultadoCierre;
  if (resultado && resultado !== 'solicitado') {
    parrafo(destino, textoPanel(`panel.activacion.cierre.${resultado}`));
  }
  const clave = activacion.cierre ? textoDelCierre(activacion.cierre, ahora) : null;
  if (clave) {
    parrafo(destino, textoPanel(clave));
  }
  if (acciones.cerrar && clave !== 'panel.activacion.cierre.en-curso') {
    boton(destino, acciones.cerrar);
  }
}
