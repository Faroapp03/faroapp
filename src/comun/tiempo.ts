// Conversiones de tiempo y días UTC compartidos, independientes del huso de la máquina.
// Un día sigue el modelo Date de JavaScript: 24 horas, sin cambios por horario de verano.

/** Milisegundos de un segundo: los plazos se escriben en segundos y `AbortSignal.timeout` los pide en milisegundos. */
export const MS_POR_SEGUNDO = 1000;

/** Milisegundos de un minuto: unidad para expresar la duración de las comprobaciones. */
export const MS_POR_MINUTO = 60 * MS_POR_SEGUNDO;

/** Segundos de un día del modelo Date de JavaScript: 24 horas, sin cambios de huso por verano. */
export const SEGUNDOS_POR_DIA = 24 * 60 * 60;

/** Milisegundos de un día UTC. */
export const MS_POR_DIA = SEGUNDOS_POR_DIA * MS_POR_SEGUNDO;

/** Longitud de la fecha ISO con año de cuatro cifras (AAAA-MM-DD). */
const LONGITUD_DIA_ISO = 10;

/**
 * El día UTC (AAAA-MM-DD) de un instante en milisegundos de época.
 *
 * El instante debe pertenecer a los años 0000–9999; no se valida ese intervalo.
 * Los años extendidos de ISO 8601 quedan fuera del contrato de esta extracción.
 *
 * @param {number} instante - Milisegundos de época.
 * @returns {string} El día en formato AAAA-MM-DD.
 * @throws {RangeError} Si el instante no es finito o queda fuera del rango válido de Date.
 */
export function diaUtc(instante: number): string {
  return new Date(instante).toISOString().slice(0, LONGITUD_DIA_ISO);
}

/**
 * El día de hoy en UTC (AAAA-MM-DD), con el mismo contrato de instante que `diaUtc`.
 *
 * @param {number} [ahora] - El instante, en milisegundos de época; por defecto, el actual.
 * @returns {string} El día en formato AAAA-MM-DD.
 * @throws {RangeError} Si el instante no es finito o queda fuera del rango válido de Date.
 */
export function hoyUtc(ahora: number = Date.now()): string {
  return diaUtc(ahora);
}

/** La forma de un día: año de cuatro cifras, mes y día de dos. */
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Si un valor es un día que existe en el calendario (AAAA-MM-DD): `2026-02-30` y `21/10/2026` no lo son. Se da por real
 * si, leído como día UTC, vuelve a escribirse igual.
 *
 * @param {unknown} valor - El valor que se comprueba.
 * @returns {boolean} Si es un día real con la forma AAAA-MM-DD.
 */
export function esDiaReal(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !DIA_ISO.test(valor)) {
    return false;
  }
  const instante = Date.parse(`${valor}T00:00:00Z`);
  return Number.isFinite(instante) && diaUtc(instante) === valor;
}
