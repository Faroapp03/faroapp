// Compactación ESCO autónoma: orden, identidad, iterables consumibles y aislamiento de los pares devueltos.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatosEsco } from '../../src/dominio/tipos-paquete.ts';
import { conRelacionesCompactas } from '../../src/plataforma/relaciones-esco.ts';

type Relaciones = DatosEsco['ocupaciones'][string]['competencias'];

/** Catálogo mínimo con relaciones esenciales y opcionales, repeticiones y una ocupación sin competencias. */
function datos(): DatosEsco {
  return {
    competencias: [
      ['uri:cero', 'Competencia inicial', 'skill'],
      ['uri:uno', 'Competencia siguiente', 'knowledge'],
    ],
    ocupaciones: {
      primera: {
        uri: 'uri:primera',
        titulo: 'Primera',
        isco08: '4226',
        alternativos: ['Otro nombre'],
        descripcion: 'Descripción',
        competencias: [
          [0, 'e'],
          [1, 'o'],
          [0, 'o'],
          [1, 'e'],
          [0, 'e'],
        ],
      },
      vacia: { uri: 'uri:vacia', titulo: 'Vacía', isco08: '4226', competencias: [] },
      ultima: { uri: 'uri:ultima', titulo: 'Última', isco08: '4226', competencias: [[1, 'e']] },
    },
  };
}

/** Exige que la ocupación probada esté en el catálogo y materializa únicamente sus relaciones. */
function relaciones(esco: DatosEsco, codigo: string): [number, 'e' | 'o'][] {
  const ocupacion = esco.ocupaciones[codigo];
  assert.ok(ocupacion);
  return [...ocupacion.competencias];
}

test('conserva los pares y el orden de cada tramo, incluidas repeticiones y ocupaciones vacías', () => {
  const original = datos();
  const compactado = conRelacionesCompactas(original);
  assert.deepEqual(Object.keys(compactado.ocupaciones), ['primera', 'vacia', 'ultima']);
  for (const codigo of Object.keys(original.ocupaciones)) {
    assert.deepEqual(relaciones(compactado, codigo), relaciones(original, codigo));
    assert.deepEqual(relaciones(compactado, codigo), relaciones(original, codigo));
  }
  assert.deepEqual(conRelacionesCompactas({ competencias: [], ocupaciones: {} }), {
    competencias: [],
    ocupaciones: {},
  });
});

test('no muta el catálogo y conserva referencias de metadatos al copiar solo ocupaciones y relaciones', () => {
  const original = datos();
  const antes = structuredClone(original);
  const compactado = conRelacionesCompactas(original);
  assert.notEqual(compactado, original);
  assert.notEqual(compactado.ocupaciones, original.ocupaciones);
  assert.equal(compactado.competencias, original.competencias);
  const primera = compactado.ocupaciones.primera;
  const leida = original.ocupaciones.primera;
  assert.ok(primera && leida);
  assert.notEqual(primera, leida);
  assert.notEqual(primera.competencias, leida.competencias);
  assert.equal(primera.alternativos, leida.alternativos);
  assert.deepEqual({ ...primera, competencias: [...primera.competencias] }, leida);
  assert.deepEqual(original, antes);
});

test('consume cada iterable una sola vez y convierte un generador consumible en relaciones reiterables', () => {
  const original = datos();
  let lecturas = 0;
  const pares: Relaciones = [
    [1, 'o'],
    [0, 'e'],
  ];
  function* consumible(): Generator<[number, 'e' | 'o']> {
    lecturas++;
    yield* pares;
  }
  const primera = original.ocupaciones.primera;
  assert.ok(primera);
  primera.competencias = consumible();
  const compactado = conRelacionesCompactas(original);
  assert.equal(lecturas, 1);
  assert.deepEqual([...primera.competencias], []);
  assert.deepEqual(relaciones(compactado, 'primera'), [
    [1, 'o'],
    [0, 'e'],
  ]);
  assert.deepEqual(relaciones(compactado, 'primera'), [
    [1, 'o'],
    [0, 'e'],
  ]);
  assert.equal(lecturas, 1);
});

test('cada recorrido devuelve pares nuevos y modificarlos no altera los tramos ni el catálogo leído', () => {
  const original = datos();
  const compactado = conRelacionesCompactas(original);
  const obtenidos = relaciones(compactado, 'primera');
  const primero = obtenidos[0];
  assert.ok(primero);
  primero[0] = 1;
  primero[1] = 'o';
  assert.deepEqual(relaciones(compactado, 'primera'), relaciones(original, 'primera'));
  assert.deepEqual(relaciones(compactado, 'ultima'), relaciones(original, 'ultima'));
  assert.notEqual(relaciones(compactado, 'primera')[0], relaciones(compactado, 'primera')[0]);
});

test('compactar de nuevo conserva las relaciones de un catálogo ya preparado', () => {
  const original = datos();
  const unaVez = conRelacionesCompactas(original);
  const dosVeces = conRelacionesCompactas(unaVez);
  for (const codigo of Object.keys(original.ocupaciones)) {
    assert.deepEqual(relaciones(dosVeces, codigo), relaciones(original, codigo));
  }
  assert.equal(dosVeces.competencias, original.competencias);
});
