/** Copia fijada, separada del documento pequeño del trabajo, bajo su misma transacción SQL. */
import {
  leerObservacionDatosTrabajo,
  MAX_OBSERVACION_DATOS_BYTES,
  type ObservacionDatosTrabajo,
  resultadoCoincideConRecibo,
} from '../../administracion/datos-trabajo.ts';
import { type EstadoTrabajosPrivado, exigirTrabajo, objetoTrabajo } from '../../administracion/trabajos.ts';
import { prepararCandidatoPendiente } from './candidato-pendiente-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

function existeTabla(sql: SqlAccesoPublico): boolean {
  return (
    sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_datos_trabajo'").length === 1
  );
}
export function prepararDatosTrabajoSqlite(sql: SqlAccesoPublico, trabajos: EstadoTrabajosPrivado): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.trabajo_panel_version === 1);
  prepararCandidatoPendiente(sql, metadata, trabajos.ultimoTrabajo);
  if (Object.hasOwn(metadata, 'datos_trabajo_version')) {
    leerDatosTrabajoSqlite(sql, trabajos);
    return;
  }
  exigirTrabajo(!existeTabla(sql));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN datos_trabajo_version INTEGER NOT NULL DEFAULT 0 CHECK(datos_trabajo_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_datos_trabajo (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
    documento TEXT, sha TEXT) STRICT`);
  // Una instalación previa no tiene observación acreditada; no se reconstruye con datos actuales.
  sql.ejecutar('INSERT INTO administracion_datos_trabajo VALUES (1,1,NULL,NULL)');
  sql.ejecutar('UPDATE publico_estado SET datos_trabajo_version=1 WHERE id=1');
}
/** La observación guardada, con su forma, tamaño y huella comprobados; null si no hay ninguna. */
function leerGuardadaSqlite(sql: SqlAccesoPublico): { observacion: ObservacionDatosTrabajo; sha: string } | null {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.datos_trabajo_version === 1 && existeTabla(sql));
  const filas = sql.filas('SELECT * FROM administracion_datos_trabajo');
  exigirTrabajo(filas.length === 1);
  const fila = objetoTrabajo(filas[0], 'documento,id,sha,version');
  exigirTrabajo(fila.id === 1 && fila.version === 1);
  if (fila.documento === null) {
    exigirTrabajo(fila.sha === null);
    return null;
  }
  exigirTrabajo(typeof fila.documento === 'string' && fila.documento.length <= MAX_OBSERVACION_DATOS_BYTES);
  exigirTrabajo(new TextEncoder().encode(fila.documento).byteLength <= MAX_OBSERVACION_DATOS_BYTES);
  exigirTrabajo(typeof fila.sha === 'string' && /^[0-9a-f]{40}$/.test(fila.sha));
  return { observacion: leerObservacionDatosTrabajo(JSON.parse(fila.documento)), sha: fila.sha };
}
export function leerDatosTrabajoSqlite(
  sql: SqlAccesoPublico,
  trabajos: EstadoTrabajosPrivado,
): ObservacionDatosTrabajo | null {
  const guardada = leerGuardadaSqlite(sql);
  if (guardada === null) {
    return null;
  }
  const { observacion, sha } = guardada;
  const t = trabajos.ultimoTrabajo;
  exigirTrabajo(t !== null && observacion.recibo.revisionReserva <= t.revisionReserva);
  // Se conserva físicamente la observación anterior; una nueva reserva la deja fuera del estado actual.
  if (observacion.recibo.revisionReserva < t.revisionReserva) {
    return null;
  }
  exigirTrabajo(
    t.estado === 'terminado' &&
      observacion.recibo.solicitudId === t.solicitudId &&
      observacion.recibo.accion === t.accion &&
      observacion.huellaRecibo === t.huellaRecibo &&
      sha === t.confianza.sha &&
      resultadoCoincideConRecibo(t.resultado, observacion.recibo),
  );
  return observacion;
}
/** Lo que el panel enseña como estado de los datos, y si es de una actualización anterior a la última reservada. */
export interface ObservacionDelPanel {
  readonly observacion: ObservacionDatosTrabajo;
  readonly deLaActualizacionAnterior: boolean;
}
/**
 * La observación del último trabajo o, si después se ha reservado otro (en curso, retirado o terminado sin
 * observación), la última admitida, marcada como de la actualización anterior. Solo se guarda una observación tras
 * admitir su recibo, y la siguiente la sustituye en la misma transacción: la que queda guardada fue admitida. Así el
 * panel no se queda sin datos mientras dura una actualización; el estado actual de los trabajos no cambia.
 */
export function leerObservacionDelPanelSqlite(
  sql: SqlAccesoPublico,
  trabajos: EstadoTrabajosPrivado,
): ObservacionDelPanel | null {
  const actual = leerDatosTrabajoSqlite(sql, trabajos);
  if (actual !== null) {
    return { observacion: actual, deLaActualizacionAnterior: false };
  }
  const guardada = leerGuardadaSqlite(sql);
  return guardada === null ? null : { observacion: guardada.observacion, deLaActualizacionAnterior: true };
}
export function guardarDatosTrabajoSqlite(
  sql: SqlAccesoPublico,
  observacion: ObservacionDatosTrabajo,
  sha: string,
): void {
  const comprobada = leerObservacionDatosTrabajo(observacion);
  exigirTrabajo(/^[0-9a-f]{40}$/.test(sha));
  sql.ejecutar('UPDATE administracion_datos_trabajo SET documento=?,sha=? WHERE id=1', JSON.stringify(comprobada), sha);
}
