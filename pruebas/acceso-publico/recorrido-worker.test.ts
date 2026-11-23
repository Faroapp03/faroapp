import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AccesoPublicoDurable, type EspacioAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import worker from '../../src/plataforma/cloudflare/worker-privado.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import type { VarianteRecorrido } from '../../src/plataforma/variantes-recorrido.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { asegurarDesafioSi401 } from '../ayudas/desafio.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

/** Contraseña compartida y clave del límite de la entrega privada, distintas entre sí. */
const PRIVADA = {
  FARO_PRUEBAS_CLAVE: 'clave-general-sintetica-para-pruebas-32-bytes',
  FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
};
const ORIGEN = 'https://ejemplo.invalid';
const STATUS_OK = 200,
  STATUS_AUTORIZACION = 401,
  STATUS_PROHIBIDO = 403,
  STATUS_REDIRECCION = 303,
  STATUS_NO_DISPONIBLE = 503,
  STATUS_NO_ENCONTRADO = 404;
const AUTORIZACION = `Basic ${Buffer.from('Faro:clave-general-sintetica-para-pruebas-32-bytes').toString('base64')}`;
const TAM_HUELLA = 64;
/**
 * La primera extensión del registro hace de modo inactivo; sin extensiones solo hay un recorrido y no hay
 * alternancia.
 */
const [EXTENSION] = EXTENSIONES;
const SIN_EXTENSIONES = EXTENSION === undefined && 'Sin extensiones instaladas no hay otro recorrido que alternar.';

