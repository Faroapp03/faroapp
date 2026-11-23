import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import {
  AlmacenLimiteContinuoSqlite,
  MAX_INTENTOS,
  VENTANA_MS,
} from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import {
  cambiarModoSqlite,
  iniciarModoSqlite,
  leerModoSqlite,
  prepararEsquemaRecorrido,
} from '../../src/plataforma/acceso-publico/recorrido-sqlite.ts';
import type { SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { consumirIntentoAntiguo } from '../ayudas/limite-antiguo.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;

test('el selector se inicia una vez en real y cambia por revisión sin sobrescribir conflictos', () => {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: (accion) => accion(),
  };
  try {
    assert.throws(() => leerModoSqlite(sql));
    iniciarModoSqlite(sql);
    assert.deepEqual(leerModoSqlite(sql), { version: 1, revision: 0, modo: 'real' });
    assert.deepEqual(cambiarModoSqlite(sql, 0, 'demo'), {
      estado: 'cambiado',
      recorrido: { version: 1, revision: 1, modo: 'demo' },
    });
    assert.deepEqual(cambiarModoSqlite(sql, 0, 'real'), {
      estado: 'conflicto',
      recorrido: { version: 1, revision: 1, modo: 'demo' },
    });
    assert.throws(() => iniciarModoSqlite(sql));
  } finally {
    db.close();
  }
});

test('autoridad durable conserva el modo y valida sesión y revisión en la misma operación', async () => {
  const { AccesoPublicoDurable } = await import('../../src/plataforma/acceso-publico/durable.ts');
  const { AlmacenRecorridoDurable } = await import('../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts');
  const db = new DatabaseSync(':memory:');
  try {
    const estado: EstadoAccesoPublicoDurable = {
      storage: {
        sql: { exec: (sentencia, ...valores) => ({ toArray: () => db.prepare(sentencia).all(...valores) }) },
        transactionSync: <T>(accion: () => T): T => {
          db.exec('BEGIN IMMEDIATE');
          try {
            const salida = accion();
            db.exec('COMMIT');
            return salida;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      },
    };
    let durable = new AccesoPublicoDurable(estado, {});
    const almacen = new AlmacenRecorridoDurable({
      idFromName: () => 'id',
      get: () => ({ fetch: (p) => durable.fetch(p) }),
    });
    assert.deepEqual(await almacen.leerRecorrido(), { version: 1, revision: 0, modo: 'real' });
    await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
    const acceso = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
    const ajeno = { ...acceso, huellaPrincipal: 'c'.repeat(TAM_HUELLA) };
    await abrirSesionDePrueba(almacen, acceso);
    const sinPermiso = await almacen.cambiarRecorridoDeSesion(ajeno, 0, 'demo');
    assert.ok(!('recorrido' in sinPermiso));
    const cambiado = await almacen.cambiarRecorridoDeSesion(acceso, 0, 'demo');
    assert.equal(cambiado.estado, 'cambiado');
    const conflicto = await almacen.cambiarRecorridoDeSesion(acceso, 0, 'real');
    assert.equal(conflicto.estado, 'conflicto');
    assert.deepEqual(await almacen.leerRecorrido(), { version: 1, revision: 1, modo: 'demo' });
    durable = new AccesoPublicoDurable(estado, {});
    assert.deepEqual(await almacen.leerRecorrido(), { version: 1, revision: 1, modo: 'demo' });
    assert.equal((await almacen.cambiarRecorridoDeSesion(acceso, 0, 'real')).estado, 'conflicto');
  } finally {
    db.close();
  }
});

test('el límite separa identidades y purga entradas vencidas', () => {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: (accion) => accion(),
  };
  try {
    db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT');
    db.exec('INSERT INTO publico_estado VALUES (1)');
    iniciarModoSqlite(sql);
    const limite = new AlmacenLimiteContinuoSqlite(sql);
    const id = (letra: string) => ({ clave: letra.repeat(TAM_HUELLA), recientes: [], anteriores: [] });
    const inicio = 1_000_000;
    for (let i = 0; i < 10; i++) {
      assert.equal(limite.consumir(id('a'), inicio), true);
    }
    assert.equal(limite.consumir(id('a'), inicio), false);
    assert.equal(limite.consumir(id('b'), inicio), true);
    assert.equal(limite.consumir(id('a'), inicio + VENTANA_MS), true);
  } finally {
    db.close();
  }
});

test('la adopción incompleta revierte y no repara un esquema parcial', () => {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      if (sentencia.startsWith('CREATE TABLE administracion_recorrido_intentos')) {
        throw new Error('fallo sintético');
      }
      db.prepare(sentencia).run(...valores);
    },
    transaccion: (accion) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const valor = accion();
        db.exec('COMMIT');
        return valor;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  try {
    db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT');
    db.exec('INSERT INTO publico_estado VALUES (1)');
    assert.throws(() => prepararEsquemaRecorrido(sql), /fallo sintético/);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_recorrido'").get()?.n,
      0,
    );
    db.exec('CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY) STRICT');
    assert.throws(() => prepararEsquemaRecorrido(sql), /Esquema de recorrido incompleto/);
    assert.throws(() => leerModoSqlite(sql));
  } finally {
    db.close();
  }
});

test('el límite antiguo usa la ventana y el tope del límite continuo, que cuenta sus filas como intentos', () => {
  const db = new DatabaseSync(':memory:');
  const sql: SqlAccesoPublico = {
    filas: (sentencia, ...valores) => db.prepare(sentencia).all(...valores),
    ejecutar: (sentencia, ...valores) => {
      db.prepare(sentencia).run(...valores);
    },
    transaccion: (accion) => accion(),
  };
  try {
    db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT');
    db.exec('INSERT INTO publico_estado VALUES (1)');
    iniciarModoSqlite(sql);
    const inicio = 1_000_000;
    const clave = 'c'.repeat(TAM_HUELLA);
    const admitidos = Array.from({ length: MAX_INTENTOS + 1 }, () => consumirIntentoAntiguo(sql, clave, inicio));
    assert.deepEqual(admitidos, [...Array(MAX_INTENTOS).fill(true), false]);
    const fila = db.prepare('SELECT caduca FROM administracion_recorrido_intentos WHERE clave=?').get(clave);
    assert.equal(fila?.caduca, inicio + VENTANA_MS);
    const limite = new AlmacenLimiteContinuoSqlite(sql);
    const ids = { clave: 'd'.repeat(TAM_HUELLA), recientes: [], anteriores: [clave] };
    assert.equal(limite.consumir(ids, inicio + VENTANA_MS - 1), false);
    assert.equal(limite.consumir(ids, inicio + VENTANA_MS), true);
  } finally {
    db.close();
  }
});
