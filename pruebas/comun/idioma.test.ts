// Contrato de idiomas: códigos exactos y rechazo de valores externos sin coerción ni normalización.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  esIdioma,
  IDIOMA_DE_LOS_DATOS,
  IDIOMA_POR_DEFECTO,
  IDIOMAS,
  type Idioma,
  type IdiomaDeDato,
} from '../../src/comun/idioma.ts';

const CODIGOS_AJENOS: readonly unknown[] = Object.freeze([
  '',
  'en',
  'fr',
  'ES',
  'CA',
  'es-ES',
  'ca-ES',
  ' es',
  'es ',
  'ca\n',
  'castellano',
  'catalán',
]);
const VALORES_AJENOS: readonly unknown[] = Object.freeze([
  null,
  undefined,
  false,
  true,
  0,
  1,
  NaN,
  Infinity,
  [],
  ['es'],
  { idioma: 'ca' },
  Symbol('es'),
  1n,
]);

test('la lista admite castellano y catalán en ese orden y conserva el castellano por defecto y de los datos', () => {
  const defecto: 'es' = IDIOMA_POR_DEFECTO;
  const datos: 'es' = IDIOMA_DE_LOS_DATOS;
  assert.deepEqual({ idiomas: IDIOMAS, defecto, datos }, { idiomas: ['es', 'ca'], defecto: 'es', datos: 'es' });
});

test('la guarda admite los dos códigos exactos y estrecha una entrada externa al tipo Idioma', () => {
  for (const valor of ['es', 'ca']) {
    assert.equal(esIdioma(valor), true);
    if (esIdioma(valor)) {
      const idioma: Idioma = valor;
      assert.equal(idioma, valor);
    }
  }
});

test('los datos admiten inglés sin admitirlo como idioma de respuesta', () => {
  const idiomaDeDato: IdiomaDeDato = 'en';
  assert.equal(esIdioma(idiomaDeDato), false);
});

test('la guarda rechaza códigos ajenos sin cambiar mayúsculas, espacios ni variantes regionales', () => {
  for (const valor of CODIGOS_AJENOS) {
    assert.equal(esIdioma(valor), false, String(valor));
  }
});

test('la guarda rechaza entradas no textuales sin coerción ni lectura de sus propiedades', () => {
  const enganoso = {
    toString(): string {
      throw new Error('La guarda no debe convertir objetos a texto');
    },
  };
  for (const valor of [...VALORES_AJENOS, enganoso]) {
    assert.equal(esIdioma(valor), false);
  }
});
