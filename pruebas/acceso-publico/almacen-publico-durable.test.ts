import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import {
  AccesoPublicoDurable,
  AlmacenPublicoDurable,
  AlmacenPublicoNoDisponible,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';

const CARACTERES_JTI = 22;
const MS_POR_SEGUNDO = 1000;
const VIDA_REVOCACION_S = 100;
const LLAMADAS_REMOTAS = 6;
const MENSAJE_GRANDE = 20_000;
const RESPUESTA_GRANDE = 3000;

const entorno = {};
function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      sql: {
        exec: (sql: string, ...valores: ValorSql[]) => {
          const filas = db.prepare(sql).all(...valores);
          return { toArray: () => filas };
        },
      },
      transactionSync: <T>(accion: () => T): T => {
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
    },
  };
}

test('DO privado sobre doble SQL real, nuevo stub por operación, cuotas y revocaciones persistidas', async () => {
  const db = new DatabaseSync(':memory:');
  const estado = estadoSqlite(db);
  let durable = new AccesoPublicoDurable(estado, entorno);
  let stubs = 0;
  const namespace: EspacioAccesoPublicoDurable = {
    idFromName: (nombre) => {
      assert.equal(nombre, 'registro-publico-v1');
      return nombre;
    },
    get: () => {
      stubs++;
      return { fetch: (peticion) => durable.fetch(peticion) };
    },
  };
  const almacen = new AlmacenPublicoDurable(namespace);
  try {
    const cuentas = [{ clave: 'consultas:global', limite: 1, ventanaMs: 86_400_000 }];
    assert.equal(await almacen.consumir(cuentas), true);
    assert.equal(await almacen.consumir(cuentas), false);
    await almacen.revocar('a'.repeat(CARACTERES_JTI), Math.floor(Date.now() / MS_POR_SEGUNDO) + VIDA_REVOCACION_S);
    assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), true);
    durable = new AccesoPublicoDurable(estado, entorno);
    assert.equal(await almacen.consumir(cuentas), false);
    assert.equal(await almacen.revocado('a'.repeat(CARACTERES_JTI)), true);
    assert.equal(stubs, LLAMADAS_REMOTAS);
    const web = await durable.fetch(new Request('https://faro.example/consumir', { method: 'POST', body: '{}' }));
    assert.equal(web.status, ESTADO_HTTP.solicitudIncorrecta);
  } finally {
    db.close();
  }
});

test('DO limita mensajes y rechaza ámbitos, campos extra y fallo de almacenamiento', async () => {
  const db = new DatabaseSync(':memory:');
  const durable = new AccesoPublicoDurable(estadoSqlite(db), entorno);
  const enviar = (ruta: string, cuerpo: unknown) =>
    durable.fetch(
      new Request(`https://registro-socios.invalid${ruta}`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
      }),
    );
  try {
    assert.equal(
      (await enviar('/consumir', { cuentas: [], secreto: 'no guardar' })).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    assert.equal(
      (await enviar('/consumir', { relleno: 'x'.repeat(MENSAJE_GRANDE) })).status,
      ESTADO_HTTP.solicitudIncorrecta,
    );
    assert.equal((await enviar('/desconocido', {})).status, ESTADO_HTTP.solicitudIncorrecta);
    db.exec('DROP TABLE publico_contadores');
    const fallo = await enviar('/consumir', { cuentas: [{ clave: 'consultas:global', limite: 1, ventanaMs: 1000 }] });
    assert.equal(fallo.status, ESTADO_HTTP.noDisponible);
    assert.deepEqual(await fallo.json(), { error: 'almacen_no_disponible' });
  } finally {
    db.close();
  }
});

function remoto(responder: () => Response | Promise<Response>): AlmacenPublicoDurable {
  return new AlmacenPublicoDurable(
    { idFromName: () => 'id', get: () => ({ fetch: async () => responder() }) },
    { tiempoLimiteMs: 20 },
  );
}

test('cliente DO falla cerrado con respuesta inválida, grande, ajena, error o sin respuesta', async () => {
  for (const respuesta of [
    () => new Response('{'),
    () => new Response(JSON.stringify({ permitido: 'si' })),
    () => new Response(JSON.stringify({ permitido: true, secreto: 'x' })),
    () => new Response(JSON.stringify({ permitido: true, relleno: 'x'.repeat(RESPUESTA_GRANDE) })),
    () => new Response('{}', { status: 503 }),
    () => {
      throw new Error('fallo remoto con dato privado');
    },
    () => new Promise<Response>(() => undefined),
    () => new Response(new ReadableStream({ start() {} })),
  ]) {
    await assert.rejects(
      remoto(respuesta).consumir([{ clave: 'consultas:global', limite: 1, ventanaMs: 1000 }]),
      AlmacenPublicoNoDisponible,
    );
  }
});

test('jti inválido se rechaza en la frontera privada con 400 y sin consultar SQLite', async () => {
  const db = new DatabaseSync(':memory:');
  const estado = estadoSqlite(db);
  let consultas = 0;
  const observado: EstadoAccesoPublicoDurable = {
    storage: {
      ...estado.storage,
      sql: {
        exec: (sql, ...valores) => {
          consultas++;
          return estado.storage.sql.exec(sql, ...valores);
        },
      },
    },
  };
  const durable = new AccesoPublicoDurable(observado, entorno);
  consultas = 0;
  try {
    for (const ruta of ['/revocar', '/revocado']) {
      for (const jti of [
        '',
        'a'.repeat(CARACTERES_JTI - 1),
        'a'.repeat(CARACTERES_JTI + 1),
        ' '.repeat(CARACTERES_JTI),
        'ñ'.repeat(CARACTERES_JTI),
        null,
        1,
      ]) {
        const cuerpo = { jti, ...(ruta === '/revocar' ? { caducaS: VIDA_REVOCACION_S } : {}) };
        const respuesta = await durable.fetch(
          new Request(`https://registro-socios.invalid${ruta}`, {
            method: 'POST',
            body: JSON.stringify(cuerpo),
          }),
        );
        assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta);
        assert.deepEqual(await respuesta.json(), { error: 'solicitud_invalida' });
      }
    }
    assert.equal(consultas, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM publico_revocados').get()?.n, 0);
  } finally {
    db.close();
  }
});
