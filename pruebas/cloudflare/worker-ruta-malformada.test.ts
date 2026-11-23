import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../../src/plataforma/cloudflare/worker.ts';

const ORIGEN = 'https://prueba.example';
const EXITO = 200;
const INCORRECTA = 400;
const AUSENTE = 404;

test('rutas administrativas con codificación inválida nunca llegan a ASSETS', async () => {
  let llamadas = 0;
  const env = {
    FARO_ADMINISTRACION: 'no',
    ASSETS: {
      fetch: async () => {
        llamadas++;
        return new Response('SENTINELA');
      },
    },
  };
  for (const ruta of [
    '/administracion/%E0%A4%A',
    '/%61dministracion/%E0%A4%A',
    '/x/%2e%2e%2fadministracion/%E0%A4%A',
    '/%6dantenimiento/%E0%A4%A',
    '/%2561dministracion/panel.js',
    '/x/%252e%252e%252fadministracion/panel.js',
  ]) {
    const respuesta = await worker.fetch(new Request(ORIGEN + ruta), env);
    assert.equal(respuesta.status, INCORRECTA, ruta);
    assert.equal(llamadas, 0, ruta);
  }
  assert.equal((await worker.fetch(new Request(`${ORIGEN}/mantenimiento/%E0%A4%A`), env)).status, AUSENTE);
  assert.equal(llamadas, 0);
});

test('rutas públicas válidas, también con codificación, conservan el acceso a ASSETS', async () => {
  const rutas: string[] = [];
  const env = {
    FARO_ADMINISTRACION: 'no',
    ASSETS: {
      fetch: async (request: Request) => {
        rutas.push(new URL(request.url).pathname);
        return new Response('público');
      },
    },
  };
  for (const ruta of ['/inicio.html', '/%61ccesibilidad.html', '/caf%C3%A9.html', '/descuento%25.html']) {
    assert.equal((await worker.fetch(new Request(ORIGEN + ruta), env)).status, EXITO);
  }
  assert.deepEqual(rutas, ['/inicio.html', '/%61ccesibilidad.html', '/caf%C3%A9.html', '/descuento%25.html']);
});

test('un alias doblemente codificado tampoco alcanza ASSETS', async () => {
  let llamadas = 0;
  const env = {
    FARO_ADMINISTRACION: 'no',
    ASSETS: {
      fetch: async () => {
        llamadas++;
        return new Response('SENTINELA');
      },
    },
  };
  const respuesta = await worker.fetch(new Request(`${ORIGEN}/%2561dministracion/panel.js`), env);
  assert.equal(respuesta.status, INCORRECTA);
  assert.equal(llamadas, 0);
});
