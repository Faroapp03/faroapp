// Las fronteras del globo (scripts/globo/fronteras.js) sobre el archivo publicado (recursos/globo/fronteras.json):
// cada pulsación cae en su territorio (Cataluña antes que España), el mapa de territorios pinta cada píxel con el suyo
// y Cataluña solo sobre España, las líneas siguen la curva de la esfera sin los cortes del mapa, y un archivo que no
// tiene la forma se rechaza entero. Lógica pura, sin DOM ni red. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ALTURA_DE_LAS_FRONTERAS,
  FronterasInvalidas,
  leerFronteras,
  lineasDeFronteras,
  mapaDeTerritorios,
  TRAMO_MAXIMO_GRADOS,
  territorioEn,
} from '../../web/scripts/globo/fronteras.js';

const ARCHIVO = JSON.parse(readFileSync(new URL('../../web/recursos/globo/fronteras.json', import.meta.url), 'utf8'));
const FRONTERAS = leerFronteras(ARCHIVO);
const MAPA = { ancho: 2048, alto: 1024 };
/** Grados de media vuelta (la longitud va de −180 a 180) y de un cuarto (la latitud, de −90 a 90). */
const MEDIA_VUELTA = 180;
const CUARTO_DE_VUELTA = 90;
/** Los países del archivo de Natural Earth que publica la web; con Cataluña, un territorio más. */
const PAISES_DE_NATURAL_EARTH = 177;
/**
 * Los píxeles de Cataluña en el mapa de 2048 × 1024 como poco: con menos, la comprobación no diría nada. Cataluña
 * (unos 32.100 km², a unos 290 km² por píxel) ocupa unos 100 píxeles; la cota es la mitad, para que un pequeño
 * ajuste de la costa no la haga saltar sin que el mapa falle.
 */
const PIXELES_DE_CATALUNA_COMO_POCO = 50;
/** Cada tramo de frontera son dos puntos de tres coordenadas (x, y, z). */
const COORDENADAS_POR_TRAMO = 6;
/** Margen relativo por el redondeo de las coordenadas en coma flotante de 32 bits. */
const MARGEN_DE_REDONDEO = 1.0001;
/** Lo que puede separarse un punto de la esfera de las líneas, por el redondeo. */
const TOLERANCIA_DE_ALTURA = 1e-5;
/** Lo cerca de x = 0 que tiene que estar un punto para estar en el antimeridiano. */
const TOLERANCIA_EN_EL_ANTIMERIDIANO = 1e-6;
const { pixeles, indices } = mapaDeTerritorios(FRONTERAS, MAPA.ancho, MAPA.alto);

/** El territorio del mapa en unas coordenadas, por su píxel. */
/** @param {number} longitud @param {number} latitud */
function enElMapa(longitud, latitud) {
  const columna = Math.floor(((longitud + MEDIA_VUELTA) / (2 * MEDIA_VUELTA)) * MAPA.ancho);
  const fila = Math.floor(((CUARTO_DE_VUELTA - latitud) / MEDIA_VUELTA) * MAPA.alto);
  const indice = pixeles[fila * MAPA.ancho + columna];
  return [...indices].find(([, uno]) => uno === indice)?.[0] ?? null;
}

const LUGARES = Object.freeze([
  { nombre: 'Barcelona', longitud: 2.17, latitud: 41.39, codigo: 'ES51' },
  { nombre: 'Lleida', longitud: 0.62, latitud: 41.62, codigo: 'ES51' },
  { nombre: 'Madrid', longitud: -3.7, latitud: 40.42, codigo: 'ESP' },
  { nombre: 'Zaragoza', longitud: -0.88, latitud: 41.65, codigo: 'ESP' },
  { nombre: 'París', longitud: 2.35, latitud: 48.86, codigo: 'FRA' },
  { nombre: 'Berlín', longitud: 13.4, latitud: 52.52, codigo: 'DEU' },
  { nombre: 'Kansas', longitud: -98, latitud: 38.5, codigo: 'USA' },
  { nombre: 'Maseru, dentro de Sudáfrica', longitud: 27.48, latitud: -29.31, codigo: 'LSO' },
  { nombre: 'Johannesburgo', longitud: 28.05, latitud: -26.2, codigo: 'ZAF' },
  { nombre: 'Chukotka, al este del antimeridiano', longitud: -175, latitud: 66, codigo: 'RUS' },
  { nombre: 'el Atlántico', longitud: -30, latitud: 30, codigo: null },
]);

test('el archivo publicado tiene los 177 países de Natural Earth y Cataluña, dentro de España', () => {
  assert.equal(FRONTERAS.territorios.length, PAISES_DE_NATURAL_EARTH + 1);
  const cataluna = FRONTERAS.territorios.find(({ codigo }) => codigo === 'ES51');
  assert.equal(cataluna?.dentroDe, 'ESP');
  assert.equal(FRONTERAS.territorios[0]?.codigo, 'ES51', 'lo que está dentro de otro se busca antes');
});

test('cada pulsación cae en su territorio, también en los huecos de otro y al otro lado del antimeridiano', () => {
  for (const { nombre, longitud, latitud, codigo } of LUGARES) {
    assert.equal(territorioEn(FRONTERAS, { longitud, latitud })?.codigo ?? null, codigo, nombre);
  }
});

