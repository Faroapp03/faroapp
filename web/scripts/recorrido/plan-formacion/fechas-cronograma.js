/** Los días personales se interpretan en la misma zona que el recorrido. */
import { fechaIso, partesEnZona, ZONA_BARCELONA } from '../../fechas.js';

export const DIA_MS = 86_400_000;
const DIAS_SEMANA = 7;
/** @param {string} dia */
export function instante(dia) {
  const numero = Date.parse(`${dia}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dia) ||
    !Number.isFinite(numero) ||
    new Date(numero).toISOString().slice(0, 10) !== dia
  ) {
    throw new TypeError('Fecha de inicio no válida');
  }
  return numero;
}
/** @param {number} numero */
export const fecha = (numero) => new Date(numero).toISOString().slice(0, 10);
/** @param {number} numero */
export const fechaMadrid = (numero) => fechaIso(partesEnZona(numero, ZONA_BARCELONA));
/** @param {number} numero */
export const diaIso = (numero) => new Date(numero).getUTCDay() || DIAS_SEMANA;
