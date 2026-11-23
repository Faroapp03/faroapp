import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  AlmacenLimiteContinuoSqlite,
  MAX_INTENTOS,
  VENTANA_MS,
} from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { identificadoresLimitePortal } from '../../src/plataforma/cloudflare/limite-portal.ts';
import { identificadoresLimiteRecorrido } from '../../src/plataforma/cloudflare/limite-recorrido.ts';

const SECRETO = 'clave-sintetica-del-limite-de-al-menos-32-bytes';
const IP = '192.0.2.77';
const PERIODO = 900_000;
const PERIODOS_DESDE_EL_ORIGEN = 1000;
const PERIODOS_DE_SEPARACION = 4;
const INICIO = PERIODO * PERIODOS_DESDE_EL_ORIGEN;
const MITAD = MAX_INTENTOS / 2;
const CERCA = 5000;
/** Periodo anterior, siguiente y el de antes del anterior, más la huella estable v2. */
const MAX_RECIENTES_LEIDOS = 4;
const TAM_HUELLA = 64;
const peticion = (ip = IP) => new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': ip } });
const hmac = (clave: string, mensaje: string) => createHmac('sha256', clave).update(mensaje).digest('hex');

function preparar() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT; INSERT INTO publico_estado VALUES (1)');
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
  return { db, almacen: new AlmacenLimiteContinuoSqlite(sql) };
}

test('la ventana cuenta los intentos de ambos lados del cambio de periodo y no se reinicia', async () => {
  const { db, almacen } = preparar();
  try {
    const fin = INICIO + PERIODO - CERCA;
    const antes = await identificadoresLimiteRecorrido(peticion(), SECRETO, fin);
    const despues = await identificadoresLimiteRecorrido(peticion(), SECRETO, INICIO + PERIODO);
    assert.notEqual(antes.clave, despues.clave);
    for (let i = 0; i < MITAD; i++) {
      assert.equal(almacen.consumir(antes, fin + i), true);
    }
    for (let i = 0; i < MITAD; i++) {
      const instante = INICIO + PERIODO + i;
      assert.equal(
        almacen.consumir(await identificadoresLimiteRecorrido(peticion(), SECRETO, instante), instante),
        true,
      );
    }
    const bloqueo = INICIO + PERIODO + MITAD;
    assert.equal(almacen.consumir(await identificadoresLimiteRecorrido(peticion(), SECRETO, bloqueo), bloqueo), false);
    assert.equal(almacen.admite(await identificadoresLimiteRecorrido(peticion(), SECRETO, bloqueo), bloqueo), false);
    const casiLibre = fin + VENTANA_MS - 1;
    assert.equal(
      almacen.consumir(await identificadoresLimiteRecorrido(peticion(), SECRETO, casiLibre), casiLibre),
      false,
    );
    const libre = fin + VENTANA_MS;
    const ids = await identificadoresLimiteRecorrido(peticion(), SECRETO, libre);
    assert.equal(almacen.consumir(ids, libre), true);
    assert.equal(almacen.consumir(ids, libre), false);
  } finally {
    db.close();
  }
});

test('la misma IP en periodos separados más allá de la ventana da huellas distintas sin la dirección', async () => {
  const primera = await identificadoresLimiteRecorrido(peticion(), SECRETO, INICIO);
  const igual = await identificadoresLimiteRecorrido(peticion(), SECRETO, INICIO + PERIODO - 1);
  const siguiente = await identificadoresLimiteRecorrido(peticion(), SECRETO, INICIO + PERIODO);
  const lejana = await identificadoresLimiteRecorrido(
    peticion(),
    SECRETO,
    INICIO + VENTANA_MS * PERIODOS_DE_SEPARACION,
  );
  assert.equal(igual.clave, primera.clave);
  assert.notEqual(siguiente.clave, primera.clave);
  assert.equal(siguiente.recientes[0], primera.clave);
  assert.notEqual(lejana.clave, primera.clave);
  assert.equal(lejana.recientes.includes(primera.clave), false);
  assert.equal(lejana.recientes.includes(siguiente.clave), false);
  assert.notEqual(lejana.clave, hmac(SECRETO, `faro/limite-recorrido/v2:${IP}`));
  assert.doesNotMatch(JSON.stringify([primera, lejana]), /192\.0\.2/);
});

