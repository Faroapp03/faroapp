/**
 * Fallos del manejador programado: qué fase falló y si fue por plazo. Solo códigos e instantes; nunca el texto del
 * error, que puede contener respuestas remotas o credenciales.
 */
import { PlazoAgotado } from '../api/errores.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';

export const FASES_PROGRAMADAS = [
  'configuracion',
  'validacion',
  'preparacion',
  'reconciliacion',
  'reserva',
  'despacho',
] as const;
export type FaseProgramada = (typeof FASES_PROGRAMADAS)[number];
export const MOTIVOS_FALLO_PROGRAMADO = ['error', 'plazo-agotado'] as const;
export type MotivoFalloProgramado = (typeof MOTIVOS_FALLO_PROGRAMADO)[number];
/** Una autoridad atascada no retiene el manejador: el registro tiene su propio plazo. */
export const PLAZO_REGISTRO_FALLO_MS = 3000;
export interface FalloProgramado {
  readonly eventoEn: number;
  readonly fase: FaseProgramada;
  readonly motivo: MotivoFalloProgramado;
}
/** `repetida`: el evento ya estaba consumido por una reserva anterior y su registro se conserva. */
export interface ResultadoFalloProgramado {
  readonly estado: 'registrado' | 'repetida';
}
export interface RegistroFallosProgramados {
  registrarFalloProgramado(fallo: FalloProgramado): Promise<ResultadoFalloProgramado>;
}
export function leerFaseProgramada(entrada: unknown): FaseProgramada {
  const fase = FASES_PROGRAMADAS.find((f) => f === entrada);
  exigirTrabajo(fase !== undefined);
  return fase;
}
export function leerMotivoFalloProgramado(entrada: unknown): MotivoFalloProgramado {
  const motivo = MOTIVOS_FALLO_PROGRAMADO.find((m) => m === entrada);
  exigirTrabajo(motivo !== undefined);
  return motivo;
}
export function leerFalloProgramado(entrada: unknown): FalloProgramado {
  const o = objetoTrabajo(entrada, 'eventoEn,fase,motivo');
  exigirTrabajo(esEnteroTrabajo(o.eventoEn) && o.eventoEn > 0);
  return Object.freeze({
    eventoEn: o.eventoEn,
    fase: leerFaseProgramada(o.fase),
    motivo: leerMotivoFalloProgramado(o.motivo),
  });
}
export function leerResultadoFalloProgramado(entrada: unknown): ResultadoFalloProgramado | undefined {
  const o = objetoTrabajo(entrada, 'estado');
  return o.estado === 'registrado' || o.estado === 'repetida' ? Object.freeze({ estado: o.estado }) : undefined;
}
/** El plazo agotado se distingue del resto; cualquier otra causa es un error sin detalle. */
export function motivoDeLaCausa(causa: unknown, senal?: AbortSignal): MotivoFalloProgramado {
  return causa instanceof PlazoAgotado || senal?.reason instanceof PlazoAgotado ? 'plazo-agotado' : 'error';
}
/**
 * Lo que el manejador relanza tras un fallo: la fase y si quedó registrado. El registro de Cloudflare solo recibe
 * estos dos datos, sin la causa original.
 */
export class FalloProgramadoAnotado extends Error {
  readonly fase: FaseProgramada;
  readonly registrado: boolean;
  constructor(fase: FaseProgramada, registrado: boolean, causa: unknown) {
    super('La actualización programada ha fallado', { cause: causa });
    this.fase = fase;
    this.registrado = registrado;
  }
}
/**
 * Registra el fallo y devuelve si quedó guardado. Un registro que falla no sustituye la causa original: el
 * manejador la relanza y deja el aviso en el registro de Cloudflare.
 */
export async function anotarFalloProgramado(
  registro: RegistroFallosProgramados | undefined,
  fallo: FalloProgramado,
): Promise<boolean> {
  if (!registro) {
    return false;
  }
  try {
    await dentroDelPlazo(() => registro.registrarFalloProgramado(fallo), PLAZO_REGISTRO_FALLO_MS);
    return true;
  } catch {
    return false;
  }
}
