// Las cuentas del globo (scripts/globo/esfera.js): el centro elegido queda delante, lo que se proyecta en la cara
// visible vuelve a sus coordenadas al pulsarlo (propiedad con fast-check, semilla fija), el giro da la vuelta al mundo
// sin salirse de los polos, arrastrar mueve la superficie con el dedo y el acercamiento no pasa de sus límites.
// Lógica pura, sin DOM. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import {
  acercar,
  arrastrar,
  coordenadasEn,
  girar,
  giroHacia,
  giroPorColumnas,
  proyectar,
  ZOOM,
} from '../../web/scripts/globo/esfera.js';

/** Grados de una vuelta y de media vuelta; el desfase (540 = 1,5 vueltas) mantiene positivo el módulo. */
const GRADOS_DE_VUELTA = 360;
const GRADOS_DE_MEDIA_VUELTA = 180;
const DESFASE_DEL_MODULO = 540;
/** Error numérico admitido en las propiedades de la proyección (unidades de disco) y margen respecto del borde. */
const TOLERANCIA_DEL_DISCO = 1e-12;
const MARGEN_DEL_BORDE = 1e-9;
/** Coordenadas dentro y fuera del disco (el radio es 1; la diagonal 0,8 queda fuera y la 0,7 dentro). */
const FUERA_DEL_DISCO = 0.8;
const DENTRO_DEL_DISCO = 0.7;
/** Una rotación 3x3 guardada por filas. */
const COLUMNAS_DEL_GIRO = 3;
const FILAS_DEL_GIRO = Object.freeze([0, 1, 2]);
/** Un giro de prueba que cruza el antimeridiano y llega al polo: grados de longitud y de latitud, y sus resultados. */
const GIRO_EN_LONGITUD = 20;
const GIRO_EN_LATITUD = 15;
const LONGITUD_TRAS_CRUZAR = -170;
const GIRO_QUE_PASA_DE_SUR_A_SUR = Object.freeze({ longitud: -350, latitud: -200 });
const POLO_NORTE = 90;
const POLO_SUR = -90;
/** Un arrastre de prueba, en píxeles, sobre una superficie de este ancho. */
const ARRASTRE_EN_PIXELES = 100;
const ANCHO_DE_LA_SUPERFICIE = 200;
/** Pasos de acercamiento de sobra para llegar al límite. */
const PASOS_HASTA_EL_LIMITE = 20;

/** La semilla de las propiedades: la misma ejecución genera siempre las mismas entradas. */
const SEMILLA = 20_261_011;
const PARAMETROS = { seed: SEMILLA, numRuns: 400 };
/** Lo que se admite de error de redondeo, en grados. */
const TOLERANCIA_GRADOS = 1e-7;

// −180 y 180 son el mismo meridiano (se excluye uno); en los polos la longitud no está definida (se evitan).
const longitud = fc.double({ min: -179.999, max: 180, noNaN: true });
const latitud = fc.double({ min: -89.9, max: 89.9, noNaN: true });

/** La diferencia entre dos longitudes, dando la vuelta por el antimeridiano si es más corto. */
/** @param {number} una @param {number} otra */
function diferenciaDeLongitud(una, otra) {
  return Math.abs(((una - otra + DESFASE_DEL_MODULO) % GRADOS_DE_VUELTA) - GRADOS_DE_MEDIA_VUELTA);
}

test('el centro de la vista queda delante, en el centro del disco', () => {
  fc.assert(
    fc.property(longitud, latitud, (centroLongitud, centroLatitud) => {
      const vista = { centro: { longitud: centroLongitud, latitud: centroLatitud }, zoom: 1 };
      const { horizontal, vertical, visible } = proyectar(vista, centroLongitud, centroLatitud);
      return visible && Math.abs(horizontal) < TOLERANCIA_DEL_DISCO && Math.abs(vertical) < TOLERANCIA_DEL_DISCO;
    }),
    PARAMETROS,
  );
});

test('un punto de la cara visible vuelve a sus coordenadas al pulsarlo donde se pinta', () => {
  fc.assert(
    fc.property(longitud, latitud, longitud, latitud, (centroLongitud, centroLatitud, puntoLongitud, puntoLatitud) => {
      const vista = { centro: { longitud: centroLongitud, latitud: centroLatitud }, zoom: 1 };
      const { horizontal, vertical, visible } = proyectar(vista, puntoLongitud, puntoLatitud);
      // En el borde del disco la vuelta está mal condicionada: se deja un margen.
      fc.pre(visible && horizontal * horizontal + vertical * vertical < 1 - MARGEN_DEL_BORDE);
      const vuelta = coordenadasEn(vista, horizontal, vertical);
      return (
        vuelta !== null &&
        Math.abs(vuelta.latitud - puntoLatitud) < TOLERANCIA_GRADOS &&
        diferenciaDeLongitud(vuelta.longitud, puntoLongitud) < TOLERANCIA_GRADOS
      );
    }),
    PARAMETROS,
  );
});

