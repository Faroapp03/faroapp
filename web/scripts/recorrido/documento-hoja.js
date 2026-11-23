/** Documento de la hoja de ruta confirmada: lo compone el plan (plan-formacion/documento.js) y aquí se pinta, se abre
 * y se comprueba antes de imprimir. */
import { TEXTOS_FORMACION as CA } from '../../idiomas/ca/formacion.js';
import { TEXTOS_FORMACION as ES } from '../../idiomas/es/formacion.js';
import { antesDelLimitePublicado } from '../../recursos/catalogo-cursos/lector.js';
import { crear, porId } from '../dom.js';
import { estado } from './estado.js';
import { irA, PASO_INFORME } from './navegacion.js';
import { crearDocumentoDelPlan } from './plan-formacion/documento.js';

/** @import { HojaConfirmada } from './estado.js' */
/** @import { PlanElegido } from './plan-formacion/contrato.js' */
const CONTENEDOR = 'hoja-de-ruta';

/** @param {HojaConfirmada} confirmada @returns {HTMLElement} */
export function crearDocumentoDeLaHoja(confirmada) {
  return crearDocumentoDelPlan(confirmada.plan);
}
/** Pinta en su contenedor el documento de la hoja confirmada. */
export function pintarDocumentoDeLaHoja() {
  if (!estado.hojaDeRuta) {
    throw new Error('No hay hoja de formación confirmada');
  }
  porId(CONTENEDOR).replaceChildren(crearDocumentoDeLaHoja(estado.hojaDeRuta));
}
/** Comprueba la fecha de confirmación y las ofertas elegidas (ninguna, una o dos).
 * @param {PlanElegido} plan @param {number} ahora */
export function planVigenteAlImprimir(plan, ahora) {
  return (
    Number.isSafeInteger(ahora) &&
    ahora >= Date.parse(plan.confirmadoEl) &&
    plan.elecciones.every((opcion) => antesDelLimitePublicado(opcion.oferta, ahora))
  );
}
/** Impide imprimir ofertas que alcanzaron su límite publicado. Lo demás se imprime entero, en las páginas que necesite.
 * Empieza retirando el bloqueo y el aviso de un intento anterior, también si no hay documento que imprimir.
 * @returns {boolean} */
export function prepararHojaParaImprimir() {
  const c = estado.hojaDeRuta;
  const host = document.getElementById(CONTENEDOR);
  document.documentElement.classList.remove('formacion-no-imprimible');
  document.getElementById('hd-error-impresion')?.remove();
  if (!c || !host?.querySelector('.hd')) {
    return false;
  }
  const ahora = Date.now();
  if (planVigenteAlImprimir(c.plan, ahora)) {
    return true;
  }
  document.documentElement.classList.add('formacion-no-imprimible');
  const aviso = crear('p', {
    className: 'hd-error-impresion',
    textContent: (c.idioma === 'ca' ? CA : ES)['formacion.doc.expirada'],
  });
  aviso.id = 'hd-error-impresion';
  aviso.setAttribute('role', 'alert');
  host.prepend(aviso);
  aviso.tabIndex = -1;
  aviso.focus();
  return false;
}
export function irALaHoja() {
  irA(PASO_INFORME);
  const vista = porId('paso-4');
  vista.dataset.vista = 'hoja';
  const titulo = vista.querySelector('#hd-titulo');
  vista.scrollIntoView({ block: 'start' });
  if (titulo instanceof HTMLElement) {
    titulo.tabIndex = -1;
    titulo.focus({ preventScroll: true });
  }
}
