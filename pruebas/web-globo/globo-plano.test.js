// La proyección del mapa plano de reserva (scripts/globo/plano.js), sin navegador: con el acercamiento mínimo el mundo
// cubre el lienzo; la latitud se acota para que no queden franjas vacías; un punto vuelve a sus coordenadas al pulsarlo
// donde se dibuja; el mapa da la vuelta por el antimeridiano; y sin lienzo 2D, el pintor plano dice que no puede. Se
// ejecutan con npm test.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZOOM } from '../../web/scripts/globo/esfera.js';
import { crearPintorPlano, proyeccionPlana, radioPlano, vistaPlana } from '../../web/scripts/globo/plano.js';
import { SinWebgl } from '../../web/scripts/globo/webgl.js';

/** Un lienzo de escritorio (cuadrado) y uno de móvil (4:3), en píxeles de CSS. */
const LIENZOS = Object.freeze([
  { ancho: 573, alto: 573 },
  { ancho: 358, alto: 268 },
]);
/** Error numérico admitido, en grados. */
const TOLERANCIA = 1e-9;
/** Un punto de prueba: Barcelona, y un punto al otro lado del antimeridiano. */
const BARCELONA = Object.freeze({ longitud: 2.17, latitud: 41.39 });
const FIYI = Object.freeze({ longitud: 178, latitud: -18 });

test('con el acercamiento mínimo, el mundo cubre el lienzo y la latitud queda en el ecuador', () => {
  for (const { ancho, alto } of LIENZOS) {
    const radio = radioPlano(ancho, alto, ZOOM.minimo);
    assert.ok(2 * Math.PI * radio >= ancho - TOLERANCIA && Math.PI * radio >= alto - TOLERANCIA, `${ancho} × ${alto}`);
    const vista = vistaPlana({ centro: BARCELONA, zoom: ZOOM.minimo }, ancho, alto);
    assert.ok(Math.abs(vista.centro.latitud) < 1, 'sin franjas vacías arriba ni abajo');
    const cerca = vistaPlana({ centro: BARCELONA, zoom: ZOOM.maximo }, ancho, alto);
    assert.equal(cerca.centro.latitud, BARCELONA.latitud, 'de cerca, la latitud se respeta');
  }
});

test('un punto vuelve a sus coordenadas al pulsarlo donde se dibuja, también al otro lado del antimeridiano', () => {
  for (const { ancho, alto } of LIENZOS) {
    const plana = proyeccionPlana(ancho, alto);
    const vista = { centro: { longitud: -170, latitud: 0 }, zoom: ZOOM.maximo };
    for (const punto of [BARCELONA, FIYI]) {
      const { horizontal, vertical, visible } = plana.proyectar(vista, punto.longitud, punto.latitud);
      assert.equal(visible, true);
      assert.ok(Math.abs(horizontal) <= Math.PI, 'el camino corto, por el antimeridiano si toca');
      const vuelta = plana.coordenadasEn(vista, horizontal, vertical);
      assert.ok(vuelta);
      assert.ok(Math.abs(vuelta.longitud - punto.longitud) < TOLERANCIA, `${punto.longitud}`);
      assert.ok(Math.abs(vuelta.latitud - punto.latitud) < TOLERANCIA, `${punto.latitud}`);
    }
    assert.equal(plana.coordenadasEn({ centro: BARCELONA, zoom: ZOOM.maximo }, 0, Math.PI), null, 'más allá del polo');
  }
});

test('sin lienzo 2D, el pintor plano lanza SinWebgl y el globo dice que no se puede dibujar', () => {
  const lienzo = /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ({ getContext: () => null }));
  const geometria = { lineas: new Float32Array(), mapa: new Uint8Array(), ancho: 0, alto: 0 };
  const colores = /** @type {import('../../web/scripts/globo/pintor.js').Colores} */ ({});
  assert.throws(() => crearPintorPlano(lienzo, geometria, colores, { territorios: [] }), SinWebgl);
});
