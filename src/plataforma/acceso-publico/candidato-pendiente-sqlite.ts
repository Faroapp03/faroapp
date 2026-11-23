/** Conserva el último recibo validado aunque el trabajo corriente se sustituya antes de reservar su activación. */
import { type ActivacionPrivada, leerEstadoActivacionPrivado } from '../../administracion/activacion.ts';
import {
  esEnteroTrabajo,
  esIdEjecucion,
  esIdSolicitudTrabajo,
  exigirTrabajo,
} from '../../administracion/estado-trabajos.js';
import type { TrabajoPrivado } from '../../administracion/trabajos.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

export function anotarCandidatoPendiente(sql: SqlAccesoPublico, t: TrabajoPrivado | null): void {
  if (t?.resultado?.resultado !== 'validado' || !t.inicioConfirmado || t.protocoloInicio !== 'obligatorio') {
    return;
  }
  exigirTrabajo(t.huellaRecibo !== null && t.runId !== null);
  sql.ejecutar(
    `INSERT INTO administracion_candidato_pendiente VALUES (1,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET solicitud=excluded.solicitud,revision=excluded.revision,run=excluded.run,
    recibo=excluded.recibo,sha=excluded.sha WHERE excluded.revision > revision`,
    t.solicitudId,
    t.revisionReserva,
    t.runId,
    t.huellaRecibo,
    t.confianza.sha,
    t.actualizadoEn,
    t.creadoEn,
  );
}

export function prepararCandidatoPendiente(
  sql: SqlAccesoPublico,
  registro: FilaSql,
  trabajo: TrabajoPrivado | null,
): void {
  if (Object.hasOwn(registro, 'candidato_pendiente_version')) {
    exigirTrabajo(registro.candidato_pendiente_version === 1);
    sql.filas('SELECT id FROM administracion_candidato_pendiente');
    return;
  }
  sql.ejecutar(`CREATE TABLE administracion_candidato_pendiente (
    id INTEGER PRIMARY KEY CHECK(id=1), solicitud TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
    run TEXT NOT NULL, recibo TEXT NOT NULL, sha TEXT NOT NULL, desde INTEGER NOT NULL,
    creado INTEGER NOT NULL CHECK(creado<=desde)) STRICT`);
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN candidato_pendiente_version INTEGER NOT NULL DEFAULT 1 CHECK(candidato_pendiente_version=1)',
  );
  // Una instalación anterior puede seguir conservando el último recibo autenticado que recibió.
  anotarCandidatoPendiente(sql, trabajo);
  if (trabajo && Object.hasOwn(registro, 'activacion_panel_version')) {
    const fila = sql.filas('SELECT documento FROM administracion_activacion WHERE id=1')[0];
    exigirTrabajo(typeof fila?.documento === 'string');
    const ultima = leerEstadoActivacionPrivado(JSON.parse(fila.documento)).ultimaActivacion;
    if (ultima) {
      resolverMarcaDeActivacion(sql, ultima);
    }
  }
}

/** Una intención existente ya tiene su propio cauce de confirmación, recuperación o abandono. */
export function leerCandidatoPendiente(sql: SqlAccesoPublico, ultima: ActivacionPrivada | null) {
  const fila = sql.filas('SELECT * FROM administracion_candidato_pendiente WHERE id=1')[0];
  if (!fila) {
    return null;
  }
  exigirTrabajo(
    esIdSolicitudTrabajo(fila.solicitud) &&
      esEnteroTrabajo(fila.revision) &&
      fila.revision > 0 &&
      esIdEjecucion(fila.run) &&
      typeof fila.recibo === 'string' &&
      /^[0-9a-f]{64}$/.test(fila.recibo) &&
      typeof fila.sha === 'string' &&
      /^[0-9a-f]{40}$/.test(fila.sha) &&
      esEnteroTrabajo(fila.desde) &&
      esEnteroTrabajo(fila.creado) &&
      fila.creado <= fila.desde,
  );
  const t = ultima?.trabajo;
  const conIntencion =
    t?.solicitudId === fila.solicitud &&
    t?.revisionReserva === fila.revision &&
    t?.runId === fila.run &&
    t?.huellaRecibo === fila.recibo &&
    t?.confianza.sha === fila.sha;
  return { solicitudId: fila.solicitud, desde: fila.desde, creadoEn: fila.creado, conIntencion };
}

export function candidatoSinIntencion(sql: SqlAccesoPublico, ultima: ActivacionPrivada | null) {
  const pendiente = leerCandidatoPendiente(sql, ultima);
  return pendiente?.conIntencion ? null : pendiente;
}

export function resolverMarcaDeActivacion(sql: SqlAccesoPublico, a: ActivacionPrivada): void {
  if (a.fase === 'confirmada' || (a.fase === 'rechazada' && a.error === 'candidato_no_verificable')) {
    retirarMarcaCandidato(sql, a.trabajo);
  }
}

export function retirarMarcaCandidato(sql: SqlAccesoPublico, t: TrabajoPrivado): void {
  sql.ejecutar(
    'DELETE FROM administracion_candidato_pendiente WHERE solicitud=? AND revision=? AND run=? AND recibo=? AND sha=?',
    t.solicitudId,
    t.revisionReserva,
    t.runId,
    t.huellaRecibo,
    t.confianza.sha,
  );
}
