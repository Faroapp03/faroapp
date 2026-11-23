// El cliente del motor del dispositivo (motor-local/cliente.js) distingue el fallo que no es de paso: si el Worker
// contesta que algún archivo del motor no es el de esta versión (worker.js, `noCoincide`), la petición rechaza con
// MotorQueNoCoincide, un TypeError con su propio nombre; cualquier otro fallo del Worker sigue siendo el TypeError de
// siempre. En los dos casos, la petición siguiente vuelve a preguntar por la copia y pide revisarla.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** El estado de una respuesta correcta del motor. */
const CORRECTO = 200;

/** @param {import('node:test').TestContext} contexto @param {string} nombre @param {unknown} valor */
function global(contexto, nombre, valor) {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, nombre);
  contexto.after(() => {
    if (anterior) {
      Object.defineProperty(globalThis, nombre, anterior);
    } else {
      Reflect.deleteProperty(globalThis, nombre);
    }
  });
  Object.defineProperty(globalThis, nombre, { configurable: true, value: valor });
}

/**
 * Un service worker con la copia del paquete completa: a cada petición de la copia contesta su estado.
 * @param {import('node:test').TestContext} contexto
 */
function servicio(contexto) {
  /** @type {unknown[]} */
  const mensajes = [];
  const contenedor = new EventTarget();
  const registro = {
    active: {
      postMessage: (/** @type {unknown} */ datos) => {
        mensajes.push(datos);
        queueMicrotask(() =>
          contenedor.dispatchEvent(
            new MessageEvent('message', { data: { type: 'ESTADO_DEL_PAQUETE', version: 'p1', completo: true } }),
          ),
        );
      },
    },
  };
  Object.assign(contenedor, {
    ready: Promise.resolve(registro),
    getRegistration: async () => registro,
    startMessages() {},
  });
  global(contexto, 'navigator', { serviceWorker: contenedor });
  return { mensajes };
}

/** Un Worker que contesta a cada petición lo que diga `WorkerDePrueba.respuesta`, con el identificador de la petición. */
class WorkerDePrueba {
  /** @type {Record<string, unknown>} */
  static respuesta = { status: CORRECTO, body: 'listo' };
  /** @type {((evento: { data: unknown }) => void)[]} */
  oyentes = [];
  /** @param {string} tipo @param {(evento: { data: unknown }) => void} oyente */
  addEventListener(tipo, oyente) {
    if (tipo === 'message') {
      this.oyentes.push(oyente);
    }
  }
  /** @param {{ id: number }} peticion */
  postMessage(peticion) {
    queueMicrotask(() => {
      for (const oyente of this.oyentes) {
        oyente({ data: { id: peticion.id, ...WorkerDePrueba.respuesta } });
      }
    });
  }
  terminate() {}
}

/** El motivo con que rechaza `promesa`, o un fallo de la prueba si no rechaza. @param {Promise<unknown>} promesa */
async function motivo(promesa) {
  return promesa.then(
    () => assert.fail('La petición tenía que fallar'),
    (error) => error,
  );
}

test('si el motor no es el de esta versión, la petición falla con MotorQueNoCoincide y no con el fallo de paso', async (t) => {
  const sw = servicio(t);
  global(t, 'Worker', WorkerDePrueba);
  global(t, 'location', { href: 'https://faro.example/recorrido.html' });
  const { pedirAlMotorLocal } = await import('../../web/scripts/motor-local/cliente.js');
  WorkerDePrueba.respuesta = { fallo: true, noCoincide: true };
  const noCoincide = await motivo(pedirAlMotorLocal('/api/salud', {}));
  assert.ok(noCoincide instanceof TypeError, 'el resto lo sigue contando como un fallo del motor del dispositivo');
  assert.equal(/** @type {TypeError} */ (noCoincide).name, 'MotorQueNoCoincide');
  // Otro fallo del Worker no es MotorQueNoCoincide, y la petición siguiente pide revisar la copia.
  WorkerDePrueba.respuesta = { fallo: true };
  const otro = await motivo(pedirAlMotorLocal('/api/salud', {}));
  assert.ok(otro instanceof TypeError);
  assert.equal(/** @type {TypeError} */ (otro).name, 'TypeError');
  assert.deepEqual(sw.mensajes.at(-1), { type: 'PREPARAR_PAQUETE', revisar: true });
  WorkerDePrueba.respuesta = { status: CORRECTO, body: 'listo' };
  assert.equal((await pedirAlMotorLocal('/api/salud', {})).status, CORRECTO);
  assert.deepEqual(sw.mensajes.at(-1), { type: 'PREPARAR_PAQUETE', revisar: true });
});
