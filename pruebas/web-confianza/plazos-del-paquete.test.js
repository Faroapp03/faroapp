// Los plazos de la espera al paquete de datos y al motor del dispositivo, con temporizadores falsos: un service worker
// que deja de avisar o que nunca se activa, la carpeta que se olvida al vencer el plazo y vuelve a pedirse, y el Worker
// que no responde en su plazo, que se termina.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estadoDelPaquete, PaqueteSinRespuesta } from '../../web/scripts/paquete-sin-conexion.js';

/** Los plazos de paquete-sin-conexion.js y de motor-local/cliente.js. */
const PLAZO_SIN_AVANCE_MS = 30_000;
const PLAZO_DEL_SERVICE_WORKER_MS = 120_000;
const PLAZO_DEL_MOTOR_MS = 120_000;
const CASI = 1;
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

/** Deja correr lo pendiente que no depende de los temporizadores. */
const vuelta = () => new Promise((listo) => setImmediate(listo));

/**
 * Un service worker que solo contesta lo que la prueba le diga: `alPedir` decide qué hace con cada petición.
 * @param {import('node:test').TestContext} contexto @param {{ ready?: Promise<unknown> }} [opciones]
 */
function servicio(contexto, { ready } = {}) {
  /** @type {unknown[]} */
  const mensajes = [];
  const contenedor = new EventTarget();
  /** @type {{ alPedir: (() => void) | null, retirados: number }} */
  const control = { alPedir: null, retirados: 0 };
  /** @param {unknown} data */
  const avisar = (data) => contenedor.dispatchEvent(new MessageEvent('message', { data }));
  const registro = {
    active: {
      postMessage: (/** @type {unknown} */ datos) => {
        mensajes.push(datos);
        queueMicrotask(() => control.alPedir?.());
      },
    },
  };
  const retirar = contenedor.removeEventListener.bind(contenedor);
  Object.assign(contenedor, {
    ready: ready ?? Promise.resolve(registro),
    getRegistration: async () => registro,
    startMessages() {},
    /** @param {string} tipo @param {EventListener} oyente */
    removeEventListener(tipo, oyente) {
      control.retirados += 1;
      retirar(tipo, oyente);
    },
  });
  global(contexto, 'navigator', { serviceWorker: contenedor });
  return { mensajes, avisar, control };
}

/**
 * Cómo ha acabado una promesa, sin esperarla: 'pendiente', 'cumplida' (con su valor) o 'rechazada' (con su motivo).
 * @param {Promise<unknown>} promesa
 */
function seguir(promesa) {
  /** @type {{ como: string, valor: unknown, motivo: object | null }} */
  const estado = { como: 'pendiente', valor: undefined, motivo: null };
  promesa.then(
    (valor) => Object.assign(estado, { como: 'cumplida', valor }),
    (motivo) => Object.assign(estado, { como: 'rechazada', motivo }),
  );
  return estado;
}

test('sin ningún aviso del service worker en 30 s, deja de esperar con PaqueteSinRespuesta y retira su oyente', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = servicio(t);
  const estado = seguir(estadoDelPaquete());
  await vuelta();
  assert.deepEqual(sw.mensajes, [{ type: 'PREPARAR_PAQUETE' }]);
  t.mock.timers.tick(PLAZO_SIN_AVANCE_MS - CASI);
  await vuelta();
  assert.equal(estado.como, 'pendiente');
  t.mock.timers.tick(CASI);
  await vuelta();
  assert.ok(estado.motivo instanceof PaqueteSinRespuesta);
  assert.ok(estado.motivo instanceof TypeError, 'el transporte lo cuenta como un fallo del motor del dispositivo');
  assert.equal(sw.control.retirados, 1);
});

