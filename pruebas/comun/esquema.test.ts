// Validación de entradas, propiedades propias y trabajo acotado del validador.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cumple, type Esquema, type EsquemaDe, validar } from '../../src/comun/esquema.ts';

/** Lista que superaría el máximo de argumentos si sus errores se repartieran en una llamada. */
const ELEMENTOS_DE_MAS = 200_000;
/** Máximo de errores publicado por el validador. */
const ERRORES_COMO_MUCHO = 20;

test('el validador de esquemas rechaza salidas incorrectas del modelo', () => {
  const esquema = {
    type: 'object',
    additionalProperties: false,
    required: ['valor'],
    properties: { valor: { type: 'number', minimum: 0, maximum: 1 } },
  };
  assert.deepEqual(validar({ valor: 0.5 }, esquema), []);
  assert.ok(validar({ valor: 2 }, esquema).length > 0, 'pasa un valor fuera del rango');
  assert.ok(validar({ valor: 0.5, extra: 1 }, esquema).length > 0, 'pasa una propiedad de más');
  assert.ok(validar({}, esquema).length > 0, 'pasa sin la propiedad obligatoria');
});

test('el validador solo mira propiedades propias: «constructor» o «__proto__» no pasan por previstas', () => {
  const esquema = {
    type: 'object',
    additionalProperties: false,
    required: ['valor'],
    properties: { valor: { type: 'number' } },
  };
  assert.ok(validar({ valor: 1, constructor: {} }, esquema).length > 0, '«constructor» pasa por prevista');
  assert.ok(validar(JSON.parse('{"valor": 1, "__proto__": {}}'), esquema).length > 0, '«__proto__» pasa por prevista');
  assert.ok(
    validar({ toString: 'x' }, { ...esquema, required: ['toString'] }).length > 0,
    '«toString» pasa por prevista',
  );
  assert.ok(validar(Object.create({ valor: 1 }), esquema).length > 0, 'una propiedad heredada no cuenta como presente');
});

test('el esquema comprueba propiedades propias no enumerables sin confundirlas con las heredadas', () => {
  const esquema: EsquemaDe<{ valor: number }> = {
    type: 'object',
    additionalProperties: false,
    required: ['valor'],
    properties: { valor: { type: 'number' } },
  };
  const corrupto = Object.defineProperty({}, 'valor', { value: 'no es número' });
  const valido = Object.defineProperty({}, 'valor', { value: 1 });
  assert.deepEqual(validar(corrupto, esquema), ['$.valor: se esperaba number']);
  assert.equal(cumple(corrupto, esquema), false);
  assert.deepEqual(validar(valido, esquema), []);
  assert.equal(cumple(valido, esquema), true);
  const extra = Object.defineProperty({ valor: 1 }, 'extra', { value: true });
  assert.deepEqual(validar(extra, esquema), ['$.extra: propiedad no prevista']);
  assert.deepEqual(validar(Object.create({ valor: 1 }), esquema), ['$.valor: falta']);
  assert.deepEqual(validar(JSON.parse('{"valor":1}'), esquema), []);
});

test('el esquema acota su trabajo: no recorre una lista demasiado larga ni junta errores sin fin', () => {
  const deNumeros: Esquema = { type: 'array', items: { type: 'number' } };
  const muchos = Array.from({ length: ELEMENTOS_DE_MAS }, () => 'x');
  const errores = validar(muchos, deNumeros);
  assert.equal(errores.length, ERRORES_COMO_MUCHO);
  assert.equal(errores[0], '$[0]: se esperaba number');
  assert.deepEqual(validar(muchos, { ...deNumeros, maxItems: 3 }), ['$: demasiados elementos']);
});
