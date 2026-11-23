/** Protocolo del enlace privado del entorno. La frontera autentica Access/OIDC antes; aquí no hay credenciales del navegador. */

import { leerCierreSinRecibo } from '../../administracion/cierre-sin-recibo.ts';
import { ACCIONES_DEMANDA, type AccionDemanda } from '../../administracion/configuracion-demanda.ts';
import {
  leerCatalogoDeRecibo,
  leerDatosDeRecibo,
  MAX_OBSERVACION_DATOS_BYTES,
} from '../../administracion/datos-trabajo.ts';
import type { ResultadoDespacho } from '../../administracion/ejecutor-github.ts';
import { leerFalloProgramado } from '../../administracion/fallo-programado.ts';
import { esNombreDeActorGitHub, type IdentidadDemandaGitHub } from '../../administracion/oidc-demanda.ts';
import {
  type ConfianzaOidcGitHub,
  esIdentificadorGitHub,
  type IdentidadEjecucionGitHub,
  leerConfianzaOidcGitHub,
} from '../../administracion/oidc-github.ts';
import {
  type AlmacenTrabajosProgramados,
  leerSolicitudTrabajoProgramado,
} from '../../administracion/programacion-trabajos.ts';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';
import {
  type AlmacenTrabajosActualizacion,
  type EvidenciaEjecucionCompletada,
  esEnteroTrabajo,
  esIdEjecucion,
  exigirTrabajo,
  type InicioTrabajo,
  leerEvidenciaEjecucionCompletada,
  leerInicioTrabajo,
  leerReciboTrabajo,
  leerReferenciaTrabajo,
  leerResultadoReservaTrabajo,
  leerResultadoRetiradaTrabajo,
  leerResultadoTransicionTrabajo,
  leerRetiradaTrabajo,
  leerSolicitudTrabajo,
  objetoTrabajo,
  type ReciboTrabajo,
  type ReferenciaTrabajo,
  type RetiradaTrabajo,
  type SolicitudTrabajo,
} from '../../administracion/trabajos.ts';
import { RUTA_CIERRE_SIN_RECIBO_DURABLE } from './cierre-sin-recibo-durable.ts';
import { type AlmacenDatosDelPanel, RUTA_DATOS_PANEL } from './datos-panel-durable.ts';
import type { MotivoSolicitud } from './solicitudes-sqlite.ts';

