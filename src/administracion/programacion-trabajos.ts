/** Capacidad privada del reloj de mantenimiento; nunca recibe una sesión ni una acción del navegador. */
import { MS_POR_MINUTO } from '../comun/tiempo.ts';
import { leerCronDiario } from './configuracion-programada.ts';
import {
  type FalloProgramado,
  type FaseProgramada,
  leerFaseProgramada,
  leerMotivoFalloProgramado,
  type MotivoFalloProgramado,
  type ResultadoFalloProgramado,
} from './fallo-programado.ts';
import type { ConfianzaOidcGitHub } from './oidc-github.ts';
import {
  type EstadoTrabajos,
  esEnteroTrabajo,
  exigirTrabajo,
  leerEstadoTrabajos,
  objetoTrabajo,
  type TrabajoActualizacion,
} from './trabajos.ts';

export interface SolicitudTrabajoProgramado {
  readonly eventoEn: number;
  readonly cron: string;
  /** El reloj ha validado el cron extraordinario habilitado para el día de este evento. */
  readonly recuperacion?: true;
  /** Segunda petición del mismo evento, tras consultar a GitHub: ya no puede volver a pedir esa consulta. */
  readonly reconciliada?: true;
}
/**
 * `pendiente-reconciliacion` no consume el evento: lo devuelve solo un evento nuevo, dentro de la ventana y con una
 * reserva vencida de ejecución conocida, para que el reloj consulte a GitHub antes de la reserva definitiva.
 */
export interface ResultadoReservaTrabajoProgramado {
  readonly revisarPaquetePendiente?: true;
  readonly estado:
    | 'nueva'
    | 'repetida'
    | 'pendiente-reconciliacion'
    | 'omitida-ocupado'
    | 'omitida-candidato'
    | 'omitida-tardia';
  readonly trabajos: EstadoTrabajos;
}
/** Requiere prepararTrabajos y prepararActivacion de la misma autoridad antes de reservar. */
export interface AlmacenTrabajosProgramados {
  reservarTrabajoProgramado(
    solicitud: SolicitudTrabajoProgramado,
    confianza: ConfianzaOidcGitHub,
  ): Promise<ResultadoReservaTrabajoProgramado>;
  /** Guarda la fase de un fallo del manejador; no consume el evento ni concede un despacho. */
  registrarFalloProgramado(fallo: FalloProgramado): Promise<ResultadoFalloProgramado>;
}
const MINUTOS_VENTANA = 360;
export const VENTANA_TRABAJO_PROGRAMADO_MS = MINUTOS_VENTANA * MS_POR_MINUTO;
/** Suma de los tres jobs de actualizar.yml, uno tras otro: 324 minutos para construir, 45 para activar y 2 para avisar. */
export const MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR = 371;
/** Lo que la reserva dura más que los tres jobs, para las colas de GitHub y el desfase de relojes. */
const MINUTOS_MARGEN_RESERVA = 13;
/** La reserva cuenta desde su creación; la prueba de contrato del presupuesto mantiene esta suma. */
const MINUTOS_RESERVA_PROGRAMADA = MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR + MINUTOS_MARGEN_RESERVA;
export const PLAZO_RESERVA_PROGRAMADA_MS = MINUTOS_RESERVA_PROGRAMADA * MS_POR_MINUTO;
/** Un trabajo creado hace menos de este plazo puede pertenecer todavía a una ejecución viva. */
export function trabajoEnPlazo(trabajo: Pick<TrabajoActualizacion, 'creadoEn'>, ahora: number): boolean {
  return ahora - trabajo.creadoEn <= PLAZO_RESERVA_PROGRAMADA_MS;
}
/** Una reserva sin cerrar después de este plazo ya no puede atribuirse a una ejecución normal en curso. */
export function reservaProgramadaVencida(trabajo: Pick<TrabajoActualizacion, 'creadoEn' | 'estado'>, ahora: number) {
  return trabajo.estado !== 'terminado' && !trabajoEnPlazo(trabajo, ahora);
}

/** `fallida`: el manejador falló antes de consumir el evento; la marca no avanza y el vigilante sigue esperándolo. */
export type ResultadoEventoProgramado =
  | Exclude<ResultadoReservaTrabajoProgramado['estado'], 'repetida' | 'pendiente-reconciliacion'>
  | 'fallida';
export type MotivoEventoProgramado =
  | 'sin-trabajo-pendiente'
  | 'reserva-sin-inicio-liberada'
  | 'ejecucion-cerrada-sin-recibo'
  | 'candidato-en-plazo'
  | 'evento-fuera-de-ventana'
  | 'activacion-sin-resolver'
  | 'trabajo-en-plazo'
  | 'requiere-atencion'
  | 'evento-sin-consumir';