test('fuera del disco no hay Tierra: es el espacio', () => {
  const vista = { centro: { longitud: 2, latitud: 41 }, zoom: 1 };
  assert.equal(coordenadasEn(vista, FUERA_DEL_DISCO, FUERA_DEL_DISCO), null);
  assert.notEqual(coordenadasEn(vista, DENTRO_DEL_DISCO, DENTRO_DEL_DISCO), null);
});

test('el giro es una rotación: sus filas tienen largo 1 y son perpendiculares', () => {
  const giro = giroHacia({ longitud: 37, latitud: -12 });
  const fila = (/** @type {number} */ i) =>
    giro.slice(i * COLUMNAS_DEL_GIRO, i * COLUMNAS_DEL_GIRO + COLUMNAS_DEL_GIRO);
  const producto = (/** @type {readonly number[]} */ a, /** @type {readonly number[]} */ b) =>
    a.reduce((suma, valor, i) => suma + valor * (b[i] ?? 0), 0);
  for (const i of FILAS_DEL_GIRO) {
    assert.ok(Math.abs(producto(fila(i), fila(i)) - 1) < TOLERANCIA_DEL_DISCO);
  }
  assert.ok(Math.abs(producto(fila(0), fila(1))) < TOLERANCIA_DEL_DISCO);
  assert.ok(Math.abs(producto(fila(1), fila(2))) < TOLERANCIA_DEL_DISCO);
  assert.ok(Math.abs(producto(fila(0), fila(2))) < TOLERANCIA_DEL_DISCO);
});

test('WebGL recibe el giro por columnas', () => {
  const giro = giroHacia({ longitud: 10, latitud: 20 });
  const columnas = giroPorColumnas(giro);
  for (const fila of FILAS_DEL_GIRO) {
    for (const columna of FILAS_DEL_GIRO) {
      const entrada = columnas[columna * COLUMNAS_DEL_GIRO + fila];
      const original = giro[fila * COLUMNAS_DEL_GIRO + columna];
      assert.ok(original !== undefined);
      assert.equal(entrada, Math.fround(original), `fila ${fila}, columna ${columna}`);
    }
  }
});

test('girar da la vuelta al mundo por el antimeridiano y se para en los polos', () => {
  const vista = { centro: { longitud: 170, latitud: 80 }, zoom: 1 };
  assert.deepEqual(girar(vista, GIRO_EN_LONGITUD, GIRO_EN_LATITUD).centro, {
    longitud: LONGITUD_TRAS_CRUZAR,
    latitud: POLO_NORTE,
  });
  assert.deepEqual(girar(vista, GIRO_QUE_PASA_DE_SUR_A_SUR.longitud, GIRO_QUE_PASA_DE_SUR_A_SUR.latitud).centro, {
    longitud: GRADOS_DE_MEDIA_VUELTA,
    latitud: POLO_SUR,
  });
});

test('al arrastrar hacia la derecha se ve lo que había al oeste, y hacia abajo, lo del norte', () => {
  const vista = { centro: { longitud: 0, latitud: 0 }, zoom: 1 };
  const tras = arrastrar(vista, ARRASTRE_EN_PIXELES, ARRASTRE_EN_PIXELES, ANCHO_DE_LA_SUPERFICIE);
  assert.ok(tras.centro.longitud < 0, 'la longitud del centro baja');
  assert.ok(tras.centro.latitud > 0, 'la latitud del centro sube');
});

test('acercar y alejar no pasan de sus límites', () => {
  let vista = { centro: { longitud: 0, latitud: 0 }, zoom: 1 };
  for (let paso = 0; paso < PASOS_HASTA_EL_LIMITE; paso += 1) {
    vista = acercar(vista, 1);
  }
  assert.equal(vista.zoom, ZOOM.maximo);
  for (let paso = 0; paso < PASOS_HASTA_EL_LIMITE; paso += 1) {
    vista = acercar(vista, -1);
  }
  assert.equal(vista.zoom, ZOOM.minimo);
});
