import { texto as textoPanel } from '../scripts/textos.js';
import { detallesDelRegistro } from './estado-visible-panel.js';
import { fechaConUtc, fechaPanel } from './fechas-panel.js';
/** El trabajo construye un candidato: su resultado no acredita activación ni cobertura de todas las fuentes. */
/** @typedef {import('../../src/administracion/trabajos.ts').EstadoTrabajos} EstadoTrabajos */
/** @typedef {import('../../src/administracion/trabajos.ts').TrabajoActualizacion} TrabajoActualizacion */
/** @typedef {import('./estado-trabajos.js').AccionActualizacion} AccionActualizacion */

/**
 * El nombre de cada acción de la lista cerrada. Ninguna vía pide todavía las dos últimas, pero el panel sabe
 * nombrarlas si un trabajo las trae.
 * @type {Readonly<Record<AccionActualizacion, string>>}
 */
export const CLAVE_TEXTO_DE_LA_ACCION = Object.freeze({
  'actualizar-datos': 'panel.trabajos.buscar',
  'reintentar-pendientes': 'panel.trabajos.reintentar',
  'comprobar-programada': 'panel.trabajo.programada',
  'comprobar-vencidas': 'panel.trabajos.vencidas',
  'actualizar-cursos': 'panel.trabajos.cursos',
});

/** @param {EstadoTrabajos|null} trabajos */
export function trabajoPendiente(trabajos) {
  return Boolean(trabajos?.ultimoTrabajo && trabajos.ultimoTrabajo.estado !== 'terminado');
}

/** @param {TrabajoActualizacion} trabajo @returns {string} */
function resultadoDelTrabajo(trabajo) {
  if (trabajo.estado === 'despacho-incierto') {
    return textoPanel('panel.trabajo.solicitada-incierta');
  }
  if (trabajo.estado === 'despachado') {
    return textoPanel('panel.trabajo.en-curso');
  }
  const resultados = {
    validado: textoPanel('panel.trabajo.resultado.validado'),
    'sin-pendientes': textoPanel('panel.trabajo.resultado.sin-pendientes'),
    rechazado: textoPanel('panel.trabajo.resultado.rechazado'),
    'despacho-rechazado': textoPanel('panel.trabajo.resultado.despacho-rechazado'),
    retirado: textoPanel('panel.trabajo.resultado.retirado'),
    'ejecucion-sin-recibo': textoPanel('panel.trabajo.resultado.ejecucion-sin-recibo'),
  };
  return trabajo.resultado ? resultados[trabajo.resultado.resultado] : textoPanel('panel.trabajo.sin-resultado');
}

/** @param {HTMLElement} destino @param {string} texto */
function parrafo(destino, texto) {
  const nodo = document.createElement('p');
  nodo.textContent = texto;
  destino.append(nodo);
}

/** Frase de la solicitud para las confirmaciones; su identificador interno queda en el detalle técnico.
 * @param {Pick<import('../../src/administracion/trabajos.ts').TrabajoActualizacion,'creadoEn'>} trabajo */
export function detalleDeSolicitud(trabajo) {
  return textoPanel('panel.trabajo.detalle', { fecha: fechaPanel(trabajo.creadoEn) });
}
/** @param {HTMLElement} destino @param {EstadoTrabajos|null} trabajos */
export function mostrarEstadoTrabajos(destino, trabajos) {
  destino.replaceChildren();
  if (!trabajos) {
    parrafo(destino, textoPanel('panel.trabajo.consulta-inicial'));
    return;
  }
  const trabajo = trabajos.ultimoTrabajo;
  if (!trabajo) {
    parrafo(destino, textoPanel('panel.trabajo.sin-trabajos'));
    return;
  }
  parrafo(destino, resultadoDelTrabajo(trabajo));
  const { resultado, ...campos } = trabajo;
  const detalle = detallesDelRegistro(destino, { revision: trabajos.revision, ...campos, ...resultado });
  parrafo(detalle, textoPanel('panel.solicitud-id', { v0: trabajo.solicitudId }));
  const accion = textoPanel(CLAVE_TEXTO_DE_LA_ACCION[trabajo.accion]);
  parrafo(detalle, textoPanel('panel.trabajo.fecha-solicitud', { v0: accion, v1: fechaConUtc(trabajo.creadoEn) }));
  if (trabajo.resultado) {
    parrafo(detalle, textoPanel('panel.trabajo.finalizada', { v0: fechaConUtc(trabajo.resultado.terminadoEn) }));
    const errores = {
      actualizacion_no_completada: textoPanel('panel.trabajo.error.actualizacion_no_completada'),
      actualizacion_no_admitida: textoPanel('panel.trabajo.error.actualizacion_no_admitida'),
      candidato_no_verificable: textoPanel('panel.trabajo.error.candidato_no_verificable'),
    };
    if (trabajo.resultado.error) {
      parrafo(destino, errores[trabajo.resultado.error]);
    }
  }
}
