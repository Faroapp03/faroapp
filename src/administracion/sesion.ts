/** Sesión administrativa global: huellas separadas del token y de la identidad verificada por petición. */
import { type DocumentoControles, leerDocumentoControles, type PoliticaControles } from './controles.ts';

export const INACTIVIDAD_SESION_PANEL_MS = 900_000;
export const DURACION_MAXIMA_SESION_PANEL_MS = 28_800_000;
export interface AccesoSesionPanel {
  readonly huellaSesion: string;
  readonly huellaPrincipal: string;
}
export interface SesionPanelActiva {
  readonly estado: 'activa';
  readonly iniciadaEn: number;
  readonly ultimaActividadEn: number;
  readonly caducaPorInactividadEn: number;
  readonly caducaAbsolutaEn: number;
}
export interface SesionPanelInactiva {
  readonly estado: 'sustituida' | 'caducada' | 'cerrada';
}
export type EstadoSesionPanel = SesionPanelActiva | SesionPanelInactiva;
export type ResultadoLecturaControlesSesion =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly controles: DocumentoControles }
  | SesionPanelInactiva;
export type ResultadoCambioControlesSesion =
  | {
      readonly estado: 'cambiado' | 'conflicto';
      readonly sesion: SesionPanelActiva;
      readonly controles: DocumentoControles;
    }
  | SesionPanelInactiva;
export interface AlmacenSesionPanel {
  /** Adopción privada y explícita, una sola vez; nunca operación del navegador. */
  activarSesionPanel(): Promise<void>;
  /** El sondeo no renueva el vencimiento por inactividad. */
  comprobarSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel>;
  mantenerSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel>;
  cerrarSesion(acceso: AccesoSesionPanel): Promise<EstadoSesionPanel>;
  leerControlesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaControlesSesion>;
  cambiarControlesDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    politica: PoliticaControles,
  ): Promise<ResultadoCambioControlesSesion>;
}

/** Preparación privada del ciclo de vida, separada de las operaciones que consume el enrutador. */
export interface AlmacenPreparacionPanel extends AlmacenSesionPanel {
  /** Adopta controles y sesión en una sola transacción; una instalación ya válida no se modifica. */
  prepararPanel(inicial: PoliticaControles): Promise<DocumentoControles>;
}

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Datos de sesión administrativa no válidos');
  }
}
function objeto(entrada: unknown): Record<string, unknown> {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  const prototipo: unknown = Object.getPrototypeOf(entrada);
  exigir((prototipo === Object.prototype || prototipo === null) && Object.getOwnPropertySymbols(entrada).length === 0);
  const copia: Record<string, unknown> = {};
  for (const clave of Object.getOwnPropertyNames(entrada)) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigir(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    Object.defineProperty(copia, clave, { value: descriptor.value, enumerable: true });
  }
  return copia;
}
function claves(entrada: Record<string, unknown>, esperadas: string): void {
  exigir(Object.keys(entrada).sort().join(',') === esperadas);
}
export function leerAccesoSesionPanel(entrada: unknown): AccesoSesionPanel {
  const copia = objeto(entrada);
  claves(copia, 'huellaPrincipal,huellaSesion');
  exigir(typeof copia.huellaSesion === 'string' && /^[0-9a-f]{64}$/.test(copia.huellaSesion));
  exigir(typeof copia.huellaPrincipal === 'string' && /^[0-9a-f]{64}$/.test(copia.huellaPrincipal));
  return { huellaSesion: copia.huellaSesion, huellaPrincipal: copia.huellaPrincipal };
}
function instante(entrada: unknown): entrada is number {
  return typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0;
}
function activa(entrada: Record<string, unknown>): SesionPanelActiva {
  claves(entrada, 'caducaAbsolutaEn,caducaPorInactividadEn,estado,iniciadaEn,ultimaActividadEn');
  exigir(entrada.estado === 'activa' && instante(entrada.iniciadaEn) && instante(entrada.ultimaActividadEn));
  exigir(instante(entrada.caducaAbsolutaEn) && instante(entrada.caducaPorInactividadEn));
  exigir(entrada.ultimaActividadEn >= entrada.iniciadaEn && entrada.ultimaActividadEn < entrada.caducaAbsolutaEn);
  exigir(entrada.caducaAbsolutaEn === entrada.iniciadaEn + DURACION_MAXIMA_SESION_PANEL_MS);
  exigir(entrada.caducaPorInactividadEn === entrada.ultimaActividadEn + INACTIVIDAD_SESION_PANEL_MS);
  return {
    estado: 'activa',
    iniciadaEn: entrada.iniciadaEn,
    ultimaActividadEn: entrada.ultimaActividadEn,
    caducaPorInactividadEn: entrada.caducaPorInactividadEn,
    caducaAbsolutaEn: entrada.caducaAbsolutaEn,
  };
}
function inactiva(entrada: Record<string, unknown>): SesionPanelInactiva {
  claves(entrada, 'estado');
  exigir(entrada.estado === 'sustituida' || entrada.estado === 'caducada' || entrada.estado === 'cerrada');
  return { estado: entrada.estado };
}
export function leerEstadoSesionPanel(entrada: unknown): EstadoSesionPanel {
  const copia = objeto(entrada);
  return copia.estado === 'activa' ? activa(copia) : inactiva(copia);
}
function sesionActiva(entrada: unknown): SesionPanelActiva {
  const sesion = leerEstadoSesionPanel(entrada);
  exigir(sesion.estado === 'activa');
  return sesion;
}
export function leerResultadoLecturaControlesSesion(entrada: unknown): ResultadoLecturaControlesSesion {
  const copia = objeto(entrada);
  if (copia.estado !== 'activa') {
    return inactiva(copia);
  }
  claves(copia, 'controles,estado,sesion');
  return { estado: 'activa', sesion: sesionActiva(copia.sesion), controles: leerDocumentoControles(copia.controles) };
}
export function leerResultadoCambioControlesSesion(entrada: unknown): ResultadoCambioControlesSesion {
  const copia = objeto(entrada);
  if (copia.estado !== 'cambiado' && copia.estado !== 'conflicto') {
    return inactiva(copia);
  }
  claves(copia, 'controles,estado,sesion');
  return {
    estado: copia.estado,
    sesion: sesionActiva(copia.sesion),
    controles: leerDocumentoControles(copia.controles),
  };
}
