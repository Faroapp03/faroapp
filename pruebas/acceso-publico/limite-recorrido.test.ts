import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VENTANA_MS } from '../../src/plataforma/acceso-publico/limite-continuo-sqlite.ts';
import { varianteDeRuta } from '../../src/plataforma/cloudflare/entrada-recorrido.ts';
import {
  huellaLimiteRecorrido,
  identificadoresLimiteRecorrido,
} from '../../src/plataforma/cloudflare/limite-recorrido.ts';

const SECRETO = 'clave-sintetica-para-hmac-de-al-menos-32-bytes';
const VENTANA = VENTANA_MS;
/** Ventanas enteras desde el origen del reloj en la prueba de cambio de ventana. */
const VENTANAS_TRANSCURRIDAS = 3;
const peticion = (ip: string) =>
  new Request('https://ejemplo.invalid/recorrido.html', { headers: { 'cf-connecting-ip': ip } });
test('HMAC separa direcciones y ventanas sin incluir la IP', async () => {
  const primera = await huellaLimiteRecorrido(peticion('192.0.2.1'), SECRETO, VENTANA);
  assert.match(primera, /^[0-9a-f]{64}$/);
  assert.equal(await huellaLimiteRecorrido(peticion('192.0.2.1'), SECRETO, VENTANA), primera);
  assert.notEqual(await huellaLimiteRecorrido(peticion('192.0.2.2'), SECRETO, VENTANA), primera);
  assert.notEqual(await huellaLimiteRecorrido(peticion('192.0.2.1'), SECRETO, VENTANA * 2), primera);
  for (const ip of ['', '192.0.2.1, 192.0.2.2', '999.1.1.1', 'invalida']) {
    await assert.rejects(huellaLimiteRecorrido(peticion(ip), SECRETO, VENTANA));
  }
  await assert.rejects(huellaLimiteRecorrido(peticion('192.0.2.1'), 'corta', VENTANA));
});
test('clasifica el recorrido real y sus alias aun codificados', () => {
  for (const ruta of ['/recorrido', '/recorrido.html', '/%72ecorrido.html', '/RECORRIDO.HTML']) {
    assert.equal(varianteDeRuta(ruta), 'real');
  }
  assert.equal(varianteDeRuta('/inicio.html'), null);
  assert.throws(() => varianteDeRuta('/%'));
  assert.throws(() => varianteDeRuta('/recorr%2569do.html'));
});

test('la huella del Worker cambia con la ventana del límite continuo y la anterior es la de la ventana previa', async () => {
  const inicio = VENTANA_MS * VENTANAS_TRANSCURRIDAS;
  const huella = (ahora: number) => huellaLimiteRecorrido(peticion('192.0.2.1'), SECRETO, ahora);
  assert.equal(await huella(inicio + VENTANA_MS - 1), await huella(inicio));
  assert.notEqual(await huella(inicio + VENTANA_MS), await huella(inicio));
  const { anteriores } = await identificadoresLimiteRecorrido(peticion('192.0.2.1'), SECRETO, inicio);
  assert.deepEqual(anteriores, [await huella(inicio), await huella(inicio - VENTANA_MS)]);
});
