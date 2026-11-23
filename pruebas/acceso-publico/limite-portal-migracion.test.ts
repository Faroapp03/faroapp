import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identificadoresLimiteRecorrido } from '../../src/plataforma/cloudflare/limite-recorrido.ts';
import { huellaLimitePortalV1 } from '../ayudas/limite-antiguo.ts';

const VENTANA = 900_000;
const EPOCA = 4;
const SECRETO = 'secreto-sintetico-distinto-de-al-menos-32-bytes';
const RUTA = process.env.FARO_S3_MODULO_PORTAL ?? '../../src/plataforma/cloudflare/limite-portal.ts';

test('portal conserva las cuotas de la ventana antigua sin mezclar el propósito del recorrido', async () => {
  const portal = await import(RUTA);
  const identificar = Reflect.get(portal, 'identificadoresLimitePortal');
  assert.equal(typeof identificar, 'function', 'Falta la identificación continua del portal');
  const peticion = new Request('https://ejemplo.invalid/', {
    headers: { 'cf-connecting-ip': '2001:db8:12:34::1' },
  });
  const instante = VENTANA * EPOCA;
  const legadoAnterior = await huellaLimitePortalV1(peticion, SECRETO, instante - 1);
  const legadoActual = await huellaLimitePortalV1(peticion, SECRETO, instante);
  const actual = await identificar(peticion, SECRETO, instante);
  assert.deepEqual(actual.anteriores, [legadoActual, legadoAnterior]);
  assert.notEqual(actual.clave, (await identificadoresLimiteRecorrido(peticion, SECRETO, instante)).clave);
  assert.doesNotMatch(JSON.stringify(actual), /2001:db8/);
});
