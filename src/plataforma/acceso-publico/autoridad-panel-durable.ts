import { esRutaRecorridoDurable, operarRecorridoDurable } from './recorrido-durable.ts';
import { esRutaSeccionesDurable, operarSeccionesDurable } from './secciones-durable.ts';
import type { AlmacenSesionRecorridoSqlite } from './sesion-recorrido-sqlite.ts';

export function esRutaAutoridadPanel(ruta: string): boolean {
  return esRutaRecorridoDurable(ruta) || esRutaSeccionesDurable(ruta);
}
export function operarAutoridadPanel(almacen: AlmacenSesionRecorridoSqlite, ruta: string, cuerpo: unknown) {
  return esRutaRecorridoDurable(ruta)
    ? operarRecorridoDurable(almacen, ruta, cuerpo)
    : operarSeccionesDurable(almacen, ruta, cuerpo);
}
