// Lo que el globo rechaza al leer sus fronteras (scripts/globo/fronteras.js): un territorio dentro de otro que ya está
// dentro de un tercero, una escala que no es un número finito y coordenadas fuera de la Tierra; y que las fronteras que
// no llegan a tiempo (scripts/globo/recursos.js) se cuentan como un recurso sin cargar, no como un fallo cualquiera.
// Se ejecutan con npm test (o, node --test pruebas/web-globo/*.test.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FronterasInvalidas, leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { cargarFronteras, RecursoSinCargar } from '../../web/scripts/globo/recursos.js';

/** Un cuadrado de un grado de lado con la escala 1: el primer punto entero y los demás como diferencias. */
const CUADRADO = Object.freeze([0, 0, 1, 0, 0, 1, -1, 0]);

/**
 * Unas fronteras con estos territorios (código y, si lo tiene, el de dentro del que está), todos con el mismo cuadrado.
 * @param {[string, string?][]} territorios @param {{ escala?: number, centro?: number[] }} [opciones]
 */
function fronteras(territorios, { escala = 1, centro = [0, 0] } = {}) {
  return {
    version: '1',
    escala,
    territorios: territorios.map(([codigo, dentroDe]) => ({
      codigo,
      centro,
      ...(dentroDe ? { dentro_de: dentroDe } : {}),
      anillos: [[...CUADRADO]],
    })),
  };
}

test('un territorio dentro de otro vale; dentro de uno que ya está dentro de otro, no', () => {
  assert.equal(leerFronteras(fronteras([['ESP'], ['ES51', 'ESP']])).territorios.length, 2);
  assert.throws(() => leerFronteras(fronteras([['ESP'], ['ES51', 'ESP'], ['ES5B', 'ES51']])), FronterasInvalidas);
  assert.throws(
    () =>
      leerFronteras(
        fronteras([
          ['AAA', 'BBB'],
          ['BBB', 'AAA'],
        ]),
      ),
    FronterasInvalidas,
    'un ciclo',
  );
});

test('la escala tiene que ser un número finito positivo y las coordenadas, de la Tierra', () => {
  for (const escala of [Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => leerFronteras(fronteras([['ESP']], { escala })), FronterasInvalidas, String(escala));
  }
  const MAS_ALLA_DEL_POLO = 91;
  assert.throws(() => leerFronteras(fronteras([['ESP']], { centro: [0, MAS_ALLA_DEL_POLO] })), FronterasInvalidas);
  const ESCALA_QUE_SALE_DE_LA_TIERRA = 1e-3;
  assert.throws(
    () => leerFronteras(fronteras([['ESP']], { escala: ESCALA_QUE_SALE_DE_LA_TIERRA })),
    FronterasInvalidas,
    'un grado de cada mil sale de la Tierra',
  );
});

test('las fronteras que no llegan a tiempo son un recurso sin cargar', async (contexto) => {
  const { fetch } = globalThis;
  contexto.after(() => {
    globalThis.fetch = fetch;
  });
  globalThis.fetch = async () => {
    throw new DOMException('La petición ha tardado demasiado.', 'TimeoutError');
  };
  await assert.rejects(cargarFronteras(), RecursoSinCargar);
});
