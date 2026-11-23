/** Autoridad privada para activar el candidato exacto; ningún recibo ni JWT por sí solo concede un efecto. */

import { type CierreActivacion, leerCierre } from './cierre-activacion.ts';
import { type CursosActivacion, type FaseActivacion, leerFase } from './fases-activacion.ts';
import type { IdentidadEjecucionGitHub } from './oidc-github.ts';
import {
  type EvidenciaIntentoActivacionCompletado,
  leerRecuperacion,
  type RecuperacionActivacion,
} from './recuperacion-activacion.ts';
import {
  autoridadActivacion,
  leerAmpliaciones,
  leerSolicitudReintentoActivacion,
  type ReintentoActivacion,
  type ReintentoDescartado,
  type SolicitudReintentoActivacion,
} from './reintento-activacion.ts';
import {
  esEnteroTrabajo,
  esIdEjecucion,
  exigirTrabajo,
  leerEstadoTrabajosPrivado,
  leerReferenciaTrabajo,
  objetoTrabajo,
  type ReferenciaTrabajo,
  type TrabajoPrivado,
} from './trabajos.ts';
import {
  type AbandonoActivacion,
  type AnteriorActivacion,
  type DetenidaActivacion,
  leerAbandono,
  leerAnterior,
  leerCierres,
  leerDetenida,
  leerIdVersionActivacion,
  type MotivoAbandono,
  type MotivoDetenida,
} from './versiones-activacion.ts';

export {
  type CursosActivacion,
  dosServicios,
  FASES_ACTIVACION,
  FASES_CON_EFECTO,
  type FaseActivacion,
} from './fases-activacion.ts';
export {
  type AutoridadActivacion,
  type EvidenciaIntentoActivacionCompletado,
  evidenciaIntentoCoincide,
  leerEvidenciaIntentoActivacion,
  type RecuperacionActivacion,
} from './recuperacion-activacion.ts';
export {
  autoridadActivacion,
  leerSolicitudReintentoActivacion,
  mismoOrigen,
  type ReintentoActivacion,
  type SolicitudReintentoActivacion,
} from './reintento-activacion.ts';
export {
  type AbandonoActivacion,
  type AnteriorActivacion,
  leerIdVersionActivacion,
  MOTIVOS_ABANDONO,
  MOTIVOS_DETENIDA,
  type MotivoAbandono,
  type MotivoDetenida,
  sirveLoAnterior,
  type VersionDesplegada,
} from './versiones-activacion.ts';

export interface ReferenciaActivacion extends ReferenciaTrabajo {
  readonly runId: string;
}
export interface SolicitudActivacion extends ReferenciaActivacion {
  readonly revisionEsperada: number;
}
export interface EvidenciaActivacion {
  readonly sha256Indice: string;
  readonly sha256ManifiestoWeb: string;
  readonly generacion: { readonly revisionCodigo: string; readonly sha256Manifiesto: string };
  readonly artefacto: {
    readonly revisionCodigo: string;
    readonly huellaPaquete: string;
    readonly sha256Artefacto: string;
  };
  readonly anterior: AnteriorActivacion;
}
/** `servido_distinto`: un reintento encontró la web cambiada desde el abandono y no preparó nada. */
export type ErrorActivacion = 'candidato_no_verificable' | 'despliegue_no_admitido' | 'servido_distinto';
export type PasoActivacion =
  | { readonly tipo: 'preparar'; readonly evidencia: EvidenciaActivacion }
  | { readonly tipo: 'subiendo' | 'promoviendo' | 'subiendo-cursos' | 'promoviendo-cursos' }
  | { readonly tipo: 'subida'; readonly versionId: string }
  | { readonly tipo: 'cursos-subida'; readonly versionIdCursos: string }
  | { readonly tipo: 'cursos-confirmado'; readonly versionIdCursos: string; readonly deploymentIdCursos: string }
  | {
      readonly tipo: 'confirmada';
      readonly versionId: string;
      readonly deploymentId: string;
      readonly sha256ManifiestoWeb: string;
    }
  | { readonly tipo: 'rechazar'; readonly error: ErrorActivacion }
  | { readonly tipo: 'abandonar'; readonly motivo: MotivoAbandono; readonly observado: AnteriorActivacion }
  | { readonly tipo: 'anotar-rechazo'; readonly motivo: MotivoDetenida; readonly observado: AnteriorActivacion | null };
