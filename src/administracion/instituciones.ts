/** Contrato de instituciones invitadas: identidad administrativa y proyección sin secretos ni huellas. */

import { leerContactoPublico } from '../../compartido/contacto-publico.js';
import type { Socio } from '../api/socios/registro.ts';
import { aBase64Url, deBase64Url } from '../comun/base64url.js';
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';

/** Política operativa acotada; no representa una capacidad del alojamiento ni una promesa de disponibilidad. */
export const LIMITES_CONECTIVIDAD = Object.freeze({
  instituciones: 100,
  clavesActivasPorInstitucion: 2,
  invitacionDias: 7,
  registrosOperativos: 10_000,
  retencionDias: 30,
  clientesDeclaradosPorDia: 64,
  consultasPorInstitucionHora: 1000,
  consultasGlobalesHora: 10_000,
  tokensPorInstitucionHora: 20,
  credencialesGlobalesHora: 1000,
  porPagina: 50,
});
export const DIA_CONECTIVIDAD_MS = 86_400_000;
export const CADUCIDAD_INVITACION_MS = LIMITES_CONECTIVIDAD.invitacionDias * DIA_CONECTIVIDAD_MS;
export const ID_INVITACION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ID_INSTITUCION = /^inst-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRETO_BYTES = 32;
const MAX_NOMBRE = 120;

export interface ClaveInstitucion {
  readonly id: string;
  readonly creadaEn: string;
  readonly ultimaConexion: string | null;
}
export interface Institucion {
  readonly id: string;
  readonly nombre: string;
  readonly correo: string | null;
  readonly estado: 'invitada' | 'activa' | 'retirada';
  readonly ultimaConexion: string | null;
  readonly consultas: number;
  readonly invitacion: { readonly caducaEn: string } | null;
  readonly claves: readonly ClaveInstitucion[];
}
export interface RegistroInstituciones {
  readonly version: 1;
  readonly revision: number;
  readonly instituciones: readonly Institucion[];
}
export interface SolicitudInvitar {
  readonly revisionEsperada: number;
  readonly nombre: string;
  readonly correo: string | null;
}
export interface SolicitudInstitucion {
  readonly revisionEsperada: number;
  readonly id: string;
}
export interface SolicitudRetirarClave extends SolicitudInstitucion {
  readonly claveId: string;
}
export interface InvitacionLeida {
  readonly version: 1;
  readonly institucion: { readonly id: string; readonly nombre: string };
  readonly caducaEn: string;
}
export interface EnlaceInvitacion {
  readonly enlaceRelativo: string;
  readonly caducaEn: string;
}
export type ResultadoRegistroSesion =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly registro: RegistroInstituciones }
  | SesionPanelInactiva;
export type ResultadoCambioInstituciones =
  | { readonly estado: 'cambiado'; readonly registro: RegistroInstituciones }
  | {
      readonly estado: 'conflicto' | 'lleno' | 'no_encontrada' | 'dos_claves_activas';
      readonly registro: RegistroInstituciones;
    };
/** Solo las huellas atraviesan el enlace privado del entorno; el secreto se devuelve una vez desde el adaptador HTTP. */
export interface IdentidadInvitacion {
  readonly id: string;
  readonly huella: string;
}
export type ResultadoCambioInstitucionesSesion =
  | (ResultadoCambioInstituciones & { readonly sesion: SesionPanelActiva })
  | SesionPanelInactiva;
export type ResultadoActivarInvitacion =
  | { readonly estado: 'activada'; readonly institucionId: string }
  | { readonly estado: 'apagada' | 'no_disponible' | 'dos_claves_activas' };
export interface AlmacenInstitucionesPanel {
  leerInstitucionesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoRegistroSesion>;
  invitarInstitucionDeSesion(
    acceso: AccesoSesionPanel,
    solicitud: SolicitudInvitar,
    nueva: IdentidadInvitacion & { readonly institucionId: string },
  ): Promise<ResultadoCambioInstitucionesSesion>;
  renovarInvitacionDeSesion(
    acceso: AccesoSesionPanel,
    solicitud: SolicitudInstitucion,
    nueva: IdentidadInvitacion,
  ): Promise<ResultadoCambioInstitucionesSesion>;
  retirarInstitucionDeSesion(
    acceso: AccesoSesionPanel,
    solicitud: SolicitudInstitucion,
  ): Promise<ResultadoCambioInstitucionesSesion>;
  retirarClaveDeSesion(
    acceso: AccesoSesionPanel,
    solicitud: SolicitudRetirarClave,
  ): Promise<ResultadoCambioInstitucionesSesion>;
}
export interface AlmacenInstituciones extends AlmacenInstitucionesPanel {
  /** Preparación privada explícita. Nunca se invoca como reparación de una lectura pública fallida. */
  prepararInstituciones(): Promise<void>;
  consultarInvitacion(recibida: IdentidadInvitacion): Promise<InvitacionLeida | null | 'apagada'>;
  activarInvitacion(recibida: IdentidadInvitacion, clave: IdentidadInvitacion): Promise<ResultadoActivarInvitacion>;
  buscarInstitucion(id: string): Promise<Socio | null>;
}

