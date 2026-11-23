// La cifra de los avisos (src/seguridad/avisos.ts) escribe los enteros igual que la función común (cifras.js).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cifra } from '../../src/comun/cifras.js';
import { AVISO_RELATO_LARGO, conPuntosDeMiles } from '../../src/seguridad/avisos.ts';
import { MAX_RELATO } from '../../src/seguridad/limites.ts';

/** Enteros de todas las longitudes, positivos y negativos. */
const ENTEROS = [
  '0',
  '7',
  '999',
  '1000',
  '4000',
  '40000',
  '1234567',
  '-1500',
  '-1234567',
  String(Number.MAX_SAFE_INTEGER),
];

test('con enteros, la cifra de los avisos es la misma que la común', () => {
  for (const entero of ENTEROS.map(Number)) {
    assert.equal(conPuntosDeMiles(entero), cifra(entero), String(entero));
  }
  assert.ok(AVISO_RELATO_LARGO.includes(cifra(MAX_RELATO)));
});

test('la cifra de los avisos no escribe decimales ni números fuera de los enteros seguros', () => {
  assert.throws(() => conPuntosDeMiles(Number('1234.5')), RangeError);
  assert.throws(() => conPuntosDeMiles(Number.NaN), RangeError);
  assert.throws(() => conPuntosDeMiles(Number('1e21')), RangeError);
});
