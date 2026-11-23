// Cuentas con fechas AAAA-MM-DD, sin lógica de ningún motor: las usan la app (dominio/acreditacion.ts) y el motor de
// cursos (motores/cursos/src/vigencia-cursos.ts). No importa nada de motores/ ni de src/.

/** Milisegundos de un día UTC (24 horas, como MS_POR_DIA de src/comun/tiempo.ts). */
const MS_POR_DIA = 86_400_000;
/** Formato del día UTC admitido; excluye formatos locales y horas. */
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/u;
/** Longitud de la fecha AAAA-MM-DD dentro de un instante ISO UTC. */
const LONGITUD_DIA_ISO = 10;

/** Milisegundos UTC del día real; NaN ante formato ajeno, fecha imposible o ausencia. */
function instanteDelDia(fecha: string): number {
  if (!DIA_ISO.test(fecha)) {
    return Number.NaN;
  }
  const instante = Date.parse(fecha);
  if (!Number.isFinite(instante) || new Date(instante).toISOString().slice(0, LONGITUD_DIA_ISO) !== fecha) {
    return Number.NaN;
  }
  return instante;
}

/**
 * Días que van de una fecha a otra, las dos AAAA-MM-DD.
 *
 * @param desde - Fecha de partida.
 * @param hasta - Fecha de llegada.
 * @returns Los días, negativos si `hasta` va antes; NaN si alguna no es una fecha.
 */
export function diasEntreFechas(desde: string, hasta: string): number {
  return (instanteDelDia(hasta) - instanteDelDia(desde)) / MS_POR_DIA;
}
