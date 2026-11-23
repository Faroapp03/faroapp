/** Un trabajo global de construcción; ni su resultado ni su huella activan una generación. */
import type { CatalogoPrivado } from './catalogo-privado.js';
import type { CierreSinRecibo } from './cierre-sin-recibo.ts';
import type { ObservacionDatosTrabajo } from './datos-trabajo.ts';
import type { AccionActualizacion, ResultadoDespacho } from './ejecutor-github.ts';
import type { EstadoDatosPanel } from './estado-datos.js';
import {
  type AccionManual,
  accion,
  accionManual,
  camposDelTrabajo,
  esEnteroTrabajo,
  esIdEjecucion,
  esIdSolicitudTrabajo,
  esOrigenTrabajo,
  exigirTrabajo,
  leerEstadoTrabajos,
  leerReferenciaTrabajo,
  leerResultado,
  leerTrabajoBase,
  type OrigenTrabajo,
  objetoTrabajo,
  type UltimoFallo,
} from './estado-trabajos.js';

import { type ConfianzaOidcGitHub, type IdentidadEjecucionGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';

export {
  esEnteroTrabajo,
  esIdEjecucion,
  exigirTrabajo,
  instanteRecibo,
  leerEstadoTrabajos,
  leerReferenciaTrabajo,
  MARGEN_RELOJ_GITHUB_MS,
  objetoTrabajo,
  tiempoReciboAdmitido,
} from './estado-trabajos.js';

export interface SolicitudTrabajo {
  readonly solicitudId: string;
  readonly accion: AccionManual;
  readonly revisionEsperada: number;
}
export interface ReferenciaTrabajo {
  readonly solicitudId: string;
  readonly revisionReserva: number;
}
export interface InicioTrabajo extends ReferenciaTrabajo {
  readonly accion: AccionActualizacion;
}
export interface RetiradaTrabajo extends ReferenciaTrabajo {
  readonly revisionEsperada: number;
}
const CONCLUSIONES = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
  'stale',
] as const;
export type ConclusionEjecucionGitHub = (typeof CONCLUSIONES)[number];
/** Evidencia del GET autenticado validada por el adaptador privado; no procede de una petición del panel. */
export interface EvidenciaEjecucionCompletada {
  readonly estado: 'completed';
  readonly runId: string;
  readonly runAttempt: '1';
  readonly repositorioId: string;
  readonly propietarioId: string;
  readonly sha: string;
  readonly workflowPath: string;
  readonly evento: 'workflow_dispatch';
  readonly conclusion: ConclusionEjecucionGitHub;
}
export interface ReciboTrabajo extends ReferenciaTrabajo {
  readonly accion: AccionActualizacion;
  readonly resultado: 'validado' | 'sin-pendientes' | 'rechazado';
  readonly veredicto: 'verde' | 'ámbar' | 'rojo' | null;
  readonly terminadoEn: string;
  readonly huellaPaquete: string | null;
  readonly error: 'actualizacion_no_completada' | 'actualizacion_no_admitida' | 'candidato_no_verificable' | null;
}
export interface ResultadoTrabajo {
  readonly resultado: ReciboTrabajo['resultado'] | 'despacho-rechazado' | 'retirado' | 'ejecucion-sin-recibo';
  readonly veredicto: ReciboTrabajo['veredicto'];
  readonly terminadoEn: string;
  readonly huellaPaquete: string | null;
  readonly error: ReciboTrabajo['error'];
  readonly ultimoFallo?: UltimoFallo;
}
export interface TrabajoActualizacion extends ReferenciaTrabajo {
  readonly accion: AccionActualizacion;
  readonly revisionBase: number;
  readonly creadoEn: number;
  readonly actualizadoEn: number;
  readonly estado: 'despacho-incierto' | 'despachado' | 'terminado';
  readonly runId: string | null;
  readonly runAttempt: '1';
  readonly resultado: ResultadoTrabajo | null;
}
/** Lo que ve el panel. Nunca lleva quién lanzó un trabajo a demanda: eso solo vive en el registro de solicitudes. */
export interface TrabajoPublico extends TrabajoActualizacion {
  readonly origen?: OrigenTrabajo;
  readonly iniciado?: boolean;
}
export interface EstadoTrabajos {
  readonly version: 1;
  readonly revision: number;
  readonly ultimoTrabajo: TrabajoPublico | null;
}
/**
 * Primer permiso de inicio negado a un run de este repositorio firmado para otra revisión. Solo guarda cuándo y el
 * motivo: la revisión recibida está en el propio run de GitHub y la autorizada, en la confianza de la reserva.
 */
