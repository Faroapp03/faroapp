/** Fila de la sesión administrativa global: validación estricta y estado que corresponde a cada acceso. */
import {
  type AccesoSesionPanel,
  DURACION_MAXIMA_SESION_PANEL_MS,
  type EstadoSesionPanel,
  INACTIVIDAD_SESION_PANEL_MS,
  leerAccesoSesionPanel,
  leerEstadoSesionPanel,
  type SesionPanelActiva,
} from '../../administracion/sesion.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

export interface FilaSesion {
  readonly huellaSesion: string | null;
  readonly huellaPrincipal: string | null;
  readonly iniciada: number | null;
  readonly actividad: number | null;
  readonly cerrada: boolean;
  readonly reloj: number;
}
export function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Estado de sesión administrativa no válido');
  }
}
export function instante(entrada: unknown): entrada is number {
  return typeof entrada === 'number' && Number.isSafeInteger(entrada) && entrada >= 0;
}
export function existeTabla(sql: SqlAccesoPublico): boolean {
  return sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_sesion'").length === 1;
}
export function validarFila(fila: FilaSql): FilaSesion {
  exigir(
    Object.keys(fila).sort().join(',') === 'actividad,cerrada,huella_principal,huella_sesion,id,iniciada,reloj,version',
  );
  exigir(fila.id === 1 && fila.version === 1 && (fila.cerrada === 0 || fila.cerrada === 1) && instante(fila.reloj));
  if (fila.huella_sesion === null) {
    exigir(fila.huella_principal === null && fila.iniciada === null && fila.actividad === null && fila.cerrada === 1);
    return {
      huellaSesion: null,
      huellaPrincipal: null,
      iniciada: null,
      actividad: null,
      cerrada: true,
      reloj: fila.reloj,
    };
  }
  const acceso = leerAccesoSesionPanel({ huellaSesion: fila.huella_sesion, huellaPrincipal: fila.huella_principal });
  exigir(instante(fila.iniciada) && instante(fila.actividad) && fila.reloj >= fila.actividad);
  crearActiva(fila.iniciada, fila.actividad);
  return {
    ...acceso,
    iniciada: fila.iniciada,
    actividad: fila.actividad,
    cerrada: fila.cerrada === 1,
    reloj: fila.reloj,
  };
}
export function crearActiva(iniciada: number, actividad: number): SesionPanelActiva {
  const estado = leerEstadoSesionPanel({
    estado: 'activa',
    iniciadaEn: iniciada,
    ultimaActividadEn: actividad,
    caducaPorInactividadEn: actividad + INACTIVIDAD_SESION_PANEL_MS,
    caducaAbsolutaEn: iniciada + DURACION_MAXIMA_SESION_PANEL_MS,
  });
  exigir(estado.estado === 'activa');
  return estado;
}
export function comprobarAcceso(fila: FilaSesion, acceso: AccesoSesionPanel, ahora: number): EstadoSesionPanel {
  if (fila.huellaSesion === null) {
    return { estado: 'cerrada' };
  }
  if (fila.huellaSesion !== acceso.huellaSesion || fila.huellaPrincipal !== acceso.huellaPrincipal) {
    return { estado: 'sustituida' };
  }
  if (fila.cerrada) {
    return { estado: 'cerrada' };
  }
  exigir(fila.iniciada !== null && fila.actividad !== null);
  const estado = crearActiva(fila.iniciada, fila.actividad);
  return ahora >= Math.min(estado.caducaAbsolutaEn, estado.caducaPorInactividadEn) ? { estado: 'caducada' } : estado;
}
