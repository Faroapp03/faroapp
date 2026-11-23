import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NOMBRES, VERBOS_CA, VERBOS_ES } from '../../src/ia/verbos-de-las-tareas.ts';

test('las listas oficiales conservan grafías que necesitan sus consumidores', () => {
  assert.ok(VERBOS_ES.has('acompañar'));
  assert.ok(VERBOS_ES.has('talllar'));
  assert.ok(VERBOS_CA.has('col·locar'));
  assert.ok(NOMBRES.has('registro'));
});

test('las listas generadas mantienen su orden de unidades de código', () => {
  for (const palabras of [VERBOS_ES, VERBOS_CA, NOMBRES]) {
    const entradas = [...palabras];
    assert.deepEqual(entradas, [...entradas].sort());
  }
});
