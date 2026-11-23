// Las rondas en el apartado «Encuesta»: una tabla con todas, el botón para ver los resultados de cada una y, cuando no
// hay ninguna abierta, el formulario para abrir la siguiente. Solo construye la interfaz; las operaciones las da la
// vista de la encuesta (vista-encuesta.js).
import { crear } from '../scripts/dom.js';
import { texto } from '../scripts/textos.js';
import { nombreDeEntidadValido } from './cliente-encuesta.js';

/** @typedef {import('./cliente-encuesta.js').ResultadosEncuesta} ResultadosEncuesta */
/** @typedef {import('./cliente-encuesta.js').RondaEncuesta} RondaEncuesta */
/** @typedef {import('./cliente-encuesta.js').LoteEncuesta} LoteEncuesta */
/** @typedef {{libre:boolean, ver:(numero:number)=>void, abrir:((nombre:string)=>void)|null, avisar:(mensaje:string)=>void}} AccionesRondas */

const t = (/** @type {string} */ clave, /** @type {Record<string,string|number>} */ valores = {}) =>
  texto(`panel.piloto.${clave}`, valores);

/** Un día AAAA-MM-DD como lo lee la persona; sin fecha conocida, «Sin dato». @param {string|null} dia */
function fecha(dia) {
  if (dia === null) {
    return t('ronda.sin-fecha');
  }
  const [anio, mes, numero] = dia.split('-');
  return `${numero}/${mes}/${anio}`;
}
/** @param {RondaEncuesta} ronda @param {boolean} vista @param {AccionesRondas} acciones */
function filaDeRonda(ronda, vista, acciones) {
  const ver = crear('button', { type: 'button', textContent: t('ronda.ver', { nombre: ronda.nombre }) });
  ver.disabled = !acciones.libre || vista;
  ver.addEventListener('click', () => acciones.ver(ronda.numero));
  const fila = crear(
    'tr',
    {},
    crear('th', { scope: 'row', textContent: ronda.nombre }),
    crear('td', { textContent: t(ronda.abierta ? 'ronda.abierta' : 'ronda.cerrada') }),
    crear('td', { textContent: fecha(ronda.inicio) }),
    crear('td', { textContent: fecha(ronda.cierre) }),
    crear('td', { textContent: String(ronda.invitaciones) }),
    crear('td', { textContent: String(ronda.respuestas) }),
    crear('td', {}, ver),
  );
  if (vista) {
    fila.setAttribute('aria-current', 'true');
  }
  return fila;
}
/** @param {ResultadosEncuesta} resultados @param {AccionesRondas} acciones */
function tablaDeRondas(resultados, acciones) {
  const columnas = ['ronda', 'estado', 'inicio', 'cierre', 'invitaciones', 'respuestas', 'acciones'];
  return crear(
    'table',
    {},
    crear('caption', { textContent: t('rondas') }),
    crear(
      'thead',
      {},
      crear('tr', {}, ...columnas.map((c) => crear('th', { scope: 'col', textContent: t(`columna.${c}`) }))),
    ),
    crear(
      'tbody',
      {},
      ...resultados.rondas.map((ronda) => filaDeRonda(ronda, ronda.numero === resultados.ronda.numero, acciones)),
    ),
  );
}
/** El formulario de la ronda nueva; el nombre sigue la misma regla que el de una entidad. @param {AccionesRondas} acciones */
function formularioDeRonda(acciones) {
  const campo = crear('input', { type: 'text', id: 'encuesta-ronda-nombre', maxLength: 60, autocomplete: 'off' });
  campo.setAttribute('aria-describedby', 'encuesta-ronda-ayuda');
  const boton = crear('button', { type: 'submit', textContent: t('ronda.abrir') });
  const formulario = crear(
    'form',
    { className: 'encuesta-ronda-nueva' },
    crear('h3', { textContent: t('ronda.nueva') }),
    crear('label', { htmlFor: campo.id, textContent: t('ronda.nombre') }),
    campo,
    crear('p', { id: 'encuesta-ronda-ayuda', className: 'ayuda', textContent: t('ronda.nombre-ayuda') }),
    boton,
  );
  campo.disabled = boton.disabled = !acciones.libre || !acciones.abrir;
  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const nombre = campo.value.trim();
    if (!nombreDeEntidadValido(nombre)) {
      campo.setAttribute('aria-invalid', 'true');
      acciones.avisar(t('error.nombre-ronda'));
      campo.focus();
      return;
    }
    campo.removeAttribute('aria-invalid');
    acciones.abrir?.(nombre);
  });
  return formulario;
}
/**
 * El bloque de rondas: la tabla y, sin ninguna abierta, el formulario de la siguiente; con una abierta, la frase que
 * dice que hay que cerrarla antes. @param {ResultadosEncuesta} resultados @param {AccionesRondas} acciones
 */
export function bloqueDeRondas(resultados, acciones) {
  const hayAbierta = resultados.rondas.some((ronda) => ronda.abierta);
  return crear(
    'section',
    { className: 'encuesta-rondas' },
    crear('p', { textContent: t('rondas-intro') }),
    tablaDeRondas(resultados, acciones),
    hayAbierta ? crear('p', { textContent: t('ronda.solo-cerrada') }) : formularioDeRonda(acciones),
  );
}
/**
 * Los resultados con un lote recién creado en la ronda abierta: el lote al final y las invitaciones sumadas a la ronda
 * y a su fila en la lista, sin volver a consultar. @param {ResultadosEncuesta} resultados @param {LoteEncuesta} lote
 * @returns {ResultadosEncuesta}
 */
export function conLoteNuevo(resultados, lote) {
  const ronda = Object.freeze({ ...resultados.ronda, invitaciones: resultados.ronda.invitaciones + lote.emitidos });
  return Object.freeze({
    ...resultados,
    ronda,
    rondas: Object.freeze(resultados.rondas.map((r) => (r.numero === ronda.numero ? ronda : r))),
    lotes: Object.freeze([...resultados.lotes, lote]),
  });
}
