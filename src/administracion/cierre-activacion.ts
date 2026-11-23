/**
 * Cierre de una publicación pedido desde el panel. Quien administra lo pide con una operación autenticada; el servidor
 * lo anota ligado a la revisión exacta de la activación y al trabajo que despacha para cumplirlo, y solo esa
 * ejecución puede cumplirlo, una vez y antes de que caduque. Solo concede cerrar sin publicar, y solo si la web sirve
 * otra vez lo anterior.
 */
import type { ResultadoTransicionActivacion } from './activacion.ts';
import type { IdentidadEjecucionGitHub } from './oidc-github.ts';
import { MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR } from './programacion-trabajos.ts';
import type { EvidenciaIntentoActivacionCompletado } from './recuperacion-activacion.ts';
import {
  esEnteroTrabajo,
  exigirTrabajo,
  leerReferenciaTrabajo,
  objetoTrabajo,
  type ReferenciaTrabajo,
} from './trabajos.ts';
import { type AnteriorActivacion, leerAnterior } from './versiones-activacion.ts';

/**
 * Caduca al terminar el plazo del workflow que lo cumple: es el tiempo justo para que esa ejecución llegue a su paso de
 * activación. Nadie más puede usarlo, y pasado ese plazo su trabajo ya se da por vencido.
 */
const MS_POR_MINUTO = 60_000;
export const PLAZO_CIERRE_MS = MINUTOS_LIMITE_WORKFLOW_ACTUALIZAR * MS_POR_MINUTO;
export interface CierreActivacion {
  /** El trabajo despachado para cumplirlo: su ejecución es la única que puede pedir el cierre. */
  readonly trabajo: ReferenciaTrabajo;
  /** Revisión de la activación al anotarlo: si la activación avanza, deja de valer. */
  readonly revisionActivacion: number;
  readonly caducaEn: number;
  /** `web-cambiada`: la ejecución lo intentó, la web ya no servía lo anterior y no se cerró; queda lo observado. */
  readonly estado: 'solicitado' | 'web-cambiada';
  readonly observado: AnteriorActivacion | null;
}
export interface SolicitudCierreActivacion {
  readonly revisionEsperada: number;
  readonly trabajo: ReferenciaTrabajo;
  readonly caducaEn: number;
}
/** Lo que manda la ejecución que lo cumple: la referencia de su trabajo, la revisión y lo que sirve la web. */
export interface RegistroCierreActivacion extends ReferenciaTrabajo {
  readonly runId: string;
  readonly revisionEsperada: number;
  readonly observado: AnteriorActivacion;
}
function entero(valor: unknown): number {
  exigirTrabajo(esEnteroTrabajo(valor) && valor < Number.MAX_SAFE_INTEGER);
  return valor;
}
export function leerCierre(entrada: unknown, revision: number): CierreActivacion {
  const o = objetoTrabajo(entrada, 'caducaEn,estado,observado,revisionActivacion,trabajo');
  exigirTrabajo(o.estado === 'solicitado' || o.estado === 'web-cambiada');
  exigirTrabajo((o.observado === null) === (o.estado === 'solicitado'));
  const revisionActivacion = entero(o.revisionActivacion);
  exigirTrabajo(revisionActivacion <= revision);
  return Object.freeze({
    trabajo: leerReferenciaTrabajo(o.trabajo),
    revisionActivacion,
    caducaEn: entero(o.caducaEn),
    estado: o.estado,
    observado: o.observado === null ? null : leerAnterior(o.observado),
  });
}
export function leerSolicitudCierreActivacion(entrada: unknown): SolicitudCierreActivacion {
  const o = objetoTrabajo(entrada, 'caducaEn,revisionEsperada,trabajo');
  return Object.freeze({
    revisionEsperada: entero(o.revisionEsperada),
    trabajo: leerReferenciaTrabajo(o.trabajo),
    caducaEn: entero(o.caducaEn),
  });
}
export function leerRegistroCierreActivacion(entrada: unknown): RegistroCierreActivacion {
  const o = objetoTrabajo(entrada, 'observado,revisionEsperada,revisionReserva,runId,solicitudId');
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(typeof o.runId === 'string' && /^[1-9]\d{0,19}$/.test(o.runId));
  return Object.freeze({
    ...referencia,
    runId: o.runId,
    revisionEsperada: entero(o.revisionEsperada),
    observado: leerAnterior(o.observado),
  });
}
/** Capacidad aparte del almacén de activación: anotar el cierre pedido y cumplirlo. */
export interface AlmacenCierreActivacion {
  solicitarCierreActivacion(solicitud: SolicitudCierreActivacion): Promise<ResultadoTransicionActivacion>;
  cerrarActivacionSolicitada(
    registro: RegistroCierreActivacion,
    identidad: IdentidadEjecucionGitHub,
    fin: EvidenciaIntentoActivacionCompletado,
  ): Promise<ResultadoTransicionActivacion>;
}
export function admiteCierreActivacion(almacen: object): almacen is AlmacenCierreActivacion {
  return (
    'solicitarCierreActivacion' in almacen &&
    typeof almacen.solicitarCierreActivacion === 'function' &&
    'cerrarActivacionSolicitada' in almacen &&
    typeof almacen.cerrarActivacionSolicitada === 'function'
  );
}
