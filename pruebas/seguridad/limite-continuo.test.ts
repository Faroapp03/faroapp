import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AlmacenLimiteContinuoSqlite } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { escribirSinAlarma } from '../ayudas/alarma-durable.ts';

const HUELLA = 64;
const VENTANA = 900_000;
const MAXIMO = 10;
const CUATRO_VENTANAS = 4;
const SEGUNDO = 1000;
const MAX_FILAS = 10_000;
const BASE_HEXADECIMAL = 16;
function preparar() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT');
  db.exec('INSERT INTO publico_estado VALUES (1)');
  db.exec(
    'CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY, caduca INTEGER NOT NULL, usados INTEGER NOT NULL) STRICT',
  );
  const sql: SqlAccesoPublico = {
    filas: (s, ...v) => db.prepare(s).all(...(v as ValorSql[])),
    ejecutar: (s, ...v) => {
      db.prepare(s).run(...(v as ValorSql[]));
    },
    transaccion: (f) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = f();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, sql };
}
test('la ventana es continua incluso cerca del cambio de época', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const clave = 'a'.repeat(HUELLA);
    const inicio = VENTANA * CUATRO_VENTANAS;
    for (let i = 0; i < MAXIMO; i++) {
      assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, inicio + i), true);
    }
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, inicio + VENTANA - 1), false);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, inicio + VENTANA), true);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, inicio + VENTANA), false);
  } finally {
    db.close();
  }
});
test('los intentos previos activos se conservan durante la migración', () => {
  const { db, sql } = preparar();
  try {
    const anterior = 'b'.repeat(HUELLA),
      clave = 'c'.repeat(HUELLA),
      ahora = VENTANA * CUATRO_VENTANAS;
    db.prepare('INSERT INTO administracion_recorrido_intentos VALUES (?,?,?)').run(anterior, ahora + SEGUNDO, MAXIMO);
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [anterior] }, ahora), false);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [anterior] }, ahora + SEGUNDO), true);
  } finally {
    db.close();
  }
});

test('saturación rechaza solo nuevas redes y conserva las ya registradas', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const ahora = VENTANA * CUATRO_VENTANAS;
    const clave = 'a'.repeat(HUELLA);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, ahora), true);
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO portal_limite_continuo SELECT lower(hex(randomblob(32))), '[1]', 999999999 FROM n",
    );
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, ahora + 1), true);
    // Sin huellas de prefijo, la red nueva se rechaza por saturación, que no es culpa suya, y no por sus intentos.
    const nueva = { clave: 'b'.repeat(HUELLA), recientes: [], anteriores: ['c'.repeat(HUELLA)] };
    assert.equal(almacen.consumir(nueva, ahora + 1), 'saturado');
    assert.equal(almacen.consumirConEspejo(nueva, ahora + 1), 'saturado');
    assert.equal(db.prepare('SELECT count(*) AS n FROM administracion_recorrido_intentos').get()?.n, 0);
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, ahora + 2), true);
  } finally {
    db.close();
  }
});

test('con la tabla llena, una red conocida sigue contando al cambiar de periodo y su huella nueva', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const ahora = VENTANA * CUATRO_VENTANAS;
    const anterior = 'a'.repeat(HUELLA);
    assert.equal(almacen.consumir({ clave: anterior, recientes: [], anteriores: [] }, ahora), true);
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO portal_limite_continuo SELECT lower(hex(randomblob(32))), '[1]', 999999999 FROM n",
    );
    const siguiente = { clave: 'e'.repeat(HUELLA), recientes: [anterior], anteriores: [] };
    assert.equal(almacen.consumir(siguiente, ahora + 1), true);
    assert.equal(almacen.consumir({ clave: 'f'.repeat(HUELLA), recientes: [], anteriores: [] }, ahora + 1), 'saturado');
  } finally {
    db.close();
  }
});

