// Las ramas del esquema preservan datos oficiales y separan sugerencias. Estas pruebas comprueban sus alternativas
// planas con el subconjunto local: no atribuyen a validar soporte de oneOf ni de JSON Schema 2020-12 completo.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EspecialidadRelacionada } from '../../motores/cursos/src/index.ts';
import {
  ESQUEMA_CONSULTA_FORMACION,
  ESQUEMA_ESPECIALIDAD_RELACIONADA,
  ESQUEMA_FORMACION_RELACIONADA,
} from '../../src/api/esquemas-formacion.ts';
import { validar } from '../../src/comun/esquema.ts';

const oficial: EspecialidadRelacionada = {
  codigo: 'OFICIAL',
  nombre: 'Oficial',
  nivel: '1',
  horas: '10',
  familia: 'ADG',
  modalidad: 'Presencial',
  programa: null,
  relacion: 'ocupacion',
  correspondencia: 'exacta',
};

/** Comprueba las alternativas planas publicadas, sin atribuir soporte de oneOf al validador de entrada. */
function alternativasQueAdmiten(especialidad: unknown): number {
  return (ESQUEMA_ESPECIALIDAD_RELACIONADA.oneOf ?? []).filter((rama) => validar(especialidad, rama).length === 0)
    .length;
}

test('las cuatro correspondencias oficiales y el parecido negativo siguen siendo datos válidos', () => {
  for (const relacion of ['ocupacion', 'incluye', 'grupo', 'variante']) {
    for (const correspondencia of ['exacta', 'cercana', 'amplia', 'estrecha']) {
      for (const parecido of [-1, 0, 1, 1 + Number.EPSILON]) {
        const especialidad = { ...oficial, relacion, correspondencia, parecido };
        assert.deepEqual(validar(especialidad, ESQUEMA_ESPECIALIDAD_RELACIONADA), []);
        assert.equal(alternativasQueAdmiten(especialidad), 1);
      }
    }
  }
});

test('sugerencia exige null y ninguna correspondencia oficial se pierde', () => {
  const sugerida = { ...oficial, relacion: 'sugerencia', correspondencia: null, parecido: 0.75 };
  assert.deepEqual(validar(sugerida, ESQUEMA_ESPECIALIDAD_RELACIONADA), []);
  assert.equal(alternativasQueAdmiten(sugerida), 1);
  for (const correspondencia of ['exacta', 'cercana', 'amplia', 'estrecha']) {
    assert.equal(alternativasQueAdmiten({ ...sugerida, correspondencia }), 0);
  }
  assert.equal(alternativasQueAdmiten({ ...oficial, correspondencia: null }), 0);
  assert.ok(validar({ ...oficial, correspondencia: 'inventada' }, ESQUEMA_ESPECIALIDAD_RELACIONADA).length);
  const { correspondencia: omitida, ...sinCorrespondencia } = oficial;
  assert.equal(omitida, 'exacta');
  assert.ok(validar(sinCorrespondencia, ESQUEMA_ESPECIALIDAD_RELACIONADA).length);
});

test('informe y consulta comparten el mismo esquema de especialidad; la ausencia de formación admite null', () => {
  assert.equal(ESQUEMA_FORMACION_RELACIONADA.properties?.especialidades?.items, ESQUEMA_ESPECIALIDAD_RELACIONADA);
  assert.equal(
    ESQUEMA_CONSULTA_FORMACION.properties?.especialidades?.properties?.mostradas?.items,
    ESQUEMA_ESPECIALIDAD_RELACIONADA,
  );
  assert.deepEqual(validar(null, ESQUEMA_FORMACION_RELACIONADA), []);
  assert.deepEqual(validar({ formacion: null, aviso: 'Sin datos', procedencia: {} }, ESQUEMA_CONSULTA_FORMACION), []);
  assert.ok(validar({ especialidades: { total: 1, mostradas: [oficial] } }, ESQUEMA_CONSULTA_FORMACION).length);
});
