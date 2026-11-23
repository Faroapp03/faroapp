// Cada plazo de suite sale de su medida en el runner con el margen del proyecto, redondeado al minuto superior: si
// cambia la medida o el plazo sin el otro, esta prueba lo detecta.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MARGEN_SOBRE_LA_MEDIDA,
  MEDIDA_SUITE_NAVEGADOR_MS,
  MEDIDA_SUITE_UNIDAD_MS,
  PLAZO_SUITE_NAVEGADOR_MS,
  PLAZO_SUITE_UNIDAD_MS,
  VARIACION_DEL_RUNNER,
} from '../../scripts/plazos-de-las-suites.ts';
import * as verificar from '../../scripts/verificar.ts';

const MINUTO_MS = 60_000;
const MARGEN_DEL_PROYECTO = 1.2;
/** 892,5 s × 1,2 = 1.071 s. */
const MINUTOS_SUITE_UNIDAD = 18;
/** 373,3 s × 1,54 × 1,2 = 690 s. */
const MINUTOS_SUITE_NAVEGADOR = 12;
/** La mediana medida entre el runner normal del 22/11 y el lento del 23/11. */
const VARIACION_MEDIDA = 1.54;

/** La medida con el margen, redondeada al minuto superior. */
function plazoDeLaMedida(medidaMs: number, variacion = 1): number {
  return Math.ceil((medidaMs * variacion * MARGEN_SOBRE_LA_MEDIDA) / MINUTO_MS) * MINUTO_MS;
}

test('el margen del proyecto sobre lo medido es 1,2', () => {
  assert.equal(MARGEN_SOBRE_LA_MEDIDA, MARGEN_DEL_PROYECTO);
});

test('el plazo de la suite de unidad es su medida en el runner × 1,2, redondeada al minuto', () => {
  assert.equal(PLAZO_SUITE_UNIDAD_MS, plazoDeLaMedida(MEDIDA_SUITE_UNIDAD_MS));
  assert.equal(PLAZO_SUITE_UNIDAD_MS, MINUTOS_SUITE_UNIDAD * MINUTO_MS);
});

test('el plazo de la suite de navegador es su medida llevada al runner lento × 1,2, redondeada al minuto', () => {
  assert.equal(VARIACION_DEL_RUNNER, VARIACION_MEDIDA);
  assert.equal(PLAZO_SUITE_NAVEGADOR_MS, plazoDeLaMedida(MEDIDA_SUITE_NAVEGADOR_MS, VARIACION_DEL_RUNNER));
  assert.equal(PLAZO_SUITE_NAVEGADOR_MS, MINUTOS_SUITE_NAVEGADOR * MINUTO_MS);
});

test('la batería global usa los plazos medidos', () => {
  assert.equal(verificar.PLAZO_SUITE_UNIDAD_MS, PLAZO_SUITE_UNIDAD_MS);
  assert.equal(verificar.PLAZO_SUITE_NAVEGADOR_MS, PLAZO_SUITE_NAVEGADOR_MS);
});
