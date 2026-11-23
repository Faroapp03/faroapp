/** Coordinación común: lectura fuera de transacción, con cortes y efectos decididos por la autoridad llamadora. */
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { type LectorEstadoDatosPanel, leerEstadoDatosPanel } from '../../administracion/estado-datos.js';
import { validarDatosVigilante, validarRelojVigilante } from '../../administracion/vigilante.ts';

type Datos = ReturnType<typeof leerEstadoDatosPanel>;
export interface OpcionesLecturaVigilante<T> {
  readonly configuracion: ConfiguracionVigilante;
  readonly reloj: () => number;
  readonly senal: AbortSignal;
  readonly lector: LectorEstadoDatosPanel;
  /** Devuelve un resultado terminal cuando la autoridad no admite continuar. */
  readonly preparar: (ahora: number) => Promise<T | undefined>;
  readonly confirmar: (datos: Datos, ahora: number) => Promise<T>;
  readonly fallo: (error: unknown, ahora: number) => Promise<T>;
}
function corte<T>(opciones: OpcionesLecturaVigilante<T>): number {
  const ahora = opciones.reloj();
  validarRelojVigilante(opciones.configuracion, ahora);
  return ahora;
}
export async function leerYComprobarVigilante<T>(opciones: OpcionesLecturaVigilante<T>): Promise<T> {
  const { senal, lector } = opciones;
  senal.throwIfAborted();
  const temprano = await opciones.preparar(corte(opciones));
  if (temprano !== undefined) {
    return temprano;
  }
  senal.throwIfAborted();
  let datos: Datos;
  try {
    datos = leerEstadoDatosPanel(await lector(senal));
    senal.throwIfAborted();
  } catch (error) {
    return opciones.fallo(error, corte(opciones));
  }
  // Solo el DTO inválido pertenece al fallo de lectura; un reloj inválido no lo es.
  const ahora = corte(opciones);
  try {
    validarDatosVigilante(datos, ahora);
  } catch (error) {
    return opciones.fallo(error, ahora);
  }
  return opciones.confirmar(datos, ahora);
}