export interface InicioRechazado {
  readonly en: number;
  readonly motivo: 'revision_no_autorizada';
}
/** Solo composición/receptor privados. Nunca se entrega esta forma al navegador. */
export interface TrabajoPrivado extends TrabajoActualizacion {
  readonly confianza: ConfianzaOidcGitHub;
  readonly huellaRecibo: string | null;
  readonly protocoloInicio: 'legado' | 'obligatorio';
  readonly inicioConfirmado: boolean;
  /** Ausente mientras no haya un rechazo con evidencia; así el documento de las reservas sin él no cambia. */
  readonly inicioRechazado?: InicioRechazado;
  /** Ausente en los trabajos reservados antes de anotar quién los pidió; toda reserva nueva lo lleva. */
  readonly origen?: OrigenTrabajo;
}
export interface EstadoTrabajosPrivado {
  readonly version: 2;
  readonly revision: number;
  readonly ultimoTrabajo: TrabajoPrivado | null;
}
export type ResultadoLecturaTrabajo =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly trabajos: EstadoTrabajos }
  | SesionPanelInactiva;
export type ResultadoReservaTrabajo =
  | {
      readonly estado: 'nueva' | 'repetida' | 'conflicto' | 'ocupado';
      readonly sesion: SesionPanelActiva;
      readonly trabajos: EstadoTrabajos;
    }
  | SesionPanelInactiva;
export interface ResultadoTransicionTrabajo {
  readonly estado: 'aplicado' | 'repetido' | 'conflicto';
  readonly trabajos: EstadoTrabajos;
}
export type ResultadoRetiradaTrabajo =
  | { readonly estado: 'retirado' | 'conflicto'; readonly sesion: SesionPanelActiva; readonly trabajos: EstadoTrabajos }
  | SesionPanelInactiva;
