// Contratos de orden: testigos explícitos UTF-16 y referencia ECMA-402 con el idioma escrito.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDIOMAS } from '../../src/comun/idioma.ts';
import { compararPorCodigo } from '../../src/comun/orden.js';
import { compararTexto } from '../../src/comun/orden-alfabetico.ts';

const MUESTRA: readonly string[] = Object.freeze([
  'b',
  'B',
  'a',
  'ñ',
  'z',
  '-',
  '_',
  '10',
  '9',
  'á',
  'ç',
  'l·l',
  'n',
  'o',
  '2026-10-12',
  '2026-09-30',
]);
const UNICODE: readonly string[] = Object.freeze([
  '',
  'a',
  'aa',
  'á',
  'a\u0301',
  '\u0000',
  '\uD7FF',
  '\uD800',
  '\uDC00',
  '\uE000',
  '\uFFFF',
  '\u{10000}',
  '\u{1F600}',
  '\u{10FFFF}',
]);

test('el orden por código conserva mayúsculas, signos, cifras y fechas de formato uniforme', () => {
  assert.deepEqual([...MUESTRA].sort(compararPorCodigo), [
    '-',
    '10',
    '2026-09-30',
    '2026-10-12',
    '9',
    'B',
    '_',
    'a',
    'b',
    'l·l',
    'n',
    'o',
    'z',
    'á',
    'ç',
    'ñ',
  ]);
});

test('el orden por código devuelve cero para textos iguales, incluido el vacío', () => {
  for (const texto of [...MUESTRA, ...UNICODE]) {
    assert.equal(compararPorCodigo(texto, texto), 0);
  }
});

test('el vacío y los prefijos van antes de una cadena más larga', () => {
  assert.equal(compararPorCodigo('', 'a'), -1);
  assert.equal(compararPorCodigo('a', ''), 1);
  assert.equal(compararPorCodigo('a', 'aa'), -1);
  assert.equal(compararPorCodigo('aa', 'a'), 1);
});

test('el orden UTF-16 sitúa los caracteres suplementarios antes de E000 aunque su punto de código sea mayor', () => {
  // U+10000 empieza por D800 en UTF-16: D800 precede a E000. Por puntos de código sería el orden contrario.
  assert.equal(compararPorCodigo('\u{10000}', '\uE000'), -1);
  assert.equal(compararPorCodigo('\uE000', '\u{10000}'), 1);
  assert.deepEqual(['\uFFFF', '\u{1F600}', '\uE000', '\u{10000}'].sort(compararPorCodigo), [
    '\u{10000}',
    '\u{1F600}',
    '\uE000',
    '\uFFFF',
  ]);
});

test('el orden por código conserva antisimetría y transitividad en la muestra Unicode acotada', () => {
  for (const a of UNICODE) {
    for (const b of UNICODE) {
      const orden = compararPorCodigo(a, b);
      assert.ok([-1, 0, 1].includes(orden));
      assert.equal(orden + compararPorCodigo(b, a), 0);
      for (const siguiente of UNICODE) {
        if (orden <= 0 && compararPorCodigo(b, siguiente) <= 0) {
          assert.ok(compararPorCodigo(a, siguiente) <= 0);
        }
      }
    }
  }
});

test('el orden alfabético coincide con ECMA-402 para cada idioma explícito incluso con caracteres suplementarios', () => {
  for (const idioma of IDIOMAS) {
    for (const a of [...MUESTRA, ...UNICODE]) {
      for (const b of [...MUESTRA, ...UNICODE]) {
        assert.equal(Math.sign(compararTexto(a, b, idioma)), Math.sign(a.localeCompare(b, idioma)));
      }
    }
  }
});

test('el orden alfabético devuelve cero para igualdad, vacío y representaciones canónicas equivalentes', () => {
  for (const idioma of IDIOMAS) {
    for (const texto of UNICODE) {
      assert.equal(compararTexto(texto, texto, idioma), 0);
    }
    assert.equal(compararTexto('á', 'a\u0301', idioma), 0);
    assert.ok(compararTexto('', 'a', idioma) < 0);
    assert.ok(compararTexto('a', '', idioma) > 0);
  }
});

test('el castellano sitúa ñ entre n y o y el catalán sitúa ç junto a c', () => {
  assert.deepEqual(
    ['o', 'ñ', 'n'].sort((a, b) => compararTexto(a, b, 'es')),
    ['n', 'ñ', 'o'],
  );
  assert.deepEqual(
    ['d', 'ç', 'c'].sort((a, b) => compararTexto(a, b, 'ca')),
    ['c', 'ç', 'd'],
  );
});