test('con la tabla antigua llena, la huella antigua nueva se rechaza y la conocida se sigue contando', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const ahora = VENTANA * CUATRO_VENTANAS;
    const conocida = 'a'.repeat(HUELLA);
    assert.equal(almacen.consumirAntiguo(conocida, ahora), true);
    db.exec(
      'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO administracion_recorrido_intentos SELECT lower(hex(randomblob(32))), 999999999, 1 FROM n',
    );
    assert.equal(almacen.consumirAntiguo(conocida, ahora + 1), true);
    assert.equal(almacen.consumirAntiguo('b'.repeat(HUELLA), ahora + 1), false);
    const conEspejo = { clave: 'd'.repeat(HUELLA), recientes: [], anteriores: ['b'.repeat(HUELLA)] };
    assert.equal(almacen.consumirConEspejo(conEspejo, ahora + 1), 'saturado');
    assert.equal(db.prepare('SELECT count(*) AS n FROM portal_limite_continuo').get()?.n, 0);
  } finally {
    db.close();
  }
});

/** Una huella sintética distinta para cada número. */
function huella(n: number, letra = 'a'): string {
  return `${letra}${n.toString(BASE_HEXADECIMAL).padStart(HUELLA - 1, '0')}`;
}
/** Llena la tabla de redes con filas vivas de otras redes. */
function llenar(db: DatabaseSync): void {
  db.exec(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${MAX_FILAS}) INSERT INTO portal_limite_continuo SELECT lower(hex(randomblob(32))), '[1]', 999999999 FROM n`,
  );
}
const contar = (db: DatabaseSync, tabla: string) => db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get()?.n;

test('con la tabla llena, las redes nuevas cuentan en su prefijo, con su cupo, sin tocar el de otro prefijo', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const ahora = VENTANA * CUATRO_VENTANAS;
    llenar(db);
    const atacante = { clave: huella(1, 'c'), recientes: [] };
    const CUPO_PREFIJO = 30;
    // Cada red /64 del mismo /48 es nueva, pero todas gastan el mismo cupo.
    for (let i = 0; i < CUPO_PREFIJO; i++) {
      const ids = { clave: huella(i), recientes: [], anteriores: [], prefijo: atacante };
      assert.equal(almacen.consumir(ids, ahora), true, `intento ${i}`);
    }
    const otra = { clave: huella(CUPO_PREFIJO), recientes: [], anteriores: [], prefijo: atacante };
    assert.equal(almacen.consumir(otra, ahora), 'saturado');
    // Otro prefijo conserva su cupo entero, también con espejo, y ninguna red nueva deja fila propia ni espejo.
    const ajeno = {
      clave: huella(1, 'd'),
      recientes: [],
      anteriores: [huella(1, 'e')],
      prefijo: { clave: huella(2, 'c'), recientes: [] },
    };
    assert.equal(almacen.consumirConEspejo(ajeno, ahora), true);
    assert.equal(contar(db, 'portal_limite_continuo'), MAX_FILAS);
    assert.equal(contar(db, 'administracion_recorrido_intentos'), 0);
    assert.equal(contar(db, 'portal_limite_prefijos'), 2);
    // El cupo del prefijo cuenta en una ventana deslizante, también con la huella del periodo siguiente.
    const siguiente = {
      clave: huella(1, '9'),
      recientes: [],
      anteriores: [],
      prefijo: { clave: huella(1, '7'), recientes: [atacante.clave] },
    };
    assert.equal(almacen.consumir(siguiente, ahora + 1), 'saturado');
    assert.equal(almacen.consumir(siguiente, ahora + VENTANA + 1), true);
    // Una red que ya ha agotado sus propios intentos sigue recibiendo «demasiados intentos», no el cupo del prefijo.
    const agotada = { clave: 'b'.repeat(HUELLA), recientes: [], anteriores: [] };
    db.prepare('INSERT INTO portal_limite_continuo VALUES (?,?,?)').run(
      agotada.clave,
      JSON.stringify(Array(MAXIMO).fill(ahora)),
      ahora + VENTANA,
    );
    assert.equal(almacen.consumir({ ...agotada, prefijo: { clave: huella(1, '6'), recientes: [] } }, ahora + 2), false);
  } finally {
    db.close();
  }
});

test('la tabla de prefijos tiene su tope: un prefijo nuevo con ella llena se rechaza por saturación', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const ahora = VENTANA * CUATRO_VENTANAS;
    llenar(db);
    const MAX_PREFIJOS = 1000;
    for (let i = 0; i < MAX_PREFIJOS; i++) {
      const ids = {
        clave: huella(i),
        recientes: [],
        anteriores: [],
        prefijo: { clave: huella(i, 'c'), recientes: [] },
      };
      assert.equal(almacen.consumir(ids, ahora), true);
    }
    const nuevo = {
      clave: huella(MAX_PREFIJOS),
      recientes: [],
      anteriores: [],
      prefijo: { clave: huella(MAX_PREFIJOS, 'c'), recientes: [] },
    };
    assert.equal(almacen.consumir(nuevo, ahora), 'saturado');
    // Un prefijo ya conocido sigue contando aunque la tabla esté llena, y su fila del periodo nuevo cabe en el margen.
    const conocido = {
      clave: huella(MAX_PREFIJOS + 1),
      recientes: [],
      anteriores: [],
      prefijo: { clave: huella(1, 'f'), recientes: [huella(0, 'c')] },
    };
    assert.equal(almacen.consumir(conocido, ahora + 1), true);
    assert.equal(contar(db, 'portal_limite_prefijos'), MAX_PREFIJOS + 1);
    // Sin intentos nuevos, todo caduca a la vez que su ventana y la alarma lo retira.
    assert.equal(almacen.vencimiento(), ahora + VENTANA);
    almacen.retirarVencidos(ahora + VENTANA + 1);
    assert.equal(contar(db, 'portal_limite_prefijos'), 0);
  } finally {
    db.close();
  }
});

test('un mensaje con un prefijo mal formado no se cuenta', () => {
  const { sql } = preparar();
  const almacen = new AlmacenLimiteContinuoSqlite(sql);
  const ids = {
    clave: huella(1),
    recientes: [],
    anteriores: [],
    prefijo: { clave: 'no es una huella', recientes: [] },
  };
  assert.throws(() => almacen.consumir(ids, VENTANA), /Límite no válido/u);
});

test('migra cuotas reales del esquema anterior y las conserva al reiniciar', async () => {
  const { db, sql } = preparar();
  try {
    const { huellaLimiteRecorrido, identificadoresLimiteRecorrido } = await import(
      '../../src/plataforma/cloudflare/limite-recorrido.ts'
    );
    const secreto = 'clave-sintetica-de-al-menos-32-bytes-para-test';
    const request = new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '2001:db8:12:34::1' } });
    const inicio = VENTANA * CUATRO_VENTANAS - 1;
    const legado = await huellaLimiteRecorrido(request, secreto, inicio);
    db.prepare('INSERT INTO administracion_recorrido_intentos VALUES (?,?,?)').run(
      legado,
      inicio + VENTANA,
      MAXIMO - 1,
    );
    const actual = inicio + 1;
    const ids = await identificadoresLimiteRecorrido(request, secreto, actual);
    assert.ok(ids.anteriores.includes(legado));
    assert.equal(new AlmacenLimiteContinuoSqlite(sql).consumir(ids, actual), true);
    assert.equal(new AlmacenLimiteContinuoSqlite(sql).consumir(ids, actual + 1), false);
    assert.equal(new AlmacenLimiteContinuoSqlite(sql).consumir(ids, inicio + VENTANA), true);
  } finally {
    db.close();
  }
});

test('esquema incompleto o registros corruptos fallan cerrados y no se reparan', () => {
  const { db, sql } = preparar();
  try {
    const almacen = new AlmacenLimiteContinuoSqlite(sql);
    const clave = 'c'.repeat(HUELLA);
    const ahora = VENTANA * CUATRO_VENTANAS;
    assert.equal(almacen.consumir({ clave, recientes: [], anteriores: [] }, ahora), true);
    db.prepare('UPDATE portal_limite_continuo SET marcas=? WHERE clave=?').run('["incorrecto"]', clave);
    assert.throws(() => almacen.consumir({ clave, recientes: [], anteriores: [] }, ahora + 1), /no disponible/);
    db.exec('DROP TABLE portal_limite_continuo');
    assert.throws(() => new AlmacenLimiteContinuoSqlite(sql), /incompleto/);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='portal_limite_continuo'").get()
        ?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test('el constructor sobre una autoridad S1 previa conserva modo, revisión y cuota antigua', async () => {
  const { AlmacenSesionPanelSqlite } = await import('../../src/plataforma/acceso-publico/sesion-sqlite.ts');
  const { AlmacenSesionRecorridoSqlite } = await import(
    '../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts'
  );
  const { prepararEsquemaRecorrido, cambiarModoSqlite } = await import(
    '../../src/plataforma/acceso-publico/recorrido-sqlite.ts'
  );
  const { consumirIntentoAntiguo } = await import('../ayudas/limite-antiguo.ts');
  const { motorPanel } = await import('../ayudas/persistencia-panel.ts');
  const { AlmacenPublicoSqlite } = await import('../../src/plataforma/acceso-publico/sqlite.ts');
  const db = new DatabaseSync(':memory:');
  try {
    const sql = motorPanel(db);
    new AlmacenPublicoSqlite(sql, { maxClientes: 2 });
    new AlmacenSesionPanelSqlite(sql);
    prepararEsquemaRecorrido(sql);
    cambiarModoSqlite(sql, 0, 'real');
    const legado = 'd'.repeat(HUELLA);
    const clave = 'e'.repeat(HUELLA);
    const ahora = Date.now();
    for (let i = 0; i < MAXIMO; i++) {
      assert.equal(consumirIntentoAntiguo(sql, legado, ahora), true);
    }
    const nueva = new AlmacenSesionRecorridoSqlite(sql, { cubrir: escribirSinAlarma });
    assert.deepEqual(await nueva.leerRecorrido(), { version: 1, revision: 1, modo: 'real' });
    assert.equal(await nueva.consumirIntentoRecorrido({ clave, recientes: [], anteriores: [legado] }), false);
    assert.equal(
      db.prepare('SELECT usados FROM administracion_recorrido_intentos WHERE clave=?').get(legado)?.usados,
      MAXIMO,
    );
    assert.equal(
      await new AlmacenSesionRecorridoSqlite(sql, { cubrir: escribirSinAlarma }).consumirIntentoRecorrido({
        clave,
        recientes: [],
        anteriores: [legado],
      }),
      false,
    );
  } finally {
    db.close();
  }
});

test('la cuota antigua del portal se respeta al cruzar ventana y reconstruir la autoridad', async () => {
  const { db, sql } = preparar();
  try {
    const { identificadoresLimitePortal } = await import('../../src/plataforma/cloudflare/limite-portal.ts');
    const { huellaLimitePortalV1 } = await import('../ayudas/limite-antiguo.ts');
    const secreto = 'clave-sintetica-independiente-de-32-bytes';
    const request = new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '192.0.2.1' } });
    const inicio = VENTANA * CUATRO_VENTANAS - 1;
    const legado = await huellaLimitePortalV1(request, secreto, inicio);
    db.prepare('INSERT INTO administracion_recorrido_intentos VALUES (?,?,?)').run(legado, inicio + VENTANA, MAXIMO);
    const ids = await identificadoresLimitePortal(request, secreto, inicio + 1);
    assert.ok(ids.anteriores.includes(legado));
    assert.equal(new AlmacenLimiteContinuoSqlite(sql).consumir(ids, inicio + 1), false);
    assert.equal(new AlmacenLimiteContinuoSqlite(sql).consumir(ids, inicio + VENTANA), true);
  } finally {
    db.close();
  }
});
