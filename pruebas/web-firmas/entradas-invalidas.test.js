// Configuración de firmas no admitida y avisos tardíos de un Worker que ya se terminó.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { aBase64, clavesPublicas, FirmaRechazada, firmasDelSobre } from '../../web/scripts/firmas/firmas.js';

const CORRECTO = 200;
const FORMATO_DESCONOCIDO = 'algoritmo-ajeno';
const BYTES_DE_PRUEBA = new Uint8Array([1]);
const FALLO_DEL_MOTOR = { name: 'TypeError', message: 'El motor del dispositivo no ha podido responder' };

/** @param {unknown} error */
function combinacionRechazada(error) {
  return error instanceof FirmaRechazada && error.motivo === 'combinacion';
}

test('un algoritmo desconocido se rechaza con el error del contrato, sin acceder a un proveedor inexistente', () => {
  const combinacion = [FORMATO_DESCONOCIDO];
  assert.throws(
    () => clavesPublicas([{ algoritmo: FORMATO_DESCONOCIDO, publica: 'AQ==' }], combinacion),
    combinacionRechazada,
  );
  const esperado = {
    tipo: 'prueba',
    combinacion,
    claves: [{ algoritmo: FORMATO_DESCONOCIDO, id: 'id', publica: BYTES_DE_PRUEBA }],
  };
  const sobre = {
    tipo: 'prueba',
    contenido: '',
    firmas: [{ algoritmo: FORMATO_DESCONOCIDO, clave: 'id', firma: aBase64(BYTES_DE_PRUEBA) }],
  };
  assert.throws(() => firmasDelSobre(sobre, esperado), combinacionRechazada);
});

class WorkerDePrueba {
  /** @type {WorkerDePrueba[]} */
  static creados = [];
  static responder = true;
  /** @type {Map<string, ((evento: { data: unknown }) => void)[]>} */
  oyentes = new Map();
  /** @type {{ id: number } | null} */
  peticion = null;
  terminado = false;
  constructor() {
    WorkerDePrueba.creados.push(this);
  }
  /** @param {string} tipo @param {(evento: { data: unknown }) => void} oyente */
  addEventListener(tipo, oyente) {
    this.oyentes.set(tipo, [...(this.oyentes.get(tipo) ?? []), oyente]);
  }
  /** @param {string} tipo @param {unknown} datos */
  emitir(tipo, datos) {
    for (const oyente of this.oyentes.get(tipo) ?? []) {
      oyente({ data: datos });
    }
  }
  /** @param {{ id: number }} peticion */
  postMessage(peticion) {
    this.peticion = peticion;
    if (WorkerDePrueba.responder) {
      queueMicrotask(() => this.contestar());
    }
  }
  contestar() {
    this.emitir('message', { id: this.peticion?.id, status: CORRECTO, body: 'listo' });
  }
  terminate() {
    this.terminado = true;
  }
}

/** El doble habla con el módulo real de estado del paquete, sin sustituir sus imports. */
function serviceWorker() {
  /** @type {((evento: { data: unknown }) => void) | undefined} */
  let responder;
  const registro = {
    active: {
      postMessage: () =>
        queueMicrotask(() => responder?.({ data: { type: 'ESTADO_DEL_PAQUETE', version: 'p1', completo: true } })),
    },
  };
  return {
    getRegistration: async () => registro,
    ready: Promise.resolve(registro),
    /** @param {string} _tipo @param {(evento: { data: unknown }) => void} oyente */
    addEventListener: (_tipo, oyente) => {
      responder = oyente;
    },
    removeEventListener: () => {
      responder = undefined;
    },
    startMessages: () => {},
  };
}

test('el aviso tardío de un Worker terminado no descarta las peticiones de su sucesor', async () => {
  const nombres = ['Worker', 'navigator', 'location'];
  const anteriores = nombres.map((nombre) => Object.getOwnPropertyDescriptor(globalThis, nombre));
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: serviceWorker() } });
  Reflect.set(globalThis, 'Worker', WorkerDePrueba);
  Reflect.set(globalThis, 'location', { href: 'https://faro.example/recorrido.html' });
  const { pedirAlMotorLocal } = await import('../../web/scripts/motor-local/cliente.js');
  try {
    assert.equal((await pedirAlMotorLocal('/api/salud', {})).status, CORRECTO);
    const viejo = WorkerDePrueba.creados.at(-1);
    assert.ok(viejo);
    assert.doesNotThrow(() => viejo.emitir('message', null));
    assert.doesNotThrow(() => viejo.emitir('message', { id: 'ajeno' }));
    viejo.emitir('error', null);
    assert.equal(viejo.terminado, true);
    assert.equal((await pedirAlMotorLocal('/api/salud', {})).status, CORRECTO);
    const nuevo = WorkerDePrueba.creados.at(-1);
    assert.ok(nuevo);
    assert.notEqual(nuevo, viejo);
    WorkerDePrueba.responder = false;
    const pendiente = pedirAlMotorLocal('/api/salud', {});
    const resuelta = assert.doesNotReject(async () => {
      assert.equal((await pendiente).status, CORRECTO);
    });
    await setImmediate();
    viejo.emitir('messageerror', null);
    nuevo.contestar();
    await resuelta;
    nuevo.emitir('error', null);
    await assert.rejects(
      pedirAlMotorLocal('/api/salud', { signal: AbortSignal.abort(new TypeError(FALLO_DEL_MOTOR.message)) }),
      FALLO_DEL_MOTOR,
    );
  } finally {
    for (const [indice, nombre] of nombres.entries()) {
      const descriptor = anteriores[indice];
      if (descriptor) {
        Object.defineProperty(globalThis, nombre, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, nombre);
      }
    }
  }
});
