import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { PAQUETE } from '../../src/plataforma/cloudflare/paquete.ts';

const PREPARADOS = ['esco', 'vectores', 'catalan', 'clasificaciones'] as const;
const diferido = (parte: string) => typeof Object.getOwnPropertyDescriptor(PAQUETE, parte)?.get === 'function';

test('servir estáticos no prepara el buscador; la primera API lo prepara sin cambiar su respuesta', async () => {
  for (const parte of PREPARADOS) {
    assert.equal(diferido(parte), true, `inicio: ${parte}`);
  }
  const worker = (await import('../../src/plataforma/cloudflare/worker.ts')).default;
  for (const parte of PREPARADOS) {
    assert.equal(diferido(parte), true, `import: ${parte}`);
  }
  const env = {
    ASSETS: { fetch: async () => new Response('no encontrado', { status: ESTADO_HTTP.noEncontrado }) },
    FARO_SECRETO_FIRMA: 'firma-sintetica-independiente-de-al-menos-32-bytes',
  };
  const estatico = await worker.fetch(new Request('https://ejemplo.invalid/scripts/acceso.js'), env);
  assert.equal(estatico.status, ESTADO_HTTP.noEncontrado);
  for (const parte of PREPARADOS) {
    assert.equal(diferido(parte), true, `estático: ${parte}`);
  }
  const respuestas = await Promise.all([
    worker.fetch(
      new Request('https://ejemplo.invalid/api/salud', { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } }),
      env,
    ),
    worker.fetch(
      new Request('https://ejemplo.invalid/api/salud', { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } }),
      env,
    ),
  ]);
  for (const respuesta of respuestas) {
    assert.equal(respuesta.status, ESTADO_HTTP.correcto);
    const cuerpo: unknown = await respuesta.json();
    assert.ok(cuerpo && typeof cuerpo === 'object' && 'estado' in cuerpo);
    assert.equal(cuerpo.estado, 'ok');
  }
  for (const parte of PREPARADOS) {
    assert.equal(diferido(parte), false, `API: ${parte}`);
  }
});