export interface RegistroPasoActivacion extends SolicitudActivacion {
  readonly paso: PasoActivacion;
}
export interface ActivacionPrivada extends Partial<CursosActivacion> {
  readonly recuperacion?: RecuperacionActivacion;
  readonly revisionBase: number;
  readonly trabajo: TrabajoPrivado;
  readonly fase: FaseActivacion;
  readonly creadoEn: number;
  readonly actualizadoEn: number;
  readonly evidencia: EvidenciaActivacion | null;
  readonly versionId: string | null;
  readonly deploymentId: string | null;
  readonly error: ErrorActivacion | null;
  /** Solo en `abandonada`: por qué se cerró sin publicar y qué servía cada Worker al cerrarla. */
  readonly abandono?: AbandonoActivacion;
  /** Solo en una fase con efecto en curso: el rechazo sin efecto que la detuvo; se borra al avanzar. */
  readonly detenida?: DetenidaActivacion;
  /** Solo en un reintento de una abandonada por `rechazo-previo`: la ejecución que la reintenta y manda en ella. */
  readonly reintento?: ReintentoActivacion;
  /** Revisión del almacén de trabajos al reservar; una activación guardada sin ella no se puede reintentar. */
  readonly revisionTrabajos?: number;
  /** Solo en una abandonada por `rechazo-previo`: la ejecución siguiente no pudo reintentarla, y por qué. */
  readonly reintentoDescartado?: ReintentoDescartado;
  /** Solo en una fase no terminal: el cierre pedido desde el panel; cualquier paso posterior lo borra. */
  readonly cierre?: CierreActivacion;
}
export interface EstadoActivacionPrivado {
  readonly version: 1;
  readonly revision: number;
  readonly ultimaActivacion: ActivacionPrivada | null;
}
export interface ResultadoTransicionActivacion {
  readonly estado: 'aplicado' | 'repetido' | 'conflicto' | 'ocupado';
  readonly activacion: EstadoActivacionPrivado;
}
/**
 * La frontera verifica la identidad federada (OIDC). El almacén vuelve a cotejar identidad, reloj, referencia y
 * revisión esperada (comparar y sustituir) dentro de la transacción.
 */
