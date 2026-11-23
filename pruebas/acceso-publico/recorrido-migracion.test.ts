import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  cambiarModoSqlite,
  leerModoSqlite,
  prepararEsquemaRecorrido,
} from '../../src/plataforma/acceso-publico/recorrido-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';

const REVISION = 17;
const INTENTOS = 8;
const HUELLA = 64;
const CADUCA = 123456;
const REVISION_CORRUPTA = 9;

function adaptador(db: DatabaseSync): SqlAccesoPublico {
  return {
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
}

for (const modo of ['real', 'demo'] as const) {
  test(`el esquema v1 existente conserva ${modo}, revisión y cuota, y sigue legible por el contrato anterior`, () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        'CREATE TABLE publico_estado (id INTEGER PRIMARY KEY, recorrido_version INTEGER NOT NULL) STRICT; INSERT INTO publico_estado VALUES (1,1)',
      );
      db.exec(
        "CREATE TABLE administracion_recorrido (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), modo TEXT NOT NULL CHECK(modo IN ('real','demo'))) STRICT",
      );
      db.prepare('INSERT INTO administracion_recorrido VALUES (1,?,?)').run(REVISION, modo);
      db.exec(
        'CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY, caduca INTEGER NOT NULL, usados INTEGER NOT NULL CHECK(usados>=0)) STRICT',
      );
      db.prepare('INSERT INTO administracion_recorrido_intentos VALUES (?,?,?)').run(
        'a'.repeat(HUELLA),
        CADUCA,
        INTENTOS,
      );
      const sql = adaptador(db);
      const esquema = db.prepare("SELECT sql FROM sqlite_master WHERE name='administracion_recorrido'").get()?.sql;
      prepararEsquemaRecorrido(sql);
      assert.deepEqual(leerModoSqlite(sql), { version: 1, revision: REVISION, modo });
      assert.equal(
        db.prepare("SELECT sql FROM sqlite_master WHERE name='administracion_recorrido'").get()?.sql,
        esquema,
      );
      assert.equal(db.prepare('SELECT usados FROM administracion_recorrido_intentos').get()?.usados, INTENTOS);
      // La versión anterior usa la misma lectura SQL y acepta los dos valores de modo.
      const anterior = db.prepare('SELECT revision,modo FROM administracion_recorrido WHERE id=1').get();
      assert.equal(anterior?.revision, REVISION);
      assert.equal(anterior?.modo, modo);
      const siguiente = modo === 'real' ? 'demo' : 'real';
      assert.equal(cambiarModoSqlite(sql, REVISION, siguiente).estado, 'cambiado');
      const reversion = db.prepare('SELECT revision,modo FROM administracion_recorrido WHERE id=1').get();
      assert.equal(reversion?.revision, REVISION + 1);
      assert.equal(reversion?.modo, siguiente);
      assert.throws(() => db.prepare("UPDATE administracion_recorrido SET modo='otro'").run());
    } finally {
      db.close();
    }
  });
}

test('un modo corrupto se rechaza y no se repara al adoptar la autoridad', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE publico_estado (id INTEGER PRIMARY KEY, recorrido_version INTEGER NOT NULL) STRICT; INSERT INTO publico_estado VALUES (1,1)',
    );
    db.exec(
      "CREATE TABLE administracion_recorrido (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), modo TEXT NOT NULL CHECK(modo IN ('real','demo'))) STRICT",
    );
    db.exec(
      "PRAGMA ignore_check_constraints=ON; INSERT INTO administracion_recorrido VALUES (1,9,'otro'); PRAGMA ignore_check_constraints=OFF",
    );
    db.exec(
      'CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY, caduca INTEGER NOT NULL, usados INTEGER NOT NULL CHECK(usados>=0)) STRICT',
    );
    const sql = adaptador(db);
    prepararEsquemaRecorrido(sql);
    assert.throws(() => leerModoSqlite(sql));
    assert.throws(() => cambiarModoSqlite(sql, REVISION_CORRUPTA, 'real'));
    assert.equal(db.prepare('SELECT modo FROM administracion_recorrido').get()?.modo, 'otro');
  } finally {
    db.close();
  }
});
