import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avisarBorrado, CANAL_DE_BORRADO, escucharBorrado } from '../../web/scripts/aviso-de-borrado.js';
import { completarAbortSignal } from '../../web/scripts/compatibilidad.js';
import { cargar, navegador } from './ayudas.js';

const SIN_AUTENTICAR = 401;
const PROHIBIDO = 403;
const CORRECTO = 200;
const PLAZO = 5;
const PAGINA = 'https://ejemplo.invalid/sub/recorrido.html?otra=1#paso';

for (const estado of ['opaqueredirect', SIN_AUTENTICAR, PROHIBIDO, CORRECTO, 'sin-red', 'sin-sw', 'renovada']) {
  test(`acceso: ${estado}, conserva consulta/fragmento y evita bucles`, async (contexto) => {
    let destino = '';
    let llamadas = 0;
    let historial = '';
    const direccion = new URL(PAGINA);
    if (estado === 'renovada') {
      direccion.searchParams.set('acceso', 'renovar');
    }
    navegador(contexto, {
      location: {
        href: direccion.href,
        replace: (/** @type {URL} */ valor) => {
          destino = valor.href;
        },
      },
      history: {
        state: { prueba: true },
        replaceState: (/** @type {unknown} */ _estado, /** @type {string} */ _titulo, /** @type {URL} */ valor) => {
          historial = valor.href;
        },
      },
      navigator: { serviceWorker: { controller: estado === 'sin-sw' ? null : {} } },
      fetch: async (/** @type {URL} */ _url, /** @type {RequestInit} */ opciones) => {
        llamadas++;
        assert.equal(opciones.redirect, 'manual');
        assert.equal(opciones.credentials, 'same-origin');
        if (estado === 'sin-red') {
          throw new TypeError('sin red');
        }
        return { type: estado === 'opaqueredirect' ? estado : 'basic', status: estado };
      },
    });
    const modulo = /** @type {typeof import('../../web/scripts/acceso.js')} */ (await cargar('acceso.js'));
    await modulo.comprobarAcceso();
    const renovar = [SIN_AUTENTICAR, PROHIBIDO, 'opaqueredirect'].includes(estado);
    const esperada = new URL(PAGINA);
    esperada.searchParams.set('acceso', 'renovar');
    assert.equal(destino, renovar ? esperada.href : '');
    assert.equal(llamadas, estado === 'sin-sw' || estado === 'renovada' ? 0 : 1);
    assert.equal(historial, estado === 'renovada' ? PAGINA : '');
  });
}

test('polyfills: conserva métodos nativos, primer motivo, abortada inicial y timeout', (contexto) => {
  const clase = /** @type {typeof AbortSignal} */ (/** @type {unknown} */ ({}));
  completarAbortSignal(clase);
  const any = clase.any;
  completarAbortSignal(clase);
  assert.equal(clase.any, any);
  const primera = new AbortController();
  const segunda = new AbortController();
  const juntas = clase.any([primera.signal, segunda.signal]);
  const motivo = new Error('primero');
  segunda.abort(motivo);
  primera.abort(new Error('después'));
  assert.equal(juntas.reason, motivo);
  assert.equal(clase.any([segunda.signal]).reason, motivo);
  assert.equal(clase.any([]).aborted, false);
  contexto.mock.timers.enable({ apis: ['setTimeout'] });
  const plazo = clase.timeout(PLAZO);
  assert.equal(plazo.aborted, false);
  contexto.mock.timers.tick(PLAZO);
  assert.equal(plazo.reason.name, 'TimeoutError');
});

test('aviso de borrado llega por el canal y se cierra al soltarlo', async (contexto) => {
  let avisos = 0;
  let cumplir = () => {};
  const llegada = new Promise((resolve) => {
    cumplir = () => resolve(undefined);
  });
  const soltar = escucharBorrado(() => {
    avisos++;
    cumplir();
  });
  contexto.after(soltar);
  avisarBorrado();
  await llegada;
  assert.equal(avisos, 1);
  soltar();
  const testigo = new BroadcastChannel(CANAL_DE_BORRADO);
  const emisor = new BroadcastChannel(CANAL_DE_BORRADO);
  contexto.after(() => {
    testigo.close();
    emisor.close();
  });
  const centinela = new Promise((resolve) => {
    testigo.addEventListener('message', ({ data }) => {
      if (data === 'centinela') {
        resolve(undefined);
      }
    });
  });
  emisor.postMessage('borrar-todo');
  emisor.postMessage('centinela');
  await centinela;
  assert.equal(avisos, 1, 'el oyente cerrado no vuelve a recibir mensajes');
  assert.equal(CANAL_DE_BORRADO, 'faro-borrar');
  navegador(contexto, { BroadcastChannel: undefined });
  assert.doesNotThrow(avisarBorrado);
  assert.doesNotThrow(escucharBorrado(() => assert.fail('sin canal')));
});
