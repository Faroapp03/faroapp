import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  AlmacenLimiteContinuoSqlite,
  type IdentificadoresLimite,
} from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import {
  esRutaRecorridoDurable,
  operarRecorridoDurable,
} from '../../src/plataforma/acceso-publico/recorrido-durable.ts';
import type { AlmacenSesionRecorridoSqlite } from '../../src/plataforma/acceso-publico/sesion-recorrido-sqlite.ts';
import type { SqlAccesoPublico, ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';
import { identificadoresLimitePrivado } from '../../src/plataforma/cloudflare/limite-privado.ts';
import { conDesafio } from '../ayudas/desafio.ts';

const OK = 200;
const NO_AUTENTICADO = 401;
const LIMITADO = 429;
const NO_DISPONIBLE = 503;
const MIL = 1000;
const TAM_HUELLA = 64;
const FILAS_MENOS_UNA = 9999;
const CADUCIDAD_LEJANA = 9999999999999;
/** Versión del contrato de los intentos que exige el objeto en el primer nivel del mensaje. */
const CONTRATO = 3;
const PERIODO = 900_000;
/** Un instante fijo, lejos de cualquier borde de periodo, para que dos huellas calculadas por separado coincidan. */
const AHORA_FIJO = PERIODO * MIL + PERIODO / 2;
/** La mitad de los intentos de la ventana. */
const MITAD = 5;
const secreto = 'clave-sintetica-exclusiva-de-pruebas-123456789';
const secretoLimite = 'clave-del-limite-sintetica-de-pruebas-123456789';
const basic = `Basic ${Buffer.from(`Faro:${secreto}`).toString('base64')}`;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE publico_estado (id INTEGER PRIMARY KEY) STRICT; INSERT INTO publico_estado VALUES (1); CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY, caduca INTEGER NOT NULL, usados INTEGER NOT NULL) STRICT',
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
  const almacen = new AlmacenLimiteContinuoSqlite(sql);
  const entorno = {
    FARO_PRUEBAS_CLAVE: secreto,
    FARO_PRUEBAS_LIMITE: secretoLimite,
    ASSETS: { fetch: async () => new Response() },
    REGISTRO_SOCIOS: {
      idFromName: () => 1,
      get: () => ({
        fetch: async (r: Request) => {
          const { clave, valido } = (await r.json()) as {
            clave: IdentificadoresLimite;
            valido: boolean;
          };
          return Response.json({
            permitido: valido ? almacen.admite(clave, Date.now()) : almacen.consumir(clave, Date.now()),
          });
        },
      }),
    },
  };
  const pedirSinMirar = (auth?: string, ip = '2001:db8:12:34::1') =>
    responderAccesoPrivado(
      new Request('https://ejemplo.invalid/', {
        headers: { 'cf-connecting-ip': ip, ...(auth === undefined ? {} : { authorization: auth }) },
      }),
      entorno,
      async () => new Response('ok'),
    );
  const pedir = conDesafio(pedirSinMirar, 'Basic');
  return { db, pedir, entorno, almacen };
}
test('válidos no gastan cuota; malos concurrentes y bloqueo posterior cierran', async () => {
  const { db, pedir } = fixture();
  try {
    assert.equal((await pedir()).status, NO_AUTENTICADO);
    for (let i = 0; i < MIL; i++) {
      assert.equal((await pedir(basic)).status, OK);
    }
    const resultados = await Promise.all(Array.from({ length: 20 }, () => pedir('Basic !!!')));
    assert.equal(resultados.filter((r) => r.status === NO_AUTENTICADO).length, 10);
    assert.equal(resultados.filter((r) => r.status === LIMITADO).length, 10);
    assert.equal((await pedir(basic, '2001:db8:12:34::2')).status, LIMITADO);
    assert.equal((await pedir(basic, '2001:db8:12:35::2')).status, OK);
  } finally {
    db.close();
  }
});
test('secreto débil o autoridad ausente falla cerrada', async () => {
  const { db, entorno } = fixture();
  try {
    const request = new Request('https://ejemplo.invalid/', {
      headers: { authorization: basic, 'cf-connecting-ip': '127.0.0.1' },
    });
    for (const env of [
      { ...entorno, FARO_PRUEBAS_CLAVE: 'corta' },
      { ...entorno, REGISTRO_SOCIOS: undefined },
    ]) {
      assert.equal(
        (await responderAccesoPrivado(request, env, async () => assert.fail('no delega'))).status,
        NO_DISPONIBLE,
      );
    }
  } finally {
    db.close();
  }
});
test('huellas IPv6 agrupan /64 y no contienen dirección', async () => {
  const a = await identificadoresLimitePrivado(
    new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '2001:db8:12:34::1' } }),
    secretoLimite,
    secreto,
    AHORA_FIJO,
  );
  const b = await identificadoresLimitePrivado(
    new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '2001:db8:12:34::2' } }),
    secretoLimite,
    secreto,
    AHORA_FIJO,
  );
  assert.deepEqual(a, b);
  assert.match(a.clave, /^[a-f0-9]{64}$/);
});

