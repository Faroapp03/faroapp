/**
 * Operaciones de programación de los dos almacenes administrativos: la autoridad SQLite y su cliente durable.
 * Cada lado valida la entrada al cruzar su frontera; el reloj y la transacción los pone el almacén que llama.
 */
import {
  type FalloProgramado,
  leerFalloProgramado,
  leerResultadoFalloProgramado,
  type ResultadoFalloProgramado,
} from '../../administracion/fallo-programado.ts';
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from '../../administracion/oidc-github.ts';
import {
  leerResultadoReservaTrabajoProgramado,
  leerSolicitudTrabajoProgramado,
  type ResultadoReservaTrabajoProgramado,
  type SolicitudTrabajoProgramado,
} from '../../administracion/programacion-trabajos.ts';
import { registrarFalloProgramadoSqlite, reservarProgramacionSqlite } from './programacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

export const RUTA_FALLO_PROGRAMADO = '/trabajos/programada/fallo';
/** Ejecuta dentro de la transacción del almacén, con su reloj ya comprobado. */
export type EnTransaccion = <T>(accion: (ahora: number) => T) => T;
export type EnviarDurable = <T>(ruta: string, cuerpo: unknown, leer: (valor: unknown) => T | undefined) => Promise<T>;

export function reservarProgramadaSqlite(
  sql: SqlAccesoPublico,
  enTransaccion: EnTransaccion,
  entrada: SolicitudTrabajoProgramado,
  entradaConfianza: ConfianzaOidcGitHub,
): ResultadoReservaTrabajoProgramado {
  const solicitud = leerSolicitudTrabajoProgramado(entrada);
  const confianza = leerConfianzaOidcGitHub(entradaConfianza);
  return enTransaccion((ahora) => reservarProgramacionSqlite(sql, solicitud, confianza, ahora));
}
export function registrarFalloSqlite(
  sql: SqlAccesoPublico,
  enTransaccion: EnTransaccion,
  entrada: FalloProgramado,
): ResultadoFalloProgramado {
  const fallo = leerFalloProgramado(entrada);
  return enTransaccion((ahora) => registrarFalloProgramadoSqlite(sql, fallo, ahora));
}
export function reservarProgramadaDurable(
  enviar: EnviarDurable,
  entrada: SolicitudTrabajoProgramado,
  entradaConfianza: ConfianzaOidcGitHub,
): Promise<ResultadoReservaTrabajoProgramado> {
  const solicitud = leerSolicitudTrabajoProgramado(entrada);
  const confianza = leerConfianzaOidcGitHub(entradaConfianza);
  return enviar('/trabajos/programada', { solicitud, confianza }, leerResultadoReservaTrabajoProgramado);
}
export function registrarFalloDurable(enviar: EnviarDurable, entrada: FalloProgramado) {
  return enviar(RUTA_FALLO_PROGRAMADO, { fallo: leerFalloProgramado(entrada) }, leerResultadoFalloProgramado);
}
