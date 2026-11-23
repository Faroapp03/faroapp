import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listaDeComas, normalizar, sinAcentos } from '../../src/comun/texto.ts';

test('quitar acentos conserva la puntuación que necesitan los detectores', () => {
  assert.equal(sinAcentos('NÚRIA, año: pingüino!'), 'nuria, ano: pinguino!');
  assert.equal(sinAcentos('CAFÉ'), sinAcentos('CAFE\u0301'));
  assert.equal(sinAcentos('SYSTEM: ¿Sí?'), 'system: ¿si?');
});

test('normalizar compara palabras ASCII sin inventar letras de otros alfabetos', () => {
  assert.equal(normalizar('  Revisar\tFACTURAS — año 2026. '), 'revisar facturas ano 2026');
  assert.equal(normalizar('aЖb 日本語 c'), 'a b c');
  assert.equal(normalizar('---😀\u0000'), '');
  assert.equal(normalizar('Archivar\ud800 facturas'), 'archivar facturas');
  assert.equal(normalizar('Col·laborar'), 'col laborar');
});

test('la normalización es estable al repetirla y no comparte el cursor de sus patrones', () => {
  for (const texto of ['Ñandú', 'é e\u0301', '', '  A—B  ', '日本', 'a\udfffB']) {
    const primera = normalizar(texto);
    assert.equal(normalizar(primera), primera);
    assert.equal(normalizar(texto), primera);
    assert.match(primera, /^(?:[a-z0-9]+(?: [a-z0-9]+)*)?$/);
  }
});

test('las listas de configuración omiten vacíos sin ordenar ni alterar valores', () => {
  assert.deepEqual(listaDeComas(undefined), []);
  assert.deepEqual(listaDeComas(' , \t, '), []);
  assert.deepEqual(listaDeComas(' a, b,,c '), ['a', 'b', 'c']);
  assert.deepEqual(listaDeComas('B, a, B, C D, 0'), ['B', 'a', 'B', 'C D', '0']);
});
