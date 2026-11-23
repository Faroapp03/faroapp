// Política, selección y exclusiones con notas y vectores controlados.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  baseDeLaEstimacion,
  MAX_REFERENCIAS,
  politicaEnVigor,
  referenciasPara,
} from '../../src/dominio/referencias.ts';
import type { Datos, PoliticaReferencias } from '../../src/dominio/tipos-paquete.ts';
import { datosMinimos, tarea, vectores } from '../fixtures/datos-referencias-grupos.ts';

function datosDeTareas(tareas: Datos['oit']['tareas']): Datos {
  const datos = datosMinimos();
  datos.oit.tareas = tareas;
  return datos;
}

test('ocupacion conserva las propias en el orden del paquete y ampliada añade apoyo ordenado por nota e id', () => {
  const datos = datosDeTareas({
    z: tarea('1111', 1),
    a: tarea('1111', 0),
    hermanaB: tarea('1112', 1),
    hermanaA: tarea('1113', 1),
    hermanaBaja: tarea('1112', 0),
    sinNota: tarea('1111', null),
    ajena: tarea('2222', 0),
  });
  assert.deepEqual(
    referenciasPara(datos, '1111', 'ocupacion')?.refs.map(({ id }) => id),
    ['z', 'a'],
  );
  assert.deepEqual(
    referenciasPara(datos, '1111', 'ampliada')?.refs.map(({ id }) => id),
    ['z', 'a', 'hermanaBaja', 'hermanaA', 'hermanaB'],
  );
});

test('el apoyo cubre la escala y no recorta las tareas propias que superan el tope', () => {
  const cantidad = MAX_REFERENCIAS + 1;
  const datos = datosDeTareas(
    Object.fromEntries(Array.from({ length: cantidad }, (_, i) => [`t${i}`, tarea('1111', i / MAX_REFERENCIAS)])),
  );
  assert.equal(referenciasPara(datos, '1111', 'ampliada')?.refs.length, cantidad);
  const apoyo = referenciasPara(datos, '1112', 'ocupacion');
  assert.equal(apoyo?.base, 'subgrupo');
  assert.equal(apoyo?.refs.length, MAX_REFERENCIAS);
  assert.equal(apoyo?.refs[0]?.nota, 0);
  assert.equal(apoyo?.refs.at(-1)?.nota, 1);
});

test('una sola plaza de apoyo elige la posición central y ninguna plaza añade tareas', () => {
  const propias = Object.fromEntries(
    Array.from({ length: MAX_REFERENCIAS - 1 }, (_, i) => [`p${i}`, tarea('1111', 0)]),
  );
  const datos = datosDeTareas({
    ...propias,
    baja: tarea('1112', 0),
    centro: tarea('1112', Math.SQRT1_2),
    alta: tarea('1112', 1),
  });
  assert.equal(referenciasPara(datos, '1111', 'ampliada')?.refs.at(-1)?.id, 'centro');
  const completas = datosDeTareas({ ...datos.oit.tareas, ultima: tarea('1111', 0) });
  assert.equal(referenciasPara(completas, '1111', 'ampliada')?.refs.length, MAX_REFERENCIAS);
});

test('una exclusión quita también copias normalizadas en otras ocupaciones', () => {
  const datos = datosDeTareas({
    original: tarea('1111', 1, 'Serving FOOD!'),
    copia: tarea('1112', 0, 'serving food'),
    distinta: tarea('1112', 0, 'serving drinks'),
  });
  for (const politica of ['ocupacion', 'ampliada'] as const) {
    const resultado = referenciasPara(datos, '1111', politica, 'original');
    assert.equal(resultado?.base, 'subgrupo');
    assert.deepEqual(
      resultado?.refs.map(({ id }) => id),
      ['distinta'],
    );
  }
  assert.equal(referenciasPara(datos, '2222', 'ampliada'), null);
  assert.deepEqual(referenciasPara(datos, '1111', 'ampliada', 'ausente'), referenciasPara(datos, '1111', 'ampliada'));
});

test('la política y la base reflejan los vectores disponibles sin inventar referencias del subgrupo', () => {
  const datos = datosDeTareas({ tarea: tarea('1111', 1) });
  for (const politica of ['ocupacion', 'ampliada', 'oit'] satisfies PoliticaReferencias[]) {
    assert.equal(baseDeLaEstimacion(datos, '1111', politica), 'ocupacion');
    assert.equal(baseDeLaEstimacion(datos, '1112', politica), 'subgrupo');
    assert.equal(baseDeLaEstimacion(datos, '2222', politica), null);
  }
  assert.equal(politicaEnVigor(datos, 'oit'), 'ampliada');
  datos.vectores = vectores(['tarea']);
  assert.equal(politicaEnVigor(datos, 'oit'), 'oit');
  assert.equal(baseDeLaEstimacion(datos, '2222', 'oit'), 'oit');
});
