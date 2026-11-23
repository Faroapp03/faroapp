/**
 * Si una solicitud a demanda (o del panel) cabe en los topes. Decisión pura: la hora y el historial llegan como datos,
 * y los días y meses son UTC, como el ciclo programado. Los ciclos programados no gastan topes, pero sí minutos.
 */
import { diaUtc, MS_POR_MINUTO } from '../comun/tiempo.ts';
import { ACCIONES_DEMANDA, type AccionDemanda, type ConfiguracionDemanda } from './configuracion-demanda.ts';

/**
 * Minutos de cada run que la autoridad no ve: la cola y la preparación del runner antes del permiso de inicio y el job
 * de activación después del recibo. Se suman a lo medido de cada trabajo y a la reserva de cada ciclo programado, así
 * que el gasto del mes y el coste estimado de una petición los cuentan siempre.
 */
export const MARGEN_MIN_POR_TRABAJO = 15;

/** Un trabajo ya admitido. */
export interface TrabajoDelHistorial {
  /** Instante de la admisión, en milisegundos de época. */
  readonly en: number;
  /** Acción pedida a demanda o desde el panel; `null` para un ciclo programado. */
  readonly accion: AccionDemanda | null;
  /** Minutos de GitHub Actions que cuenta: lo medido más el margen de lo que no se mide; `null` si no hay medida. */
  readonly minutos: number | null;
}
export type MotivoTopes = 'separacion' | 'tope_dia' | 'tope_mes' | 'presupuesto';
export type DecisionTopes =
  | { readonly decision: 'admitida' }
  | { readonly decision: 'rechazada'; readonly motivo: MotivoTopes };

const ERROR = 'Datos de los topes de demanda no válidos';
const LONGITUD_MES_ISO = 7;
const ADMITIDA: DecisionTopes = Object.freeze({ decision: 'admitida' });

function rechazada(motivo: MotivoTopes): DecisionTopes {
  return Object.freeze({ decision: 'rechazada', motivo });
}
function esAccionDemanda(valor: unknown): valor is AccionDemanda {
  return (ACCIONES_DEMANDA as readonly unknown[]).includes(valor);
}
function comprobarEntrada(accion: unknown, ahora: number, historial: readonly TrabajoDelHistorial[]): void {
  if (!esAccionDemanda(accion) || !Number.isSafeInteger(ahora) || ahora < 0 || !Array.isArray(historial)) {
    throw new Error(ERROR);
  }
  for (const trabajo of historial) {
    if (
      !Number.isSafeInteger(trabajo.en) ||
      trabajo.en < 0 ||
      trabajo.en > ahora ||
      (trabajo.accion !== null && !esAccionDemanda(trabajo.accion)) ||
      (trabajo.minutos !== null && (!Number.isSafeInteger(trabajo.minutos) || trabajo.minutos < 0))
    ) {
      throw new Error(ERROR);
    }
  }
}
/** Días del mes de `ahora` posteriores a su día, en UTC. */
function diasRestantesDelMes(ahora: number): number {
  const fecha = new Date(ahora);
  const ultimoDia = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0)).getUTCDate();
  return ultimoDia - fecha.getUTCDate();
}
/** Lo que se reserva para cada ciclo programado: lo declarado en la configuración más el margen de lo que no se mide. */
function minutosDeUnCiclo(configuracion: ConfiguracionDemanda): number {
  return configuracion.reservaProgramadaMin + MARGEN_MIN_POR_TRABAJO;
}
/**
 * Lo que costará la solicitud, y cualquier trabajo aún sin medir: nunca menos que un ciclo programado, ni menos que
 * lo más largo que se ha medido este mes para esa misma acción.
 */
function costeEstimado(
  accion: AccionDemanda | null,
  delMes: readonly TrabajoDelHistorial[],
  configuracion: ConfiguracionDemanda,
): number {
  const medidos = delMes.flatMap((t) => (t.accion === accion && t.minutos !== null ? [t.minutos] : []));
  return Math.max(minutosDeUnCiclo(configuracion), ...medidos);
}
/**
 * Los minutos gastados del mes, más lo que costará la solicitud, más la reserva de cada ciclo programado que queda:
 * los días que faltan del mes y hoy, si el ciclo de hoy aún no consta. Así una solicitud nunca deja sin minutos al
 * ciclo diario.
 */
function cabeEnElPresupuesto(
  configuracion: ConfiguracionDemanda,
  accion: AccionDemanda,
  ahora: number,
  delMes: readonly TrabajoDelHistorial[],
): boolean {
  const hoy = diaUtc(ahora);
  const gastados = delMes.reduce((suma, t) => suma + (t.minutos ?? costeEstimado(t.accion, delMes, configuracion)), 0);
  const programadoDeHoy = delMes.some((t) => t.accion === null && diaUtc(t.en) === hoy);
  const ciclosPendientes = diasRestantesDelMes(ahora) + (programadoDeHoy ? 0 : 1);
  const reservados = ciclosPendientes * minutosDeUnCiclo(configuracion);
  return gastados + costeEstimado(accion, delMes, configuracion) + reservados <= configuracion.presupuestoMinMes;
}

/**
 * `historial`: los trabajos del mes de `ahora` y, si lo hay, la última solicitud anterior, para que la separación
 * también valga al cambiar de mes. Los trabajos de otros meses solo cuentan para la separación.
 */
export function decidirTopes(
  configuracion: ConfiguracionDemanda,
  accion: AccionDemanda,
  ahora: number,
  historial: readonly TrabajoDelHistorial[],
): DecisionTopes {
  comprobarEntrada(accion, ahora, historial);
  const solicitudes = historial.filter((t) => t.accion !== null);
  const ultima = Math.max(-Infinity, ...solicitudes.map((t) => t.en));
  if (ahora - ultima < configuracion.separacionMin * MS_POR_MINUTO) {
    return rechazada('separacion');
  }
  const hoy = diaUtc(ahora);
  if (solicitudes.filter((t) => diaUtc(t.en) === hoy).length >= configuracion.maxDia) {
    return rechazada('tope_dia');
  }
  const mes = hoy.slice(0, LONGITUD_MES_ISO);
  const delMes = historial.filter((t) => diaUtc(t.en).startsWith(mes));
  if (delMes.filter((t) => t.accion === accion).length >= configuracion.maxMes[accion]) {
    return rechazada('tope_mes');
  }
  return cabeEnElPresupuesto(configuracion, accion, ahora, delMes) ? ADMITIDA : rechazada('presupuesto');
}
