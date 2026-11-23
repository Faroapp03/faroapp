/** Agenda personal del plan: los días de estudio propuestos y las sesiones publicadas. Nunca sustituye las fechas del
 * proveedor ni confirma la admisión; los horarios y sus coincidencias los cuenta el propio cronograma en sus avisos. */
import { crearCronogramaEstudio } from './cronograma-estudio.js';

/** @import { PlanElegido } from './contrato.js' */

/** @param {string} fecha */
function fechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new TypeError('La agenda necesita una fecha de inicio válida');
  }
  const valor = new Date(`${fecha}T12:00:00Z`);
  if (!Number.isFinite(valor.getTime()) || valor.toISOString().slice(0, 10) !== fecha) {
    throw new TypeError('La agenda necesita una fecha de inicio válida');
  }
}

/** @param {PlanElegido} plan */
export function crearAgenda(plan) {
  fechaValida(plan.preferencias.inicio);
  return { cronograma: crearCronogramaEstudio(plan) };
}
