/**
 * El cierre sin recibo: lo que el supervisor envía cuando el motor no deja un recibo válido, o lo deja rechazado por
 * falta de tiempo. Solo lleva la reserva a la que responde y por qué no terminó, con su causa y su paso de listas
 * cerradas; nunca mensajes, rutas ni identificadores del ciclo. Viaja por la misma ruta autenticada que el recibo.
 */

import type { AccionActualizacion } from './ejecutor-github.ts';
import {
  accion,
  exigirTrabajo,
  leerReferenciaTrabajo,
  leerUltimoFallo,
  objetoTrabajo,
  type ReferenciaTrabajo,
  type UltimoFallo,
} from './estado-trabajos.js';

export interface CierreSinRecibo extends ReferenciaTrabajo {
  readonly accion: AccionActualizacion;
  readonly ultimoFallo: UltimoFallo;
}
const CAMPOS = 'accion,revisionReserva,solicitudId,ultimoFallo';

/** Distingue el cierre de un recibo por su forma: el recibo siempre declara su versión y el cierre nunca. */
export function esCierreSinRecibo(entrada: unknown): boolean {
  return (
    entrada !== null && typeof entrada === 'object' && Object.getOwnPropertyNames(entrada).sort().join(',') === CAMPOS
  );
}
export function leerCierreSinRecibo(entrada: unknown): CierreSinRecibo {
  const o = objetoTrabajo(entrada, CAMPOS);
  const referencia = leerReferenciaTrabajo({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
  exigirTrabajo(accion(o.accion));
  const ultimoFallo = leerUltimoFallo(o.ultimoFallo);
  // `sin-resultado` lo deduce solo el servidor, de la evidencia de GitHub; el supervisor siempre sabe su causa.
  exigirTrabajo(ultimoFallo.causa !== 'sin-resultado');
  return Object.freeze({ ...referencia, accion: o.accion, ultimoFallo });
}