export const MAX_MENSAJE_TRABAJO_DURABLE = 8192;
export const MAX_RESPUESTA_TRABAJO_DURABLE = 8192;
export const MAX_MENSAJE_RECIBO_DURABLE = MAX_OBSERVACION_DATOS_BYTES + MAX_MENSAJE_TRABAJO_DURABLE;
const MAX_CAMPO_IDENTIDAD = 512;
const MAX_JTI = 128;
const MS_SEGUNDO = 1000;
export const RUTA_DEMANDA = '/trabajos/demanda';
const RUTAS = new Set([
  '/trabajos/preparar',
  '/trabajos/programada',
  '/trabajos/programada/fallo',
  '/trabajos/leer',
  '/trabajos/reservar',
  '/trabajos/privado',
  '/trabajos/datos',
  RUTA_DATOS_PANEL,
  '/trabajos/despacho',
  '/trabajos/recibo',
  '/trabajos/inicio',
  '/trabajos/inicio-rechazado',
  '/trabajos/retirar',
  '/trabajos/sin-recibo',
  RUTA_CIERRE_SIN_RECIBO_DURABLE,
  RUTA_DEMANDA,
]);
export function esRutaTrabajosDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}
export function leerHuellaReciboDurable(entrada: unknown): string {
  exigirTrabajo(typeof entrada === 'string' && /^[0-9a-f]{64}$/.test(entrada));
  return entrada;
}
/** Solo estructura de una identidad ya verificada. Nunca interpreta un token, claims o nombres visibles. */
export function leerIdentidadTrabajoDurable(entrada: unknown): IdentidadEjecucionGitHub {
  const o = objetoTrabajo(
    entrada,
    'caducaEn,emitidoEn,jti,propietarioId,ref,repositorioId,runAttempt,runId,sha,workflowRef,workflowSha',
  );
  for (const clave of ['repositorioId', 'propietarioId', 'ref', 'workflowRef', 'workflowSha', 'sha', 'jti']) {
    const valor = o[clave];
    exigirTrabajo(
      typeof valor === 'string' &&
        valor.length > 0 &&
        valor.length <= MAX_CAMPO_IDENTIDAD &&
        !/[\s\p{Cc}]/u.test(valor),
    );
  }
  exigirTrabajo(esIdEjecucion(o.runId) && esIdEjecucion(o.runAttempt));
  exigirTrabajo(typeof o.jti === 'string' && new TextEncoder().encode(o.jti).byteLength <= MAX_JTI);
  exigirTrabajo(esEnteroTrabajo(o.emitidoEn) && esEnteroTrabajo(o.caducaEn));
  exigirTrabajo(Number.isSafeInteger(o.emitidoEn * MS_SEGUNDO) && Number.isSafeInteger(o.caducaEn * MS_SEGUNDO));
  // Los campos textuales se comprobaron en el bucle; la copia no expone el objeto del llamador.
  return Object.freeze({
    repositorioId: o.repositorioId as string,
    propietarioId: o.propietarioId as string,
    ref: o.ref as string,
    workflowRef: o.workflowRef as string,
    workflowSha: o.workflowSha as string,
    sha: o.sha as string,
    runId: o.runId,
    runAttempt: o.runAttempt,
    jti: o.jti,
    emitidoEn: o.emitidoEn,
    caducaEn: o.caducaEn,
  });
}
export function leerDespachoTrabajoDurable(entrada: unknown): ResultadoDespacho {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  const o = objetoTrabajo(entrada, descriptor?.value === 'despachada' ? 'estado,runId' : 'estado');
  if (o.estado === 'despachada') {
    exigirTrabajo(esIdEjecucion(o.runId));
    return { estado: 'despachada', runId: o.runId };
  }
  exigirTrabajo(o.estado === 'rechazada' || o.estado === 'incierta');
  return { estado: o.estado };
}
/** El run verificado pide o consulta su reserva; la configuración va como texto, y la autoridad la vuelve a leer. */
export type PeticionDemanda =
  | {
      readonly operacion: 'reservar';
      readonly accion: AccionDemanda;
      readonly identidad: IdentidadDemandaGitHub;
      readonly confianza: ConfianzaOidcGitHub;
      readonly configuracion: string | null;
    }
  | { readonly operacion: 'consultar'; readonly runId: string };
/** Las guardias comunes de la reserva y los topes: todos los motivos del registro menos los de la programada. */
export type MotivoRechazoDemanda = Exclude<MotivoSolicitud, 'requiere_atencion' | 'fuera_de_ventana'>;
/** Nunca lleva al actor: la respuesta solo dice qué reserva tiene el run y con qué revisión pedirá su inicio. */
export type ResultadoDemanda =
  | { readonly estado: 'reservada' | 'repetida'; readonly solicitudId: string; readonly revisionReserva: number }
  | { readonly estado: 'rechazada'; readonly motivo: MotivoRechazoDemanda }
  | { readonly estado: 'cerrada' | 'sin_reserva' };
