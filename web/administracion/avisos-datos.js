import { fechaIso, partesEnZona } from '../scripts/fechas.js';
import { texto as textoPanel } from '../scripts/textos.js';
import { diaPanel } from './fechas-panel.js';
import { ESTADOS_SALUD } from './salud-datos.js';

/** Avisos del estado de los datos que no son el resultado de una consulta: la edición que una encuesta ha publicado,
 * lo que la última salida no recoge y el fallo del almacén de cursos. Cada uno se escribe solo cuando el estado lo
 * trae con valor; sin valor, no sale ninguna línea. Ningún texto se interpreta como HTML. */

/** @typedef {import('./salud-datos.js').SaludFuente} SaludFuente */
/** @typedef {import('./estado-datos.js').MotivoAlmacenDatos} MotivoAlmacenDatos */

/** @param {HTMLElement} destino @param {string} texto */
function linea(destino, texto) {
  const parrafo = document.createElement('p');
  parrafo.textContent = texto;
  destino.append(parrafo);
}
/** El texto de una cantidad en singular o plural: `clave.uno` o `clave.otros`.
 * @param {string} clave @param {number} cantidad */
function conNumero(clave, cantidad) {
  return textoPanel(`${clave}.${cantidad === 1 ? 'uno' : 'otros'}`, { v0: String(cantidad) });
}
/** La edición nueva y sus avisos son información: no cambian el estado de la fuente.
 * @param {HTMLElement} destino @param {SaludFuente} fuente
 */
function avisosDeEdicion(destino, fuente) {
  if (fuente.edicionNueva !== null) {
    const { estado, anio, observadoEn } = fuente.edicionNueva;
    const observado = diaPanel(fechaIso(partesEnZona(observadoEn)));
    linea(destino, textoPanel(`panel.datos.edicion-nueva.${estado}`, { v0: anio, v1: observado }));
    if (fuente.edicionNueva.motivo !== undefined) {
      linea(destino, textoPanel(`panel.datos.edicion-nueva.motivo.${fuente.edicionNueva.motivo}`));
    }
    for (const parte of fuente.edicionNueva.partes ?? []) {
      linea(destino, textoPanel(`panel.datos.edicion-nueva.parte.${parte}`));
    }
  }
  if (fuente.avisoEdicion !== null) {
    linea(destino, textoPanel(`panel.datos.aviso-edicion.${fuente.avisoEdicion}`));
  }
  if (fuente.gruposEnSuGranGrupo !== null) {
    linea(destino, conNumero('panel.datos.grupos-en-su-gran-grupo', fuente.gruposEnSuGranGrupo));
  }
  if (fuente.gruposSinClase !== null) {
    linea(destino, conNumero('panel.datos.grupos-sin-clase', fuente.gruposSinClase));
  }
}
/** Las cifras de la última comprobación de enlaces: información, no una incidencia.
 * @param {HTMLElement} destino @param {SaludFuente} fuente
 */
function avisosDeEnlaces(destino, fuente) {
  if (fuente.enlaces === null) {
    return;
  }
  const { comprobados, ocultos, sinComprobar } = fuente.enlaces;
  const cifras = [
    conNumero('panel.datos.enlaces.comprobados', comprobados),
    conNumero('panel.datos.enlaces.ocultos', ocultos),
    conNumero('panel.datos.enlaces.sin-comprobar', sinComprobar),
  ];
  linea(destino, textoPanel('panel.datos.enlaces', { v0: cifras.join('; ') }));
}
/** Las fichas que la última actualización descartó, las especialidades por revisar y un texto por cada motivo.
 * @param {HTMLElement} destino @param {SaludFuente} fuente
 */
function avisosDeSalidaParcial(destino, fuente) {
  const salida = fuente.salidaParcial;
  if (salida === null) {
    return;
  }
  if (salida.descartadas > 0) {
    const descartadas = conNumero('panel.datos.salida-parcial.descartadas', salida.descartadas);
    linea(destino, textoPanel('panel.datos.salida-parcial', { v0: descartadas }));
  }
  if (salida.aRevisar > 0) {
    linea(destino, conNumero('panel.datos.salida-parcial.a-revisar', salida.aRevisar));
  }
  for (const motivo of salida.motivos) {
    linea(destino, textoPanel(`panel.datos.salida-parcial.motivo.${motivo}`));
  }
}
/** @param {HTMLElement} destino @param {SaludFuente} fuente */
export function avisosDeFuente(destino, fuente) {
  avisosDeEdicion(destino, fuente);
  avisosDeSalidaParcial(destino, fuente);
  avisosDeEnlaces(destino, fuente);
}
/** Un aviso de la instalación que pide atención: un bloque con su título, con la forma y el tono de «Necesita atención».
 * @param {HTMLElement} destino @param {string} clave
 */
function avisoQuePideAtencion(destino, clave) {
  const aviso = document.createElement('section');
  aviso.className = 'salud-aviso';
  const titulo = document.createElement('h4');
  titulo.id = `salud-aviso-${clave.split('.').pop()}`;
  titulo.textContent = textoPanel('panel.datos.aviso-instalacion');
  aviso.setAttribute('aria-labelledby', titulo.id);
  const visual = ESTADOS_SALUD.atencion;
  const indicador = document.createElement('p');
  indicador.className = `salud-indicador salud-${visual.tono}`;
  indicador.textContent = `${visual.forma} ${textoPanel('panel.salud.estado.atencion')}`;
  aviso.append(titulo, indicador);
  linea(aviso, textoPanel(clave));
  destino.append(aviso);
}
/** Los avisos que son de la instalación y no de una fuente: el fallo del almacén de cursos, que solo sale cuando el
 * estado lo trae.
 * @param {HTMLElement} destino @param {{almacen: MotivoAlmacenDatos|null}} salud
 */
export function avisosDeLaInstalacion(destino, salud) {
  if (salud.almacen !== null) {
    avisoQuePideAtencion(destino, `panel.datos.almacen.${salud.almacen}`);
  }
}
