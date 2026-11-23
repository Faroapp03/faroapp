/**
 * Ensayo local mínimo de la herramienta de desarrollo de Cloudflare: Miniflare arranca workerd en este equipo y le
 * despacha peticiones a través de undici. Acredita que las versiones fijadas en el archivo de bloqueo funcionan juntas; no consulta
 * la red ni ensaya el worker del producto, que necesita sus enlaces de despliegue.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const requerir = createRequire(import.meta.url);
const HTTP_CORRECTO = 200;
/** Tamaño del cuerpo comprimido: suficiente para que workerd lo comprima de verdad. */
const BYTES_COMPRIMIDOS = 20_000;

/** Worker de módulo con tres rutas: estado en JSON, eco de un cuerpo y una respuesta comprimida. */
const WORKER = `export default {
  async fetch(peticion) {
    const url = new URL(peticion.url);
    if (url.pathname === '/eco') {
      return new Response(await peticion.text(), { headers: { 'x-metodo': peticion.method } });
    }
    if (url.pathname === '/comprimido') {
      return new Response('x'.repeat(${BYTES_COMPRIMIDOS}), { headers: { 'content-type': 'text/plain' }, encodeBody: 'automatic' });
    }
    return Response.json({ ruta: url.pathname, ok: true });
  },
};`;

test('Miniflare despacha peticiones a workerd con el undici fijado, sin red', async () => {
  const { Miniflare, convertV4MiniflareOptions } = requerir('miniflare');
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({ name: 'ensayo', modules: true, compatibilityDate: '2026-10-01', script: WORKER }),
  );
  try {
    const estado = await miniflare.dispatchFetch('http://localhost/estado');
    assert.equal(estado.status, HTTP_CORRECTO);
    assert.deepEqual(await estado.json(), { ruta: '/estado', ok: true });

    const eco = await miniflare.dispatchFetch('http://localhost/eco', { method: 'POST', body: 'hola Faro' });
    assert.equal(await eco.text(), 'hola Faro');
    assert.equal(eco.headers.get('x-metodo'), 'POST');

    const comprimido = await miniflare.dispatchFetch('http://localhost/comprimido', {
      headers: { 'accept-encoding': 'gzip' },
    });
    assert.equal((await comprimido.text()).length, BYTES_COMPRIMIDOS);
  } finally {
    await miniflare.dispose();
  }
});

test('el undici que usa Miniflare es la versión que fijan el archivo de bloqueo y la anulación de package.json', () => {
  const bloqueo = requerir('../../package-lock.json') as { packages: Record<string, { version?: string }> };
  const instalada = (requerir('undici/package.json') as { version: string }).version;
  assert.equal(instalada, bloqueo.packages['node_modules/undici']?.version);
  assert.equal(instalada, (requerir('../../package.json') as { overrides: { undici: string } }).overrides.undici);
});
