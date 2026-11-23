// Las chinchetas con bandera del globo (scripts/globo/atlas.js y luces.js), sin navegador: el atlas tiene una casilla
// para cada territorio con marca en el archivo publicado (y la bandera de cada uno existe), con lados potencia de dos;
// una bandera que no se puede dibujar se queda sin casilla y su marca cae a la chincheta con luz (casilla −1), igual
// que todas si el atlas falla; los colores de la chincheta salen de sus tokens (blanca con filete oscuro; la elegida,
// amarilla, más grande y con el aro oscuro de su bandera bien visible). Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { direccionDeLaBandera } from '../../web/scripts/datos-globales/banderas.js';
import { leerDatosGlobales } from '../../web/scripts/datos-globales/datos.js';
import { CELDA, COLUMNAS, dibujarAtlas, filasDelAtlas, potenciaDeDos } from '../../web/scripts/globo/atlas.js';
import { codigoEnElMapa, paisesConIa } from '../../web/scripts/globo/datos.js';
import { leerFronteras } from '../../web/scripts/globo/fronteras.js';
import { AUMENTO_DEL_ELEGIDO, crearLuces, lucesDe } from '../../web/scripts/globo/luces.js';
import { colorDeToken } from '../../web/scripts/globo/recursos.js';
import { navegador } from '../web-controles/ayudas.js';

/** Los números de cada marca en su búfer (posición, si es la elegida y su casilla) y dónde va la casilla. */
const NUMEROS_POR_MARCA = 5;
const POSICION_DE_LA_CASILLA = 4;
const POSICION_DE_LA_ELEGIDA = 3;
/** Lo más claro que puede ser cada canal del filete oscuro (de 0 a 1). */
const CANAL_DE_UN_FILETE_OSCURO = 0.25;
/** Los nueve números de la matriz de giro de 3 × 3. */
const LADO_DEL_GIRO = 9;
/** El contraste mínimo de un elemento gráfico (WCAG 1.4.11) y lo que se suma a cada luminancia al calcularlo. */
const CONTRASTE_GRAFICO = 3;
const DESTELLO = 0.05;
/** WCAG 2.x: el umbral del canal lineal, su divisor, el desplazamiento, la escala y el exponente de la curva. */
const SRGB = Object.freeze({ umbral: 0.03928, divisor: 12.92, desplazamiento: 0.055, escala: 1.055, exponente: 2.4 });
const PESOS = Object.freeze({ rojo: 0.2126, verde: 0.7152, azul: 0.0722 });

const WEB = new URL('../../web/', import.meta.url);
const leer = (/** @type {string} */ ruta) => JSON.parse(readFileSync(new URL(ruta, WEB), 'utf8'));
const DATOS = leerDatosGlobales(leer('datos/datos-globales.json'));
const FRONTERAS = leerFronteras(leer('recursos/globo/fronteras.json'));
const LUCES = lucesDe(paisesConIa(DATOS), FRONTERAS, codigoEnElMapa);
const TOKENS = readFileSync(new URL('estilos/tokens.css', WEB), 'utf8');
const COLORES = { marca: [1, 1, 1], marcaFilete: [0, 0, 0], resalte: [1, 1, 0], resalteFilete: [0, 0, 0] };

/** El color de una variable de tokens.css (su primera declaración). @param {string} nombre */
function token(nombre) {
  const valor = new RegExp(`${nombre}:\\s*([^;]+);`).exec(TOKENS)?.[1];
  const color = colorDeToken(valor ?? '');
  assert.ok(color, nombre);
  return color;
}

/** El contraste entre dos colores (WCAG 2.x). @param {number[]} a @param {number[]} b */
function contraste(a, b) {
  const luminancia = (/** @type {number[]} */ color) =>
    color
      .map((canal) =>
        canal <= SRGB.umbral ? canal / SRGB.divisor : ((canal + SRGB.desplazamiento) / SRGB.escala) ** SRGB.exponente,
      )
      .reduce((suma, canal, indice) => suma + canal * ([PESOS.rojo, PESOS.verde, PESOS.azul][indice] ?? 0), 0);
  const [clara = 0, oscura = 0] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + DESTELLO) / (oscura + DESTELLO);
}

/**
 * Un lienzo falso que anota cada bandera que dibuja; `falla` dice qué imágenes no se dejan dibujar.
 * @param {(imagen: unknown) => boolean} [falla]
 */
