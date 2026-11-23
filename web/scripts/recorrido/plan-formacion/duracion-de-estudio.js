// Cómo se escribe el tiempo de estudio del plan: horas y minutos enteros, con las mismas abreviaturas en castellano y
// en catalán.
const MINUTOS_POR_HORA = 60;

/** El tiempo de estudio redondeado al minuto: «2 h 3 min», «2 h», «30 min»; «0 min» si no llega a un minuto. Los minutos
 * que salen de multiplicar horas publicadas por 60 pueden traer decimales de más (2,05 h son 122,99999999999999 min):
 * se redondean antes de partir en horas y minutos.
 * @param {number} minutos */
export function duracionDeEstudio(minutos) {
  const total = Math.round(minutos);
  const horas = Math.floor(total / MINUTOS_POR_HORA);
  const resto = total % MINUTOS_POR_HORA;
  return [horas ? `${horas} h` : '', resto ? `${resto} min` : ''].filter(Boolean).join(' ') || '0 min';
}
