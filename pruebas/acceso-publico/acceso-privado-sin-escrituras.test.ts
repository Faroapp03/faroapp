import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ProgramadorAlarmaDurable } from '../../src/plataforma/acceso-publico/mantenimiento-durable.ts';
import { operarRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-durable.ts';
import { AlmacenSesionRecorridoSqlite } from '../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts';
import { AlmacenSesionPanelSqlite } from '../../src/plataforma/acceso-publico/sesion-sqlite.ts';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';

const OK = 200;
const NO_AUTENTICADO = 401;
const LIMITADO = 429;
const NO_DISPONIBLE = 503;
const MAXIMO = 10;
const SIMULTANEAS = 40;
const SECUENCIALES = 200;
const ESPERA_ALARMA_MS = 2;
const MINUTO = 60_000;
const tareaDeLimites = (sesion: AlmacenSesionRecorridoSqlite) =>
  ({
    operacion: 'retirada-intentos',
    vencimiento: async () => sesion.vencimientoLimites(),
    ejecutar: async () => sesion.retirarLimitesVencidos(Date.now()),
  }) as const;
const CLAVE = 'contrasena-compartida-sintetica-de-32-bytes';
const LIMITE = 'clave-del-limite-sintetica-distinta-de-32-bytes';
const basic = (clave = CLAVE) => `Basic ${Buffer.from(`Faro:${clave}`).toString('base64')}`;

/** Alarma en memoria que tarda como el almacenamiento real, para que las operaciones en serie se acumulen. */
function alarmasAsincronas() {
  let fecha: number | null = null;
  const espera = () => new Promise((listo) => setTimeout(listo, ESPERA_ALARMA_MS));
  return {
    getAlarm: async () => {
      await espera();
      return fecha;
    },
    setAlarm: async (siguiente: number) => {
      await espera();
      fecha = siguiente;
    },
    deleteAlarm: async () => {
      await espera();
      fecha = null;
    },
  };
}

/** Autoridad durable completa: almacén SQLite, ruta durable y programador real con alarma asíncrona. */
function autoridad() {
  const db = new DatabaseSync(':memory:');
  const base = motorPanel(db);
  new AlmacenPublicoSqlite(base, { maxClientes: 2 });
  new AlmacenSesionPanelSqlite(base);
  const escrituras: string[] = [];
  const sql = {
    ...base,
    ejecutar: (sentencia: string, ...valores: Parameters<typeof base.ejecutar>[1][]) => {
      escrituras.push(sentencia);
      base.ejecutar(sentencia, ...valores);
    },
  };
  const alarmas = alarmasAsincronas();
  let cubiertas = 0;
  let programador: ProgramadorAlarmaDurable | undefined;
  const sesion = new AlmacenSesionRecorridoSqlite(sql, {
    cubrir: (vence, escribir) => {
      cubiertas++;
      assert.ok(programador);
      return programador.cubrir(vence, escribir);
    },
  });
  programador = new ProgramadorAlarmaDurable(alarmas, [tareaDeLimites(sesion)]);
  escrituras.length = 0;
  const entorno = {
    FARO_PRUEBAS_CLAVE: CLAVE,
    FARO_PRUEBAS_LIMITE: LIMITE,
    ASSETS: { fetch: async () => new Response() },
    REGISTRO_SOCIOS: {
      idFromName: () => 'id',
      get: () => ({
        fetch: async (peticion: Request) =>
          Response.json(await operarRecorridoDurable(sesion, new URL(peticion.url).pathname, await peticion.json())),
      }),
    },
  };
  const pedir = (auth: string, ip = '192.0.2.40', env: Record<string, unknown> = entorno) =>
    responderAccesoPrivado(
      new Request('https://ejemplo.invalid/recurso.js', { headers: { 'cf-connecting-ip': ip, authorization: auth } }),
      env as typeof entorno,
      async () => new Response('ok'),
    );
  const filas = () => Number(db.prepare('SELECT count(*) AS n FROM portal_limite_continuo').get()?.n);
  return { db, entorno, pedir, filas, escrituras, cubiertas: () => cubiertas };
}

test('la contraseña correcta no escribe, no pasa por cubrir y no entra en la cola del programador', async () => {
  const { db, pedir, filas, escrituras, cubiertas } = autoridad();
  try {
    for (let i = 0; i < SECUENCIALES; i++) {
      assert.equal((await pedir(basic())).status, OK);
    }
    const simultaneas = await Promise.all(Array.from({ length: SIMULTANEAS }, () => pedir(basic())));
    assert.deepEqual(
      simultaneas.map((r) => r.status),
      Array(SIMULTANEAS).fill(OK),
    );
    assert.equal(filas(), 0);
    assert.deepEqual(escrituras, []);
    assert.equal(cubiertas(), 0);
  } finally {
    db.close();
  }
});

test('con la IP bloqueada por fallos, la contraseña correcta sigue rechazada sin escribir', async () => {
  const { db, pedir, filas, escrituras, cubiertas } = autoridad();
  try {
    for (let i = 0; i < MAXIMO; i++) {
      assert.equal((await pedir(basic('contrasena-erronea-sintetica-32-bytes-x'))).status, NO_AUTENTICADO);
    }
    assert.equal(cubiertas(), MAXIMO);
    const antes = db.prepare('SELECT clave,marcas,caduca FROM portal_limite_continuo').all();
    const escritas = escrituras.length;
    assert.equal(filas(), 1);
    assert.equal((await pedir(basic())).status, LIMITADO);
    assert.equal((await pedir(basic(), '192.0.2.41')).status, OK);
    assert.equal(escrituras.length, escritas);
    assert.equal(cubiertas(), MAXIMO);
    assert.deepEqual(db.prepare('SELECT clave,marcas,caduca FROM portal_limite_continuo').all(), antes);
  } finally {
    db.close();
  }
});

test('sin la clave del límite, corta o igual a la contraseña, la privada responde 503 sin delegar', async () => {
  const { db, entorno, pedir } = autoridad();
  try {
    const { FARO_PRUEBAS_LIMITE: _limite, ...sinLimite } = entorno;
    for (const env of [
      sinLimite,
      { ...entorno, FARO_PRUEBAS_LIMITE: 'corta' },
      { ...entorno, FARO_PRUEBAS_LIMITE: CLAVE },
      { ...entorno, FARO_PRUEBAS_LIMITE: 1 },
    ]) {
      assert.equal((await pedir(basic(), '192.0.2.40', env)).status, NO_DISPONIBLE);
    }
  } finally {
    db.close();
  }
});

test('las huellas que se escriben dependen de la clave del límite y no de la contraseña compartida', async () => {
  const claves = async (cambios: Record<string, unknown>) => {
    const { db, entorno, pedir } = autoridad();
    try {
      const erronea = basic('erronea-sintetica-de-mas-de-32-bytes-1');
      assert.equal((await pedir(erronea, '192.0.2.40', { ...entorno, ...cambios })).status, NO_AUTENTICADO);
      return db
        .prepare('SELECT clave FROM portal_limite_continuo')
        .all()
        .map((f) => f.clave);
    } finally {
      db.close();
    }
  };
  const base = await claves({});
  assert.equal(base.length, 1);
  const otraContrasena = await claves({ FARO_PRUEBAS_CLAVE: 'otra-contrasena-compartida-de-32-bytes' });
  const otroLimite = await claves({ FARO_PRUEBAS_LIMITE: 'otra-clave-del-limite-sintetica-de-32-bytes' });
  assert.deepEqual(otraContrasena, base);
  assert.notDeepEqual(otroLimite, base);
  const deLaContrasena = createHmac('sha256', CLAVE)
    .update(
      `faro/acceso-pruebas/v1:${createHmac('sha256', CLAVE).update('faro/limite-recorrido/v2:192.0.2.40').digest('hex')}`,
    )
    .digest('hex');
  assert.notEqual(base[0], deLaContrasena);
});

test('migración: las filas v2 recientes de la privada, firmadas con la contraseña, siguen contando', async () => {
  const { db, pedir, filas } = autoridad();
  try {
    const v2 = createHmac('sha256', CLAVE)
      .update(
        `faro/acceso-pruebas/v1:${createHmac('sha256', CLAVE).update('faro/limite-recorrido/v2:192.0.2.40').digest('hex')}`,
      )
      .digest('hex');
    const ahora = Date.now();
    const marcas = Array.from({ length: MAXIMO - 1 }, (_, i) => ahora - MAXIMO + i);
    db.prepare('INSERT INTO portal_limite_continuo VALUES (?,?,?)').run(v2, JSON.stringify(marcas), ahora + MINUTO);
    assert.equal((await pedir(basic('erronea-sintetica-de-mas-de-32-bytes-1'))).status, NO_AUTENTICADO);
    assert.equal((await pedir(basic('erronea-sintetica-de-mas-de-32-bytes-1'))).status, LIMITADO);
    assert.equal((await pedir(basic())).status, LIMITADO);
    assert.equal(filas(), 2);
    assert.equal(
      db.prepare('SELECT marcas FROM portal_limite_continuo WHERE clave=?').get(v2)?.marcas,
      JSON.stringify(marcas),
    );
  } finally {
    db.close();
  }
});