function lienzoFalso(falla = () => false) {
  /** @type {unknown[]} */
  const dibujadas = [];
  const dibujo = new Proxy(
    {
      drawImage: (/** @type {unknown} */ imagen) => {
        if (falla(imagen)) {
          throw new Error('no se puede dibujar');
        }
        dibujadas.push(imagen);
      },
    },
    { get: (objeto, clave) => (clave in objeto ? objeto[/** @type {'drawImage'} */ (clave)] : () => undefined) },
  );
  const lienzo = { width: 0, height: 0, getContext: () => dibujo };
  return { lienzo: /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (lienzo)), dibujadas };
}

/** Una imagen falsa de bandera 3:2, con el código de su territorio. @param {string} codigo */
const banderaFalsa = (codigo) =>
  /** @type {CanvasImageSource} */ (/** @type {unknown} */ ({ codigo, naturalWidth: 3, naturalHeight: 2 }));

/**
 * Un contexto WebGL falso que anota las variables y los búferes que se suben.
 * @param {{ maximo?: number }} [opciones] el lado mayor de textura que admite
 */
function webglFalso({ maximo = 4096 } = {}) {
  /** @type {Map<string, unknown>} */
  const variables = new Map();
  /** @type {Float32Array[]} */
  const buferes = [];
  const gl = new Proxy(
    {
      createProgram: () => ({}),
      createShader: () => ({}),
      createBuffer: () => ({}),
      createTexture: () => ({}),
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getParameter: () => maximo,
      getUniformLocation: (/** @type {unknown} */ _programa, /** @type {string} */ nombre) => nombre,
      uniform3fv: (/** @type {string} */ nombre, /** @type {unknown} */ valor) => variables.set(nombre, valor),
      uniform2fv: (/** @type {string} */ nombre, /** @type {unknown} */ valor) => variables.set(nombre, valor),
      bufferData: (/** @type {unknown} */ _destino, /** @type {Float32Array} */ datos) => buferes.push(datos),
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
  return { gl: /** @type {WebGLRenderingContext} */ (/** @type {unknown} */ (gl)), variables, buferes };
}

/** La casilla de cada marca del último búfer subido, por su código, en el orden en que se subieron las marcas.
 * @param {Float32Array[]} buferes @param {string[]} codigosEnOrden */
function casillasSubidas(buferes, codigosEnOrden) {
  const ultimo = buferes.at(-1);
  assert.ok(ultimo);
  return new Map(
    codigosEnOrden.map((codigo, indice) => [codigo, ultimo[indice * NUMEROS_POR_MARCA + POSICION_DE_LA_CASILLA]]),
  );
}

test('cada territorio con marca tiene bandera, y el atlas le da una casilla propia dentro de sus lados potencia de dos', () => {
  assert.ok(LUCES.length > 0);
  const imagenes = new Map(
    LUCES.map(({ codigo }) => {
      const direccion = direccionDeLaBandera(codigo, { delJuego: true });
      assert.ok(direccion, `${codigo}: sin bandera`);
      assert.ok(readFileSync(new URL(direccion, WEB)).length > 0, direccion);
      return [codigo, banderaFalsa(codigo)];
    }),
  );
  const { lienzo, dibujadas } = lienzoFalso();
  const atlas = dibujarAtlas(imagenes, () => lienzo);
  assert.ok(atlas);
  assert.deepEqual([...atlas.casillas.keys()].sort(), LUCES.map(({ codigo }) => codigo).sort());
  assert.equal(new Set(atlas.casillas.values()).size, LUCES.length, 'una casilla por territorio');
  assert.ok(Math.max(...atlas.casillas.values()) < atlas.columnas * atlas.filas);
  assert.equal(dibujadas.length, LUCES.length);
  assert.equal(lienzo.width, COLUMNAS * CELDA);
  assert.equal(lienzo.width, potenciaDeDos(lienzo.width));
  assert.equal(lienzo.height, potenciaDeDos(lienzo.height));
  assert.equal(lienzo.height, filasDelAtlas(LUCES.length) * CELDA);
});

test('una bandera que no se puede dibujar se queda sin casilla y su marca cae a la chincheta con luz', (t) => {
  const codigos = ['ESP', 'ES51', 'FRA', 'AUT'];
  const imagenes = new Map(codigos.map((codigo) => [codigo, banderaFalsa(codigo)]));
  const falla = (/** @type {unknown} */ imagen) => /** @type {{ codigo: string }} */ (imagen).codigo === 'FRA';
  const { lienzo } = lienzoFalso(falla);
  navegador(t, { document: { createElement: () => lienzo }, Path2D: class {} });
  const { gl, buferes, variables } = webglFalso();
  const luces = crearLuces(gl, COLORES);
  // De norte a sur, con la elegida al final: Austria, Francia, Cataluña y España (elegida).
  const marcas = [
    { codigo: 'FRA', longitud: 2, latitud: 46 },
    { codigo: 'AUT', longitud: 14, latitud: 47.5 },
    { codigo: 'ES51', longitud: 1.5, latitud: 41.8 },
    { codigo: 'ESP', longitud: -3.7, latitud: 40 },
  ];
  const enOrden = ['AUT', 'FRA', 'ES51', 'ESP'];
  luces.poner(marcas, 'ESP');
  assert.deepEqual([...casillasSubidas(buferes, enOrden).values()], [-1, -1, -1, -1], 'sin banderas, todas con luz');
  assert.equal(luces.ponerBanderas(imagenes), true);
  const despues = casillasSubidas(buferes, enOrden);
  assert.equal(despues.get('FRA'), -1, 'Francia, sin bandera dibujable, con luz');
  for (const codigo of ['AUT', 'ES51', 'ESP']) {
    assert.ok((despues.get(codigo) ?? -1) >= 0, `${codigo} con su casilla`);
  }
  const ultimo = /** @type {Float32Array} */ (buferes.at(-1));
  assert.equal(ultimo[(marcas.length - 1) * NUMEROS_POR_MARCA + POSICION_DE_LA_ELEGIDA], 1, 'la elegida, al final');
  luces.pintar({ giro: new Float32Array(LADO_DEL_GIRO), escala: [1, 1] }, 1);
  assert.deepEqual(variables.get('rejilla'), [COLUMNAS, 1]);
  assert.deepEqual(variables.get('colorDelElegido'), COLORES.resalte);
  assert.deepEqual(variables.get('colorDelFileteElegido'), COLORES.resalteFilete);
  luces.liberar();
});

test('si el atlas no cabe en la tarjeta gráfica o no hay lienzo, todas las marcas siguen con la luz, sin errores', (t) => {
  const imagenes = new Map([['ESP', banderaFalsa('ESP')]]);
  const { lienzo } = lienzoFalso();
  navegador(t, { document: { createElement: () => lienzo }, Path2D: class {} });
  const pequeno = webglFalso({ maximo: 64 });
  const luces = crearLuces(pequeno.gl, COLORES);
  luces.poner([{ codigo: 'ESP', longitud: -3.7, latitud: 40 }], null);
  assert.equal(luces.ponerBanderas(imagenes), false);
  assert.deepEqual([...casillasSubidas(pequeno.buferes, ['ESP']).values()], [-1]);
  luces.liberar();
  assert.equal(luces.ponerBanderas(imagenes), false, 'liberadas, no suben nada');
  const sinLienzo = /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ({ getContext: () => null }));
  assert.equal(
    dibujarAtlas(imagenes, () => sinLienzo),
    null,
  );
  assert.equal(dibujarAtlas(new Map()), null);
});

test('la chincheta es blanca con filete oscuro; la elegida, amarilla (#ffc93c), más grande y con el aro oscuro', () => {
  assert.deepEqual(token('--globo-marca'), [1, 1, 1]);
  assert.ok(Math.max(...token('--globo-marca-filete')) < CANAL_DE_UN_FILETE_OSCURO, 'filete oscuro');
  assert.deepEqual(token('--globo-resalte'), colorDeToken('#ffc93c'));
  // El filete y el aro de la bandera de la elegida son del color de su filete: se ven sobre el amarillo.
  assert.ok(
    contraste(token('--globo-resalte-filete'), token('--globo-resalte')) >= CONTRASTE_GRAFICO,
    'aro sobre amarillo',
  );
  assert.ok(contraste(token('--globo-resalte'), token('--globo-mar')) >= CONTRASTE_GRAFICO, 'amarillo sobre el mar');
  assert.ok(AUMENTO_DEL_ELEGIDO > 0, 'la elegida es más grande: no se distingue solo por el color');
});
