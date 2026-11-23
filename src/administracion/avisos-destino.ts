/**
 * El contrato del destino de los avisos de mantenimiento: a qué dirección de correo se avisa y si está confirmada.
 * La autoridad es una fila del objeto durable con SQLite (plataforma/acceso-publico/avisos-destino-sqlite.ts). La
 * dirección completa solo sale en dos lecturas: la del panel dentro de la sesión administrativa y la del envío dentro
 * del servidor. Cambiar o quitar responden con el resumen, que dice cómo está el destino sin la dirección.
 */
import { leerDestinoCorreo } from './destino-correo.ts';
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';
import { type EstadoAvisosPanel, leerEstadoAvisosPanel } from './vigilante-panel.js';

/** Sin dirección; con una dirección que todavía no ha confirmado quien la recibe; o con la dirección confirmada. */
export type VerificacionDestino = 'sin_destino' | 'pendiente' | 'verificado';
export interface DestinoAvisos {
  readonly version: 1;
  readonly correo: string | null;
  /** Sube con cada cambio: quien cambia dice qué revisión ha visto y no pisa un cambio que no conoce. */
  readonly revision: number;
  /** Milisegundos desde 1970 del último cambio; nulo mientras nadie lo ha cambiado nunca. */
  readonly cambiadoEn: number | null;
  readonly verificacion: VerificacionDestino;
}
export type ResumenDestinoAvisos = Omit<DestinoAvisos, 'correo'>;
/** `avisos`: el estado de cada canal y de las comprobaciones, sin la dirección; lo añade el objeto durable. */
export type ResultadoLecturaDestino =
  | {
      readonly estado: 'activa';
      readonly sesion: SesionPanelActiva;
      readonly destino: DestinoAvisos;
      readonly avisos?: EstadoAvisosPanel;
    }
  | SesionPanelInactiva;
export type ResultadoCambioDestino =
  | {
      readonly estado: 'cambiado' | 'conflicto';
      readonly sesion: SesionPanelActiva;
      readonly destino: ResumenDestinoAvisos;
    }
  | SesionPanelInactiva;
/** La sesión y la revisión se comprueban en la misma transacción que la lectura o el cambio. */
export interface AlmacenAvisosDestinoPanel {
  leerDestinoAvisosDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoLecturaDestino>;
  cambiarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    correo: string,
  ): Promise<ResultadoCambioDestino>;
  quitarDestinoAvisosDeSesion(acceso: AccesoSesionPanel, revisionEsperada: number): Promise<ResultadoCambioDestino>;
  /**
   * Deja la dirección `verificado` por evidencia: un aviso de prueba enviado a esa dirección y esa revisión ha sido
   * aceptado por el enlace. Si la dirección o la revisión ya no son las vigentes, responde conflicto y no cambia nada.
   * La revisión no sube: la dirección es la misma y quien la había visto puede seguir cambiándola.
   */
  verificarDestinoAvisosDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    correo: string,
  ): Promise<ResultadoCambioDestino>;
}
export interface AlmacenAvisosDestino extends AlmacenAvisosDestinoPanel {
  /** La lectura del envío, sin sesión: solo la usa el servidor para saber a quién avisar. */
  leerDestinoParaAvisar(): Promise<DestinoAvisos>;
}

export const DESTINO_INICIAL: DestinoAvisos = Object.freeze({
  version: 1,
  correo: null,
  revision: 0,
  cambiadoEn: null,
  verificacion: 'sin_destino',
});

export class DestinoAvisosInvalido extends Error {
  override readonly name = 'DestinoAvisosInvalido';
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new DestinoAvisosInvalido('Destino de avisos no válido');
  }
}
function objeto(valor: unknown, claves: string): Record<string, unknown> {
  exigir(valor !== null && typeof valor === 'object' && !Array.isArray(valor));
  exigir(Object.keys(valor).sort().join(',') === claves);
  return valor as Record<string, unknown>;
}
export function esRevisionDestino(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
/** El resumen coherente: sin cambios no hay fecha, y la fecha no es anterior a 1970. */
function leerResumen(dato: Record<string, unknown>): ResumenDestinoAvisos {
  const { version, revision, cambiadoEn, verificacion } = dato;
  exigir(version === 1 && esRevisionDestino(revision));
  exigir(verificacion === 'sin_destino' || verificacion === 'pendiente' || verificacion === 'verificado');
  exigir(revision === 0 ? cambiadoEn === null : esRevisionDestino(cambiadoEn));
  return { version, revision, cambiadoEn: cambiadoEn as number | null, verificacion };
}
/** Hay dirección si y solo si el estado no es «sin destino», y la dirección guardada cumple la misma validación. */
export function leerDestinoAvisos(valor: unknown): DestinoAvisos {
  const dato = objeto(valor, 'cambiadoEn,correo,revision,verificacion,version');
  const resumen = leerResumen(dato);
  if (resumen.verificacion === 'sin_destino') {
    exigir(dato.correo === null);
    return { ...resumen, correo: null };
  }
  exigir(typeof dato.correo === 'string' && leerDestinoCorreo(dato.correo) === dato.correo);
  return { ...resumen, correo: dato.correo };
}
export function leerResumenDestinoAvisos(valor: unknown): ResumenDestinoAvisos {
  return leerResumen(objeto(valor, 'cambiadoEn,revision,verificacion,version'));
}
export function resumenDe({ version, revision, cambiadoEn, verificacion }: DestinoAvisos): ResumenDestinoAvisos {
  return { version, revision, cambiadoEn, verificacion };
}
function sesionActiva(valor: unknown): SesionPanelActiva {
  const sesion = leerEstadoSesionPanel(valor);
  exigir(sesion.estado === 'activa');
  return sesion;
}
function sesionInactiva(valor: unknown): SesionPanelInactiva {
  const sesion = leerEstadoSesionPanel(valor);
  exigir(sesion.estado !== 'activa');
  return sesion;
}
export function leerResultadoLecturaDestino(valor: unknown): ResultadoLecturaDestino {
  exigir(valor !== null && typeof valor === 'object' && !Array.isArray(valor));
  const dato = valor as Record<string, unknown>;
  if (dato.estado === 'activa') {
    // El estado de los avisos se decide por su presencia: una lectura sin él sigue siendo válida.
    const conAvisos = Object.hasOwn(dato, 'avisos');
    objeto(dato, conAvisos ? 'avisos,destino,estado,sesion' : 'destino,estado,sesion');
    const lectura = {
      estado: 'activa',
      sesion: sesionActiva(dato.sesion),
      destino: leerDestinoAvisos(dato.destino),
    } as const;
    return conAvisos ? { ...lectura, avisos: leerEstadoAvisosPanel(dato.avisos) } : lectura;
  }
  return sesionInactiva(valor);
}
export function leerResultadoCambioDestino(valor: unknown): ResultadoCambioDestino {
  exigir(valor !== null && typeof valor === 'object' && !Array.isArray(valor));
  const dato = valor as Record<string, unknown>;
  if (dato.estado === 'cambiado' || dato.estado === 'conflicto') {
    objeto(dato, 'destino,estado,sesion');
    return { estado: dato.estado, sesion: sesionActiva(dato.sesion), destino: leerResumenDestinoAvisos(dato.destino) };
  }
  return sesionInactiva(valor);
}