test('con la tabla llena, una red nueva cuenta en su prefijo y la conocida se sigue contando en su fila', async () => {
  const { db, pedir } = fixture();
  try {
    assert.equal((await pedir(basic)).status, OK);
    assert.equal(db.prepare('SELECT count(*) AS n FROM portal_limite_continuo').get()?.n, 0);
    assert.equal((await pedir('Basic !!!')).status, NO_AUTENTICADO);
    assert.equal(db.prepare('SELECT count(*) AS n FROM portal_limite_continuo').get()?.n, 1);
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO portal_limite_continuo SELECT lower(hex(randomblob(32))), '[1]', 9999999999999 FROM n",
    );
    assert.equal((await pedir('Basic !!!')).status, NO_AUTENTICADO);
    assert.equal((await pedir('Basic !!!', '2001:db8:12:35::1')).status, NO_AUTENTICADO);
    assert.equal(db.prepare('SELECT count(*) AS n FROM portal_limite_prefijos').get()?.n, 1);
    // La credencial correcta no escribe: no depende de que quede sitio, pero sí del bloqueo de su red.
    assert.equal((await pedir(basic)).status, OK);
    assert.equal((await pedir(basic, '2001:db8:12:35::1')).status, OK);
  } finally {
    db.close();
  }
});

test('cliente y ruta durable preservan la decisión y rechazan forma inválida', async () => {
  const clave = { clave: 'a'.repeat(TAM_HUELLA), recientes: ['c'.repeat(TAM_HUELLA)], anteriores: [] };
  let recibido = false;
  const almacen = {
    decidirIntentoPrivado: async (ids: typeof clave, valido: boolean) => {
      assert.deepEqual(ids, clave);
      assert.equal(valido, false);
      recibido = true;
      return false;
    },
  } as unknown as AlmacenSesionRecorridoSqlite;
  const espacio = {
    idFromName: () => 'id',
    get: () => ({
      fetch: async (peticion: Request) => {
        const resultado = await operarRecorridoDurable(almacen, new URL(peticion.url).pathname, await peticion.json());
        return Response.json(resultado);
      },
    }),
  };
  assert.equal(await new AlmacenRecorridoDurable(espacio).decidirIntentoPrivado(clave, false), false);
  assert.equal(recibido, true);
  assert.equal(await operarRecorridoDurable(almacen, '/privado/intento', { clave, valido: 'false' }), undefined);
});

test('la autoridad atiende la ruta privada y ya no la antigua, que solo usaban clientes sin la forma obligatoria', async () => {
  const clave = { clave: 'b'.repeat(TAM_HUELLA), recientes: [], anteriores: [] };
  const llamadas: Array<[typeof clave, boolean]> = [];
  const almacen = {
    decidirIntentoPrivado: async (ids: typeof clave, valido: boolean) => {
      llamadas.push([ids, valido]);
      return valido;
    },
  } as unknown as AlmacenSesionRecorridoSqlite;
  for (const valido of [true, false]) {
    const nueva = await operarRecorridoDurable(almacen, '/privado/intento', { version: CONTRATO, clave, valido });
    assert.deepEqual(nueva, { permitido: valido });
    assert.equal(
      await operarRecorridoDurable(almacen, '/pruebas/intento', { version: CONTRATO, clave, valido }),
      undefined,
    );
  }
  assert.equal(esRutaRecorridoDurable('/privado/intento'), true);
  assert.equal(esRutaRecorridoDurable('/pruebas/intento'), false);
  assert.deepEqual(llamadas, [
    [clave, true],
    [clave, false],
  ]);
});

