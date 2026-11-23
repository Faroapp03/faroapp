// Las marcas del globo (scripts/globo/luces.js), sin navegador, con el archivo publicado de datos globales y las
// fronteras publicadas: una igual para cada país con algún dato oficial de la IA (uso medido o exposición calculada) y
// contorno, y otra para Cataluña; ninguna para un país solo con empleo ni para la UE (sin contorno); pulsar la cabeza
// de una marca elige su territorio (`marcaBajo`); los colores de la marca, sin elegir y elegida, son los de sus tokens. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import { codigoEnElMapa, paisesConIa } from '../../web/scripts/globo/datos.js';
import { leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { ALTO_PX, AUMENTO_DEL_ELEGIDO, crearLuces, lucesDe, MARCA, marcaBajo } from '../../web/scripts/globo/luces.js';
import { navegador } from '../web-controles/ayudas.js';

/** Altura de la cabeza de la chincheta sobre su punta: (29 − 12) de un alto de 30 unidades; el elegido la escala. */
const PUNTA_DE_LA_MARCA = 29;
const CABEZA_DE_LA_MARCA = 12;
const ALTO_DE_LA_MARCA = 30;
/** Los nueve números de la matriz de giro de 3 × 3. */
const LADO_DEL_GIRO = 9;
/** Media vuelta de longitud, para ponerse en la cara de atrás. */
const MEDIA_VUELTA = 180;

function leer(/** @type {string} */ ruta) {
  return JSON.parse(readFileSync(new URL(ruta, import.meta.url), 'utf8'));
}
const DATOS = leerDatosGlobales(leer('../../web/datos/datos-globales.json'));
const FRONTERAS = leerFronteras(leer('../../web/recursos/globo/fronteras.json'));
const LUCES = lucesDe(paisesConIa(DATOS), FRONTERAS, codigoEnElMapa);
/** Una caja que encierra Cataluña, en grados: su marca ha de caer dentro. */
const CAJA_DE_CATALUNA = Object.freeze({ oeste: 0, este: 3.5, sur: 40.5, norte: 43 });
const porCodigo = new Map(LUCES.map((luz) => [luz.codigo, luz]));

test('una marca por país con datos de la IA, igual para todos, y otra para Cataluña; ninguna sin ellos ni para la UE', () => {
  for (const codigo of ['ESP', 'DEU', 'USA', 'AUS', 'CHL', 'BRA', 'COL', 'URY']) {
    assert.deepEqual(Object.keys(porCodigo.get(codigo) ?? {}).sort(), ['codigo', 'latitud', 'longitud'], codigo);
  }
  for (const codigo of ['AFG', 'NPL']) {
    assert.equal(porCodigo.has(codigo), false, `${codigo}: solo empleo, sin marca`);
  }
  const cataluna = porCodigo.get('ES51');
  assert.ok(cataluna, 'Cataluña tiene su marca, en su contorno');
  assert.ok(
    cataluna.longitud > CAJA_DE_CATALUNA.oeste &&
      cataluna.longitud < CAJA_DE_CATALUNA.este &&
      cataluna.latitud > CAJA_DE_CATALUNA.sur &&
      cataluna.latitud < CAJA_DE_CATALUNA.norte,
    'su marca, dentro de Cataluña',
  );
  assert.equal(porCodigo.has('EU27_2020'), false, 'la UE no tiene contorno ni marca');
});

test('pulsar la cabeza de una marca elige su país; su punta, en el centro del país, queda debajo', () => {
  const espana = /** @type {import('../../web/scripts/globo/luces.js').Luz} */ (porCodigo.get('ESP'));
  const vista = { centro: { longitud: espana.longitud, latitud: espana.latitud }, zoom: 1 };
  const radio = 300;
  const altura = (ALTO_PX * (PUNTA_DE_LA_MARCA - CABEZA_DE_LA_MARCA)) / ALTO_DE_LA_MARCA;
  assert.equal(marcaBajo([espana], vista, { derecha: 0, arriba: altura, radio }, null)?.codigo, 'ESP');
  assert.equal(marcaBajo([espana], vista, { derecha: 0, arriba: altura + ALTO_PX / 2 + 1, radio }, null), null);
  // La del elegido es más grande: se acierta más lejos de su cabeza.
  const lejos = {
    derecha: 0,
    arriba:
      (ALTO_PX * (1 + AUMENTO_DEL_ELEGIDO) * (PUNTA_DE_LA_MARCA - CABEZA_DE_LA_MARCA)) / ALTO_DE_LA_MARCA +
      ALTO_PX / 2 +
      1,
    radio,
  };
  assert.equal(marcaBajo([espana], vista, lejos, null), null);
  assert.equal(marcaBajo([espana], vista, lejos, 'ESP')?.codigo, 'ESP');
  // En la cara de atrás no hay marca que pulsar.
  const detras = { centro: { longitud: espana.longitud + MEDIA_VUELTA, latitud: -espana.latitud }, zoom: 1 };
  assert.equal(marcaBajo([espana], detras, { derecha: 0, arriba: altura, radio }, null), null);
});

test('la marca es una chincheta: un trazado SVG cerrado, con la punta abajo en el centro de su cuadro de 30', () => {
  assert.match(MARCA, /^M15 29C.*z$/);
});

test('cada marca está en el centro de su país en las fronteras, y solo hay marca donde hay datos de la IA', () => {
  const centros = new Map(FRONTERAS.territorios.map(({ codigo, centro }) => [codigo, centro]));
  const paises = paisesConIa(DATOS);
  for (const luz of LUCES) {
    const pais = paises.find(({ codigo }) => codigo === luz.codigo);
    assert.ok(pais, luz.codigo);
    assert.deepEqual(
      { longitud: luz.longitud, latitud: luz.latitud },
      { ...centros.get(codigoEnElMapa(pais)) },
      luz.codigo,
    );
  }
  const conContorno = paises.filter((pais) => centros.has(codigoEnElMapa(pais)));
  assert.equal(LUCES.length, conContorno.length);
});

test('crearLuces pinta la marca sin elegir con los colores de marca y la del elegido con los de resalte, no con los de frontera ni espacio', (t) => {
  // Seis colores distintos entre sí, para que cada uniforme solo pueda venir de su color.
  const colores = {
    marca: [0, 1, 0],
    marcaFilete: [1, 1, 1],
    resalte: [1, 1, 0],
    resalteFilete: [0, 1, 1],
    frontera: [1, 0, 0],
    espacio: [0, 0, 1],
  };
  /** @type {Map<string, unknown>} */
  const colorSubido = new Map();
  const gl = new Proxy(
    {
      createProgram: () => ({}),
      createShader: () => ({}),
      createBuffer: () => ({}),
      createTexture: () => ({}),
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getUniformLocation: (/** @type {unknown} */ _programa, /** @type {string} */ nombre) => nombre,
      uniform3fv: (/** @type {string} */ nombre, /** @type {unknown} */ valor) => colorSubido.set(nombre, valor),
    },
    {
      get(objeto, clave) {
        if (clave in objeto) {
          return objeto[/** @type {keyof typeof objeto} */ (clave)];
        }
        return typeof clave === 'string' && /^[A-Z0-9_]+$/u.test(clave) ? 1 : () => undefined;
      },
    },
  );
  const dibujo2d = new Proxy({}, { get: () => () => undefined, set: () => true });
  navegador(t, { document: { createElement: () => ({ getContext: () => dibujo2d }) }, Path2D: class {} });
  const luces = crearLuces(/** @type {WebGLRenderingContext} */ (/** @type {unknown} */ (gl)), colores);
  luces.poner([{ codigo: 'ESP', longitud: 0, latitud: 0 }], 'ESP');
  luces.pintar({ giro: new Float32Array(LADO_DEL_GIRO), escala: [1, 1] }, 1);
  assert.deepEqual(colorSubido.get('colorDelRelleno'), colores.marca);
  assert.deepEqual(colorSubido.get('colorDelFilete'), colores.marcaFilete);
  assert.deepEqual(colorSubido.get('colorDelElegido'), colores.resalte);
  assert.deepEqual(colorSubido.get('colorDelFileteElegido'), colores.resalteFilete);
  luces.liberar();
});
