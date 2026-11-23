const DIAS_SEMANA = 7;
const DOMINGO_A_LUNES = 6;
const ULTIMO_DIA = 0;
/** @param {string} valor */
export const fechaUTC = (valor) => new Date(`${valor}T12:00:00Z`);
/** @param {Date} fecha */
export const fechaISO = (fecha) => fecha.toISOString().slice(0, 'YYYY-MM-DD'.length);
/** @param {string} valor @param {number} dias */
export function moverDia(valor, dias) {
  const fecha = fechaUTC(valor);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fechaISO(fecha);
}
/** Cambia de mes conservando el día hasta el último válido (también en años bisiestos).
 * @param {string} valor @param {number} meses */
export function moverMes(valor, meses) {
  const fecha = fechaUTC(valor);
  const dia = fecha.getUTCDate();
  fecha.setUTCDate(1);
  fecha.setUTCMonth(fecha.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, ULTIMO_DIA)).getUTCDate();
  fecha.setUTCDate(Math.min(dia, ultimo));
  return fechaISO(fecha);
}
/** @param {string} valor */
export function diasDelMes(valor) {
  const fecha = fechaUTC(valor);
  const inicio = `${valor.slice(0, 'YYYY-MM'.length)}-01`;
  const huecos = (fechaUTC(inicio).getUTCDay() + DOMINGO_A_LUNES) % DIAS_SEMANA;
  const dias = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, ULTIMO_DIA)).getUTCDate();
  return { huecos, dias: Array.from({ length: dias }, (_, i) => moverDia(inicio, i)) };
}
/** @param {string} valor @param {string} tecla @returns {string|null} */
export function fechaConTecla(valor, tecla) {
  const lunes = (fechaUTC(valor).getUTCDay() + DOMINGO_A_LUNES) % DIAS_SEMANA;
  const dias = new Map([
    ['ArrowLeft', -1],
    ['ArrowRight', 1],
    ['ArrowUp', -DIAS_SEMANA],
    ['ArrowDown', DIAS_SEMANA],
    ['Home', -lunes],
    ['End', DOMINGO_A_LUNES - lunes],
  ]);
  const salto = dias.get(tecla);
  if (salto !== undefined) {
    return moverDia(valor, salto);
  }
  if (tecla === 'PageUp' || tecla === 'PageDown') {
    return moverMes(valor, tecla === 'PageUp' ? -1 : 1);
  }
  return null;
}
