import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  estadoDelPaquete,
  MARCA_REGISTRO_FALLIDO,
  pedirAlmacenPersistente,
  prepararPaqueteSinConexion,
  SinServiceWorker,
} from '../../web/scripts/paquete-sin-conexion.js';

/** @param {import('node:test').TestContext} contexto @param {unknown} valor */
function navegador(contexto, valor) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  contexto.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'navigator', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: valor });
}

/** Lo más que se espera a un service worker activo (PLAZO_DEL_SERVICE_WORKER_MS en paquete-sin-conexion.js). */
const PLAZO_DEL_SERVICE_WORKER_MS = 120_000;

/** Un contenedor sin ningún registro: `ready`, como en el navegador, no se cumple nunca. */
function sinRegistro() {
  return Object.assign(new EventTarget(), {
    ready: new Promise(() => {}),
    getRegistration: async () => undefined,
    startMessages() {},
  });
}

/** <html> con su dataset, para la marca de registro fallido. @param {import('node:test').TestContext} contexto */
function documento(contexto, /** @type {Record<string, string>} */ dataset) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  contexto.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, 'document', anterior);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset } } });
}

test('sin la API del service worker, el motor recibe SinServiceWorker en el acto', async (contexto) => {
  navegador(contexto, {});
  await assert.rejects(estadoDelPaquete(), SinServiceWorker);
});

test('con el registro fallido y sin registro, el motor recibe SinServiceWorker en el acto', async (contexto) => {
  navegador(contexto, { serviceWorker: sinRegistro() });
  documento(contexto, { [MARCA_REGISTRO_FALLIDO]: '' });
  await assert.rejects(estadoDelPaquete(), SinServiceWorker);
});

test('sin registro ni marca, el motor recibe SinServiceWorker al vencer el plazo, no antes', async (contexto) => {
  contexto.mock.timers.enable({ apis: ['setTimeout'] });
  navegador(contexto, { serviceWorker: sinRegistro() });
  documento(contexto, {});
  /** @type {unknown} */
  let resultado = 'pendiente';
  const pendiente = estadoDelPaquete().then(
    () => {
      resultado = 'cumplida';
    },
    (/** @type {unknown} */ error) => {
      resultado = error;
    },
  );
  await new Promise((resolver) => setImmediate(resolver));
  contexto.mock.timers.tick(PLAZO_DEL_SERVICE_WORKER_MS - 1);
  await new Promise((resolver) => setImmediate(resolver));
  assert.equal(resultado, 'pendiente', 'antes del plazo sigue esperando');
  contexto.mock.timers.tick(1);
  await pendiente;
  assert.ok(
    /** @type {unknown} */ (resultado) instanceof SinServiceWorker,
    `SinServiceWorker, no ${String(resultado)}`,
  );
});

/** @param {import('node:test').TestContext} contexto */
function servicio(contexto) {
  /** @type {unknown[]} */
  const mensajes = [];
  const contenedor = new EventTarget();
  const registro = { active: { postMessage: (/** @type {unknown} */ datos) => mensajes.push(datos) } };
  Object.assign(contenedor, {
    ready: Promise.resolve(registro),
    getRegistration: async () => registro,
    startMessages() {},
  });
  navegador(contexto, { serviceWorker: contenedor });
  return { contenedor, mensajes };
}

for (const completo of [true, false, 'true', undefined]) {
  test(`estado del paquete conserva versión y completo estricto: ${completo}`, async (contexto) => {
    const { contenedor, mensajes } = servicio(contexto);
    const pendiente = estadoDelPaquete();
    await new Promise((resolver) => setImmediate(resolver));
    contenedor.dispatchEvent(new MessageEvent('message', { data: { type: 'OTRO' } }));
    contenedor.dispatchEvent(
      new MessageEvent('message', { data: { type: 'ESTADO_DEL_PAQUETE', version: 'version', completo } }),
    );
    assert.deepEqual(await pendiente, { version: 'version', completo: completo === true });
    assert.deepEqual(mensajes, [{ type: 'PREPARAR_PAQUETE' }]);
  });
}

test('un estado sin versión rechaza; preparar solo manda la petición', async (contexto) => {
  const { contenedor, mensajes } = servicio(contexto);
  const pendiente = estadoDelPaquete();
  await new Promise((resolver) => setImmediate(resolver));
  contenedor.dispatchEvent(new MessageEvent('message', { data: { type: 'ESTADO_DEL_PAQUETE' } }));
  await assert.rejects(pendiente, { name: 'TypeError', message: 'El service worker no dice qué versión guarda' });
  await prepararPaqueteSinConexion();
  assert.equal(mensajes.length, 2);
});

test('persistencia ausente, concedida o denegada conserva el funcionamiento', async (contexto) => {
  navegador(contexto, {});
  await pedirAlmacenPersistente();
  let pedidos = 0;
  navegador(contexto, {
    storage: {
      persisted: async () => true,
      persist: async () => {
        pedidos++;
      },
    },
  });
  await pedirAlmacenPersistente();
  assert.equal(pedidos, 0);
  navegador(contexto, {
    storage: {
      persisted: async () => false,
      persist: async () => {
        pedidos++;
        throw new Error('denegada');
      },
    },
  });
  await pedirAlmacenPersistente();
  assert.equal(pedidos, 1);
});