export interface AlmacenActivacion {
  prepararActivacion(): Promise<void>;
  leerActivacionPrivada(): Promise<EstadoActivacionPrivado>;
  /** Con `reintentoDe`, reintenta la abandonada que nombra; sin él, reserva el último trabajo validado. */
  reservarActivacion(
    solicitud: SolicitudActivacion | SolicitudReintentoActivacion,
    identidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionActivacion>;
  registrarPasoActivacion(
    registro: RegistroPasoActivacion,
    identidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionActivacion>;
}
export interface AlmacenRecuperacionActivacion extends AlmacenActivacion {
  recuperarActivacion(
    solicitud: SolicitudActivacion,
    identidad: IdentidadEjecucionGitHub,
    anterior: EvidenciaIntentoActivacionCompletado,
  ): Promise<ResultadoTransicionActivacion>;
  registrarPasoRecuperacionActivacion(
    registro: RegistroPasoActivacion,
    identidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionActivacion>;
}
export function admiteRecuperacionActivacion(almacen: AlmacenActivacion): almacen is AlmacenRecuperacionActivacion {
  return (
    'recuperarActivacion' in almacen &&
    typeof almacen.recuperarActivacion === 'function' &&
    'registrarPasoRecuperacionActivacion' in almacen &&
    typeof almacen.registrarPasoRecuperacionActivacion === 'function'
  );
}
const TAM_SHA = 40;
const TAM_HASH = 64;
const TAM_PAQUETE = 16;
function objeto(entrada: unknown, campos: string) {
  return objetoTrabajo(entrada, campos.split(',').sort().join(','));
}
function hash(valor: unknown, longitud: number): string {
  exigirTrabajo(typeof valor === 'string' && valor.length === longitud && /^[0-9a-f]+$/.test(valor));
  return valor;
}
function leerError(entrada: unknown): ErrorActivacion {
  exigirTrabajo(
    entrada === 'candidato_no_verificable' || entrada === 'despliegue_no_admitido' || entrada === 'servido_distinto',
  );
  return entrada;
}
export function leerReferenciaActivacion(entrada: unknown): ReferenciaActivacion {
  const o = objeto(entrada, 'solicitudId,revisionReserva,runId');
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(esIdEjecucion(o.runId));
  return Object.freeze({ ...referencia, runId: o.runId });
}
export function leerSolicitudActivacion(entrada: unknown): SolicitudActivacion {
  const o = objeto(entrada, 'solicitudId,revisionReserva,runId,revisionEsperada');
  const referencia = leerReferenciaActivacion({
    solicitudId: o.solicitudId,
    revisionReserva: o.revisionReserva,
    runId: o.runId,
  });
  exigirTrabajo(esEnteroTrabajo(o.revisionEsperada) && o.revisionEsperada < Number.MAX_SAFE_INTEGER);
  return Object.freeze({ ...referencia, revisionEsperada: o.revisionEsperada });
}
/** Una reserva o, con `reintentoDe`, el reintento de una abandonada; cada forma con sus campos exactos. */
export function leerSolicitudReservaActivacion(entrada: unknown): SolicitudActivacion | SolicitudReintentoActivacion {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  return Object.hasOwn(entrada, 'reintentoDe')
    ? leerSolicitudReintentoActivacion(entrada)
    : leerSolicitudActivacion(entrada);
}
export function leerEvidenciaActivacion(entrada: unknown): EvidenciaActivacion {
  const o = objeto(entrada, 'sha256Indice,sha256ManifiestoWeb,generacion,artefacto,anterior');
  const g = objeto(o.generacion, 'revisionCodigo,sha256Manifiesto');
  const a = objeto(o.artefacto, 'revisionCodigo,huellaPaquete,sha256Artefacto');
  const revisionCodigo = hash(g.revisionCodigo, TAM_SHA);
  exigirTrabajo(a.revisionCodigo === revisionCodigo);
  return Object.freeze({
    sha256Indice: hash(o.sha256Indice, TAM_HASH),
    sha256ManifiestoWeb: hash(o.sha256ManifiestoWeb, TAM_HASH),
    generacion: Object.freeze({ revisionCodigo, sha256Manifiesto: hash(g.sha256Manifiesto, TAM_HASH) }),
    artefacto: Object.freeze({
      revisionCodigo,
      huellaPaquete: hash(a.huellaPaquete, TAM_PAQUETE),
      sha256Artefacto: hash(a.sha256Artefacto, TAM_HASH),
    }),
    anterior: leerAnterior(o.anterior),
  });
}
export function leerPasoActivacion(entrada: unknown): PasoActivacion {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const tipo = Object.getOwnPropertyDescriptor(entrada, 'tipo')?.value;
  if (tipo === 'preparar') {
    const o = objeto(entrada, 'tipo,evidencia');
    return Object.freeze({ tipo, evidencia: leerEvidenciaActivacion(o.evidencia) });
  }
  if (tipo === 'subida') {
    const o = objeto(entrada, 'tipo,versionId');
    return Object.freeze({ tipo, versionId: leerIdVersionActivacion(o.versionId) });
  }
  if (tipo === 'confirmada') {
    const o = objeto(entrada, 'tipo,versionId,deploymentId,sha256ManifiestoWeb');
    return Object.freeze({
      tipo,
      versionId: leerIdVersionActivacion(o.versionId),
      deploymentId: leerIdVersionActivacion(o.deploymentId),
      sha256ManifiestoWeb: hash(o.sha256ManifiestoWeb, TAM_HASH),
    });
  }
  if (tipo === 'rechazar') {
    const o = objeto(entrada, 'tipo,error');
    return Object.freeze({ tipo, error: leerError(o.error) });
  }
  if (tipo === 'anotar-rechazo') {
    const o = objeto(entrada, 'tipo,motivo,observado');
    return Object.freeze({ tipo, ...leerDetenida({ motivo: o.motivo, observado: o.observado }) });
  }
  if (tipo === 'abandonar') {
    const o = objeto(entrada, 'tipo,motivo,observado');
    return Object.freeze({ tipo, ...leerAbandono({ motivo: o.motivo, observado: o.observado }) });
  }
  if (tipo === 'cursos-subida') {
    const o = objeto(entrada, 'tipo,versionIdCursos');
    return Object.freeze({ tipo, versionIdCursos: leerIdVersionActivacion(o.versionIdCursos) });
  }
  if (tipo === 'cursos-confirmado') {
    const o = objeto(entrada, 'tipo,versionIdCursos,deploymentIdCursos');
    return Object.freeze({
      tipo,
      versionIdCursos: leerIdVersionActivacion(o.versionIdCursos),
      deploymentIdCursos: leerIdVersionActivacion(o.deploymentIdCursos),
    });
  }
  objeto(entrada, 'tipo');
  exigirTrabajo(
    tipo === 'subiendo' || tipo === 'promoviendo' || tipo === 'subiendo-cursos' || tipo === 'promoviendo-cursos',
  );
  return Object.freeze({ tipo });
}
export function leerRegistroPasoActivacion(entrada: unknown): RegistroPasoActivacion {
  const o = objeto(entrada, 'solicitudId,revisionReserva,runId,revisionEsperada,paso');
  const solicitud = leerSolicitudActivacion({
    solicitudId: o.solicitudId,
    revisionReserva: o.revisionReserva,
    runId: o.runId,
    revisionEsperada: o.revisionEsperada,
  });
  return Object.freeze({ ...solicitud, paso: leerPasoActivacion(o.paso) });
}
/** Solo admite instantáneas modernas terminadas y validadas; un documento legado nunca gana autoridad de activación. */
export function leerTrabajoActivable(entrada: unknown): TrabajoPrivado {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const revision = Object.getOwnPropertyDescriptor(entrada, 'revisionReserva')?.value;
  const trabajo = leerEstadoTrabajosPrivado({ version: 2, revision, ultimoTrabajo: entrada }).ultimoTrabajo;
  exigirTrabajo(
    trabajo !== null &&
      trabajo.estado === 'terminado' &&
      trabajo.resultado?.resultado === 'validado' &&
      trabajo.runId !== null &&
      trabajo.huellaRecibo !== null &&
      trabajo.protocoloInicio === 'obligatorio' &&
      trabajo.inicioConfirmado,
  );
  return trabajo;
}
function camposDeLaActivacion(entrada: unknown): string {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const recuperacion = Object.hasOwn(entrada, 'recuperacion') ? ',recuperacion' : '';
  const cursos = Object.hasOwn(entrada, 'versionIdCursos') ? ',versionIdCursos,deploymentIdCursos' : '';
  const abandono = Object.hasOwn(entrada, 'abandono') ? ',abandono' : '';
  const detenida = Object.hasOwn(entrada, 'detenida') ? ',detenida' : '';
  const nuevos = ['reintento', 'revisionTrabajos', 'reintentoDescartado', 'cierre']
    .filter((c) => Object.hasOwn(entrada, c))
    .map((c) => `,${c}`);
  return `revisionBase,trabajo,fase,creadoEn,actualizadoEn,evidencia,versionId,deploymentId,error${recuperacion}${cursos}${abandono}${detenida}${nuevos.join('')}`;
}
/** El cierre pedido solo existe mientras la intención no ha terminado. */
function leerCierreDe(o: Record<string, unknown>, fase: FaseActivacion, revision: number) {
  if (!Object.hasOwn(o, 'cierre')) {
    return {};
  }
  exigirTrabajo(!['confirmada', 'rechazada', 'abandonada'].includes(fase));
  return { cierre: leerCierre(o.cierre, revision) };
}
function leerCursos(o: Record<string, unknown>): Partial<CursosActivacion> {
  if (!Object.hasOwn(o, 'versionIdCursos')) {
    return {};
  }
  return {
    versionIdCursos: o.versionIdCursos === null ? null : leerIdVersionActivacion(o.versionIdCursos),
    deploymentIdCursos: o.deploymentIdCursos === null ? null : leerIdVersionActivacion(o.deploymentIdCursos),
  };
}
function leerActivacion(entrada: unknown, revision: number): ActivacionPrivada {
  const o = objeto(entrada, camposDeLaActivacion(entrada));
  const conRecuperacion = Object.hasOwn(o, 'recuperacion');
  exigirTrabajo(esEnteroTrabajo(o.revisionBase) && o.revisionBase < revision);
  exigirTrabajo(esEnteroTrabajo(o.creadoEn) && esEnteroTrabajo(o.actualizadoEn) && o.actualizadoEn >= o.creadoEn);
  const trabajo = leerTrabajoActivable(o.trabajo);
  exigirTrabajo(o.creadoEn >= trabajo.actualizadoEn);
  const evidencia = o.evidencia === null ? null : leerEvidenciaActivacion(o.evidencia);
  if (evidencia) {
    exigirTrabajo(
      evidencia.artefacto.revisionCodigo === trabajo.confianza.sha &&
        evidencia.artefacto.huellaPaquete === trabajo.resultado?.huellaPaquete,
    );
  }
  const versionId = o.versionId === null ? null : leerIdVersionActivacion(o.versionId);
  const deploymentId = o.deploymentId === null ? null : leerIdVersionActivacion(o.deploymentId);
  const error = o.error === null ? null : leerError(o.error);
  const cursos = leerCursos(o);
  const fase = leerFase(o.fase, { evidencia, versionId, deploymentId, error, ...cursos });
  const { abandono, detenida } = leerCierres(o, fase);
  const ampliaciones = leerAmpliaciones(o, trabajo, o.creadoEn);
  const autoridad = autoridadActivacion({ trabajo, ...ampliaciones });
  const recuperacion = conRecuperacion
    ? leerRecuperacion(o.recuperacion, autoridad, { base: o.revisionBase, actual: revision })
    : undefined;
  return Object.freeze({
    ...(recuperacion ? { recuperacion } : {}),
    revisionBase: o.revisionBase,
    trabajo,
    fase,
    creadoEn: o.creadoEn,
    actualizadoEn: o.actualizadoEn,
    evidencia,
    versionId,
    deploymentId,
    error,
    ...cursos,
    ...(abandono ? { abandono } : {}),
    ...(detenida ? { detenida } : {}),
    ...ampliaciones,
    ...leerCierreDe(o, fase, revision),
  });
}
export function leerEstadoActivacionPrivado(entrada: unknown): EstadoActivacionPrivado {
  const o = objeto(entrada, 'version,revision,ultimaActivacion');
  exigirTrabajo(o.version === 1 && esEnteroTrabajo(o.revision));
  exigirTrabajo(o.ultimaActivacion !== null || o.revision === 0);
  return Object.freeze({
    version: 1,
    revision: o.revision,
    ultimaActivacion: o.ultimaActivacion === null ? null : leerActivacion(o.ultimaActivacion, o.revision),
  });
}
export function leerResultadoTransicionActivacion(entrada: unknown): ResultadoTransicionActivacion {
  const o = objeto(entrada, 'estado,activacion');
  exigirTrabajo(
    o.estado === 'aplicado' || o.estado === 'repetido' || o.estado === 'conflicto' || o.estado === 'ocupado',
  );
  const activacion = leerEstadoActivacionPrivado(o.activacion);
  exigirTrabajo(o.estado === 'conflicto' || activacion.ultimaActivacion !== null);
  return Object.freeze({ estado: o.estado, activacion });
}
