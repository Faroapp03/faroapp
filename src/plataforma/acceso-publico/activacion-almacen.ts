/**
 * Operaciones de activación de los dos almacenes administrativos: la autoridad SQLite y su cliente durable. Cada lado
 * valida la entrada al cruzar su frontera; el reloj y la transacción los pone el almacén que llama.
 */
import {
  type AlmacenRecuperacionActivacion,
  leerEvidenciaIntentoActivacion,
  leerRegistroPasoActivacion,
  leerSolicitudActivacion,
  leerSolicitudReservaActivacion,
  type ResultadoTransicionActivacion,
} from '../../administracion/activacion.ts';
import {
  type AlmacenCierreActivacion,
  leerRegistroCierreActivacion,
  leerSolicitudCierreActivacion,
  type SolicitudCierreActivacion,
} from '../../administracion/cierre-activacion.ts';
import {
  leerPasoRecuperacionActivacionDurable,
  leerPasoRegistradoActivacionDurable,
  leerRecuperacionActivacionDurable,
  leerReservaActivacionDurable,
} from './activacion-durable.ts';
import { registrarPasoActivacionSqlite, registrarPasoRecuperacionActivacionSqlite } from './activacion-sqlite.ts';
import { leerCierreCumplidoDurable, leerSolicitudCierreDurable } from './cierre-activacion-durable.ts';
import { cerrarActivacionSolicitadaSqlite, solicitarCierreActivacionSqlite } from './cierre-activacion-sqlite.ts';
import type { EnTransaccion, EnviarDurable } from './programacion-almacen.ts';
import { recuperarActivacionSqlite } from './recuperacion-activacion-sqlite.ts';
import { reservarActivacionConReintentoSqlite } from './reintento-activacion-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { leerIdentidadTrabajoDurable } from './trabajos-durable.ts';

export type ArgumentosReserva = Parameters<AlmacenRecuperacionActivacion['reservarActivacion']>;
export type ArgumentosRecuperacion = Parameters<AlmacenRecuperacionActivacion['recuperarActivacion']>;
export type ArgumentosCierre = Parameters<AlmacenCierreActivacion['cerrarActivacionSolicitada']>;
export type { SolicitudCierreActivacion };
export type ArgumentosPaso = Parameters<AlmacenRecuperacionActivacion['registrarPasoActivacion']>;
/** El almacén SQLite: su autoridad y la transacción con su reloj. */
export interface ActivacionEnSqlite {
  readonly sql: SqlAccesoPublico;
  readonly enTransaccion: EnTransaccion;
}

export function reservarActivacionEnSqlite(
  { sql, enTransaccion }: ActivacionEnSqlite,
  ...[entrada, identidad]: ArgumentosReserva
): ResultadoTransicionActivacion {
  return enTransaccion((ahora) => reservarActivacionConReintentoSqlite(sql, entrada, identidad, ahora));
}
export function recuperarActivacionEnSqlite(
  { sql, enTransaccion }: ActivacionEnSqlite,
  ...[entrada, identidad, anterior]: ArgumentosRecuperacion
): ResultadoTransicionActivacion {
  const solicitud = leerSolicitudActivacion(entrada);
  const evidencia = leerEvidenciaIntentoActivacion(anterior);
  return enTransaccion((ahora) => recuperarActivacionSqlite(sql, solicitud, { identidad, anterior: evidencia }, ahora));
}
/** Un paso de la ejecución que manda en la activación, en su primer intento o en el relevo vigente. */
export function registrarPasoEnSqlite(
  { sql, enTransaccion }: ActivacionEnSqlite,
  relevo: boolean,
  ...[entrada, identidad]: ArgumentosPaso
): ResultadoTransicionActivacion {
  const registro = leerRegistroPasoActivacion(entrada);
  const registrar = relevo ? registrarPasoRecuperacionActivacionSqlite : registrarPasoActivacionSqlite;
  return enTransaccion((ahora) => registrar(sql, registro, identidad, ahora));
}
export function reservarActivacionEnDurable(
  enviar: EnviarDurable,
  ...[entrada, identidad]: ArgumentosReserva
): Promise<ResultadoTransicionActivacion> {
  const solicitud = leerSolicitudReservaActivacion(entrada);
  const comprobada = leerIdentidadTrabajoDurable(identidad);
  return enviar('/activacion/reservar', { solicitud, identidad: comprobada }, (valor) =>
    leerReservaActivacionDurable(valor, solicitud),
  );
}
export function recuperarActivacionEnDurable(
  enviar: EnviarDurable,
  ...[entrada, identidad, anterior]: ArgumentosRecuperacion
): Promise<ResultadoTransicionActivacion> {
  const solicitud = leerSolicitudActivacion(entrada);
  const comprobada = leerIdentidadTrabajoDurable(identidad);
  const evidencia = leerEvidenciaIntentoActivacion(anterior);
  return enviar('/activacion/recuperar', { solicitud, identidad: comprobada, anterior: evidencia }, (valor) =>
    leerRecuperacionActivacionDurable(valor, solicitud, comprobada, evidencia),
  );
}
export function registrarPasoEnDurable(
  enviar: EnviarDurable,
  relevo: boolean,
  ...[entrada, identidad]: ArgumentosPaso
): Promise<ResultadoTransicionActivacion> {
  const registro = leerRegistroPasoActivacion(entrada);
  const comprobada = leerIdentidadTrabajoDurable(identidad);
  const cuerpo = { registro, identidad: comprobada };
  return relevo
    ? enviar('/activacion/paso-recuperacion', cuerpo, (valor) =>
        leerPasoRecuperacionActivacionDurable(valor, registro, comprobada),
      )
    : enviar('/activacion/paso', cuerpo, (valor) => leerPasoRegistradoActivacionDurable(valor, registro));
}
export function solicitarCierreEnSqlite(
  { sql, enTransaccion }: ActivacionEnSqlite,
  entrada: SolicitudCierreActivacion,
): ResultadoTransicionActivacion {
  const solicitud = leerSolicitudCierreActivacion(entrada);
  return enTransaccion((ahora) => solicitarCierreActivacionSqlite(sql, solicitud, ahora));
}
export function cerrarSolicitadaEnSqlite(
  { sql, enTransaccion }: ActivacionEnSqlite,
  ...[entrada, identidad, anterior]: ArgumentosCierre
): ResultadoTransicionActivacion {
  const registro = leerRegistroCierreActivacion(entrada);
  const fin = leerEvidenciaIntentoActivacion(anterior);
  return enTransaccion((ahora) => cerrarActivacionSolicitadaSqlite(sql, registro, { identidad, fin }, ahora));
}
export function solicitarCierreEnDurable(
  enviar: EnviarDurable,
  entrada: SolicitudCierreActivacion,
): Promise<ResultadoTransicionActivacion> {
  const solicitud = leerSolicitudCierreActivacion(entrada);
  return enviar('/activacion/cierre/solicitar', { solicitud }, (valor) => leerSolicitudCierreDurable(valor, solicitud));
}
export function cerrarSolicitadaEnDurable(
  enviar: EnviarDurable,
  ...[entrada, identidad, anterior]: ArgumentosCierre
): Promise<ResultadoTransicionActivacion> {
  const registro = leerRegistroCierreActivacion(entrada);
  const comprobada = leerIdentidadTrabajoDurable(identidad);
  const fin = leerEvidenciaIntentoActivacion(anterior);
  return enviar('/activacion/cierre/cumplir', { registro, identidad: comprobada, fin }, (valor) =>
    leerCierreCumplidoDurable(valor, registro),
  );
}
