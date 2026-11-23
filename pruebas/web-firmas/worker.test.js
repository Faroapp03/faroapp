// Se ejecuta el Worker real sin motor compilado: una sonda ausente nunca deja cargar código ni datos.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const SONDA = new URL('../../web/motor/copia-comprobada.json', import.meta.url).href;
const NO_ENCONTRADO = 404;
/** @type {((evento: { data: import('../../web/scripts/motor-local/worker.js').PeticionAlMotor }) => Promise<void>) | undefined} */
let responder;
/** @type {unknown[]} */
const enviados = [];
/** @type {string[]} */
const pedidas = [];
/** @type {() => Promise<Response>} */
let respuesta = async () => new Response(null, { status: NO_ENCONTRADO });

/** @param {number} id */
async function preguntar(id) {
  assert.ok(responder);
  await responder({
    data: {
      id,
      paquete: 'https://faro.example/paquete/p1/',
      completo: true,
      url: 'https://faro.example/api/salud',
      method: 'GET',
      headers: [],
      body: null,
    },
  });
}

test('sin sonda comprobada no se solicita el motor y cada petición recibe el mismo fallo', async () => {
  const nombres = ['addEventListener', 'postMessage', 'fetch'];
  const anteriores = nombres.map((nombre) => Object.getOwnPropertyDescriptor(globalThis, nombre));
  const warn = console.warn;
  Reflect.set(
    globalThis,
    'addEventListener',
    (/** @type {string} */ _tipo, /** @type {NonNullable<typeof responder>} */ oyente) => {
      responder = oyente;
    },
  );
  Reflect.set(globalThis, 'postMessage', (mensaje) => enviados.push(mensaje));
  Reflect.set(globalThis, 'fetch', (direccion) => {
    pedidas.push(String(direccion));
    return respuesta();
  });
  console.warn = () => {};
  try {
    await import('../../web/scripts/motor-local/worker.js');
    const redes = [
      async () => new Response(null, { status: NO_ENCONTRADO }),
      async () => {
        throw new TypeError('sin red');
      },
      async () => new Response('<title>portal</title>'),
      async () => Response.json({ version: null }),
    ];
    for (const [indice, red] of redes.entries()) {
      respuesta = red;
      enviados.length = 0;
      pedidas.length = 0;
      const id = indice + 1;
      await preguntar(id);
      assert.deepEqual(enviados, [{ id, fallo: true }]);
      assert.deepEqual(pedidas, [SONDA]);
    }
  } finally {
    console.warn = warn;
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
