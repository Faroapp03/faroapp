// Las tareas oficiales de un grupo ISCO-08, para marcar las que hace la persona. Cada una es una casilla con su nombre
// y su nota publicada por la OIT; al marcarla aparece debajo «¿Cuánto tiempo le dedicas?» (el mismo selector que las
// tareas contadas con sus palabras, de fila-tarea.js). Con dos grupos, cada tarea dice de cuál es.

import { crear } from '../dom.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { datoOficial } from './datos-traducidos.js';
import { crearSelectorTiempo, escribirNombreOficial } from './fila-tarea.js';
import { formatearNota } from './formato.js';

/** @import { Parte } from '../textos.js' */
/** @import { Tarea, TareaOficialDelGrupo } from './estado.js' */

/**
 * Lo que comparten las filas de una lista (crearListaOficial explica cada campo).
 * @typedef {Object} OpcionesDeLaLista
 * @property {Map<string, Tarea>} marcadas
 * @property {Map<string, string>} usadas
 * @property {boolean} conGrupo
 * @property {(tareaOficial: TareaOficialDelGrupo, marcada: boolean) => void} alMarcar
 */

/**
 * El id de la casilla de una tarea oficial: se usa para devolverle el foco al volver a pintar la lista.
 * @param {{ id: string }} tareaOficial @returns {string}
 */
export function idDeCasilla(tareaOficial) {
  return `marca-${tareaOficial.id}`;
}

/**
 * Bajo el nombre: la nota de la OIT y, con dos grupos, el grupo de la tarea.
 * @param {TareaOficialDelGrupo} tareaOficial @param {boolean} conGrupo
 */
function crearDetalles(tareaOficial, conGrupo) {
  const nota = escribir(
    crear('small'),
    traducible('recorrido.tarea.nota-oit', { nota: formatearNota(tareaOficial.nota) }),
  );
  if (!conGrupo) {
    return [nota];
  }
  const grupo = traducible('recorrido.tarea.de-grupo', { grupo: datoOficial(tareaOficial.grupo) });
  return [nota, escribir(crear('small', { className: 'rc-grupo-isco' }), grupo)];
}

/**
 * La casilla de una tarea oficial. Si la persona ya la cuenta con sus palabras (`usadaEn`), no se puede marcar otra
 * vez: contaría dos veces en el informe (estado.js). Marcada, siempre se puede desmarcar.
 * @param {TareaOficialDelGrupo} tareaOficial
 * @param {Pick<OpcionesDeLaLista, 'conGrupo' | 'alMarcar'> & {
 *   marcada?: Tarea | undefined, usadaEn?: string | undefined }} opciones
 */
function crearCasilla(tareaOficial, { marcada, usadaEn, conGrupo, alMarcar }) {
  const casilla = crear('input', { type: 'checkbox', id: idDeCasilla(tareaOficial), checked: Boolean(marcada) });
  const bloqueada = Boolean(usadaEn) && !marcada;
  casilla.disabled = bloqueada;
  casilla.addEventListener('change', () => alMarcar(tareaOficial, casilla.checked));
  const usada = bloqueada
    ? [escribir(crear('small'), traducible('recorrido.tarea.ya-la-cuentas', { tarea: usadaEn }))]
    : [];
  return crear(
    'label',
    { className: 'rc-opcion' },
    casilla,
    escribirNombreOficial(crear('strong'), tareaOficial),
    ...crearDetalles(tareaOficial, conGrupo),
    ...usada,
  );
}

/**
 * La fila de una tarea oficial: su casilla y, marcada, «¿Cuánto tiempo le dedicas?», con el nombre de la tarea en su
 * leyenda para los lectores de pantalla (WCAG 1.3.1): quien recorre los grupos de un formulario no oye tres veces la
 * misma pregunta sin saber de qué tarea es.
 * @param {TareaOficialDelGrupo} tareaOficial @param {OpcionesDeLaLista} opciones
 */
function crearFila(tareaOficial, opciones) {
  const marcada = opciones.marcadas.get(tareaOficial.id);
  const usadaEn = opciones.usadas.get(tareaOficial.id);
  const fila = crear(
    'li',
    { className: 'rc-marcable' },
    crearCasilla(tareaOficial, { conGrupo: opciones.conGrupo, alMarcar: opciones.alMarcar, marcada, usadaEn }),
  );
  if (!marcada) {
    return fila;
  }
  fila.dataset.tarea = String(marcada.id);
  fila.append(crearSelectorTiempo(marcada, (elemento) => escribirNombreOficial(elemento, tareaOficial)));
  return fila;
}

/**
 * Un bloque de tareas oficiales para marcar: `titulo` es su leyenda y `explicacion`, lo que va debajo (traducibles).
 * `tareas` son las tareas oficiales del grupo; `marcadas`, las tareas de la persona por id de tarea oficial; `usadas`,
 * el texto de la tarea de la persona que ya usa cada tarea oficial; `alMarcar(tareaOficial, marcada)`, lo que se hace
 * al cambiar una casilla.
 * @param {OpcionesDeLaLista & { titulo: Parte, explicacion: Parte, tareas: TareaOficialDelGrupo[] }} lista
 * @returns {HTMLFieldSetElement}
 */
export function crearListaOficial({ titulo, explicacion, tareas, ...opciones }) {
  return crear(
    'fieldset',
    { className: 'rc-oficiales' },
    escribir(crear('legend'), titulo),
    escribir(crear('p', { className: 'rc-nota' }), explicacion),
    crear('ul', { className: 'rc-marcables' }, ...tareas.map((tareaOficial) => crearFila(tareaOficial, opciones))),
  );
}
