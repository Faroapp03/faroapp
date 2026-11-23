// Dos garantías de la geometría del globo (herramientas/web/geometria-del-globo.ts): un contorno que no vuelve a su
// inicio lanza en vez de devolver un anillo abierto, y los centros se redondean con la escala de las coordenadas.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Anillo,
  centroDeLaCaja,
  contornoDeLaUnion,
  ESCALA,
  GeometriaInvalida,
  redondearAEscala,
} from '../../herramientas/web/geometria-del-globo.ts';

test('un contorno que gasta sus segmentos sin volver a su inicio lanza, no devuelve un anillo abierto', () => {
  // El borde {(0,0), (2,0)} sale tres veces y se anula; quedan (0,0)→(1,1)→(2,0), que no vuelve a (0,0).
  const anillo: Anillo = [
    [0, 0],
    [2, 0],
    [0, 0],
    [1, 1],
    [2, 0],
  ];
  assert.throws(() => contornoDeLaUnion([anillo]), GeometriaInvalida);
});

/** Fracción de un paso de la escala por debajo de la mitad: el redondeo la quita. */
const FRACCION_POR_DEBAJO = 0.4;
/** Fracción de un paso por encima de la mitad: el redondeo la lleva al paso siguiente. */
const FRACCION_POR_ENCIMA = 0.6;
/** Los dos desplazamientos, en grados. */
const POR_DEBAJO_DE_MEDIO_PASO = FRACCION_POR_DEBAJO / ESCALA;
const POR_ENCIMA_DE_MEDIO_PASO = FRACCION_POR_ENCIMA / ESCALA;

test('los centros se redondean a 1 / ESCALA grados, como las coordenadas', () => {
  assert.equal(redondearAEscala(1 + POR_DEBAJO_DE_MEDIO_PASO), 1);
  assert.equal(redondearAEscala(1 + POR_ENCIMA_DE_MEDIO_PASO), 1 + 1 / ESCALA);
  const este = 1 + POR_ENCIMA_DE_MEDIO_PASO;
  const cuadrado: Anillo = [
    [0, 0],
    [este, 0],
    [este, 1],
    [0, 1],
  ];
  assert.deepEqual(centroDeLaCaja([cuadrado]), [redondearAEscala(este / 2), redondearAEscala(1 / 2)]);
});
