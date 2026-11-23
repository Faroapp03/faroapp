import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CON_MAYUSCULA_INICIAL, formaDeNombre, segunLaLista } from '../../src/comun/nombres-propios.ts';

test('la lista oficial coincide con la huella del manifiesto del producto', () => {
  const manifiesto = JSON.parse(readFileSync(new URL('../../datos/manifiesto.json', import.meta.url), 'utf8'));
  const bytes = readFileSync(new URL('../../datos/nombres.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifiesto['nombres.json'].sha256);
});

test('la normalización reconoce acentos, apóstrofos y punto volado sin depender de la carpeta actual', () => {
  for (const [entrada, esperada] of [
    ['Núria', 'nuria'],
    ['PÉREZ', 'perez'],
    ["D'Amico", 'damico'],
    ['D’Amico', 'damico'],
    ['Marcel·la', 'marcella'],
    ['Çañá', 'cana'],
  ] as const) {
    assert.equal(formaDeNombre(entrada), esperada);
  }
  assert.equal(segunLaLista('Núria').dePila, true);
  assert.equal(segunLaLista('PÉREZ').apellido, true);
  assert.equal(segunLaLista('Pastora').oficio, true);
  assert.equal(segunLaLista('Cuinera').noEsNombre, true);
});

test('una inicial de nombre no equivale a siglas ni a una palabra entera en mayúsculas', () => {
  for (const texto of ['Laura', 'Núria', 'Çelia']) {
    assert.equal(CON_MAYUSCULA_INICIAL.test(texto), true);
  }
  for (const texto of ['LAURA', 'TCAE', 'CNC', 'laura', 'L']) {
    assert.equal(CON_MAYUSCULA_INICIAL.test(texto), false);
  }
});
