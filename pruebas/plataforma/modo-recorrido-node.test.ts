import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

test('el servidor local anuncia el recorrido real sin consultar la API', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-modo-node-'));
  const servidor = crearServidor({
    web: carpeta,
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async () => {
      throw new Error('No debe consultar la API');
    },
  });
  try {
    servidor.listen(0, '127.0.0.1');
    await once(servidor, 'listening');
    const direccion = servidor.address();
    assert.ok(direccion && typeof direccion !== 'string');
    const url = `http://127.0.0.1:${direccion.port}/modo-recorrido.json`;
    const respuesta = await fetch(url);
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await respuesta.json(), { version: 1, revision: 0, modo: 'real' });
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, ESTADO_HTTP.correcto);
    assert.equal(await head.text(), '');
    const post = await fetch(url, { method: 'POST' });
    assert.equal(post.status, ESTADO_HTTP.metodoNoAdmitido);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((ok) => servidor.close(() => ok()));
    rmSync(carpeta, { recursive: true, force: true });
  }
});