export interface AlmacenTrabajosDemanda {
  operarDemanda(peticion: PeticionDemanda): Promise<ResultadoDemanda>;
}
function leerIdentidadDemanda(entrada: unknown): IdentidadDemandaGitHub {
  const o = objetoTrabajo(entrada, 'actor,ejecucion');
  const actor = objetoTrabajo(o.actor, 'id,nombre');
  exigirTrabajo(esIdentificadorGitHub(actor.id) && esNombreDeActorGitHub(actor.nombre));
  const ejecucion = leerIdentidadTrabajoDurable(o.ejecucion);
  return Object.freeze({ ejecucion, actor: Object.freeze({ id: actor.id, nombre: actor.nombre }) });
}
export function leerPeticionDemanda(entrada: unknown): PeticionDemanda {
  exigirTrabajo(entrada !== null && typeof entrada === 'object');
  if (Object.getOwnPropertyDescriptor(entrada, 'operacion')?.value === 'consultar') {
    const o = objetoTrabajo(entrada, 'operacion,runId');
    exigirTrabajo(esIdEjecucion(o.runId));
    return Object.freeze({ operacion: 'consultar', runId: o.runId });
  }
  const o = objetoTrabajo(entrada, 'accion,confianza,configuracion,identidad,operacion');
  const accion = ACCIONES_DEMANDA.find((a) => a === o.accion);
  exigirTrabajo(o.operacion === 'reservar' && accion !== undefined);
  exigirTrabajo(o.configuracion === null || typeof o.configuracion === 'string');
  return Object.freeze({
    operacion: 'reservar',
    accion,
    identidad: leerIdentidadDemanda(o.identidad),
    confianza: leerConfianzaOidcGitHub(o.confianza),
    configuracion: o.configuracion,
  });
}
function sesion(almacen: AlmacenTrabajosActualizacion, ruta: string, cuerpo: unknown) {
  if (ruta === '/trabajos/retirar') {
    const o = objetoTrabajo(cuerpo, 'acceso,retirada');
    const acceso = leerAccesoSesionPanel(o.acceso);
    const retirada = leerRetiradaTrabajo(o.retirada);
    return () => almacen.retirarTrabajoDeSesion(acceso, retirada);
  }
  if (ruta === '/trabajos/leer') {
    const o = objetoTrabajo(cuerpo, 'acceso');
    const acceso = leerAccesoSesionPanel(o.acceso);
    return () => almacen.leerTrabajoDeSesion(acceso);
  }
  const o = objetoTrabajo(cuerpo, 'acceso,confianza,solicitud');
  const acceso = leerAccesoSesionPanel(o.acceso);
  const solicitud = leerSolicitudTrabajo(o.solicitud);
  const confianza = leerConfianzaOidcGitHub(o.confianza);
  return () => almacen.reservarTrabajoDeSesion(acceso, solicitud, confianza);
}
/** Sin la capacidad, la ruta no existe para ese almacén, igual que la programada. */
function demanda(almacen: Partial<AlmacenTrabajosDemanda>, cuerpo: unknown) {
  const peticion = leerPeticionDemanda(cuerpo);
  const operar = almacen.operarDemanda?.bind(almacen);
  return operar ? () => operar(peticion) : undefined;
}
function cierreSinRecibo(almacen: AlmacenTrabajosActualizacion, cuerpo: unknown) {
  const o = objetoTrabajo(cuerpo, 'cierre,identidad');
  const cierre = leerCierreSinRecibo(o.cierre);
  const identidad = leerIdentidadTrabajoDurable(o.identidad);
  return () => almacen.cerrarSinRecibo(cierre, identidad);
}
function privada(almacen: AlmacenTrabajosActualizacion, ruta: string, cuerpo: unknown): () => Promise<unknown> {
  if (ruta === '/trabajos/inicio') {
    const o = objetoTrabajo(cuerpo, 'identidad,inicio');
    const inicio = leerInicioTrabajo(o.inicio);
    const identidad = leerIdentidadTrabajoDurable(o.identidad);
    return () => almacen.confirmarInicio(inicio, identidad);
  }
  if (ruta === '/trabajos/inicio-rechazado') {
    const o = objetoTrabajo(cuerpo, 'identidad,inicio');
    const inicio = leerInicioTrabajo(o.inicio);
    const identidad = leerIdentidadTrabajoDurable(o.identidad);
    return () => almacen.anotarInicioRechazado(inicio, identidad);
  }
  if (ruta === '/trabajos/sin-recibo') {
    const o = objetoTrabajo(cuerpo, 'evidencia,referencia');
    const referencia = leerReferenciaTrabajo(o.referencia);
    const evidencia = leerEvidenciaEjecucionCompletada(o.evidencia);
    return () => almacen.finalizarEjecucionSinRecibo(referencia, evidencia);
  }
  if (ruta === '/trabajos/despacho') {
    const o = objetoTrabajo(cuerpo, 'referencia,resultado');
    const referencia = leerReferenciaTrabajo(o.referencia);
    const resultado = leerDespachoTrabajoDurable(o.resultado);
    return () => almacen.anotarDespacho(referencia, resultado);
  }
  const tieneEstado = cuerpo !== null && typeof cuerpo === 'object' && Object.hasOwn(cuerpo, 'estado');
  const tieneCatalogo = cuerpo !== null && typeof cuerpo === 'object' && Object.hasOwn(cuerpo, 'catalogo');
  exigirTrabajo(!tieneCatalogo || tieneEstado);
  const anteriores = tieneEstado ? 'estado,huellaRecibo,identidad,recibo' : 'huellaRecibo,identidad,recibo';
  const campos = tieneCatalogo ? 'catalogo,estado,huellaRecibo,identidad,recibo' : anteriores;
  const o = objetoTrabajo(cuerpo, campos);
  const recibo = leerReciboTrabajo(o.recibo);
  const huella = leerHuellaReciboDurable(o.huellaRecibo);
  const identidad = leerIdentidadTrabajoDurable(o.identidad);
  const estado = tieneEstado ? leerDatosDeRecibo(recibo, o.estado) : undefined;
  const catalogo = tieneCatalogo ? leerCatalogoDeRecibo(recibo, o.catalogo) : undefined;
  exigirTrabajo(catalogo == null || estado != null);
  return () => almacen.registrarRecibo(recibo, huella, identidad, estado, catalogo);
}
/** El reloj diario: reserva de su evento o registro de un fallo del manejador. */
function programada(almacen: Partial<AlmacenTrabajosProgramados>, ruta: string, cuerpo: unknown) {
  if (ruta === '/trabajos/programada/fallo') {
    const fallo = leerFalloProgramado(objetoTrabajo(cuerpo, 'fallo').fallo);
    const registrar = almacen.registrarFalloProgramado?.bind(almacen);
    return registrar ? () => registrar(fallo) : undefined;
  }
  const o = objetoTrabajo(cuerpo, 'confianza,solicitud');
  const solicitud = leerSolicitudTrabajoProgramado(o.solicitud);
  const confianza = leerConfianzaOidcGitHub(o.confianza);
  const reservar = almacen.reservarTrabajoProgramado?.bind(almacen);
  return reservar ? () => reservar(solicitud, confianza) : undefined;
}
type AlmacenTrabajosDurable = AlmacenTrabajosActualizacion &
  AlmacenDatosDelPanel &
  Partial<AlmacenTrabajosProgramados> &
  Partial<AlmacenTrabajosDemanda>;
