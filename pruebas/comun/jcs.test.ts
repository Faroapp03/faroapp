import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jsonCanonico, TextoJcsInvalido } from '../../src/comun/jcs.ts';

test('JCS reproduce los números y escapes del vector RFC 8785 §3.2.2', () => {
  const entrada = {
    numbers: ['333333333.33333329', '1e30', '4.5', '2e-3', '0.000000000000000000000000001'].map(Number),
    string: '€$\u000F\nA\'B"\\\\"/',
    literals: [null, true, false],
  };
  assert.equal(
    jsonCanonico(entrada),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
      '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test('JCS ordena claves por unidades UTF16 y conserva el texto sin normalizar', () => {
  const entrada = { דּ: 1, '😀': 1, '€': 1, ö: 1, '\u0080': 1, '1': 1, '\r': 1 };
  assert.equal(jsonCanonico(entrada), '{"\\r":1,"1":1,"\u0080":1,"ö":1,"€":1,"😀":1,"דּ":1}');
  assert.notEqual(jsonCanonico('é'), jsonCanonico('e\u0301'));
  assert.equal(jsonCanonico(-0), '0');
});

test('JCS representa huecos como null sin utilizar iteradores añadidos', () => {
  const longitud = 3;
  const ultimo = 3;
  const lista: unknown[] = Array(longitud);
  lista[0] = 1;
  lista[longitud - 1] = ultimo;
  lista[Symbol.iterator] = () => ['otro'].values();
  assert.equal(jsonCanonico(lista), '[1,null,3]');
  assert.equal(jsonCanonico([undefined, null, 0]), '[null,null,0]');
  assert.equal(Object.hasOwn(lista, 1), false);
});

test('JCS admite objetos planos, omite undefined y no altera sus propiedades', () => {
  const entrada = Object.assign(Object.create(null), { b: 1, a: { d: undefined, c: true } });
  assert.equal(jsonCanonico(entrada), '{"a":{"c":true},"b":1}');
  assert.deepEqual(Object.keys(entrada), ['b', 'a']);
  assert.equal(Object.hasOwn(entrada.a, 'd'), true);
  assert.equal(jsonCanonico(JSON.parse('{"b":[1],"a":{}}')), '{"a":{},"b":[1]}');
});

test('JCS rechaza tipos ajenos a JSON y números no finitos en cualquier nivel', () => {
  const noAdmitidos = [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, Symbol('x'), () => true];
  for (const valor of noAdmitidos) {
    assert.throws(() => jsonCanonico(valor), TypeError);
  }
  for (const valor of [new Date(0), new Map([['a', 1]]), new Set([1]), new (class Caja {})()]) {
    assert.throws(() => jsonCanonico({ a: valor }), TypeError);
  }
  assert.throws(() => jsonCanonico({ a: [Number.NEGATIVE_INFINITY] }), TypeError);
});

test('JCS rechaza sustitutos UTF16 solitarios en valores y claves con error específico', () => {
  for (const texto of ['\ud800', '\udfff', 'a\ud800b', '\ud800\ud800', '\udfff\ud800']) {
    assert.throws(() => jsonCanonico({ texto }), TextoJcsInvalido);
    assert.throws(() => jsonCanonico({ [texto]: true }), TextoJcsInvalido);
  }
  assert.equal(jsonCanonico({ texto: 'a😀é e\u0301' }), '{"texto":"a😀é é"}');
});