test('el progreso y el latido alargan la espera, y el estado la cierra', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = servicio(t);
  const estado = seguir(estadoDelPaquete());
  await vuelta();
  const casiTodo = PLAZO_SIN_AVANCE_MS - CASI;
  t.mock.timers.tick(casiTodo);
  sw.avisar({ type: 'PROGRESO_DEL_PAQUETE', version: 'v' });
  t.mock.timers.tick(casiTodo);
  sw.avisar({ type: 'OTRO' });
  sw.avisar({ type: 'PROGRESO_DEL_PAQUETE', version: 'v', archivos: 3, guardados: 1 });
  t.mock.timers.tick(casiTodo);
  await vuelta();
  assert.equal(estado.como, 'pendiente');
  sw.avisar({ type: 'ESTADO_DEL_PAQUETE', version: 'v', completo: true });
  await vuelta();
  assert.equal(estado.como, 'cumplida');
  assert.deepEqual(estado.valor, { version: 'v', completo: true });
  t.mock.timers.tick(PLAZO_SIN_AVANCE_MS);
  await vuelta();
  assert.equal(estado.como, 'cumplida', 'el plazo vencido después no cambia nada');
});

test('si ningún service worker se activa en 120 s, deja de esperar sin pedir nada', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = servicio(t, { ready: new Promise(() => {}) });
  const estado = seguir(estadoDelPaquete());
  await vuelta();
  t.mock.timers.tick(PLAZO_DEL_SERVICE_WORKER_MS - CASI);
  await vuelta();
  assert.equal(estado.como, 'pendiente');
  t.mock.timers.tick(CASI);
  await vuelta();
  assert.ok(estado.motivo instanceof PaqueteSinRespuesta);
  assert.deepEqual(sw.mensajes, []);
});

class WorkerDePrueba {
  /** @type {WorkerDePrueba[]} */
  static creados = [];
  static responder = true;
  /** @type {((evento: { data: unknown }) => void)[]} */
  oyentes = [];
  terminado = false;
  constructor() {
    WorkerDePrueba.creados.push(this);
  }
  /** @param {string} tipo @param {(evento: { data: unknown }) => void} oyente */
  addEventListener(tipo, oyente) {
    if (tipo === 'message') {
      this.oyentes.push(oyente);
    }
  }
  /** @param {{ id: number }} peticion */
  postMessage(peticion) {
    if (WorkerDePrueba.responder) {
      queueMicrotask(() => {
        for (const oyente of this.oyentes) {
          oyente({ data: { id: peticion.id, status: CORRECTO, body: 'listo' } });
        }
      });
    }
  }
  terminate() {
    this.terminado = true;
  }
}

test('el motor del dispositivo: el plazo del paquete olvida la carpeta y el del Worker lo termina; reintentar vuelve a pedir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = servicio(t);
  global(t, 'Worker', WorkerDePrueba);
  global(t, 'location', { href: 'https://faro.example/recorrido.html' });
  const { pedirAlMotorLocal } = await import('../../web/scripts/motor-local/cliente.js');
  // El service worker no contesta: al vencer el plazo, la petición falla y la carpeta no se queda guardada.
  const primera = seguir(pedirAlMotorLocal('/api/salud', {}));
  await vuelta();
  t.mock.timers.tick(PLAZO_SIN_AVANCE_MS);
  await vuelta();
  assert.ok(primera.motivo instanceof PaqueteSinRespuesta);
  // «Volver a intentarlo»: se vuelve a preguntar por la copia, que esta vez contesta.
  sw.control.alPedir = () => sw.avisar({ type: 'ESTADO_DEL_PAQUETE', version: 'p1', completo: true });
  const respuesta = await pedirAlMotorLocal('/api/salud', {});
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(sw.mensajes.length, 2);
  // El Worker no responde en su plazo: se termina, la petición falla y la siguiente crea otro y revisa la copia.
  const atascado = WorkerDePrueba.creados.at(-1);
  WorkerDePrueba.responder = false;
  const segunda = seguir(pedirAlMotorLocal('/api/salud', {}));
  await vuelta();
  t.mock.timers.tick(PLAZO_DEL_MOTOR_MS - CASI);
  await vuelta();
  assert.equal(segunda.como, 'pendiente');
  assert.equal(atascado?.terminado, false);
  t.mock.timers.tick(CASI);
  await vuelta();
  assert.ok(segunda.motivo instanceof TypeError);
  assert.equal(atascado?.terminado, true);
  WorkerDePrueba.responder = true;
  assert.equal((await pedirAlMotorLocal('/api/salud', {})).status, CORRECTO);
  assert.notEqual(WorkerDePrueba.creados.at(-1), atascado);
  assert.deepEqual(sw.mensajes.at(-1), { type: 'PREPARAR_PAQUETE', revisar: true });
});
