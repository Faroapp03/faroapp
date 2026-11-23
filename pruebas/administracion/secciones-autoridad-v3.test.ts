import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { politicaSeccionesInicial } from '../../src/administracion/secciones-web.js';
import { AccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import { leerSeccionesConAutoridad } from '../../src/plataforma/acceso-publico/secciones-autoridad-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { respuestaSeccionesV3 } from '../../src/plataforma/cloudflare/secciones-v3.ts';
import { motorPanel, POLITICA_PANEL } from '../ayudas/persistencia-panel.ts';

const VERSION_PUBLICA = 4;
const HTTP_OK = 200;
const HTTP_NO_DISPONIBLE = 503;

test('la autoridad se crea una vez y conserva controles, revisión y secciones', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const sql = motorPanel(db);
    new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
    await new AlmacenSesionPanelSqlite(sql).prepararPanel(POLITICA_PANEL);
    const antes = db.prepare('SELECT documento FROM administracion_controles WHERE id=1').get();
    const primero = leerSeccionesConAutoridad(sql);
    const segundo = leerSeccionesConAutoridad(sql);
    assert.deepEqual(segundo, primero);
    assert.match(primero.autoridad, /^[0-9a-f-]{36}$/);
    assert.equal(primero.revision, 0);
    assert.deepEqual(primero.secciones, politicaSeccionesInicial());
    assert.deepEqual(db.prepare('SELECT documento FROM administracion_controles WHERE id=1').get(), antes);
    db.exec('DROP TABLE secciones_autoridad');
    assert.throws(() => leerSeccionesConAutoridad(sql));
  } finally {
    db.close();
  }
});

test('el binding durable expone la misma autoridad después de reiniciar el objeto', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const crear = () =>
      new AccesoPublicoDurable(
        {
          storage: {
            sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
            transactionSync: <T>(accion: () => T) => motorPanel(db).transaccion(accion),
          },
        },
        {},
      );
    let durable = crear();
    const espacio = { idFromName: () => 'id', get: () => ({ fetch: (peticion: Request) => durable.fetch(peticion) }) };
    const cliente = new AlmacenRecorridoDurable(espacio);
    await cliente.prepararPanel(POLITICA_PANEL);
    const primera = await cliente.leerSeccionesConAutoridad();
    durable = crear();
    const segunda = await cliente.leerSeccionesConAutoridad();
    assert.deepEqual(segunda, primera);
    assert.equal(segunda.version, VERSION_PUBLICA);
  } finally {
    db.close();
  }
});

test('v3 sin panel usa identidad durable estable sin activar controles', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const durable = new AccesoPublicoDurable(
      {
        storage: {
          sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
          transactionSync: <T>(accion: () => T) => motorPanel(db).transaccion(accion),
        },
      },
      {},
    );
    const espacio = { idFromName: () => 'id', get: () => ({ fetch: (peticion: Request) => durable.fetch(peticion) }) };
    const pedir = () =>
      respuestaSeccionesV3(new Request('https://ejemplo.invalid/secciones-v3.json'), espacio, async () => {}, true);
    const primera = await pedir();
    const segunda = await pedir();
    assert.equal(primera.status, HTTP_OK);
    assert.equal(primera.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await primera.json(), await segunda.json());
    assert.equal(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_controles'").get(),
      undefined,
    );
  } finally {
    db.close();
  }
});

test('sin durable el endpoint v3 informa indisponibilidad sin inventar identidad', async () => {
  const respuesta = await respuestaSeccionesV3(
    new Request('https://ejemplo.invalid/secciones-v3.json'),
    undefined,
    async () => {},
    true,
  );
  assert.equal(respuesta.status, HTTP_NO_DISPONIBLE);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(await respuesta.text(), '');
});

test('identidades de almacenes independientes no son comparables y datos dañados no se regeneran', async () => {
  const bases = [new DatabaseSync(':memory:'), new DatabaseSync(':memory:')];
  try {
    const almacenes = bases.map((db) => {
      const sql = motorPanel(db);
      new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
      return { db, sql, sesion: new AlmacenSesionPanelSqlite(sql) };
    });
    for (const almacen of almacenes) {
      await almacen.sesion.prepararPanel(POLITICA_PANEL);
    }
    const [primero, segundo] = almacenes.map(({ sql }) => leerSeccionesConAutoridad(sql));
    assert.ok(primero && segundo);
    assert.notEqual(primero.autoridad, segundo.autoridad);
    const primera = almacenes[0];
    assert.ok(primera);
    primera.db.exec("UPDATE secciones_autoridad SET autoridad='invalido' WHERE id=1");
    assert.throws(() => leerSeccionesConAutoridad(primera.sql));
    assert.equal(primera.db.prepare('SELECT autoridad FROM secciones_autoridad').get()?.autoridad, 'invalido');
  } finally {
    for (const db of bases) {
      db.close();
    }
  }
});
