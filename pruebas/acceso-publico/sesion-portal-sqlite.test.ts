import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AlmacenSesionPortalSqlite } from '../../src/plataforma/acceso-publico/sesion-portal-sqlite.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { escribirSinAlarma } from '../ayudas/alarma-durable.ts';

const LONGITUD_HUELLA = 64;
/** El tope de sesiones del almacén, que la prueba llena entero. */
const MAX_SESIONES = 10_000;
const VIDA_S = 60;
function preparar() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY, version INTEGER NOT NULL) STRICT');
  db.exec('INSERT INTO publico_estado VALUES (1,1)');
  const sql: SqlAccesoPublico = {
    filas: (consulta, ...valores) => db.prepare(consulta).all(...(valores as ValorSql[])),
    ejecutar: (consulta, ...valores) => {
      db.prepare(consulta).run(...(valores as ValorSql[]));
    },
    transaccion: (accion) => {
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

test('una sesión revocada no se recupera tras reconstruir la autoridad', () => {
  const { db, sql } = preparar();
  try {
    const id = 'a'.repeat(LONGITUD_HUELLA),
      ahora = 1_800_000_000;
    const almacen = new AlmacenSesionPortalSqlite(sql);
    almacen.registrar(id, ahora + 60, ahora);
    assert.equal(almacen.activa(id, ahora), true);
    almacen.revocar(id);
    assert.equal(new AlmacenSesionPortalSqlite(sql).activa(id, ahora), false);
    assert.equal(almacen.activa('b'.repeat(LONGITUD_HUELLA), ahora), false);
  } finally {
    db.close();
  }
});

test('la pérdida de tabla no recrea sesiones ni abre acceso', () => {
  const { db, sql } = preparar();
  try {
    new AlmacenSesionPortalSqlite(sql);
    db.exec('DROP TABLE portal_sesiones');
    assert.throws(() => new AlmacenSesionPortalSqlite(sql));
  } finally {
    db.close();
  }
});

test('la autoridad llena rechaza nuevas sesiones y conserva la revocación de las existentes', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenSesionPortalSqlite(sql);
    const ahora = 1_800_000_000;
    db.exec(`WITH RECURSIVE numeros(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numeros WHERE n<10000)
      INSERT INTO portal_sesiones SELECT printf('%064x',n), ${ahora + 60} FROM numeros`);
    const existente = '1'.padStart(LONGITUD_HUELLA, '0');
    assert.throws(() => almacen.registrar('a'.repeat(LONGITUD_HUELLA), ahora + 60, ahora));
    assert.equal(almacen.activa(existente, ahora), true);
    almacen.revocar(existente);
    assert.equal(almacen.activa(existente, ahora), false);
  } finally {
    db.close();
  }
});

test('una autoridad dañada falla en lectura y salida sin recrear su tabla', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenSesionPortalSqlite(sql);
    db.exec('DROP TABLE portal_sesiones');
    const huella = 'a'.repeat(LONGITUD_HUELLA);
    const ahora = 1_800_000_000;
    assert.throws(() => almacen.activa(huella, ahora));
    assert.throws(() => almacen.revocar(huella));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='portal_sesiones'").get()?.n, 0);
  } finally {
    db.close();
  }
});

test('disponible es una lectura pura: las caducadas no cuentan, siguen en la tabla y registrar las limpia', async () => {
  const { operarSesionPortal } = await import('../../src/plataforma/acceso-publico/sesion-portal-durable.ts');
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenSesionPortalSqlite(sql);
    const ahora = 1_800_000_000;
    const cuenta = () => db.prepare('SELECT count(*) AS n FROM portal_sesiones').get()?.n;
    const escrituras: string[] = [];
    const vigilada: SqlAccesoPublico = {
      filas: sql.filas,
      ejecutar: (consulta, ...valores) => {
        escrituras.push(consulta);
        sql.ejecutar(consulta, ...valores);
      },
      transaccion: (accion) => {
        escrituras.push('transacción');
        return sql.transaccion(accion);
      },
    };
    const lectora = new AlmacenSesionPortalSqlite(vigilada);
    escrituras.length = 0;
    assert.equal(lectora.disponible(ahora), true);
    assert.deepEqual(await operarSesionPortal(lectora, '/portal/disponible', {}, escribirSinAlarma), {
      disponible: true,
    });
    assert.equal(
      await operarSesionPortal(lectora, '/portal/disponible', { huella: 'a' }, escribirSinAlarma),
      undefined,
    );
    db.exec(`WITH RECURSIVE numeros(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numeros WHERE n<10000)
      INSERT INTO portal_sesiones SELECT printf('%064x',n), ${ahora + 60} FROM numeros`);
    assert.equal(lectora.disponible(ahora), false);
    assert.equal(lectora.disponible(ahora + 60), true, 'las caducadas no cuentan');
    assert.deepEqual(escrituras, [], 'disponible no escribe ni abre transacciones');
    assert.equal(cuenta(), MAX_SESIONES, 'las caducadas siguen en la tabla tras disponible');
    assert.throws(() => almacen.registrar('a'.repeat(LONGITUD_HUELLA), ahora + 60, ahora));
    almacen.registrar('a'.repeat(LONGITUD_HUELLA), ahora + 60 + VIDA_S, ahora + 60);
    assert.equal(cuenta(), 1, 'registrar sí limpia las caducadas');
    db.exec('DROP TABLE portal_sesiones');
    assert.throws(() => lectora.disponible(ahora));
  } finally {
    db.close();
  }
});
