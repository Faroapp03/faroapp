/**
 * Protocolo de la lectura que enseña el panel en «Fuentes»: la observación del último trabajo o, mientras corre otra
 * actualización, la última admitida con su marca. Va por el enlace privado del entorno, como el resto de trabajos.
 */
import { leerObservacionDatosTrabajo, MAX_OBSERVACION_DATOS_BYTES } from '../../administracion/datos-trabajo.ts';
import { exigirTrabajo, objetoTrabajo } from '../../administracion/trabajos.ts';
import type { ObservacionDelPanel } from './datos-trabajo-sqlite.ts';

export const RUTA_DATOS_PANEL = '/trabajos/datos-panel';
/** La observación más el sobre que la acompaña con su marca. */
export const MAX_RESPUESTA_DATOS_PANEL_DURABLE =
  MAX_OBSERVACION_DATOS_BYTES + JSON.stringify({ observacion: null, deLaActualizacionAnterior: false }).length;

export interface AlmacenDatosDelPanel {
  leerDatosDelPanel(): Promise<ObservacionDelPanel | null>;
}
/** La respuesta del objeto durable, con la observación y la marca comprobadas; null si aún no hay ninguna. */
export function leerDatosDelPanelDurable(entrada: unknown): ObservacionDelPanel | null {
  if (entrada === null) {
    return null;
  }
  const o = objetoTrabajo(entrada, 'deLaActualizacionAnterior,observacion');
  exigirTrabajo(typeof o.deLaActualizacionAnterior === 'boolean');
  return {
    observacion: leerObservacionDatosTrabajo(o.observacion),
    deLaActualizacionAnterior: o.deLaActualizacionAnterior,
  };
}