const INICIO = 2_000_000;
const VENTANA = 900_000;
const ANTES_VENCER = 840_000;
const DESPUES_VENCER = 960_000;
test('versiones mezcladas: se rechazan formas incompatibles y el cliente envía el espejo', async () => {
  const clave = { clave: 'e'.repeat(TAM_HUELLA), recientes: ['f'.repeat(TAM_HUELLA)], anteriores: [] };
  const antigua = { clave: 'e'.repeat(TAM_HUELLA), anteriores: ['f'.repeat(TAM_HUELLA)] };
  const almacen = {
    decidirIntentoPrivado: async () => assert.fail('un mensaje de otra versión no llega al almacén'),
    consumirIntentoRecorrido: async () => assert.fail('un mensaje de otra versión no llega al almacén'),
  } as unknown as AlmacenSesionRecorridoSqlite;
  // La privada exige versión; el recorrido no acepta objetos legados sin versión ni versiones ajenas.
  const rechazados: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['/privado/intento', { clave, valido: false }],
    ['/privado/intento', { clave: antigua, valido: false }],
    ['/privado/intento', { version: 2, clave, valido: false }],
    ['/privado/intento', { version: '3', clave, valido: false }],
    ['/recorrido/intento', { clave }],
    ['/recorrido/intento', { clave: antigua }],
    ['/recorrido/intento', { version: 4, clave }],
  ];
  for (const [ruta, cuerpo] of rechazados) {
    assert.equal(await operarRecorridoDurable(almacen, ruta, cuerpo), undefined, JSON.stringify(cuerpo));
  }
  const enviados: unknown[] = [];
  const espacio = {
    idFromName: () => 'id',
    get: () => ({
      fetch: async (peticion: Request) => {
        enviados.push(await peticion.json());
        return Response.json({ error: 'solicitud_invalida' }, { status: 400 });
      },
    }),
  };
  const cliente = new AlmacenRecorridoDurable(espacio);
  await assert.rejects(cliente.decidirIntentoPrivado(clave, false));
  await assert.rejects(cliente.consumirIntentoRecorrido(clave));
  assert.deepEqual(enviados, [
    { version: CONTRATO, clave, valido: false },
    { version: CONTRATO, clave, espejo: true },
  ]);
});

test('privada: los intentos a ambos lados del borde del periodo suman en la misma ventana', async () => {
  const peticion = new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '192.0.2.40' } });
  const borde = PERIODO * (MIL + 1);
  const ids = (ahora: number) => identificadoresLimitePrivado(peticion, secretoLimite, secreto, ahora);
  const { db, almacen } = fixture();
  try {
    for (let i = 0; i < MITAD; i++) {
      assert.equal(almacen.consumir(await ids(borde - MITAD + i), borde - MITAD + i), true);
    }
    assert.notEqual((await ids(borde - 1)).clave, (await ids(borde)).clave);
    for (let i = 0; i < MITAD; i++) {
      assert.equal(almacen.consumir(await ids(borde + i), borde + i), true);
    }
    assert.equal(almacen.consumir(await ids(borde + MITAD), borde + MITAD), false);
    assert.equal(almacen.admite(await ids(borde + MITAD), borde + MITAD), false);
    const casiLibre = borde - MITAD + VENTANA - 1;
    assert.equal(almacen.admite(await ids(casiLibre), casiLibre), false);
    assert.equal(almacen.admite(await ids(casiLibre + 1), casiLibre + 1), true);
  } finally {
    db.close();
  }
});

test('privada: un desfase de un segundo entre el reloj del Worker y el del objeto no da más intentos en el borde', async () => {
  const peticion = new Request('https://ejemplo.invalid/', { headers: { 'cf-connecting-ip': '192.0.2.41' } });
  const borde = PERIODO * (MIL + 1);
  const DESFASE = 1000;
  const ids = (ahora: number) => identificadoresLimitePrivado(peticion, secretoLimite, secreto, ahora);
  // [instante del objeto en la primera escritura, desfase del Worker que escribe, instante del objeto al leer, desfase
  // del Worker que lee]; el Worker ve el instante del objeto más su desfase.
  const casos = [
    [borde + 1, -DESFASE, borde + PERIODO, 0],
    [borde - 10, 0, borde + PERIODO - 10 - 1, DESFASE],
    [borde + PERIODO - 10, DESFASE, borde + PERIODO - 1, 0],
  ] as const;
  for (const [escribe, desfaseEscritor, lee, desfaseLector] of casos) {
    const { db, almacen } = fixture();
    try {
      for (let i = 0; i < 10; i++) {
        assert.equal(almacen.consumir(await ids(escribe + i + desfaseEscritor), escribe + i), true);
      }
      assert.equal(almacen.consumir(await ids(lee + desfaseLector), lee), false, String(escribe));
      assert.equal(almacen.admite(await ids(lee + desfaseLector), lee), false, String(escribe));
    } finally {
      db.close();
    }
  }
});