/** Capacidad separada: los almacenes/dobles de sesión anteriores no están obligados a implementarla. */
export interface AlmacenTrabajosActualizacion {
  prepararTrabajos(): Promise<void>;
  leerTrabajoDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaTrabajo>;
  reservarTrabajoDeSesion(
    acceso: AccesoSesionPanel,
    solicitud: SolicitudTrabajo,
    confianza: ConfianzaOidcGitHub,
  ): Promise<ResultadoReservaTrabajo>;
  leerTrabajoPrivado(): Promise<EstadoTrabajosPrivado>;
  leerDatosDelUltimoTrabajo(): Promise<ObservacionDatosTrabajo | null>;
  anotarDespacho(referencia: ReferenciaTrabajo, resultado: ResultadoDespacho): Promise<ResultadoTransicionTrabajo>;
  /**
   * La frontera verifica OIDC antes de entregar la identidad. undefined conserva llamadas internas antiguas
   * sin observación; nunca acredita datos actualizados. HTTP entrega siempre el estado validado, incluso null.
   */
  registrarRecibo(
    recibo: ReciboTrabajo,
    huellaRecibo: string,
    identidad: IdentidadEjecucionGitHub,
    estado?: EstadoDatosPanel | null,
    catalogo?: CatalogoPrivado | null,
  ): Promise<ResultadoTransicionTrabajo>;
  confirmarInicio(inicio: InicioTrabajo, identidad: IdentidadEjecucionGitHub): Promise<ResultadoTransicionTrabajo>;
  /**
   * Solo tras una verificación OIDC `revision_no_autorizada`. Anota el primer rechazo de la reserva y nada más; el
   * receptor responde igual que a cualquier otro permiso negado.
   */
  anotarInicioRechazado(
    inicio: InicioTrabajo,
    identidad: IdentidadEjecucionGitHub,
  ): Promise<ResultadoTransicionTrabajo>;
  retirarTrabajoDeSesion(acceso: AccesoSesionPanel, retirada: RetiradaTrabajo): Promise<ResultadoRetiradaTrabajo>;
  finalizarEjecucionSinRecibo(
    referencia: ReferenciaTrabajo,
    evidencia: EvidenciaEjecucionCompletada,
  ): Promise<ResultadoTransicionTrabajo>;
  /** El supervisor dice por qué no terminó su ejecución; la frontera ya verificó su OIDC, como con el recibo. */
  cerrarSinRecibo(cierre: CierreSinRecibo, identidad: IdentidadEjecucionGitHub): Promise<ResultadoTransicionTrabajo>;
}
export function leerSolicitudTrabajo(entrada: unknown): SolicitudTrabajo {
  const o = objetoTrabajo(entrada, 'accion,revisionEsperada,solicitudId');
  exigirTrabajo(esIdSolicitudTrabajo(o.solicitudId));
  exigirTrabajo(accionManual(o.accion) && esEnteroTrabajo(o.revisionEsperada));
  return Object.freeze({ solicitudId: o.solicitudId, accion: o.accion, revisionEsperada: o.revisionEsperada });
}
export function leerInicioTrabajo(entrada: unknown): InicioTrabajo {
  const o = objetoTrabajo(entrada, 'accion,revisionReserva,solicitudId');
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(accion(o.accion));
  return Object.freeze({ ...referencia, accion: o.accion });
}
export function leerRetiradaTrabajo(entrada: unknown): RetiradaTrabajo {
  const o = objetoTrabajo(entrada, 'revisionEsperada,revisionReserva,solicitudId');
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(esEnteroTrabajo(o.revisionEsperada));
  return Object.freeze({ ...referencia, revisionEsperada: o.revisionEsperada });
}
export function leerEvidenciaEjecucionCompletada(entrada: unknown): EvidenciaEjecucionCompletada {
  const o = objetoTrabajo(
    entrada,
    'conclusion,estado,evento,propietarioId,repositorioId,runAttempt,runId,sha,workflowPath',
  );
  exigirTrabajo(o.estado === 'completed' && o.evento === 'workflow_dispatch' && o.runAttempt === '1');
  exigirTrabajo(esIdEjecucion(o.runId) && esIdEjecucion(o.repositorioId) && esIdEjecucion(o.propietarioId));
  exigirTrabajo(typeof o.sha === 'string' && /^[0-9a-f]{40}$/.test(o.sha));
  exigirTrabajo(
    typeof o.workflowPath === 'string' && /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(o.workflowPath),
  );
  const conclusion = CONCLUSIONES.find((c) => c === o.conclusion);
  exigirTrabajo(conclusion !== undefined);
  return Object.freeze({
    estado: 'completed',
    evento: 'workflow_dispatch',
    runAttempt: '1',
    runId: o.runId,
    repositorioId: o.repositorioId,
    propietarioId: o.propietarioId,
    sha: o.sha,
    workflowPath: o.workflowPath,
    conclusion,
  });
}
export function leerReciboTrabajo(entrada: unknown): ReciboTrabajo {
  const o = objetoTrabajo(
    entrada,
    'accion,error,huellaPaquete,resultado,revisionReserva,solicitudId,terminadoEn,veredicto',
  );
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(accion(o.accion));
  const r = leerResultado({
    resultado: o.resultado,
    veredicto: o.veredicto,
    terminadoEn: o.terminadoEn,
    huellaPaquete: o.huellaPaquete,
    error: o.error,
  });
  exigirTrabajo(r.resultado === 'validado' || r.resultado === 'sin-pendientes' || r.resultado === 'rechazado');
  return Object.freeze({ ...referencia, accion: o.accion, ...r, resultado: r.resultado });
}
function leerProtocoloInicio(
  t: Record<string, unknown>,
  base: TrabajoActualizacion,
  version: 1 | 2,
): Pick<TrabajoPrivado, 'protocoloInicio' | 'inicioConfirmado'> {
  const protocoloInicio = version === 1 ? 'legado' : t.protocoloInicio;
  const inicioConfirmado = version === 1 ? false : t.inicioConfirmado;
  exigirTrabajo(protocoloInicio === 'legado' || protocoloInicio === 'obligatorio');
  exigirTrabajo(typeof inicioConfirmado === 'boolean');
  exigirTrabajo(
    !inicioConfirmado ||
      (protocoloInicio === 'obligatorio' && base.runId !== null && base.estado !== 'despacho-incierto'),
  );
  const resultado = base.resultado?.resultado;
  exigirTrabajo(resultado !== 'retirado' || (protocoloInicio === 'obligatorio' && !inicioConfirmado));
  if (protocoloInicio === 'obligatorio' && (resultado === 'validado' || resultado === 'sin-pendientes')) {
    exigirTrabajo(inicioConfirmado);
  }
  return { protocoloInicio, inicioConfirmado };
}
function leerInicioRechazado(
  t: Record<string, unknown>,
  base: TrabajoActualizacion,
  protocoloInicio: TrabajoPrivado['protocoloInicio'],
): Pick<TrabajoPrivado, 'inicioRechazado'> {
  if (!Object.hasOwn(t, 'inicioRechazado')) {
    return {};
  }
  const r = objetoTrabajo(t.inicioRechazado, 'en,motivo');
  exigirTrabajo(protocoloInicio === 'obligatorio' && r.motivo === 'revision_no_autorizada');
  exigirTrabajo(esEnteroTrabajo(r.en) && r.en >= base.creadoEn);
  return { inicioRechazado: Object.freeze({ en: r.en, motivo: r.motivo }) };
}
function leerTrabajoPrivado(entrada: unknown, revision: number, version: 1 | 2): TrabajoPrivado {
  const anteriores =
    'accion,actualizadoEn,confianza,creadoEn,estado,huellaRecibo,resultado,revisionBase,revisionReserva,runAttempt,runId,solicitudId';
  const propios = `${anteriores},inicioConfirmado,protocoloInicio`;
  const opcionales = ['inicioRechazado', 'origen'];
  const t = objetoTrabajo(entrada, version === 1 ? anteriores : camposDelTrabajo(entrada, propios, opcionales));
  exigirTrabajo(!Object.hasOwn(t, 'origen') || esOrigenTrabajo(t.origen));
  const base = leerTrabajoBase(t, revision);
  exigirTrabajo(version === 2 || accionManual(base.accion));
  const confianza = leerConfianzaOidcGitHub(t.confianza);
  exigirTrabajo(
    t.huellaRecibo === null || (typeof t.huellaRecibo === 'string' && /^[0-9a-f]{64}$/.test(t.huellaRecibo)),
  );
  const resultado = base.resultado?.resultado;
  const conRecibo = resultado === 'validado' || resultado === 'sin-pendientes' || resultado === 'rechazado';
  exigirTrabajo(conRecibo ? t.huellaRecibo !== null : t.huellaRecibo === null);
  const protocolo = leerProtocoloInicio(t, base, version);
  return Object.freeze({
    ...base,
    confianza,
    huellaRecibo: t.huellaRecibo,
    ...protocolo,
    ...leerInicioRechazado(t, base, protocolo.protocoloInicio),
    ...(Object.hasOwn(t, 'origen') ? { origen: t.origen as OrigenTrabajo } : {}),
  });
}
export function leerEstadoTrabajosPrivado(entrada: unknown): EstadoTrabajosPrivado {
  const o = objetoTrabajo(entrada, 'revision,ultimoTrabajo,version');
  exigirTrabajo((o.version === 1 || o.version === 2) && esEnteroTrabajo(o.revision));
  if (o.ultimoTrabajo === null) {
    exigirTrabajo(o.revision === 0);
  }
  return Object.freeze({
    version: 2,
    revision: o.revision,
    ultimoTrabajo: o.ultimoTrabajo === null ? null : leerTrabajoPrivado(o.ultimoTrabajo, o.revision, o.version),
  });
}
export function estadoPublicoTrabajos(estado: EstadoTrabajosPrivado): EstadoTrabajos {
  const t = estado.ultimoTrabajo;
  if (!t) {
    return Object.freeze({ version: 1, revision: estado.revision, ultimoTrabajo: null });
  }
  const {
    confianza: _confianza,
    huellaRecibo: _huella,
    protocoloInicio: _protocolo,
    inicioConfirmado,
    inicioRechazado: _rechazo,
    ...publico
  } = t;
  const ultimoTrabajo = Object.freeze({ ...publico, iniciado: inicioConfirmado });
  return Object.freeze({ version: 1, revision: estado.revision, ultimoTrabajo });
}

