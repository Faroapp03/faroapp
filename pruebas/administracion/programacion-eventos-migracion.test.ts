/**
 * El historial de eventos de la programación pasa de la versión 1 (sin fase ni motivo del fallo) a la 2 sin perder sus
 * filas, y la autoridad sigue reservando. SQLite local en memoria; sin red.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { leerProgramacionSqlite } from '../../src/plataforma/acceso-publico/programacion-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const HORA = 3_600_000;
const DIA = 24 * HORA;
const AHORA = Date.parse('2026-10-17T03:00:00Z');
const AYER = AHORA - DIA;
const CRON = '0 3 * * *';
const TAM_SHA = 40;
const POLITICA: PoliticaControles = { version: 2, api: 'deshabilitada', mcp: false, a2a: false };
const CONFIANZA = {
  audiencia: 'https://mantenimiento.example/mantenimiento/resultado',
  repositorioId: '101',
  propietarioId: '102',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
/** La forma de la versión 1: cuatro columnas y la versión limitada a 0 y 1, con un evento ya consumido ayer. */
const VERSION_1 = [
  'DROP TABLE administracion_programacion_eventos',
  'ALTER TABLE publico_estado DROP COLUMN programacion_eventos_version',
  'ALTER TABLE publico_estado ADD COLUMN programacion_eventos_version INTEGER NOT NULL DEFAULT 0 CHECK(programacion_eventos_version IN (0,1))',
  `CREATE TABLE administracion_programacion_eventos (
    evento_en INTEGER PRIMARY KEY, registrado_en INTEGER NOT NULL,
    resultado TEXT NOT NULL, motivo TEXT NOT NULL) STRICT`,
  `INSERT INTO administracion_programacion_eventos VALUES (${AYER},${AYER},'omitida-tardia','evento-fuera-de-ventana')`,
  `UPDATE administracion_programacion SET evento_en=${AYER}`,
  'UPDATE publico_estado SET programacion_eventos_version=1 WHERE id=1',
];

async function autoridadEnLaVersion1(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: <T>(accion: () => T): T => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const resultado = accion();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const reloj = { ahora: AHORA };
  new AlmacenPublicoSqlite(sql, { maxClientes: 1, ahora: () => reloj.ahora });
  const backend = new AlmacenSesionPanelSqlite(sql, { ahora: () => reloj.ahora });
  await backend.prepararPanel(POLITICA);
  await backend.prepararTrabajos();
  await backend.prepararActivacion();
  for (const sentencia of VERSION_1) {
    db.exec(sentencia);
  }
  return { db, sql, reloj, backend };
}

test('una autoridad con el historial de la versión 1 se migra a la 2, conserva su evento y sigue reservando', async (t) => {
  const f = await autoridadEnLaVersion1(t);
  await f.backend.prepararTrabajos();
  assert.equal(f.db.prepare('SELECT programacion_eventos_version AS v FROM publico_estado').get()?.v, 2);
  const columnas = f.db
    .prepare("SELECT name FROM pragma_table_info('administracion_programacion_eventos') ORDER BY name")
    .all()
    .map((c) => c.name);
  assert.deepEqual(columnas, ['evento_en', 'fase', 'motivo', 'motivo_fallo', 'registrado_en', 'resultado']);
  const reserva = await f.backend.reservarTrabajoProgramado({ eventoEn: AHORA, cron: CRON }, CONFIANZA);
  assert.equal(reserva.estado, 'nueva');
  const eventos = leerProgramacionSqlite(f.sql, f.reloj.ahora).eventos.map((e) => [e.eventoEn, e.resultado, e.fase]);
  assert.deepEqual(eventos, [
    [AHORA, 'nueva', null],
    [AYER, 'omitida-tardia', null],
  ]);
  // Una segunda preparación encuentra la versión 2 y no vuelve a migrar.
  await f.backend.prepararTrabajos();
  assert.equal(leerProgramacionSqlite(f.sql, f.reloj.ahora).eventos.length, 2);
});