/** Registro operativo de un evento consumido: solo instantes y códigos, nunca personas ni identificadores remotos. */
export interface EventoProgramado {
  readonly eventoEn: number;
  readonly registradoEn: number;
  readonly resultado: ResultadoEventoProgramado;
  readonly motivo: MotivoEventoProgramado;
  /**
   * Fase y motivo del fallo del manejador, juntos o ninguno. Una reserva `nueva` solo puede llevar el fallo de su
   * despacho; una fila `fallida` siempre lleva el suyo.
   */
  readonly fase: FaseProgramada | null;
  readonly motivoFallo: MotivoFalloProgramado | null;
}
export const MAX_EVENTOS_PROGRAMADOS = 60;
const MOTIVOS_POR_RESULTADO: Readonly<Record<ResultadoEventoProgramado, readonly MotivoEventoProgramado[]>> = {
  nueva: ['sin-trabajo-pendiente', 'reserva-sin-inicio-liberada', 'ejecucion-cerrada-sin-recibo'],
  'omitida-tardia': ['evento-fuera-de-ventana'],
  'omitida-candidato': ['activacion-sin-resolver', 'candidato-en-plazo'],
  'omitida-ocupado': ['trabajo-en-plazo', 'requiere-atencion'],
  fallida: ['evento-sin-consumir'],
};
function leerFalloDelEvento(resultado: ResultadoEventoProgramado, fase: unknown, motivoFallo: unknown) {
  if (fase === null && motivoFallo === null && resultado !== 'fallida') {
    return { fase: null, motivoFallo: null };
  }
  const leida = leerFaseProgramada(fase);
  exigirTrabajo(resultado === 'fallida' ? leida !== 'despacho' : resultado === 'nueva' && leida === 'despacho');
  return { fase: leida, motivoFallo: leerMotivoFalloProgramado(motivoFallo) };
}
export function leerEventoProgramado(entrada: unknown): EventoProgramado {
  const o = objetoTrabajo(entrada, 'eventoEn,fase,motivo,motivoFallo,registradoEn,resultado');
  exigirTrabajo(esEnteroTrabajo(o.eventoEn) && o.eventoEn > 0 && esEnteroTrabajo(o.registradoEn));
  exigirTrabajo(o.eventoEn <= o.registradoEn);
  const resultado = (Object.keys(MOTIVOS_POR_RESULTADO) as ResultadoEventoProgramado[]).find((r) => r === o.resultado);
  exigirTrabajo(resultado !== undefined);
  const motivo = MOTIVOS_POR_RESULTADO[resultado].find((m) => m === o.motivo);
  exigirTrabajo(motivo !== undefined);
  const fallo = leerFalloDelEvento(resultado, o.fase, o.motivoFallo);
  return Object.freeze({ eventoEn: o.eventoEn, registradoEn: o.registradoEn, resultado, motivo, ...fallo });
}
export function leerSolicitudTrabajoProgramado(entrada: unknown): SolicitudTrabajoProgramado {
  const incluye = (clave: string) => entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, clave);
  const reconciliada = incluye('reconciliada');
  const recuperacion = incluye('recuperacion');
  const o = objetoTrabajo(
    entrada,
    `cron,eventoEn${reconciliada ? ',reconciliada' : ''}${recuperacion ? ',recuperacion' : ''}`,
  );
  exigirTrabajo(!recuperacion || o.recuperacion === true);
  exigirTrabajo(esEnteroTrabajo(o.eventoEn) && o.eventoEn > 0 && (!reconciliada || o.reconciliada === true));
  const cron = leerCronDiario(o.cron);
  const [minuto, hora] = cron.split(' ').map(Number);
  const fecha = new Date(o.eventoEn);
  exigirTrabajo(
    Number.isFinite(fecha.getTime()) &&
      fecha.getUTCMinutes() === minuto &&
      fecha.getUTCHours() === hora &&
      fecha.getUTCSeconds() === 0 &&
      fecha.getUTCMilliseconds() === 0,
  );
  return Object.freeze({
    eventoEn: o.eventoEn,
    cron,
    ...(reconciliada ? { reconciliada: true as const } : {}),
    ...(recuperacion ? { recuperacion: true as const } : {}),
  });
}
export function leerResultadoReservaTrabajoProgramado(entrada: unknown): ResultadoReservaTrabajoProgramado {
  const pendiente =
    entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, 'revisarPaquetePendiente');
  const o = objetoTrabajo(entrada, pendiente ? 'estado,revisarPaquetePendiente,trabajos' : 'estado,trabajos');
  exigirTrabajo(!pendiente || (o.estado === 'nueva' && o.revisarPaquetePendiente === true));
  exigirTrabajo(
    o.estado === 'nueva' ||
      o.estado === 'repetida' ||
      o.estado === 'pendiente-reconciliacion' ||
      o.estado === 'omitida-ocupado' ||
      o.estado === 'omitida-candidato' ||
      o.estado === 'omitida-tardia',
  );
  const trabajos = leerEstadoTrabajos(o.trabajos);
  if (o.estado === 'nueva') {
    exigirTrabajo(
      trabajos.ultimoTrabajo?.accion === 'comprobar-programada' &&
        trabajos.ultimoTrabajo.estado === 'despacho-incierto' &&
        trabajos.ultimoTrabajo.revisionReserva === trabajos.revision,
    );
  }
  return Object.freeze({
    estado: o.estado,
    trabajos,
    ...(pendiente ? { revisarPaquetePendiente: true as const } : {}),
  });
}