/** Las operaciones que no llevan cuerpo: preparar, leer el documento privado y las dos lecturas de la observación. */
type OperacionSinCuerpo = (almacen: AlmacenTrabajosDurable) => Promise<unknown>;
const SIN_CUERPO: ReadonlyMap<string, OperacionSinCuerpo> = new Map<string, OperacionSinCuerpo>([
  [
    '/trabajos/preparar',
    async (almacen) => {
      await almacen.prepararTrabajos();
      return { correcto: true };
    },
  ],
  ['/trabajos/privado', (almacen) => almacen.leerTrabajoPrivado()],
  ['/trabajos/datos', (almacen) => almacen.leerDatosDelUltimoTrabajo()],
  [RUTA_DATOS_PANEL, (almacen) => almacen.leerDatosDelPanel()],
]);
function accionValida(
  almacen: AlmacenTrabajosDurable,
  ruta: string,
  cuerpo: unknown,
): (() => Promise<unknown>) | undefined {
  if (!esRutaTrabajosDurable(ruta)) {
    return undefined;
  }
  try {
    const sinCuerpo = SIN_CUERPO.get(ruta);
    if (sinCuerpo) {
      objetoTrabajo(cuerpo, '');
      return () => sinCuerpo(almacen);
    }
    if (ruta === '/trabajos/programada' || ruta === '/trabajos/programada/fallo') {
      return programada(almacen, ruta, cuerpo);
    }
    if (ruta === RUTA_DEMANDA) {
      return demanda(almacen, cuerpo);
    }
    if (ruta === RUTA_CIERRE_SIN_RECIBO_DURABLE) {
      return cierreSinRecibo(almacen, cuerpo);
    }
    return ruta === '/trabajos/leer' || ruta === '/trabajos/reservar' || ruta === '/trabajos/retirar'
      ? sesion(almacen, ruta, cuerpo)
      : privada(almacen, ruta, cuerpo);
  } catch {
    return undefined;
  }
}
/** La captura solo cubre la forma de entrada; los fallos SQL se propagan al adaptador y conservan su clasificación. */
export async function operarTrabajosDurable(
  almacen: AlmacenTrabajosDurable,
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> {
  const accion = accionValida(almacen, ruta, cuerpo);
  return accion ? accion() : undefined;
}
export function leerReservaDurable(entrada: unknown, solicitud: SolicitudTrabajo) {
  const resultado = leerResultadoReservaTrabajo(entrada);
  if (resultado.estado === 'nueva' || resultado.estado === 'repetida') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(
      t !== null &&
        t.solicitudId === solicitud.solicitudId &&
        t.accion === solicitud.accion &&
        t.revisionBase === solicitud.revisionEsperada &&
        t.revisionReserva === solicitud.revisionEsperada + 1,
    );
  }
  return resultado;
}
function leerTransicionDurable(entrada: unknown, referencia: ReferenciaTrabajo) {
  const resultado = leerResultadoTransicionTrabajo(entrada);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(
      t !== null && t.solicitudId === referencia.solicitudId && t.revisionReserva === referencia.revisionReserva,
    );
  }
  return resultado;
}
export function leerTransicionDespachoDurable(
  entrada: unknown,
  referencia: ReferenciaTrabajo,
  despacho: ResultadoDespacho,
) {
  const resultado = leerTransicionDurable(entrada, referencia);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    if (despacho.estado === 'despachada') {
      exigirTrabajo(t?.runId === despacho.runId);
    }
    if (despacho.estado === 'rechazada') {
      exigirTrabajo(t?.resultado?.resultado === 'despacho-rechazado');
    }
  }
  return resultado;
}
export function leerTransicionReciboDurable(
  entrada: unknown,
  recibo: ReciboTrabajo,
  identidad: IdentidadEjecucionGitHub,
) {
  const resultado = leerTransicionDurable(entrada, recibo);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    const { solicitudId: _id, accion: _accion, revisionReserva: _revision, ...resumen } = recibo;
    exigirTrabajo(t?.runId === identidad.runId && t.accion === recibo.accion && t.estado === 'terminado');
    exigirTrabajo(JSON.stringify(t.resultado) === JSON.stringify(resumen));
  }
  return resultado;
}

