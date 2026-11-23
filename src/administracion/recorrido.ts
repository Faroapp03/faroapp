/** Contrato independiente del documento de secciones: una única elección global y una revisión. */
import {
  type AccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
  type SesionPanelInactiva,
} from './sesion.ts';
export type ModoRecorrido = 'real' | 'demo';
export interface DocumentoRecorrido {
  readonly version: 1;
  readonly revision: number;
  readonly modo: ModoRecorrido;
}
export type ResultadoRecorrido =
  | {
      readonly estado: 'activa' | 'cambiado' | 'conflicto';
      readonly sesion: SesionPanelActiva;
      readonly recorrido: DocumentoRecorrido;
    }
  | SesionPanelInactiva;
export interface AlmacenRecorrido {
  leerRecorrido(): Promise<DocumentoRecorrido>;
  leerRecorridoDeSesion(acceso: AccesoSesionPanel): Promise<ResultadoRecorrido>;
  cambiarRecorridoDeSesion(
    acceso: AccesoSesionPanel,
    revisionEsperada: number,
    modo: ModoRecorrido,
  ): Promise<ResultadoRecorrido>;
}

export function leerModo(valor: unknown): ModoRecorrido {
  if (valor !== 'real' && valor !== 'demo') {
    throw new Error('Modo de recorrido inválido');
  }
  return valor;
}

export function leerDocumentoRecorrido(valor: unknown): DocumentoRecorrido {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('Recorrido inválido');
  }
  const dato = valor as Record<string, unknown>;
  if (
    Object.keys(dato).sort().join(',') !== 'modo,revision,version' ||
    dato.version !== 1 ||
    typeof dato.revision !== 'number' ||
    !Number.isSafeInteger(dato.revision) ||
    dato.revision < 0
  ) {
    throw new Error('Recorrido inválido');
  }
  return { version: 1, revision: dato.revision, modo: leerModo(dato.modo) };
}

export function leerResultadoRecorrido(valor: unknown): ResultadoRecorrido {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('Resultado de recorrido inválido');
  }
  const dato = valor as Record<string, unknown>;
  if (dato.estado === 'activa' || dato.estado === 'cambiado' || dato.estado === 'conflicto') {
    if (Object.keys(dato).sort().join(',') !== 'estado,recorrido,sesion') {
      throw new Error('Resultado de recorrido inválido');
    }
    const sesion = leerEstadoSesionPanel(dato.sesion);
    if (sesion.estado !== 'activa') {
      throw new Error('Sesión de recorrido inválida');
    }
    return { estado: dato.estado, sesion, recorrido: leerDocumentoRecorrido(dato.recorrido) };
  }
  const sesion = leerEstadoSesionPanel(dato);
  if (sesion.estado === 'activa') {
    throw new Error('Resultado de recorrido inválido');
  }
  return sesion;
}
