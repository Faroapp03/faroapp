/** Tamaños y rutas del protocolo privado del enlace del entorno. */
import { MAX_RESPUESTA_ADMINISTRADORES, RUTAS_ADMINISTRADORES_DURABLE } from '../../administracion/administradores.ts';
import { MAX_OBSERVACION_DATOS_BYTES } from '../../administracion/datos-trabajo.ts';
import { MAX_RESPUESTA_REGISTRO_PANEL, RUTA_REGISTRO_PANEL_DURABLE } from '../../administracion/sesion-unica.ts';
import { esRutaEncuestaDurable, MAX_RESPUESTA_ENCUESTA } from '../../encuesta/protocolo-durable.ts';
import { esRutaAccesosDurable, MAX_RESPUESTA_ACCESOS } from './accesos-durable.ts';
import {
  esRutaActivacionDurable,
  MAX_MENSAJE_ACTIVACION_DURABLE,
  MAX_RESPUESTA_ACTIVACION_DURABLE,
} from './activacion-durable.ts';
import { MAX_RESPUESTA_DATOS_PANEL_DURABLE, RUTA_DATOS_PANEL } from './datos-panel-durable.ts';
import { esRutaInstitucionesDurable, MAX_RESPUESTA_INSTITUCIONES } from './instituciones-durable.ts';
import {
  esRutaTrabajosDurable,
  MAX_MENSAJE_RECIBO_DURABLE,
  MAX_MENSAJE_TRABAJO_DURABLE,
  MAX_RESPUESTA_TRABAJO_DURABLE,
} from './trabajos-durable.ts';
import { esRutaVigilanteDurable, MAX_RESPUESTA_VIGILANTE } from './vigilante-durable.ts';

const MAX_MENSAJE = 16_384;
export const MAX_RESPUESTA = 2048;
export const PLAZO_LECTURA_MS = 2000;
export const PLAZO_CLIENTE_MS = 3000;
export const MAX_PLAZO_MS = 30_000;
export function esRutaEjecucion(ruta: string): boolean {
  return esRutaTrabajosDurable(ruta) || esRutaActivacionDurable(ruta);
}
/** Lecturas del panel que devuelven listas completas: el registro de accesos y la lista de administradores. */
const SALIDAS_DEL_PANEL: ReadonlyMap<string, number> = new Map([
  [RUTA_REGISTRO_PANEL_DURABLE, MAX_RESPUESTA_REGISTRO_PANEL],
  [RUTAS_ADMINISTRADORES_DURABLE.leer, MAX_RESPUESTA_ADMINISTRADORES],
  [RUTAS_ADMINISTRADORES_DURABLE.cambiar, MAX_RESPUESTA_ADMINISTRADORES],
]);
function salidaDeTrabajos(ruta: string): number {
  if (ruta === '/trabajos/datos') {
    return MAX_OBSERVACION_DATOS_BYTES;
  }
  return ruta === RUTA_DATOS_PANEL ? MAX_RESPUESTA_DATOS_PANEL_DURABLE : MAX_RESPUESTA_TRABAJO_DURABLE;
}
export function limitesMensajes(ruta: string): { entrada: number; salida: number } {
  if (esRutaVigilanteDurable(ruta)) {
    return { entrada: MAX_MENSAJE, salida: MAX_RESPUESTA_VIGILANTE };
  }
  if (esRutaAccesosDurable(ruta)) {
    return { entrada: MAX_MENSAJE, salida: MAX_RESPUESTA_ACCESOS };
  }
  if (esRutaInstitucionesDurable(ruta)) {
    return { entrada: MAX_MENSAJE, salida: MAX_RESPUESTA_INSTITUCIONES };
  }
  if (esRutaEncuestaDurable(ruta)) {
    return { entrada: MAX_MENSAJE, salida: MAX_RESPUESTA_ENCUESTA };
  }
  if (esRutaActivacionDurable(ruta)) {
    return { entrada: MAX_MENSAJE_ACTIVACION_DURABLE, salida: MAX_RESPUESTA_ACTIVACION_DURABLE };
  }
  if (esRutaTrabajosDurable(ruta)) {
    return {
      entrada: ruta === '/trabajos/recibo' ? MAX_MENSAJE_RECIBO_DURABLE : MAX_MENSAJE_TRABAJO_DURABLE,
      salida: salidaDeTrabajos(ruta),
    };
  }
  const salidaDelPanel = SALIDAS_DEL_PANEL.get(ruta);
  if (salidaDelPanel !== undefined) {
    return { entrada: MAX_MENSAJE, salida: salidaDelPanel };
  }
  return { entrada: MAX_MENSAJE, salida: MAX_RESPUESTA };
}
