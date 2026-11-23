import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { DESTINO_INICIAL } from '../../src/administracion/avisos-destino.ts';
import { DestinoCorreoInvalido } from '../../src/administracion/destino-correo.ts';
import { cambiarDestinoSqlite, leerDestinoSqlite } from '../../src/plataforma/acceso-publico/avisos-destino-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const CORREO = 'persona@example.org';
const AHORA = Date.parse('2026-11-22T05:00:00Z');
function motor(t: TestContext): { db: DatabaseSync; sql: SqlAccesoPublico } {
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
  return { db, sql };
}
const tablas = (db: DatabaseSync) =>
  db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_avisos_destino'").get()?.n;

test('leer sin tabla da el destino inicial y no crea nada', (t) => {
  const { db, sql } = motor(t);
  assert.deepEqual(leerDestinoSqlite(sql), DESTINO_INICIAL);
  assert.equal(tablas(db), 0);
});

test('cambiar crea la fila, deja la dirección pendiente y sube la revisión', (t) => {
  const { db, sql } = motor(t);
  const cambio = sql.transaccion(() => cambiarDestinoSqlite(sql, 0, 'persona@Example.ORG', AHORA));
  assert.deepEqual(cambio, {
    estado: 'cambiado',
    destino: { version: 1, revision: 1, cambiadoEn: AHORA, verificacion: 'pendiente' },
  });
  assert.equal(tablas(db), 1);
  assert.deepEqual(leerDestinoSqlite(sql), {
    version: 1,
    correo: CORREO,
    revision: 1,
    cambiadoEn: AHORA,
    verificacion: 'pendiente',
  });
});

test('una revisión vieja no pisa el cambio y el conflicto no devuelve la dirección', (t) => {
  const { sql } = motor(t);
  sql.transaccion(() => cambiarDestinoSqlite(sql, 0, CORREO, AHORA));
  const conflicto = sql.transaccion(() => cambiarDestinoSqlite(sql, 0, 'otra@example.org', AHORA + 1));
  assert.equal(conflicto.estado, 'conflicto');
  assert.deepEqual(conflicto.destino, { version: 1, revision: 1, cambiadoEn: AHORA, verificacion: 'pendiente' });
  assert.doesNotMatch(JSON.stringify(conflicto), /@/);
  assert.equal(leerDestinoSqlite(sql).correo, CORREO);
});

test('quitar deja el destino sin dirección con su propia revisión y su fecha', (t) => {
  const { sql } = motor(t);
  sql.transaccion(() => cambiarDestinoSqlite(sql, 0, CORREO, AHORA));
  const quitado = sql.transaccion(() => cambiarDestinoSqlite(sql, 1, null, AHORA + 1));
  assert.deepEqual(quitado, {
    estado: 'cambiado',
    destino: { version: 1, revision: 2, cambiadoEn: AHORA + 1, verificacion: 'sin_destino' },
  });
  assert.deepEqual(leerDestinoSqlite(sql), {
    version: 1,
    correo: null,
    revision: 2,
    cambiadoEn: AHORA + 1,
    verificacion: 'sin_destino',
  });
});

test('una dirección inválida no cambia nada y la tabla rechaza filas incoherentes', (t) => {
  const { db, sql } = motor(t);
  assert.throws(
    () => sql.transaccion(() => cambiarDestinoSqlite(sql, 0, `${CORREO}\r\nBcc: otra@example.org`, AHORA)),
    DestinoCorreoInvalido,
  );
  assert.equal(tablas(db), 0);
  sql.transaccion(() => cambiarDestinoSqlite(sql, 0, CORREO, AHORA));
  assert.throws(() => db.exec("UPDATE administracion_avisos_destino SET verificacion='sin_destino'"));
  assert.throws(() => db.exec("INSERT INTO administracion_avisos_destino VALUES (2,1,NULL,0,NULL,'sin_destino')"));
  db.exec("UPDATE administracion_avisos_destino SET correo='Persona <persona@example.org>'");
  assert.throws(() => leerDestinoSqlite(sql));
});
