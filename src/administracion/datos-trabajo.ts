/** Observación privada de datos correlacionada con el recibo; nunca activa una generación. */
import { type CatalogoPrivado, leerCatalogoPrivado, MAX_CATALOGO_PRIVADO_BYTES } from './catalogo-privado.js';
import { type EstadoDatosPanel, leerEstadoDatosPanel } from './estado-datos.js';
import { exigirTrabajo, leerReciboTrabajo, objetoTrabajo, type ReciboTrabajo } from './trabajos.ts';

export const MAX_DATOS_TRABAJO_BYTES = 131_072;
const MAX_OBSERVACION_ANTERIOR_BYTES = 135_168;
export const MAX_OBSERVACION_DATOS_BYTES = MAX_OBSERVACION_ANTERIOR_BYTES + MAX_CATALOGO_PRIVADO_BYTES;
const FIN_SEGUNDOS_ISO = 19;
const RESTO_SEGUNDO_MS = 999;
export interface ObservacionDatosTrabajo {
  readonly version: 1 | 2;
  readonly recibo: ReciboTrabajo;
  readonly huellaRecibo: string;
  readonly datos: EstadoDatosPanel;
  readonly catalogo?: CatalogoPrivado | null;
}
function comprobarTamano(valor: EstadoDatosPanel | ObservacionDatosTrabajo, maximo: number): void {
  // Solo se serializan copias cerradas por los lectores: ningún accesor o toJSON de la entrada.
  exigirTrabajo(new TextEncoder().encode(JSON.stringify(valor)).byteLength <= maximo);
}
/** Misma semántica para el receptor y los almacenes; null solo acredita un rechazo sin observación. */
export function leerDatosDeRecibo(entradaRecibo: ReciboTrabajo, entradaEstado: unknown): EstadoDatosPanel | null {
  const recibo = leerReciboTrabajo(entradaRecibo);
  const estado = entradaEstado === null ? null : leerEstadoDatosPanel(entradaEstado);
  if (estado) {
    comprobarTamano(estado, MAX_DATOS_TRABAJO_BYTES);
    // El cierre del recibo tiene precisión de segundos; la copia fijada v2 conserva microsegundos.
    exigirTrabajo(estado.observadoEn.slice(0, FIN_SEGUNDOS_ISO) <= recibo.terminadoEn.slice(0, FIN_SEGUNDOS_ISO));
  }
  if (recibo.resultado === 'validado') {
    exigirTrabajo(estado?.modulos.find((m) => m.id === 'paquete')?.veredicto === 'verde');
    // Un módulo en rojo no puede quedar en un paquete publicado: ningún candidato con él es válido.
    exigirTrabajo(estado?.modulos.every((m) => m.veredicto !== 'rojo') === true);
  } else if (recibo.resultado === 'sin-pendientes') {
    exigirTrabajo(recibo.accion !== 'actualizar-datos' && estado !== null);
  } else if (recibo.error === 'actualizacion_no_admitida') {
    exigirTrabajo(estado !== null && recibo.veredicto !== null);
  } else {
    exigirTrabajo(estado === null && recibo.veredicto === null);
  }
  return estado;
}
/** Copia íntegra, cerrada e inmutable: recibo, hash del cuerpo autenticado y copia fijada validada. */
export function leerObservacionDatosTrabajo(entrada: unknown): ObservacionDatosTrabajo {
  const descriptor =
    typeof entrada === 'object' && entrada !== null ? Object.getOwnPropertyDescriptor(entrada, 'version') : null;
  const version = descriptor && 'value' in descriptor ? descriptor.value : null;
  const o = objetoTrabajo(
    entrada,
    version === 2 ? 'catalogo,datos,huellaRecibo,recibo,version' : 'datos,huellaRecibo,recibo,version',
  );
  exigirTrabajo(o.version === 1 || o.version === 2);
  exigirTrabajo(typeof o.huellaRecibo === 'string' && /^[0-9a-f]{64}$/.test(o.huellaRecibo));
  const recibo = leerReciboTrabajo(o.recibo);
  const datos = leerDatosDeRecibo(recibo, o.datos);
  exigirTrabajo(datos !== null);
  const observacion: ObservacionDatosTrabajo = Object.freeze({
    version: o.version,
    ...(o.version === 2 ? { catalogo: leerCatalogoDeRecibo(recibo, o.catalogo) } : {}),
    recibo,
    huellaRecibo: o.huellaRecibo,
    datos,
  });
  comprobarTamano(observacion, o.version === 1 ? MAX_OBSERVACION_ANTERIOR_BYTES : MAX_OBSERVACION_DATOS_BYTES);
  return observacion;
}

/** La copia fijada puede ser anterior al recibo; nunca se rejuvenece para acompañarlo. */
export function leerCatalogoDeRecibo(recibo: ReciboTrabajo, entrada: unknown): CatalogoPrivado | null {
  if (entrada === null) {
    return null;
  }
  const catalogo = leerCatalogoPrivado(entrada);
  const fin = Date.parse(recibo.terminadoEn) + RESTO_SEGUNDO_MS;
  for (const fecha of [
    catalogo.corteRegistro,
    catalogo.corteProyeccion,
    ...catalogo.referencias.map((r) => r.fecha),
    ...catalogo.unidades.flatMap((u) => [u.comprobadoEl, u.evaluadoEl, u.ultimoIntentoEl, u.ultimoFinEl]),
  ]) {
    exigirTrabajo(fecha === null || Date.parse(fecha) <= fin);
  }
  return catalogo;
}