test('migración: las filas v2 recientes cuentan y no se reescriben; las vencidas se retiran solas', async () => {
  const { db, almacen } = preparar();
  try {
    const ahora = INICIO + CERCA;
    const v2 = hmac(SECRETO, `faro/limite-recorrido/v2:${IP}`);
    const marcas = Array.from({ length: MAX_INTENTOS - 1 }, (_, i) => ahora - VENTANA_MS + 1 + i);
    db.prepare('INSERT INTO portal_limite_continuo VALUES (?,?,?)').run(v2, JSON.stringify(marcas), ahora + VENTANA_MS);
    const ids = await identificadoresLimiteRecorrido(peticion(), SECRETO, ahora);
    assert.notEqual(ids.clave, v2);
    assert.equal(ids.recientes.includes(v2), true);
    assert.equal(almacen.admite(ids, ahora), true);
    assert.equal(almacen.consumir(ids, ahora), true);
    assert.equal(almacen.consumir(ids, ahora), false);
    assert.equal(
      db.prepare('SELECT marcas FROM portal_limite_continuo WHERE clave=?').get(v2)?.marcas,
      JSON.stringify(marcas),
    );
    const vencida = ahora + VENTANA_MS;
    const tarde = await identificadoresLimiteRecorrido(peticion(), SECRETO, vencida);
    assert.equal(almacen.consumir(tarde, vencida), true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM portal_limite_continuo WHERE clave=?').get(v2)?.n, 0);
  } finally {
    db.close();
  }
});

test('migración del portal: la fila v2 con su propósito sigue contando tras el cambio', async () => {
  const { db, almacen } = preparar();
  try {
    const ahora = INICIO + CERCA;
    const v2 = hmac(SECRETO, `faro/acceso-portal/v1:${hmac(SECRETO, `faro/limite-recorrido/v2:${IP}`)}`);
    const marcas = Array.from({ length: MAX_INTENTOS }, (_, i) => ahora - MAX_INTENTOS + i);
    db.prepare('INSERT INTO portal_limite_continuo VALUES (?,?,?)').run(v2, JSON.stringify(marcas), ahora + VENTANA_MS);
    const ids = await identificadoresLimitePortal(peticion(), SECRETO, ahora);
    assert.notEqual(ids.clave, v2);
    assert.equal(almacen.consumir(ids, ahora), false);
    assert.equal(almacen.consumir(ids, ahora - MAX_INTENTOS + VENTANA_MS), true);
  } finally {
    db.close();
  }
});

test('un desfase de un segundo entre el reloj del Worker y el del objeto no da más intentos en el borde', async () => {
  const DESFASE = 1000;
  const borde = INICIO + PERIODO;
  const ids = (ahora: number) => identificadoresLimiteRecorrido(peticion(), SECRETO, ahora);
  // [instante del objeto en la primera escritura, desfase del Worker que escribe, instante del objeto al leer, desfase
  // del Worker que lee]; el Worker ve el instante del objeto más su desfase. En los tres, el Worker que lee está en otro
  // periodo que el que escribió: dos por detrás (los dos primeros) o uno por delante (el tercero).
  const casos = [
    [borde + 1, -DESFASE, borde + PERIODO, 0],
    [borde - MAX_INTENTOS, 0, borde + PERIODO - MAX_INTENTOS - 1, DESFASE],
    [borde + PERIODO - MAX_INTENTOS, DESFASE, borde + PERIODO - 1, 0],
  ] as const;
  for (const [escribe, desfaseEscritor, lee, desfaseLector] of casos) {
    const { db, almacen } = preparar();
    try {
      for (let i = 0; i < MAX_INTENTOS; i++) {
        assert.equal(almacen.consumir(await ids(escribe + i + desfaseEscritor), escribe + i), true);
      }
      const lector = await ids(lee + desfaseLector);
      assert.notEqual(lector.clave, (await ids(escribe + desfaseEscritor)).clave);
      assert.equal(almacen.consumir(lector, lee), false, String(escribe));
      assert.equal(almacen.admite(lector, lee), false, String(escribe));
      const portal = await identificadoresLimitePortal(peticion(), SECRETO, lee + desfaseLector);
      assert.equal(portal.recientes.length, MAX_RECIENTES_LEIDOS);
    } finally {
      db.close();
    }
  }
});

test('vector conocido de la versión 3: periodo actual, vecinos, estable v2 y red /64', async () => {
  const ids = await identificadoresLimiteRecorrido(peticion(), SECRETO, INICIO);
  // Calculado aparte con HMAC-SHA-256(SECRETO, «faro/limite-recorrido/v3:<periodo>:<red>») para los periodos 1000, 999,
  // 1001 y 998, y HMAC-SHA-256(SECRETO, «faro/limite-recorrido/v2:<red>»).
  assert.equal(ids.clave, 'd0747c2748e65f0563245ed55d7d9e19efbc233fa18450367670e9cb0f474493');
  assert.deepEqual(ids.recientes, [
    '8674df4da18bff55d9e9f9eae188b35a3c545de335cad2f59df6a40943f110fc',
    'c811638dc785545125f9e795b00a3a30d6abef50fca0f6c9dbe84e310c39447e',
    '66a6d3f70e43b2e082beab1b7d7714772671120b5f1fde0e4fde61519c61ec0d',
    'edc768410dc0218a1a7a9565273c72b6f2b33b52dae74bc41dd841d321417cd6',
  ]);
  const v6 = await identificadoresLimiteRecorrido(peticion('2001:db8:12:34::abcd'), SECRETO, INICIO);
  assert.equal(v6.clave, '36b35bfec1dc8995f1cfec7bf8138135677141711d95578d84eec8384f8290cd');
});

test('el objeto admite como mucho cuatro huellas vecinas más la actual y rechaza una quinta', () => {
  const { db, almacen } = preparar();
  try {
    const huella = (letra: string) => letra.repeat(TAM_HUELLA);
    const cuatro = ['b', 'c', 'd', 'e'].map(huella);
    assert.equal(almacen.consumir({ clave: huella('a'), recientes: cuatro, anteriores: [] }, INICIO), true);
    assert.throws(
      () => almacen.consumir({ clave: huella('a'), recientes: [...cuatro, huella('f')], anteriores: [] }, INICIO),
      /no válido/,
    );
    assert.throws(
      () => almacen.admite({ clave: huella('a'), recientes: [...cuatro, huella('f')], anteriores: [] }, INICIO),
      /no válido/,
    );
  } finally {
    db.close();
  }
});
