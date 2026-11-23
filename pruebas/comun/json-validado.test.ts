// Las guardas de JSON (src/comun/json.ts) comprueban datos recibidos completos y nunca los sustituyen por otros.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  camposDe,
  esBooleano,
  esFormaDe,
  esListaDe,
  esNuloO,
  esNumero,
  esObjeto,
  esOpcional,
  esRegistroDe,
  esTexto,
  type Guarda,
  listaDe,
  textoDe,
} from '../../src/comun/json.ts';

const esFila = esFormaDe({ nombre: esTexto, notas: esListaDe(esNuloO(esNumero)), aviso: esOpcional(esTexto) });

test('las guardas recorren todas las filas, campos anidados, nulos y opcionales sin cambiar los datos', () => {
  const primera = { nombre: 'primera', notas: [1, null] };
  const segunda = { nombre: 'segunda', notas: [2], aviso: 'nota', extra: true };
  const filas = [primera, segunda];
  const original = JSON.stringify(filas);
  const esFilas = esListaDe(esFila);
  assert.ok(esFilas(filas));
  assert.equal(JSON.stringify(filas), original);
  assert.equal(segunda.extra, true);
  for (const valor of [
    null,
    {},
    [primera, { nombre: 3, notas: [2] }],
    [{ nombre: 'fila', notas: [1, '2'] }],
    [{ nombre: 'fila', notas: null }],
    [{ nombre: 'fila', notas: [], aviso: null }],
    Array(1),
  ]) {
    assert.equal(esFilas(valor), false);
  }
  const esRegistro = esRegistroDe(esFila);
  assert.ok(esRegistro({ uno: primera, dos: segunda }));
  assert.equal(esRegistro({ uno: primera, dos: { nombre: 'segunda', notas: [false] } }), false);
  assert.equal(esRegistro([]), false);
  assert.equal(esRegistro(null), false);
  assert.equal(esFila(Object.create({ nombre: 'heredado', notas: [] })), false);
  assert.equal(esNuloO(esTexto)(undefined), false);
  assert.equal(esOpcional(esTexto)(null), false);
});

test('camposDe y listaDe devuelven el objeto recibido por identidad, sin afirmar la forma de sus datos', () => {
  const objeto = { dato: 1 };
  const lista = ['dato', null];
  assert.equal(camposDe(objeto), objeto);
  assert.equal(camposDe(lista), lista);
  assert.equal(listaDe(lista), lista);
  assert.deepEqual(listaDe(objeto), []);
  for (const valor of [null, undefined, 1, false, 'texto', Symbol('dato'), 1n, () => 'dato']) {
    assert.deepEqual(camposDe(valor), {});
    assert.deepEqual(listaDe(valor), []);
  }
});

test('textoDe devuelve el texto recibido y, de cualquier otra cosa, el texto vacío', () => {
  const objeto = { dato: 1 };
  assert.equal(textoDe('texto'), 'texto');
  assert.equal(textoDe(''), '');
  for (const valor of [null, undefined, 1, false, objeto, ['dato'], () => 'texto']) {
    assert.equal(textoDe(valor), '');
  }
});

test('las guardas primitivas conservan el contrato typeof sin imponer límites numéricos', () => {
  for (const valor of [0, -1, Infinity, -Infinity, NaN]) {
    assert.equal(esNumero(valor), true);
  }
  for (const valor of ['', 'texto']) {
    assert.equal(esTexto(valor), true);
  }
  for (const valor of [true, false]) {
    assert.equal(esBooleano(valor), true);
  }
  for (const valor of [null, undefined, [], {}, () => 1]) {
    assert.equal(esNumero(valor), false);
    assert.equal(esTexto(valor), false);
    assert.equal(esBooleano(valor), false);
  }
  assert.equal(esNumero('1'), false);
  assert.equal(esBooleano(1), false);
  assert.equal(esTexto(1), false);
});

