/**
 * Reintento de una intención abandonada por `rechazo-previo`. Lo pide la ejecución siguiente del mantenimiento, del
 * mismo repositorio, workflow y rama protegida, cuando termina sin pendientes. La intención nueva tiene su reserva y
 * su revisión propias: guarda como trabajo el de la abandonada, que es el que publica con su artefacto conservado, y
 * aparte la ejecución que la reintenta, que es la única autoridad sobre sus pasos.
 */
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';
import type { AutoridadActivacion } from './recuperacion-activacion.ts';
import {
  esEnteroTrabajo,
  esIdEjecucion,
  exigirTrabajo,
  leerReferenciaTrabajo,
  objetoTrabajo,
  type ReferenciaTrabajo,
  type TrabajoPrivado,
} from './trabajos.ts';
import { type AnteriorActivacion, formaObservada, leerAnterior } from './versiones-activacion.ts';

export interface ReintentoActivacion extends ReferenciaTrabajo {
  readonly runId: string;
  readonly confianza: ConfianzaOidcGitHub;
  /** Cuándo se abandonó la intención que se reintenta: desde entonces sus datos validados están sin publicar. */
  readonly abandonadaEn: number;
  /**
   * Lo que servía cada Worker al abandonarla. El reintento solo prepara si la web sigue sirviendo eso mismo: así no
   * deshace nada que se haya publicado entre medias.
   */
  readonly observado: AnteriorActivacion;
}
/** Por qué la ejecución siguiente no pudo reintentar una abandonada por `rechazo-previo`. */
export type ReintentoDescartado = 'sin-artefacto';
/** El trabajo abandonado que la ejecución dice reintentar; el servidor lo coteja con el de la abandonada. */
export interface ReintentoDe extends ReferenciaTrabajo {
  readonly runId: string;
  readonly huellaRecibo: string;
}
export interface SolicitudReintentoActivacion extends ReferenciaTrabajo {
  readonly runId: string;
  readonly revisionEsperada: number;
  readonly reintentoDe: ReintentoDe;
  /** Si está, no se reintenta: se anota en la abandonada por qué no se pudo, para que el panel no lo prometa. */
  readonly descartado?: ReintentoDescartado;
}
function referencia(o: Record<string, unknown>): ReferenciaTrabajo & { readonly runId: string } {
  const r = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(esIdEjecucion(o.runId));
  return { ...r, runId: o.runId };
}
/** Mismo repositorio, propietario, workflow y rama; el commit puede haber avanzado en la rama protegida. */
export function mismoOrigen(a: ConfianzaOidcGitHub, b: ConfianzaOidcGitHub): boolean {
  return (
    a.audiencia === b.audiencia &&
    a.repositorioId === b.repositorioId &&
    a.propietarioId === b.propietarioId &&
    a.ref === b.ref &&
    a.workflowRef === b.workflowRef
  );
}
export function leerReintento(entrada: unknown, trabajo: TrabajoPrivado, creadoEn: number): ReintentoActivacion {
  const o = objetoTrabajo(entrada, 'abandonadaEn,confianza,observado,revisionReserva,runId,solicitudId');
  const r = referencia(o);
  const confianza = leerConfianzaOidcGitHub(o.confianza);
  exigirTrabajo(mismoOrigen(confianza, trabajo.confianza) && r.revisionReserva > trabajo.revisionReserva);
  exigirTrabajo(
    esEnteroTrabajo(o.abandonadaEn) && o.abandonadaEn >= trabajo.actualizadoEn && o.abandonadaEn <= creadoEn,
  );
  return Object.freeze({ ...r, confianza, abandonadaEn: o.abandonadaEn, observado: leerAnterior(o.observado) });
}
export function leerSolicitudReintentoActivacion(entrada: unknown): SolicitudReintentoActivacion {
  const descartado = entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, 'descartado');
  const o = objetoTrabajo(
    entrada,
    `${descartado ? 'descartado,' : ''}reintentoDe,revisionEsperada,revisionReserva,runId,solicitudId`,
  );
  exigirTrabajo(!descartado || o.descartado === 'sin-artefacto');
  const d = objetoTrabajo(o.reintentoDe, 'huellaRecibo,revisionReserva,runId,solicitudId');
  exigirTrabajo(esEnteroTrabajo(o.revisionEsperada) && o.revisionEsperada < Number.MAX_SAFE_INTEGER);
  exigirTrabajo(typeof d.huellaRecibo === 'string' && /^[0-9a-f]{64}$/.test(d.huellaRecibo));
  return Object.freeze({
    ...referencia(o),
    revisionEsperada: o.revisionEsperada,
    reintentoDe: Object.freeze({ ...referencia(d), huellaRecibo: d.huellaRecibo }),
    ...(descartado ? { descartado: 'sin-artefacto' as const } : {}),
  });
}
/** La ejecución que manda en la activación: la que reintenta, si es un reintento; si no, la de su trabajo. */
export function autoridadActivacion(a: {
  readonly trabajo: TrabajoPrivado;
  readonly reintento?: ReintentoActivacion;
}): AutoridadActivacion {
  return a.reintento ?? a.trabajo;
}
/** Los campos del reintento en una activación guardada; una guardada sin ellos se sigue leyendo. */
export function leerAmpliaciones(
  o: Record<string, unknown>,
  trabajo: TrabajoPrivado,
  creadoEn: number,
): { reintento?: ReintentoActivacion; revisionTrabajos?: number; reintentoDescartado?: ReintentoDescartado } {
  const reintento = Object.hasOwn(o, 'reintento') ? leerReintento(o.reintento, trabajo, creadoEn) : undefined;
  exigirTrabajo(!reintento || formaObservada(reintento.observado, Object.hasOwn(o, 'versionIdCursos')));
  const descartado = Object.hasOwn(o, 'reintentoDescartado') ? leerDescartado(o) : undefined;
  const revisionTrabajos = Object.hasOwn(o, 'revisionTrabajos')
    ? leerRevisionTrabajos(o.revisionTrabajos, reintento ?? trabajo)
    : undefined;
  return {
    ...(reintento ? { reintento } : {}),
    ...(revisionTrabajos === undefined ? {} : { revisionTrabajos }),
    ...(descartado ? { reintentoDescartado: descartado } : {}),
  };
}
/** Solo en una abandonada por `rechazo-previo` que no es un reintento: la oportunidad de reintentarla ya pasó. */
function leerDescartado(o: Record<string, unknown>): ReintentoDescartado {
  exigirTrabajo(o.reintentoDescartado === 'sin-artefacto' && o.fase === 'abandonada' && !Object.hasOwn(o, 'reintento'));
  const abandono = o.abandono;
  exigirTrabajo(
    abandono !== null &&
      typeof abandono === 'object' &&
      Object.getOwnPropertyDescriptor(abandono, 'motivo')?.value === 'rechazo-previo',
  );
  return 'sin-artefacto';
}
/** Revisión del almacén de trabajos al reservar: con ella se sabe si después hubo otro trabajo. */
export function leerRevisionTrabajos(entrada: unknown, trabajo: Pick<ReferenciaTrabajo, 'revisionReserva'>): number {
  exigirTrabajo(esEnteroTrabajo(entrada) && entrada >= trabajo.revisionReserva);
  return entrada;
}