/** Error de entrada sin valores de la petición; no contiene nombres, correos ni secretos. */
export class SolicitudInstitucionInvalida extends Error {
  override readonly name = 'SolicitudInstitucionInvalida';
  constructor() {
    super('Solicitud de institución no válida');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new SolicitudInstitucionInvalida();
  }
}
function objeto(entrada: unknown, claves: readonly string[]): Record<string, unknown> {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const prototipo: unknown = Object.getPrototypeOf(entrada);
  exigir((prototipo === Object.prototype || prototipo === null) && Object.getOwnPropertySymbols(entrada).length === 0);
  exigir(Object.getOwnPropertyNames(entrada).length === claves.length);
  const copia: Record<string, unknown> = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    Object.defineProperty(copia, clave, { value: descriptor.value, enumerable: true });
  }
  return copia;
}
function revision(entrada: unknown): number {
  exigir(
    typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0 && entrada < Number.MAX_SAFE_INTEGER,
  );
  return entrada;
}
export function nombreInstitucion(entrada: unknown): string {
  exigir(typeof entrada === 'string' && entrada.length > 0 && entrada.length <= MAX_NOMBRE);
  exigir(entrada.trim() === entrada && !/[\p{C}\r\n]/u.test(entrada));
  return entrada;
}
export function correoInstitucion(entrada: unknown): string | null {
  if (entrada === null) {
    return null;
  }
  exigir(typeof entrada === 'string' && entrada !== '');
  try {
    leerContactoPublico({ responsable: '', correo: entrada });
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new SolicitudInstitucionInvalida();
  }
  return entrada;
}
export function leerSolicitudInvitar(entrada: unknown): SolicitudInvitar {
  const o = objeto(entrada, ['revisionEsperada', 'nombre', 'correo']);
  return {
    revisionEsperada: revision(o.revisionEsperada),
    nombre: nombreInstitucion(o.nombre),
    correo: correoInstitucion(o.correo),
  };
}
export function leerSolicitudInstitucion(entrada: unknown): SolicitudInstitucion {
  const o = objeto(entrada, ['revisionEsperada', 'id']);
  exigir(typeof o.id === 'string' && ID_INSTITUCION.test(o.id));
  return { revisionEsperada: revision(o.revisionEsperada), id: o.id };
}
export function leerSolicitudRetirarClave(entrada: unknown): SolicitudRetirarClave {
  const o = objeto(entrada, ['revisionEsperada', 'id', 'claveId']);
  exigir(typeof o.claveId === 'string' && ID_INVITACION.test(o.claveId));
  return { ...leerSolicitudInstitucion({ revisionEsperada: o.revisionEsperada, id: o.id }), claveId: o.claveId };
}
/** El fragmento se quita de la dirección en la página; el servidor solo recibe este cuerpo POST. */
export function leerSecretoInvitacion(entrada: unknown): { readonly id: string; readonly secreto: string } {
  const o = objeto(entrada, ['invitacion']);
  exigir(typeof o.invitacion === 'string');
  const trozos = o.invitacion.split('.');
  const id = trozos[0],
    secreto = trozos[1];
  exigir(trozos.length === 2 && typeof id === 'string' && ID_INVITACION.test(id));
  exigir(typeof secreto === 'string' && /^[A-Za-z0-9_-]{43}$/.test(secreto));
  const bytes = deBase64Url(secreto);
  exigir(bytes !== null && bytes.byteLength === SECRETO_BYTES && aBase64Url(bytes) === secreto);
  return { id, secreto };
}

