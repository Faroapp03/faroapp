import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargar, navegador } from './ayudas.js';

const PAGINA = 'https://ejemplo.invalid/sub/recorrido.html?otra=1#paso';
const TAMANO_EXCESIVO = 32_768;
const PLAZO_PRUEBA = 1000;

/** @param {import('node:test').TestContext} contexto @param {Response} respuesta */
async function comprobar(contexto, respuesta) {
  let destino = '';
  navegador(contexto, {
    location: {
      href: PAGINA,
      replace: (/** @type {URL} */ url) => {
        destino = url.href;
      },
    },
    navigator: { serviceWorker: { controller: {} } },
    fetch: async () => respuesta,
  });
  const modulo = await cargar('acceso.js');
  await modulo.comprobarAcceso();
  return destino;
}

test('salud termina de consumir una respuesta correcta sin dejar el cuerpo pendiente', async (contexto) => {
  let cancelado = false;
  const flujo = new ReadableStream({
    start(controlador) {
      controlador.enqueue(new TextEncoder().encode('{"estado":'));
      controlador.enqueue(new TextEncoder().encode('"ok"}'));
      controlador.close();
    },
    cancel() {
      cancelado = true;
    },
  });
  const respuesta = new Response(flujo);
  assert.equal(await comprobar(contexto, respuesta), '');
  assert.equal(respuesta.bodyUsed, true);
  assert.equal(flujo.locked, false);
  assert.equal(cancelado, false);
});

test('salud detiene un cuerpo excesivo y libera el lector sin renovar la sesión', async (contexto) => {
  let cancelado = false;
  const flujo = new ReadableStream({
    start(controlador) {
      controlador.enqueue(new Uint8Array(TAMANO_EXCESIVO));
    },
    cancel() {
      cancelado = true;
    },
  });
  assert.equal(await comprobar(contexto, new Response(flujo)), '');
  assert.equal(cancelado, true);
  assert.equal(flujo.locked, false);
});

test('salud libera el lector si falla el cuerpo y no inventa una sesión caducada', async (contexto) => {
  const flujo = new ReadableStream({
    pull(controlador) {
      controlador.error(new TypeError('lectura interrumpida'));
    },
  });
  const respuesta = new Response(flujo);
  assert.equal(await comprobar(contexto, respuesta), '');
  assert.equal(respuesta.bodyUsed, true);
  assert.equal(flujo.locked, false);
});

test('un 401 conserva la renovación aunque su cuerpo no termine', async (contexto) => {
  const respuesta = new Response(new ReadableStream(), { status: 401 });
  const esperada = new URL(PAGINA);
  esperada.searchParams.set('acceso', 'renovar');
  assert.equal(await comprobar(contexto, respuesta), esperada.href);
  assert.equal(respuesta.bodyUsed, false);
  await respuesta.body?.cancel();
});

test('salud respeta la señal de plazo durante la lectura y libera el lector', async (contexto) => {
  const cancelador = new AbortController();
  contexto.mock.method(AbortSignal, 'timeout', () => cancelador.signal);
  const flujo = new ReadableStream({
    start(controlador) {
      cancelador.signal.addEventListener('abort', () => controlador.error(cancelador.signal.reason), { once: true });
    },
  });
  const pendiente = comprobar(contexto, new Response(flujo));
  queueMicrotask(() => cancelador.abort(new DOMException('Sin respuesta', 'TimeoutError')));
  assert.equal(await pendiente, '');
  assert.equal(flujo.locked, false);
});

test('salud no espera un cancelador atascado al descartar un cuerpo excesivo', {
  timeout: PLAZO_PRUEBA,
}, async (contexto) => {
  let cancelado = false;
  const flujo = new ReadableStream({
    start(controlador) {
      controlador.enqueue(new Uint8Array(TAMANO_EXCESIVO));
    },
    cancel() {
      cancelado = true;
      return new Promise(() => {});
    },
  });
  assert.equal(await comprobar(contexto, new Response(flujo)), '');
  assert.equal(cancelado, true);
  assert.equal(flujo.locked, false);
});
