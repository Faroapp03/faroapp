import { fechaIso, partesEnZona, ZONA_BARCELONA } from '../../fechas.js';
import { disponibilidadValida } from './contrato.js';

/** Valida y ordena sin modificar la elección; no atribuye horas de reloj. */
/** @param {unknown} entrada @returns {{dias:number[],minutosPorDia:number}} */
export function validarDisponibilidad(entrada) {
  if (!disponibilidadValida(entrada)) {
    throw new TypeError('La disponibilidad de estudio no es válida');
  }
  const dato = /** @type {{dias:number[],minutosPorDia:number}} */ (entrada);
  return { dias: [...dato.dias].sort((a, b) => a - b), minutosPorDia: dato.minutosPorDia };
}

/** El inicio es una fecha civil; la confirmación se convierte a la misma zona usada por el recorrido. */
/** @param {string} inicio @param {string} confirmadoEl @returns {boolean} */
export function inicioNoAnterior(inicio, confirmadoEl) {
  const instante = Date.parse(confirmadoEl);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !Number.isFinite(instante) || !/(?:Z|[+-]\d\d:\d\d)$/.test(confirmadoEl)) {
    return false;
  }
  const dia = fechaIso(partesEnZona(instante, ZONA_BARCELONA));
  return inicio >= dia;
}