test('el mapa de territorios pinta cada lugar con su territorio', () => {
  for (const { nombre, longitud, latitud, codigo } of LUGARES) {
    assert.equal(enElMapa(longitud, latitud), codigo, nombre);
  }
});

test('Cataluña solo ocupa píxeles que serían de España: su costa no se sale al mar', () => {
  const sinCataluna = mapaDeTerritorios(
    { territorios: FRONTERAS.territorios.filter(({ codigo }) => codigo !== 'ES51') },
    MAPA.ancho,
    MAPA.alto,
  );
  const cataluna = indices.get('ES51');
  const espanaSola = sinCataluna.indices.get('ESP');
  let pixelesDeCataluna = 0;
  for (let pixel = 0; pixel < pixeles.length; pixel += 1) {
    if (pixeles[pixel] !== cataluna) {
      continue;
    }
    pixelesDeCataluna += 1;
    assert.equal(sinCataluna.pixeles[pixel], espanaSola, `píxel ${pixel}`);
  }
  assert.ok(pixelesDeCataluna > PIXELES_DE_CATALUNA_COMO_POCO, `${pixelesDeCataluna} píxeles de Cataluña`);
});

test('España y Cataluña tienen índices distintos en el mapa de territorios', () => {
  assert.notEqual(indices.get('ESP'), indices.get('ES51'));
});

/** Un tramo completo, cuya longitud se comprueba antes de usar sus seis coordenadas.
 * @param {Float32Array} lineas @param {number} i @returns {[number,number,number,number,number,number]} */
function tramo(lineas, i) {
  const [x1, y1, z1, x2, y2, z2] = lineas.subarray(i, i + COORDENADAS_POR_TRAMO);
  assert.ok(x1 !== undefined);
  assert.ok(y1 !== undefined);
  assert.ok(z1 !== undefined);
  assert.ok(x2 !== undefined);
  assert.ok(y2 !== undefined);
  assert.ok(z2 !== undefined);
  return [x1, y1, z1, x2, y2, z2];
}

test('las fronteras van de dos en dos puntos, a la misma altura y en tramos de un grado como mucho', () => {
  const lineas = lineasDeFronteras(FRONTERAS);
  assert.equal(lineas.length % COORDENADAS_POR_TRAMO, 0);
  // La cuerda de un tramo de un grado en la esfera de radio 1,0015: 2 · 1,0015 · sen(0,5°) ≈ 0,0175.
  const medioTramo = ((TRAMO_MAXIMO_GRADOS / 2) * Math.PI) / MEDIA_VUELTA;
  const cuerdaMaxima = 2 * ALTURA_DE_LAS_FRONTERAS * Math.sin(medioTramo) * MARGEN_DE_REDONDEO;
  for (let i = 0; i < lineas.length; i += COORDENADAS_POR_TRAMO) {
    const [x1, y1, z1, x2, y2, z2] = tramo(lineas, i);
    assert.ok(Math.abs(Math.hypot(x1, y1, z1) - ALTURA_DE_LAS_FRONTERAS) < TOLERANCIA_DE_ALTURA);
    assert.ok(Math.hypot(x2 - x1, y2 - y1, z2 - z1) <= cuerdaMaxima, `tramo ${i / COORDENADAS_POR_TRAMO}`);
  }
});

test('los cortes del mapa en el antimeridiano no se dibujan como fronteras', () => {
  const lineas = lineasDeFronteras(FRONTERAS);
  // En el antimeridiano, x = 0 y z < 0: un tramo con los dos extremos ahí sería un corte del mapa.
  const enElAntimeridiano = (/** @type {number} */ ejeX, /** @type {number} */ ejeZ) =>
    Math.abs(ejeX) < TOLERANCIA_EN_EL_ANTIMERIDIANO && ejeZ < 0;
  for (let i = 0; i < lineas.length; i += COORDENADAS_POR_TRAMO) {
    const [x1, , z1, x2, , z2] = tramo(lineas, i);
    assert.ok(!(enElAntimeridiano(x1, z1) && enElAntimeridiano(x2, z2)), `tramo ${i / COORDENADAS_POR_TRAMO}`);
  }
});

test('un archivo que no tiene la forma se rechaza entero', () => {
  const con = (/** @type {Record<string, unknown>} */ cambio) => () => leerFronteras({ ...ARCHIVO, ...cambio });
  assert.throws(con({ version: '2' }), FronterasInvalidas);
  assert.throws(con({ escala: 0 }), FronterasInvalidas);
  const [primero, ...resto] = ARCHIVO.territorios;
  assert.throws(con({ territorios: [primero, primero, ...resto] }), FronterasInvalidas);
  assert.throws(con({ territorios: [{ ...primero, anillos: [[0, 0, 0]] }] }), FronterasInvalidas);
  assert.throws(con({ territorios: [{ ...primero, codigo: 'españa' }] }), FronterasInvalidas);
  assert.throws(con({ territorios: [{ ...primero, dentro_de: 'XXX' }] }), FronterasInvalidas);
});
