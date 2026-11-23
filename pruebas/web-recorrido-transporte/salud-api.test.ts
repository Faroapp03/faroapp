import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';

const CORRECTO = 200;

test('salud real expone el estado y el contrato sin realizar red ni publicar credenciales', async (t) => {
  const red = t.mock.method(globalThis, 'fetch', () => assert.fail('Salud no realiza peticiones de red'));
  const api = await crearApi({
    datos: cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))),
    origenesPermitidos: [],
  });
  const respuesta = await api(
    new Request('https://ejemplo.invalid/api/salud', {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
  );
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get(CABECERA_CONTRATO), String(CONTRATO_API));
  const cuerpo: unknown = await respuesta.json();
  assert.ok(typeof cuerpo === 'object' && cuerpo !== null && 'estado' in cuerpo);
  assert.deepEqual(Object.keys(cuerpo).sort(), ['estado', 'interruptores', 'version']);
  assert.equal(cuerpo.estado, 'ok');
  assert.equal(Reflect.has(cuerpo, 'turnstile'), false);
  assert.equal(red.mock.callCount(), 0);
});
