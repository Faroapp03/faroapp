// El Worker real, con la sonda del service worker presente: si la carga falla, la respuesta a la
// página dice si es porque el service worker ha rechazado algún archivo que no es el de esta versión (la sonda lo
// cuenta con `noCoincide`), y entonces el fallo no es de paso; si no, es el fallo de siempre. La clave de firma se lee
// de un almacén que contesta (almacen-de-prueba.ts): sin IndexedDB, el fallo sería el del almacenamiento.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlmacenDePrueba, usarAlmacen } from './almacen-de-prueba.ts';

const SONDA = new URL('../../web/motor/copia-comprobada.json', import.meta.url).href;
const NO_ENCONTRADO = 404;
/** @typedef {import('../../web/scripts/motor-local/worker.js').PeticionAlMotor} PeticionAlMotor */
/** @type {((evento: { data: PeticionAlMotor }) => Promise<void>) | undefined} */
let responder;
/** @type {unknown[]} */
const enviados = [];
/** @type {string[]} */
const pedidas = [];
/** Lo que cuenta la sonda en la próxima petición. */
let noCoincide = false;

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

test('con la sonda presente, un fallo de la carga dice si algún archivo no es el de esta versión', async (t) => {
  usarAlmacen(t, new AlmacenDePrueba());
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
  Reflect.set(globalThis, 'postMessage', (/** @type {unknown} */ mensaje) => enviados.push(mensaje));
  Reflect.set(globalThis, 'fetch', async (/** @type {unknown} */ direccion) => {
    pedidas.push(String(direccion));
    return String(direccion) === SONDA
      ? Response.json({ version: 'v1', noCoincide })
      : new Response(null, { status: NO_ENCONTRADO });
  });
  console.warn = () => {};
  try {
    await import('../../web/scripts/motor-local/worker.js');
    // Sin paquete (cada lectura responde 404), la carga falla siempre; lo que cambia es lo que cuenta la sonda.
    for (const [indice, cuenta] of [true, false, true].entries()) {
      noCoincide = cuenta;
      enviados.length = 0;
      pedidas.length = 0;
      const id = indice + 1;
      await preguntar(id);
      const respuestas = enviados.filter(
        (mensaje) => typeof mensaje === 'object' && mensaje !== null && 'id' in mensaje,
      );
      assert.deepEqual(respuestas, [cuenta ? { id, fallo: true, noCoincide: true } : { id, fallo: true }]);
      assert.equal(pedidas[0], SONDA, 'la sonda se consulta antes de cargar');
      assert.equal(pedidas.at(-1), SONDA, 'y otra vez al fallar');
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