test('un registro comprueba también los valores propios no enumerables y conserva el objeto', () => {
  const comprobar = esRegistroDe(esTexto);
  const corrupto = Object.defineProperty({}, 'oculto', { value: 1 });
  const valido = Object.defineProperty({ visible: 'texto' }, 'oculto', { value: 'otro texto' });
  assert.equal(comprobar(corrupto), false);
  assert.equal(comprobar(valido), true);
  assert.deepEqual(Object.keys(valido), ['visible']);
  assert.equal(Object.hasOwn(valido, 'oculto'), true);
  assert.equal(valido.visible, 'texto');
  const deJson: unknown = JSON.parse('{"uno":"texto","dos":"otro texto"}');
  const original = JSON.stringify(deJson);
  assert.ok(comprobar(deJson));
  assert.equal(JSON.stringify(deJson), original);
});

test('la forma inferida admite campos ausentes sin materializarlos ni aceptar valores corruptos', () => {
  const comprobar = esFormaDe({ requerido: esTexto, aviso: esOpcional(esTexto), nota: esOpcional(esNuloO(esNumero)) });
  type Recibido = typeof comprobar extends Guarda<infer Forma> ? Forma : never;
  const ausente: Recibido = { requerido: 'texto' };
  const explicito: Recibido = { requerido: 'texto', aviso: undefined, nota: null };
  assert.ok(comprobar(ausente));
  assert.ok(comprobar(explicito));
  assert.equal(Object.hasOwn(ausente, 'aviso'), false);
  assert.equal(Object.hasOwn(ausente, 'nota'), false);
  assert.equal(Object.hasOwn(explicito, 'aviso'), true);
  assert.equal(explicito.aviso, undefined);
  assert.equal(explicito.nota, null);
  assert.equal(JSON.stringify(ausente), '{"requerido":"texto"}');
  for (const valor of [{}, { requerido: 1 }, { requerido: 'texto', aviso: 1 }, { requerido: 'texto', nota: '1' }]) {
    assert.equal(comprobar(valor), false);
  }
});

test('esObjeto admite objetos sin exigir un prototipo concreto y rechaza null, listas y funciones', () => {
  for (const valor of [{}, Object.create(null), new Date(0), new Map()]) {
    assert.equal(esObjeto(valor), true);
  }
  for (const valor of [null, undefined, [], 'texto', 1, true, () => 1]) {
    assert.equal(esObjeto(valor), false);
  }
});

test('una forma lee campos propios no enumerables e ignora accesores heredados y campos extra', () => {
  const comprobar = esFormaDe({ nombre: esTexto, aviso: esOpcional(esTexto) });
  const heredado = {
    get aviso(): never {
      throw new Error('El campo heredado no se debe leer');
    },
  };
  const valor = Object.defineProperty(Object.create(heredado), 'nombre', { value: 'texto' });
  Object.defineProperty(valor, 'extra', {
    get(): never {
      throw new Error('El campo extra no se debe leer');
    },
  });
  assert.equal(comprobar(valor), true);
  assert.deepEqual(Object.getOwnPropertyNames(valor), ['nombre', 'extra']);
  assert.equal(Object.hasOwn(valor, 'aviso'), false);
});

test('un registro lee todos los accesores antes de comprobar el primer valor inválido', () => {
  const orden: string[] = [];
  const valor = {
    get primero(): number {
      orden.push('lee primero');
      return 1;
    },
    get segundo(): string {
      orden.push('lee segundo');
      return 'texto';
    },
  };
  const comprobar = esRegistroDe((dato: unknown): dato is string => {
    orden.push(`comprueba ${String(dato)}`);
    return esTexto(dato);
  });
  assert.equal(comprobar(valor), false);
  assert.deepEqual(orden, ['lee primero', 'lee segundo', 'comprueba 1']);
});

test('las guardas propagan el error original de un accesor sin sustituirlo por falso', () => {
  const fallo = new Error('lectura fallida');
  const valor = {
    primero: 1,
    get segundo(): never {
      throw fallo;
    },
  };
  assert.throws(
    () => esRegistroDe(esTexto)(valor),
    (error: unknown) => error === fallo,
  );
  assert.throws(
    () => esFormaDe({ segundo: esTexto })(valor),
    (error: unknown) => error === fallo,
  );
});

test('un registro comprueba solo claves string propias y no impone políticas sobre símbolos ni prototipos', () => {
  const valor = Object.assign(Object.create({ heredado: 1 }), { propio: 'texto', [Symbol('dato')]: 1 });
  assert.equal(esRegistroDe(esTexto)(valor), true);
  assert.deepEqual(Object.getOwnPropertyNames(valor), ['propio']);
});
