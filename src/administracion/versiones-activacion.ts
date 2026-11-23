/**
 * Lo que sirve cada Worker de una activación: el despliegue anterior que guarda la evidencia y, al abandonar, lo que
 * el orquestador observa servido en ese momento. Un abandono solo se admite si cada Worker vuelve a servir su versión
 * anterior: así nunca se cierra una intención con una versión suya todavía en servicio.
 */
import { FASES_CON_EFECTO, type FaseActivacion } from './fases-activacion.ts';
import { exigirTrabajo, objetoTrabajo } from './trabajos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface VersionDesplegada {
  readonly versionId: string;
  readonly deploymentId: string;
}
/**
 * Una activación de dos servicios guarda lo que servían el principal y el Worker de Cursos; la de un servicio, que
 * publica solo el principal, guarda solo lo del principal.
 */
export type AnteriorActivacion =
  | VersionDesplegada
  | { readonly principal: VersionDesplegada; readonly cursos: VersionDesplegada };
/**
 * Por qué se cerró sin publicar: a mano (tras volver atrás o para cerrar una fase que no se va a terminar), o sola
 * ante un rechazo que demuestra que el efecto no se hizo (del adaptador antes de llamar al proveedor, o del proveedor
 * de forma explícita).
 */
export const MOTIVOS_ABANDONO = ['a-mano', 'rechazo-previo', 'rechazo-proveedor'] as const;
export type MotivoAbandono = (typeof MOTIVOS_ABANDONO)[number];
export interface AbandonoActivacion {
  readonly motivo: MotivoAbandono;
  readonly observado: AnteriorActivacion;
}
function objeto(entrada: unknown, campos: string) {
  return objetoTrabajo(entrada, campos.split(',').sort().join(','));
}
export function leerIdVersionActivacion(entrada: unknown): string {
  exigirTrabajo(typeof entrada === 'string' && UUID.test(entrada));
  return entrada;
}
function leerVersionDesplegada(entrada: unknown): VersionDesplegada {
  const o = objeto(entrada, 'versionId,deploymentId');
  return Object.freeze({
    versionId: leerIdVersionActivacion(o.versionId),
    deploymentId: leerIdVersionActivacion(o.deploymentId),
  });
}
export function leerAnterior(entrada: unknown): AnteriorActivacion {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  if (!Object.hasOwn(entrada, 'principal')) {
    return leerVersionDesplegada(entrada);
  }
  const o = objeto(entrada, 'principal,cursos');
  return Object.freeze({ principal: leerVersionDesplegada(o.principal), cursos: leerVersionDesplegada(o.cursos) });
}
/**
 * Por qué una intención está detenida en una fase con efecto en curso: el adaptador o Cloudflare rechazaron la
 * subida o el despliegue sin hacerlo, y no se pudo abandonar porque algún Worker ya sirve la versión nueva.
 */
export const MOTIVOS_DETENIDA = ['rechazo-previo', 'rechazo-proveedor'] as const;
export type MotivoDetenida = (typeof MOTIVOS_DETENIDA)[number];
/**
 * Con el motivo, lo que servía cada Worker al detenerse: el panel elige su texto por lo observado. Es null si no se
 * pudo comprobar (un despliegue repartido entre dos versiones o la pareja de configuraciones rota).
 */
export interface DetenidaActivacion {
  readonly motivo: MotivoDetenida;
  readonly observado: AnteriorActivacion | null;
}
export function leerDetenida(entrada: unknown): DetenidaActivacion {
  const o = objeto(entrada, 'motivo,observado');
  const motivo = MOTIVOS_DETENIDA.find((m) => m === o.motivo);
  exigirTrabajo(motivo !== undefined);
  return Object.freeze({ motivo, observado: o.observado === null ? null : leerAnterior(o.observado) });
}
/** Lo observado tiene la forma de la activación; sin observación no hay forma que comprobar. */
export function formaObservada(observado: AnteriorActivacion | null, dosServicios: boolean): boolean {
  return observado === null || 'principal' in observado === dosServicios;
}
export function leerAbandono(entrada: unknown): AbandonoActivacion {
  const o = objeto(entrada, 'motivo,observado');
  const motivo = MOTIVOS_ABANDONO.find((m) => m === o.motivo);
  exigirTrabajo(motivo !== undefined);
  return Object.freeze({ motivo, observado: leerAnterior(o.observado) });
}
/** Cada Worker sirve la versión que servía antes de la intención; el despliegue puede ser otro tras volver atrás. */
export function sirveLoAnterior(anterior: AnteriorActivacion, observado: AnteriorActivacion): boolean {
  if ('principal' in anterior) {
    return (
      'principal' in observado &&
      observado.principal.versionId === anterior.principal.versionId &&
      observado.cursos.versionId === anterior.cursos.versionId
    );
  }
  return !('principal' in observado) && observado.versionId === anterior.versionId;
}
/**
 * El abandono solo en una abandonada, con lo observado en la forma de la activación; la detenida solo en una fase con
 * efecto en curso.
 */
export function leerCierres(
  o: Record<string, unknown>,
  fase: FaseActivacion,
): { abandono?: AbandonoActivacion; detenida?: DetenidaActivacion } {
  exigirTrabajo(Object.hasOwn(o, 'abandono') === (fase === 'abandonada'));
  const abandono = fase === 'abandonada' ? leerAbandono(o.abandono) : undefined;
  exigirTrabajo(!abandono || 'principal' in abandono.observado === Object.hasOwn(o, 'versionIdCursos'));
  const detenida = Object.hasOwn(o, 'detenida') ? leerDetenida(o.detenida) : undefined;
  exigirTrabajo(detenida === undefined || FASES_CON_EFECTO.includes(fase));
  exigirTrabajo(!detenida || formaObservada(detenida.observado, Object.hasOwn(o, 'versionIdCursos')));
  return { ...(abandono ? { abandono } : {}), ...(detenida ? { detenida } : {}) };
}