function crearDurable(db: DatabaseSync) {
  return new AccesoPublicoDurable(
    {
      storage: {
        ...alarmaDurableDePrueba(),
        sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
        transactionSync: <T>(accion: () => T) => {
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
      },
    },
    {},
  );
}

async function activarModo(
  espacio: EspacioAccesoPublicoDurable,
  revision: number,
  modo: VarianteRecorrido,
): Promise<void> {
  const almacen = new AlmacenRecorridoDurable(espacio);
  const acceso = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
  if (revision === 0) {
    await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
    await abrirSesionDePrueba(almacen, acceso);
  }
  assert.equal((await almacen.cambiarRecorridoDeSesion(acceso, revision, modo)).estado, 'cambiado');
}

test('Worker exige el acceso general y la contraseña del modo inactivo frente al durable real', {
  skip: SIN_EXTENSIONES,
}, async () => {
  assert.ok(EXTENSION);
  const otra = `/${EXTENSION.entrada}`;
  const db = new DatabaseSync(':memory:');
  try {
    const durable = crearDurable(db);
    const espacio = { idFromName: () => 'id', get: () => ({ fetch: (p: Request) => durable.fetch(p) }) };
    const env = {
      REGISTRO_SOCIOS: espacio,
      ASSETS: { fetch: async () => new Response('contenido') },
      ...PRIVADA,
      FARO_RECORRIDO_CLAVE: 'clave-inactiva-sintetica',
      FARO_RECORRIDO_FIRMA: 'firma-sintetica-distinta-con-mas-de-32-bytes',
      FARO_RECORRIDO_LIMITE: 'limite-sintetico-distinto-con-mas-de-32-bytes',
    };
    await activarModo(espacio, 0, EXTENSION.id);
    const pedir = (ruta: string, init: RequestInit = {}) =>
      worker.fetch(
        new Request(`${ORIGEN}${ruta}`, {
          ...init,
          headers: { authorization: AUTORIZACION, 'cf-connecting-ip': '192.0.2.10', ...init.headers },
        }),
        env,
      );
    const anonima = await worker.fetch(new Request(`${ORIGEN}${otra}`), env);
    assert.equal(asegurarDesafioSi401(anonima, 'Basic').status, STATUS_AUTORIZACION);
    assert.equal((await pedir(otra)).status, STATUS_OK);
    assert.equal((await pedir('/recorrido.html')).status, STATUS_PROHIBIDO);
    const entrada = await pedir('/recorrido.html', {
      method: 'POST',
      headers: { origin: ORIGEN, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'clave=clave-inactiva-sintetica',
    });
    assert.equal(entrada.status, STATUS_REDIRECCION);
    const cookie = entrada.headers.get('set-cookie');
    assert.ok(cookie);
    assert.equal(
      (await pedir('/recorrido.html', { headers: { cookie: cookie.split(';')[0] ?? '' } })).status,
      STATUS_OK,
    );
    await activarModo(espacio, 1, 'real');
    for (const carpeta of EXTENSION.rutasProtegidas.filter((ruta) => ruta.endsWith('/'))) {
      assert.equal((await pedir(`${carpeta}recurso.js`)).status, STATUS_PROHIBIDO, carpeta);
    }
  } finally {
    db.close();
  }
});

test('el reinicio no repone una fila ausente ni un modo corrupto', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    crearDurable(db);
    db.exec('DELETE FROM administracion_recorrido');
    let durable = crearDurable(db);
    const espacio = { idFromName: () => 'id', get: () => ({ fetch: (p: Request) => durable.fetch(p) }) };
    const env = {
      REGISTRO_SOCIOS: espacio,
      ASSETS: { fetch: async () => new Response('contenido') },
      ...PRIVADA,
    };
    const pedir = () =>
      worker.fetch(
        new Request(`${ORIGEN}/modo-recorrido.json`, {
          headers: { authorization: AUTORIZACION, 'cf-connecting-ip': '192.0.2.10' },
        }),
        env,
      );
    assert.equal((await pedir()).status, STATUS_NO_DISPONIBLE);
    assert.equal(db.prepare('SELECT count(*) AS n FROM administracion_recorrido').get()?.n, 0);
    db.exec('PRAGMA ignore_check_constraints=ON');
    db.exec("INSERT INTO administracion_recorrido VALUES (1,1,'invalido')");
    durable = crearDurable(db);
    assert.equal((await pedir()).status, STATUS_NO_DISPONIBLE);
    assert.equal(db.prepare('SELECT modo FROM administracion_recorrido').get()?.modo, 'invalido');
    db.exec('DROP TABLE administracion_recorrido');
    db.exec('DROP TABLE administracion_recorrido_intentos');
    durable = crearDurable(db);
    assert.equal((await pedir()).status, STATUS_NO_DISPONIBLE);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_recorrido'").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});

test('puerta oficial comparte selector y privada mantiene canales externos y actualización cerrados', {
  skip: SIN_EXTENSIONES,
}, async () => {
  assert.ok(EXTENSION);
  const { default: oficial } = await import('../../src/plataforma/cloudflare/worker-unificado.ts');
  const db = new DatabaseSync(':memory:');
  try {
    const durable = crearDurable(db);
    const env = {
      REGISTRO_SOCIOS: { idFromName: () => 'id', get: () => ({ fetch: (p: Request) => durable.fetch(p) }) },
      ASSETS: { fetch: async () => new Response('contenido') },
    };
    await activarModo(env.REGISTRO_SOCIOS, 0, EXTENSION.id);
    assert.equal((await oficial.fetch(new Request(`${ORIGEN}/${EXTENSION.entrada}`), env)).status, STATUS_OK);
    assert.equal((await oficial.fetch(new Request(`${ORIGEN}/modo-recorrido.json`), env)).status, STATUS_OK);
    for (const ruta of [
      '/mcp',
      '/a2a',
      '/.well-known/agent-card.json',
      '/api/socios/v1/token',
      '/.well-known/oauth-authorization-server/api/socios/v1',
      '/administracion/api/controles/cambiar',
      '/administracion/api/datos/actualizar',
      '/mantenimiento/inicio',
      '/mantenimiento/resultado',
      '/mantenimiento/activacion',
      '/%6dcp',
    ]) {
      assert.equal(
        (
          await worker.fetch(
            new Request(`${ORIGEN}${ruta}`, {
              headers: { authorization: AUTORIZACION, 'cf-connecting-ip': '192.0.2.10' },
            }),
            {
              ...env,
              ...PRIVADA,
            },
          )
        ).status,
        STATUS_NO_ENCONTRADO,
        ruta,
      );
    }
  } finally {
    db.close();
  }
});

test('la capacidad del panel distingue el privado del oficial y nunca se almacena en caché', async () => {
  const { default: oficial } = await import('../../src/plataforma/cloudflare/worker-unificado.ts');
  const env = {
    REGISTRO_SOCIOS: { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ permitido: true }) }) },
    ASSETS: { fetch: async () => new Response('') },
    ...PRIVADA,
  };
  const privada = await worker.fetch(
    new Request(`${ORIGEN}/capacidades-panel.json`, {
      headers: { authorization: AUTORIZACION, 'cf-connecting-ip': '192.0.2.10' },
    }),
    env,
  );
  assert.equal(privada.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await privada.json(), {
    version: 1,
    controles: false,
    actualizacion: false,
    vigilante: false,
    recorrido: false,
  });
  const publica = await oficial.fetch(new Request(`${ORIGEN}/capacidades-panel.json`), env);
  assert.equal(publica.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await publica.json(), {
    version: 1,
    controles: true,
    actualizacion: true,
    vigilante: false,
    recorrido: true,
  });
  const invalida = await oficial.fetch(new Request(`${ORIGEN}/capacidades-panel.json`), {
    ...env,
    FARO_VIGILANTE: '{invalido',
  });
  assert.equal(((await invalida.json()) as { vigilante: boolean }).vigilante, true);
});

test('los módulos públicos de etapas llegan a ASSETS sin atravesar la lista privada del panel', async () => {
  const { responderUnificado } = await import('../../src/plataforma/cloudflare/worker-unificado.ts');
  const rutas: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (peticion: Request) => {
        rutas.push(new URL(peticion.url).pathname);
        return new Response('export {};', { headers: { 'content-type': 'text/javascript' } });
      },
    },
  };
  for (const ruta of ['/scripts/etapas.js', '/scripts/dom.js', '/scripts/idioma.js', '/scripts/textos.js']) {
    const respuesta = await responderUnificado(new Request(`${ORIGEN}${ruta}`), env);
    assert.equal(respuesta.status, STATUS_OK);
    assert.match(respuesta.headers.get('content-type') ?? '', /javascript/);
  }
  assert.deepEqual(rutas, ['/scripts/etapas.js', '/scripts/dom.js', '/scripts/idioma.js', '/scripts/textos.js']);
});