/** Contrato privado cerrado: un objeto durable defectuoso no puede introducir campos ni secretos en una respuesta pública. */
export function leerIdentidadInvitacion(entrada: unknown): IdentidadInvitacion {
  const o = objeto(entrada, ['id', 'huella']);
  exigir(typeof o.id === 'string' && ID_INVITACION.test(o.id));
  exigir(typeof o.huella === 'string' && /^[0-9a-f]{64}$/.test(o.huella));
  return { id: o.id, huella: o.huella };
}
function instanteIso(entrada: unknown): string {
  exigir(typeof entrada === 'string');
  const fecha = new Date(entrada);
  exigir(Number.isFinite(fecha.getTime()) && fecha.toISOString() === entrada);
  return entrada;
}
function nullableIso(entrada: unknown): string | null {
  return entrada === null ? null : instanteIso(entrada);
}
function leerClave(entrada: unknown): ClaveInstitucion {
  const o = objeto(entrada, ['id', 'creadaEn', 'ultimaConexion']);
  exigir(typeof o.id === 'string' && ID_INVITACION.test(o.id));
  return { id: o.id, creadaEn: instanteIso(o.creadaEn), ultimaConexion: nullableIso(o.ultimaConexion) };
}
function leerInstitucion(entrada: unknown): Institucion {
  const o = objeto(entrada, [
    'id',
    'nombre',
    'correo',
    'estado',
    'ultimaConexion',
    'consultas',
    'invitacion',
    'claves',
  ]);
  exigir(typeof o.id === 'string' && ID_INSTITUCION.test(o.id));
  exigir(o.estado === 'invitada' || o.estado === 'activa' || o.estado === 'retirada');
  exigir(Array.isArray(o.claves) && o.claves.length <= LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion);
  const claves = o.claves.map(leerClave);
  exigir(new Set(claves.map((c) => c.id)).size === claves.length);
  exigir((o.estado === 'activa') === claves.length > 0);
  const invitacion =
    o.invitacion === null ? null : { caducaEn: instanteIso(objeto(o.invitacion, ['caducaEn']).caducaEn) };
  exigir(o.estado !== 'retirada' || invitacion === null);
  return {
    id: o.id,
    nombre: nombreInstitucion(o.nombre),
    correo: correoInstitucion(o.correo),
    estado: o.estado,
    ultimaConexion: nullableIso(o.ultimaConexion),
    consultas: revision(o.consultas),
    invitacion,
    claves,
  };
}
export function leerRegistroInstituciones(entrada: unknown): RegistroInstituciones {
  const o = objeto(entrada, ['version', 'revision', 'instituciones']);
  exigir(
    o.version === 1 && Array.isArray(o.instituciones) && o.instituciones.length <= LIMITES_CONECTIVIDAD.instituciones,
  );
  const instituciones = o.instituciones.map(leerInstitucion);
  exigir(new Set(instituciones.map((i) => i.id)).size === instituciones.length);
  return { version: 1, revision: revision(o.revision), instituciones };
}
function resultadoInstituciones(entrada: unknown, lectura: true): ResultadoRegistroSesion;
function resultadoInstituciones(entrada: unknown, lectura: false): ResultadoCambioInstitucionesSesion;
function resultadoInstituciones(
  entrada: unknown,
  lectura: boolean,
): ResultadoRegistroSesion | ResultadoCambioInstitucionesSesion {
  exigir(entrada !== null && typeof entrada === 'object');
  const estado = Object.getOwnPropertyDescriptor(entrada, 'estado');
  exigir(estado !== undefined && 'value' in estado);
  if (estado.value === 'cerrada' || estado.value === 'sustituida' || estado.value === 'caducada') {
    const inactiva = leerEstadoSesionPanel(entrada);
    exigir(inactiva.estado !== 'activa');
    return inactiva;
  }
  const o = objeto(entrada, ['estado', 'sesion', 'registro']);
  const sesion = leerEstadoSesionPanel(o.sesion);
  exigir(sesion.estado === 'activa');
  const registro = leerRegistroInstituciones(o.registro);
  if (lectura) {
    exigir(o.estado === 'activa');
    return { estado: 'activa', sesion, registro };
  }
  exigir(
    o.estado === 'cambiado' ||
      o.estado === 'conflicto' ||
      o.estado === 'lleno' ||
      o.estado === 'no_encontrada' ||
      o.estado === 'dos_claves_activas',
  );
  return { estado: o.estado, sesion, registro };
}
export function leerResultadoRegistroSesion(entrada: unknown): ResultadoRegistroSesion {
  return resultadoInstituciones(entrada, true);
}
export function leerResultadoCambioInstitucionesSesion(entrada: unknown): ResultadoCambioInstitucionesSesion {
  return resultadoInstituciones(entrada, false);
}
export function leerInvitacionConsultada(entrada: unknown): InvitacionLeida | null | 'apagada' {
  if (entrada === null || entrada === 'apagada') {
    return entrada;
  }
  const o = objeto(entrada, ['version', 'institucion', 'caducaEn']);
  exigir(o.version === 1);
  const i = objeto(o.institucion, ['id', 'nombre']);
  exigir(typeof i.id === 'string' && ID_INSTITUCION.test(i.id));
  return {
    version: 1,
    institucion: { id: i.id, nombre: nombreInstitucion(i.nombre) },
    caducaEn: instanteIso(o.caducaEn),
  };
}
export function leerInvitacionActivada(entrada: unknown): ResultadoActivarInvitacion {
  exigir(entrada !== null && typeof entrada === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(entrada, 'estado');
  exigir(descriptor !== undefined && 'value' in descriptor);
  if (descriptor.value === 'activada') {
    const o = objeto(entrada, ['estado', 'institucionId']);
    exigir(typeof o.institucionId === 'string' && ID_INSTITUCION.test(o.institucionId));
    return { estado: 'activada', institucionId: o.institucionId };
  }
  const o = objeto(entrada, ['estado']);
  exigir(o.estado === 'apagada' || o.estado === 'no_disponible' || o.estado === 'dos_claves_activas');
  return { estado: o.estado };
}
