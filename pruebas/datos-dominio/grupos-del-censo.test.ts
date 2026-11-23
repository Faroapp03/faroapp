// Selección de grupos publicados: prioridad de tres cifras, fallback, orden y prevención del doble recuento.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CifrasPorNivel, grupoDe2, gruposPublicados } from '../../src/dominio/grupos-del-censo.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';

const DATOS: Pick<Datos, 'clasificaciones'> = {
  clasificaciones: {
    cno11: {
      '751': { titulo: 'Grupo 751', nivel: '3', padre: '75' },
      '752': { titulo: 'Grupo 752', nivel: '3', padre: '75' },
      '811': { titulo: 'Grupo 811', nivel: '3', padre: '81' },
      '931': { titulo: 'Grupo 931', nivel: '3', padre: '99' },
    },
    isco08_es: {},
    isco08_a_cno11: {},
  },
};
const PERSONAS = { valido: 100, amplio: 1000 } as const;
const CIFRAS: CifrasPorNivel<number> = {
  de3: { '751': 100, '752': 0, '811': 200 },
  de2: { '75': 1000, '81': 2000, '99': 3000 },
  vale: (personas) => personas > 0,
};

test('el padre del grupo sale de la clasificación y solo sin ella del prefijo de dos cifras', () => {
  assert.equal(grupoDe2(DATOS, '9311'), '99');
  assert.equal(grupoDe2(DATOS, '931'), '99');
  assert.equal(grupoDe2(DATOS, '4411'), '44');
  assert.equal(grupoDe2(DATOS, '44'), '44');
});

test('el grupo de tres cifras publicado y válido tiene prioridad sobre el amplio', () => {
  assert.deepEqual(gruposPublicados(DATOS, ['7511'], CIFRAS), [{ codigo: '751', amplio: false, cifras: 100 }]);
});

test('el grupo de dos cifras sustituye al de tres si este falta o no cumple el mínimo', () => {
  assert.deepEqual(gruposPublicados(DATOS, ['7521'], CIFRAS), [{ codigo: '75', amplio: true, cifras: 1000 }]);
  assert.deepEqual(gruposPublicados(DATOS, ['9311'], CIFRAS), [{ codigo: '99', amplio: true, cifras: 3000 }]);
});

test('sin ninguno publicado y válido el código no añade un grupo', () => {
  assert.deepEqual(gruposPublicados(DATOS, ['4411'], CIFRAS), []);
  assert.deepEqual(gruposPublicados(DATOS, ['7521'], { ...CIFRAS, vale: () => false }), []);
  assert.deepEqual(gruposPublicados(DATOS, [], CIFRAS), []);
});

test('códigos repetidos del mismo grupo se cuentan una vez y conservan su primera posición', () => {
  const codigos = Object.freeze(['8111', '7511', '8112', '7512']);
  assert.deepEqual(gruposPublicados(DATOS, codigos, CIFRAS), [
    { codigo: '811', amplio: false, cifras: 200 },
    { codigo: '751', amplio: false, cifras: 100 },
  ]);
  assert.deepEqual(codigos, ['8111', '7511', '8112', '7512']);
});

test('un grupo amplio excluye todos sus hijos publicados con independencia del orden de los códigos', () => {
  for (const codigos of [
    ['7511', '7521'],
    ['7521', '7511'],
  ]) {
    assert.deepEqual(gruposPublicados(DATOS, codigos, CIFRAS), [{ codigo: '75', amplio: true, cifras: 1000 }]);
  }
});

test('quitar hijos de un grupo amplio conserva el orden de los otros grupos', () => {
  assert.deepEqual(gruposPublicados(DATOS, ['7511', '8111', '7521'], CIFRAS), [
    { codigo: '811', amplio: false, cifras: 200 },
    { codigo: '75', amplio: true, cifras: 1000 },
  ]);
});

test('la política de publicación se aplica a las cifras presentes, primero tres y después dos', () => {
  const revisadas: number[] = [];
  const cifras = {
    ...CIFRAS,
    vale: (personas: number) => {
      revisadas.push(personas);
      return personas > 0;
    },
  };
  gruposPublicados(DATOS, ['7511', '7521', '4411'], cifras);
  assert.deepEqual(revisadas, [PERSONAS.valido, 0, PERSONAS.amplio]);
});