function sesionActivaTrabajo(entrada: unknown): SesionPanelActiva {
  const sesion = leerEstadoSesionPanel(entrada);
  exigirTrabajo(sesion.estado === 'activa');
  return sesion;
}
export function leerResultadoLecturaTrabajo(entrada: unknown): ResultadoLecturaTrabajo {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  if (descriptor?.value !== 'activa') {
    const sesion = leerEstadoSesionPanel(entrada);
    exigirTrabajo(sesion.estado !== 'activa');
    return sesion;
  }
  const o = objetoTrabajo(entrada, 'estado,sesion,trabajos');
  return Object.freeze({
    estado: 'activa',
    sesion: sesionActivaTrabajo(o.sesion),
    trabajos: leerEstadoTrabajos(o.trabajos),
  });
}
export function leerResultadoReservaTrabajo(entrada: unknown): ResultadoReservaTrabajo {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  if (['sustituida', 'cerrada', 'caducada'].includes(descriptor?.value)) {
    const sesion = leerEstadoSesionPanel(entrada);
    exigirTrabajo(sesion.estado !== 'activa');
    return sesion;
  }
  const o = objetoTrabajo(entrada, 'estado,sesion,trabajos');
  exigirTrabajo(o.estado === 'nueva' || o.estado === 'repetida' || o.estado === 'ocupado' || o.estado === 'conflicto');
  const trabajos = leerEstadoTrabajos(o.trabajos);
  if (o.estado !== 'conflicto') {
    exigirTrabajo(trabajos.ultimoTrabajo !== null);
  }
  if (o.estado === 'nueva') {
    exigirTrabajo(
      trabajos.ultimoTrabajo?.estado === 'despacho-incierto' &&
        trabajos.ultimoTrabajo.revisionReserva === trabajos.revision,
    );
  }
  if (o.estado === 'ocupado') {
    exigirTrabajo(trabajos.ultimoTrabajo?.estado !== 'terminado');
  }
  return Object.freeze({ estado: o.estado, sesion: sesionActivaTrabajo(o.sesion), trabajos });
}
export function leerResultadoTransicionTrabajo(entrada: unknown): ResultadoTransicionTrabajo {
  const o = objetoTrabajo(entrada, 'estado,trabajos');
  exigirTrabajo(o.estado === 'aplicado' || o.estado === 'repetido' || o.estado === 'conflicto');
  const trabajos = leerEstadoTrabajos(o.trabajos);
  if (o.estado !== 'conflicto') {
    exigirTrabajo(trabajos.ultimoTrabajo !== null);
  }
  return Object.freeze({ estado: o.estado, trabajos });
}

export function leerResultadoRetiradaTrabajo(entrada: unknown): ResultadoRetiradaTrabajo {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  if (['sustituida', 'cerrada', 'caducada'].includes(descriptor?.value)) {
    const sesion = leerEstadoSesionPanel(entrada);
    exigirTrabajo(sesion.estado !== 'activa');
    return sesion;
  }
  const o = objetoTrabajo(entrada, 'estado,sesion,trabajos');
  exigirTrabajo(o.estado === 'retirado' || o.estado === 'conflicto');
  const trabajos = leerEstadoTrabajos(o.trabajos);
  if (o.estado === 'retirado') {
    exigirTrabajo(trabajos.ultimoTrabajo?.resultado?.resultado === 'retirado');
  }
  return Object.freeze({ estado: o.estado, sesion: sesionActivaTrabajo(o.sesion), trabajos });
}
