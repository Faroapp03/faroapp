/** Disponibilidad en la autoridad existente de controles, con su misma revisión y sesión. */
import { type DocumentoSecciones, leerDocumentoSecciones, type PoliticaSecciones } from './secciones-web.js';
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';

export interface AlmacenSecciones {
  /** null indica que los controles nunca se adoptaron; un fallo no es una política inicial. */
  leerSecciones(): Promise<DocumentoSecciones | null>;
}
export type ResultadoLecturaSeccionesSesion =
  | { readonly estado: 'activa'; readonly sesion: SesionPanelActiva; readonly secciones: DocumentoSecciones }
  | SesionPanelInactiva;
export type ResultadoCambioSeccionesSesion =
  | {
      readonly estado: 'cambiado' | 'conflicto';
      readonly sesion: SesionPanelActiva;
      readonly secciones: DocumentoSecciones;
    }
  | SesionPanelInactiva;
export interface AlmacenSeccionesPanel extends AlmacenSecciones {
  leerSeccionesDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaSeccionesSesion>;
  cambiarSeccionesDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    secciones: PoliticaSecciones,
  ): Promise<ResultadoCambioSeccionesSesion>;
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Resultado de secciones administrativas no válido');
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
function contenido(copia: Record<string, unknown>) {
  exigir(Object.keys(copia).sort().join(',') === 'estado,secciones,sesion');
  const sesion = leerEstadoSesionPanel(copia.sesion);
  exigir(sesion.estado === 'activa');
  return { sesion, secciones: leerDocumentoSecciones(copia.secciones) };
}
function inactiva(copia: Record<string, unknown>): SesionPanelInactiva {
  const sesion = leerEstadoSesionPanel(copia);
  exigir(sesion.estado !== 'activa');
  return sesion;
}
export function leerResultadoLecturaSeccionesSesion(entrada: unknown): ResultadoLecturaSeccionesSesion {
  const copia = objeto(entrada);
  return copia.estado === 'activa' ? { estado: 'activa', ...contenido(copia) } : inactiva(copia);
}
export function leerResultadoCambioSeccionesSesion(entrada: unknown): ResultadoCambioSeccionesSesion {
  const copia = objeto(entrada);
  return copia.estado === 'cambiado' || copia.estado === 'conflicto'
    ? { estado: copia.estado, ...contenido(copia) }
    : inactiva(copia);
}