test('huella activa mantiene capacidad cuando vence el primer TTL', () => {
  const { db, almacen } = fixture();
  const id = { clave: 'a'.repeat(TAM_HUELLA), recientes: [], anteriores: [] };
  try {
    assert.equal(almacen.consumir(id, INICIO), true);
    db.exec(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO portal_limite_continuo SELECT lower(hex(randomblob(32))), '[1]', 9999999999999 FROM n",
    );
    assert.equal(almacen.consumir(id, INICIO + ANTES_VENCER), true);
    db.prepare('DELETE FROM portal_limite_continuo WHERE caduca<=?').run(INICIO + DESPUES_VENCER);
    const count = db.prepare('SELECT count(*) AS n FROM portal_limite_continuo').get()?.n;
    if (count === FILAS_MENOS_UNA) {
      db.prepare('INSERT INTO portal_limite_continuo VALUES (?,?,?)').run(
        'c'.repeat(TAM_HUELLA),
        '[1]',
        CADUCIDAD_LEJANA,
      );
    }
    assert.equal(almacen.consumir(id, INICIO + DESPUES_VENCER), true);
    const nueva = { clave: 'b'.repeat(TAM_HUELLA), recientes: [], anteriores: [] };
    assert.equal(almacen.consumir(nueva, INICIO + DESPUES_VENCER), 'saturado');
    assert.equal(almacen.admite(nueva, INICIO + DESPUES_VENCER), true);
  } finally {
    db.close();
  }
});
test('un éxito rechazado no prolonga la cuota de fallos', () => {
  const { db, almacen } = fixture();
  const id = { clave: 'b'.repeat(TAM_HUELLA), recientes: [], anteriores: [] };
  try {
    for (let i = 0; i < 10; i++) {
      assert.equal(almacen.consumir(id, INICIO), true);
    }
    const antes = db.prepare('SELECT marcas,caduca FROM portal_limite_continuo WHERE clave=?').get(id.clave);
    assert.equal(almacen.admite(id, INICIO + ANTES_VENCER), false);
    assert.deepEqual(db.prepare('SELECT marcas,caduca FROM portal_limite_continuo WHERE clave=?').get(id.clave), antes);
    assert.equal(almacen.admite(id, INICIO + VENTANA), true);
  } finally {
    db.close();
  }
});

test('la clave durable privada conserva la derivación de su contrato anterior', async () => {
  const peticion = new Request('https://example.test/', { headers: { 'cf-connecting-ip': '192.0.2.17' } });
  const ids = await identificadoresLimitePrivado(peticion, secretoLimite, 'clave-sintetica-de-prueba-de-32-bytes');
  // La huella estable de la versión anterior se sigue leyendo, nunca escribiendo, mientras caducan sus filas.
  assert.equal(ids.recientes.at(-1), '87caf7532fc189cd00a7c331ee792f070cd824600d49b8d8b14b48e69ed7573f');
  assert.notEqual(ids.clave, '87caf7532fc189cd00a7c331ee792f070cd824600d49b8d8b14b48e69ed7573f');
  assert.deepEqual(ids.anteriores, []);
});

test('vector conocido de la versión 3 en la privada: periodo actual, vecinos y estable', async () => {
  const peticion = new Request('https://example.test/', { headers: { 'cf-connecting-ip': '192.0.2.17' } });
  const ids = await identificadoresLimitePrivado(
    peticion,
    secretoLimite,
    'clave-sintetica-de-prueba-de-32-bytes',
    PERIODO * MIL,
  );
  // Calculado aparte: HMAC(secretoLimite, «faro/acceso-pruebas/v1:» + HMAC(secretoLimite, «faro/limite-recorrido/v3:
  // <periodo>:192.0.2.17»)) para los periodos 1000, 999, 1001 y 998; el prefijo, igual con «v3-prefijo» y 192.0.2.0/24.
  // La estable de la versión 2 no se recalcula aquí.
  assert.deepEqual(ids, {
    clave: '885fe271b242cfce275843efda11f0fbad4d63237d13ff3eafd1e9a0ffb7e03d',
    recientes: [
      '0c10e40a62b529be439d9cf1cf9fcd435c5259a419589522af76ac87ed2905b1',
      '4ee7b4aad537cc287843d0e7f592f11410a495720e873104761833479a9162c2',
      '69b9fd46fb24840e87144decd16daf38c1301e7f7cd429fcccd86d12a41849a6',
      '87caf7532fc189cd00a7c331ee792f070cd824600d49b8d8b14b48e69ed7573f',
    ],
    anteriores: [],
    prefijo: {
      clave: '8314322aba0d6cdb0e5f62fa90f20c60c063e1126e4cf1f7a1bcb603444fca94',
      recientes: [
        '65c50ec13b96b281f1eda3077c0040128d6f21cba1e76a9cf364bba1c7f36266',
        'd699b9ed99e19f7c047c2c889223af00b17ee2f3af8976a53342c6722416bce4',
        'a6716454e477757f00396b0d75478db2b8e846258c0fb5ed64ef3293ab27186f',
      ],
    },
  });
});
