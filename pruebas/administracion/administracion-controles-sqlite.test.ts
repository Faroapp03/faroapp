import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { Socio } from '../../src/api/socios/registro.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { AlmacenPublicoSqlite, type SqlAccesoPublico } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { sembrarSocioPersistido, socioPersistido } from '../ayudas/registro-persistido-anterior.ts';

const HUELLAS = 64;
const LONGITUD_JTI = 22;
const JTI = 'a'.repeat(LONGITUD_JTI);
const AHORA = 10_000;
const CADUCA = 100;
const CUOTA = 2;
const VENTANA = 1000;
const opciones = { maxClientes: 2, ahora: () => AHORA };
const politica = (api: PoliticaControles['api'] = 'habilitada'): PoliticaControles => ({
  version: 2,
  api,
  mcp: true,
  a2a: false,
});
const socio = (id = 'pub-uno'): Socio => ({
  id,
  huellas: ['a'.repeat(HUELLAS)],
  consultasPorHora: CUOTA,
});
const cuenta = { clave: 'consultas:global', limite: CUOTA, ventanaMs: VENTANA };
function motor(db: DatabaseSync): SqlAccesoPublico {
  return {
    filas: (sql, ...valores) => db.prepare(sql).all(...valores),
    ejecutar: (sql, ...valores) => {
      db.prepare(sql).run(...valores);
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
function conBase(accion: (db: DatabaseSync, sql: SqlAccesoPublico, almacen: AlmacenPublicoSqlite) => Promise<void>) {
  return async () => {
    const db = new DatabaseSync(':memory:');
    const sql = motor(db);
    try {
      await accion(db, sql, new AlmacenPublicoSqlite(sql, opciones));
    } finally {
      db.close();
    }
  };
}
function datos(db: DatabaseSync) {
  return ['publico_socios', 'publico_contadores', 'publico_revocados'].map((tabla) =>
    db.prepare(`SELECT * FROM ${tabla} ORDER BY 1`).all(),
  );
}

test(
  'heredado intacto: lectura no migra esquema ni cambia abierto',
  conBase(async (db, sql, almacen) => {
    const esquema = db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all();
    assert.equal(await almacen.leerControles(), null);
    await assert.rejects(almacen.cambiarControles(0, politica()));
    await assert.rejects(almacen.activarControles({ ...politica(), version: 1 } as unknown as PoliticaControles));
    assert.equal(new AlmacenPublicoSqlite(sql, opciones) instanceof AlmacenPublicoSqlite, true);
    assert.deepEqual(db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(), esquema);
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 0);
  }),
);

test(
  'activar preserva cierre, credenciales, cuotas y revocados; reinicio no reinicializa',
  conBase(async (db, sql, a) => {
    sembrarSocioPersistido(db, socio());
    assert.equal(await a.consumir([cuenta]), true);
    await a.revocar(JTI, CADUCA);
    db.exec('UPDATE publico_estado SET abierto=0');
    const antes = datos(db);
    const inicial = await a.activarControles(politica());
    assert.equal(inicial.api, 'habilitada');
    assert.equal(inicial.revision, 0);
    await assert.rejects(a.activarControles(politica()));
    const b = new AlmacenPublicoSqlite(sql, opciones);
    assert.deepEqual(await b.leerControles(), inicial);
    assert.equal(db.prepare('SELECT abierto FROM publico_estado').get()?.abierto, 0);
    assert.deepEqual(datos(db), antes);
    await b.cambiarControles(0, politica('deshabilitada'));
    assert.deepEqual(datos(db), antes);
    assert.deepEqual(socioPersistido(db, 'pub-uno'), socio());
    assert.equal(await b.revocado(JTI), true);
    assert.equal(await b.consumir([cuenta]), true);
    assert.equal(await b.consumir([cuenta]), false);
  }),
);

test('dos conexiones ven revisión comprometida; conflicto no sobrescribe y cierre comprueba inserción', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-controles-'));
  const config = { ...opciones, archivo: join(dir, 'registro.sqlite') };
  const a = crearAlmacenPublicoNode(config);
  const b = crearAlmacenPublicoNode(config);
  try {
    await a.activarControles(politica());
    const cambios = await Promise.all([
      a.cambiarControles(0, politica('deshabilitada')),
      b.cambiarControles(0, politica('habilitada')),
    ]);
    assert.deepEqual(
      cambios.map((c) => c.estado),
      ['cambiado', 'conflicto'],
    );
    assert.deepEqual(cambios[0]?.controles, cambios[1]?.controles);
    assert.equal(await b.consumir([cuenta]), true);
    assert.equal((await b.cambiarControles(1, politica())).estado, 'cambiado');
    assert.equal(await a.consumir([cuenta]), true);
    assert.equal(await b.consumir([cuenta]), false);
    assert.equal((await a.leerControles())?.revision, CUOTA);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});

test(
  'documentos/revisiones inválidos y revisión agotada conservan el anterior',
  conBase(async (db, _sql, a) => {
    const original = await a.activarControles(politica());
    for (const revision of [-1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(a.cambiarControles(revision, politica()));
    }
    await assert.rejects(a.cambiarControles(0, { ...politica(), proveedor: 'no' } as PoliticaControles));
    assert.deepEqual(await a.leerControles(), original);
    const agotado = { ...original, revision: Number.MAX_SAFE_INTEGER };
    const persistido = {
      ...JSON.parse(String(db.prepare('SELECT documento FROM administracion_controles').get()?.documento)),
      revision: agotado.revision,
    };
    db.prepare('UPDATE administracion_controles SET documento=?').run(JSON.stringify(persistido));
    await assert.rejects(a.cambiarControles(Number.MAX_SAFE_INTEGER, politica()));
    assert.deepEqual(await a.leerControles(), agotado);
  }),
);

const corrupciones = [
  'DROP TABLE administracion_controles',
  'DELETE FROM administracion_controles',
  "UPDATE administracion_controles SET documento='{}'",
  'DELETE FROM publico_estado',
  'UPDATE publico_estado SET controles_version=0',
  'ALTER TABLE publico_estado DROP COLUMN controles_version',
];
for (const corrupcion of corrupciones) {
  test(
    `adopción incompleta falla cerrado sin recrear: ${corrupcion}`,
    conBase(async (db, sql, a) => {
      await a.activarControles(politica());
      db.exec(corrupcion);
      const antes = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
      await assert.rejects(a.leerControles());
      await assert.rejects(a.activarControles(politica()));
      assert.throws(() => new AlmacenPublicoSqlite(sql, opciones));
      assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), antes);
    }),
  );
}

test(
  'fallo SQL en migración revierte marcador/esquema; fallo de cambio conserva revisión',
  conBase(async (db, sql) => {
    let romper = 'UPDATE publico_estado SET controles_version';
    const roto: SqlAccesoPublico = {
      ...sql,
      ejecutar: (sentencia, ...valores) => {
        if (sentencia.startsWith(romper)) {
          throw new Error('fallo sintético');
        }
        sql.ejecutar(sentencia, ...valores);
      },
    };
    const a = new AlmacenPublicoSqlite(roto, opciones);
    const antes = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    await assert.rejects(a.activarControles(politica()));
    assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), antes);
    assert.equal(await a.leerControles(), null);
    romper = 'UPDATE administracion_controles';
    const inicial = await a.activarControles(politica());
    await assert.rejects(a.cambiarControles(0, politica('deshabilitada')));
    assert.deepEqual(await a.leerControles(), inicial);
  }),
);

test('archivo reabierto conserva adopción y revisión sin reinicializar desde opciones', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-controles-reinicio-'));
  const config = { ...opciones, archivo: join(dir, 'registro.sqlite') };
  let a = crearAlmacenPublicoNode(config);
  try {
    await a.activarControles(politica());
    const cierre = await a.cambiarControles(0, politica('deshabilitada'));
    a.close();
    a = crearAlmacenPublicoNode(config);
    assert.deepEqual(await a.leerControles(), cierre.controles);
    assert.equal(await a.consumir([cuenta]), true);
    assert.equal(await a.consumir([cuenta]), true);
    assert.equal(await a.consumir([cuenta]), false);
  } finally {
    a.close();
    rmSync(dir, { recursive: true });
  }
});
