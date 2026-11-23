// El orden de formación distingue una medida de coseno de la ausencia, conserva prioridades y es transitivo.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Correspondencia, EspecialidadRelacionada } from '../../../compartido/contratos/tipos-formacion.ts';
import { ordenDeEnlaces, ordenEspecialidades } from '../src/orden-formacion.ts';

/** Especialidad mínima para probar las claves de orden, sin catálogo ni vectores externos. */
function especialidad(
  nombre: string,
  parecido?: number,
  correspondencia: Correspondencia | null = 'exacta',
  relacion: EspecialidadRelacionada['relacion'] = 'ocupacion',
): EspecialidadRelacionada {
  return {
    codigo: nombre,
    nombre,
    nivel: '',
    horas: '',
    familia: '',
    modalidad: '',
    programa: null,
    relacion,
    correspondencia,
    ...(parecido === undefined ? {} : { parecido }),
  };
}

/** Los nombres, en el orden devuelto por el comparador. */
function nombresOrdenados(lista: EspecialidadRelacionada[]): string[] {
  return [...lista].sort(ordenEspecialidades).map(({ nombre }) => nombre);
}

test('una medida negativa precede a una ausencia de la misma relación, sin imputarle coseno cero', () => {
  const medida = especialidad('Z medida negativa', -1, 'amplia');
  const ausente = especialidad('A sin medida');
  assert.ok(ordenEspecialidades(medida, ausente) < 0);
  assert.ok(ordenEspecialidades(ausente, medida) > 0);
  assert.deepEqual(nombresOrdenados([ausente, medida]), ['Z medida negativa', 'A sin medida']);
});

test('coseno cero es una medida y precede a la ausencia y a las medidas negativas', () => {
  assert.deepEqual(
    nombresOrdenados([
      especialidad('A sin medida'),
      especialidad('D negativa', -1),
      especialidad('C cero', 0, 'amplia'),
      especialidad('B positiva', 1),
    ]),
    ['B positiva', 'C cero', 'D negativa', 'A sin medida'],
  );
});

test('la relación conserva prioridad sobre la presencia y el valor de la medida', () => {
  assert.deepEqual(
    nombresOrdenados([
      especialidad('Sugerencia', 1, null, 'sugerencia'),
      especialidad('Variante', 1, 'exacta', 'variante'),
      especialidad('Grupo', undefined, 'exacta', 'grupo'),
      especialidad('Incluye', -1, 'exacta', 'incluye'),
      especialidad('Ocupación', undefined),
    ]),
    ['Ocupación', 'Incluye', 'Grupo', 'Variante', 'Sugerencia'],
  );
});

test('a igual medida y sin medidas se conservan correspondencia y orden alfabético en castellano', () => {
  for (const parecido of [undefined, -1, 0, 1]) {
    const lista = [
      especialidad('Amplia', parecido, 'amplia'),
      especialidad('Estrecha', parecido, 'estrecha'),
      especialidad('Cercana', parecido, 'cercana'),
      especialidad('O exacta', parecido),
      especialidad('Ñ exacta', parecido),
      especialidad('N exacta', parecido),
    ];
    assert.deepEqual(nombresOrdenados(lista), ['N exacta', 'Ñ exacta', 'O exacta', 'Cercana', 'Estrecha', 'Amplia']);
  }
});

test('el comparador conserva reflexividad, antisimetría y transitividad con medidas y ausencias', () => {
  const muestra = [
    especialidad('Sin medida', undefined, 'amplia'),
    especialidad('Sin medida exacta'),
    especialidad('Negativa', -1, 'amplia'),
    especialidad('Negativa exacta', -1),
    especialidad('Cero', 0),
    especialidad('Positiva', 1),
    especialidad('Grupo', 1, 'exacta', 'grupo'),
  ];
  for (const a of muestra) {
    assert.equal(ordenEspecialidades(a, a), 0);
    for (const b of muestra) {
      const orden = ordenEspecialidades(a, b);
      assert.equal(Math.sign(orden) + Math.sign(ordenEspecialidades(b, a)), 0);
      for (const c of muestra) {
        if (orden <= 0 && ordenEspecialidades(b, c) <= 0) {
          assert.ok(ordenEspecialidades(a, c) <= 0);
        }
      }
    }
  }
});

test('las sugerencias sin correspondencia conservan parecido y nombre como claves de orden', () => {
  assert.deepEqual(
    nombresOrdenados([
      especialidad('Z sugerencia', 1, null, 'sugerencia'),
      especialidad('A sugerencia', 1, null, 'sugerencia'),
      especialidad('Sin medida', undefined, null, 'sugerencia'),
      especialidad('Negativa', -1, null, 'sugerencia'),
      especialidad('Oficial', -1, 'amplia'),
    ]),
    ['Oficial', 'A sugerencia', 'Z sugerencia', 'Negativa', 'Sin medida'],
  );
});

test('el mejor enlace prioriza relación y correspondencia, conservando el empate sin mirar el parecido', () => {
  const misma = especialidad('Misma ocupación', -1, 'amplia');
  const general = especialidad('Más general', 1, 'exacta', 'incluye');
  assert.ok(ordenDeEnlaces(misma, general) < 0);
  assert.ok(ordenDeEnlaces(general, misma) > 0);
  const exacta = especialidad('Exacta', undefined, 'exacta');
  assert.ok(ordenDeEnlaces(exacta, misma) < 0);
  const otroParecido = { ...misma, parecido: 1, nombre: 'Otro nombre' };
  assert.equal(ordenDeEnlaces(misma, otroParecido), 0);
  const sugerencia = especialidad('Sugerencia', 1, null, 'sugerencia');
  assert.ok(ordenDeEnlaces(misma, sugerencia) < 0);
  assert.equal(ordenDeEnlaces(sugerencia, { ...sugerencia }), 0);
});