export function leerTransicionInicioDurable(
  entrada: unknown,
  inicio: InicioTrabajo,
  identidad: IdentidadEjecucionGitHub,
) {
  const resultado = leerTransicionDurable(entrada, inicio);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(t?.runId === identidad.runId && t.accion === inicio.accion && t.estado === 'despachado');
  }
  return resultado;
}
/** El rechazo no inicia nada: la reserva sigue sin run confirmado y con la misma acción. */
export function leerTransicionInicioRechazadoDurable(entrada: unknown, inicio: InicioTrabajo) {
  const resultado = leerTransicionDurable(entrada, inicio);
  if (resultado.estado !== 'conflicto') {
    exigirTrabajo(resultado.trabajos.ultimoTrabajo?.accion === inicio.accion);
  }
  return resultado;
}
export function leerRetiradaDurable(entrada: unknown, retirada: RetiradaTrabajo) {
  const resultado = leerResultadoRetiradaTrabajo(entrada);
  if (resultado.estado === 'retirado') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(t?.solicitudId === retirada.solicitudId && t.revisionReserva === retirada.revisionReserva);
    exigirTrabajo(resultado.trabajos.revision === retirada.revisionEsperada + 1);
  }
  return resultado;
}
export function leerTransicionSinReciboDurable(
  entrada: unknown,
  referencia: ReferenciaTrabajo,
  evidencia: EvidenciaEjecucionCompletada,
) {
  const resultado = leerTransicionDurable(entrada, referencia);
  if (resultado.estado !== 'conflicto') {
    const t = resultado.trabajos.ultimoTrabajo;
    exigirTrabajo(t?.runId === evidencia.runId && t.resultado?.resultado === 'ejecucion-sin-recibo');
  }
  return resultado;
}
