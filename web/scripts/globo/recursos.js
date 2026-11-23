// Lo que el globo trae de fuera de su código: las fronteras y la imagen de la Tierra (recursos/globo/, del mismo
// origen, que se piden solo al abrir el globo), las banderas de las marcas (imagenes/, también del mismo origen), los
// colores de tokens.css y el tamaño del lienzo en la página.

import { MS_POR_SEGUNDO } from '../tiempo.js';
import { leerFronteras } from './fronteras.js';
import { SinWebgl } from './webgl.js';

/** Los recursos del globo, junto a este módulo en la web publicada. */
const RECURSOS = Object.freeze({
  raiz: new URL('../../', import.meta.url),
  fronteras: new URL('../../recursos/globo/fronteras.json', import.meta.url),
  tierra: new URL('../../recursos/globo/tierra.jpg', import.meta.url),
});
/** Píxeles del dispositivo por píxel de CSS como mucho: más no se nota en el globo y gasta batería. */
const DENSIDAD_MAXIMA = 2;
/** Segundos que espera como mucho cada recurso del globo: sin él, el globo no se queda cargando sin fin. */
const SEGUNDOS_DE_CARGA = 30;
/** El plazo de cada recurso, en milisegundos (el cuerpo de las fronteras incluido). */
const PLAZO_DE_CARGA_MS = SEGUNDOS_DE_CARGA * MS_POR_SEGUNDO;
/** Las cifras de un color corto («#rgb»): una por canal. */
const CIFRAS_DEL_COLOR_CORTO = 3;
/** La base de las cifras de un color. */
const BASE_HEXADECIMAL = 16;
/** El mayor valor de un canal: lo que vale 1. */
const MAXIMO_DEL_CANAL = 255;

/** Si un fallo es el corte por plazo de una señal (AbortSignal.timeout). @param {unknown} error @returns {boolean} */
function esFueraDePlazo(error) {
  return error instanceof DOMException && error.name === 'TimeoutError';
}
/** Los colores del dibujo: cada uno, su variable de tokens.css. */
const COLORES = Object.freeze({
  espacio: '--globo-espacio',
  mar: '--globo-mar',
  frontera: '--globo-frontera',
  resalte: '--globo-resalte',
  resalteFilete: '--globo-resalte-filete',
  marca: '--globo-marca',
  marcaFilete: '--globo-marca-filete',
  estrella: '--globo-estrella',
});

/** Un recurso del globo que no ha llegado: un archivo que falta o una respuesta que no es la suya. */
export class RecursoSinCargar extends Error {
  /** @override */
  name = 'RecursoSinCargar';
}

/**
 * Un color de tokens.css («#rgb» o «#rrggbb») como [rojo, verde, azul] de 0 a 1, o null si no es un color así. Solo
 * entiende esas dos formas hexadecimales: las variables `--globo-*` de tokens.css han de declararse así (con otra
 * notación, como `oklch()`, el color se daría por ausente y el globo no se dibujaría).
 * @param {string} texto @returns {[number, number, number] | null}
 */
export function colorDeToken(texto) {
  const hexadecimal = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(texto.trim())?.[1];
  if (!hexadecimal) {
    return null;
  }
  const largo = hexadecimal.length === CIFRAS_DEL_COLOR_CORTO ? 1 : 2;
  const canal = (/** @type {number} */ posicion) => {
    const parte = hexadecimal.slice(posicion * largo, posicion * largo + largo);
    return Number.parseInt(largo === 1 ? parte + parte : parte, BASE_HEXADECIMAL) / MAXIMO_DEL_CANAL;
  };
  return [canal(0), canal(1), canal(2)];
}

/**
 * Los colores del dibujo, leídos de las variables que la página aplica a `raiz`. Si falta alguno, el globo no se
 * dibuja (SinWebgl): sin él, se pintaría de un color que nadie ha elegido.
 * @param {HTMLElement} raiz @returns {import('./pintor.js').Colores}
 */
export function coloresDe(raiz) {
  const estilo = getComputedStyle(raiz);
  const leer = (/** @type {string} */ variable) => {
    const color = colorDeToken(estilo.getPropertyValue(variable));
    if (!color) {
      throw new SinWebgl(`falta el color ${variable} en tokens.css`);
    }
    return color;
  };
  return {
    espacio: leer(COLORES.espacio),
    mar: leer(COLORES.mar),
    frontera: leer(COLORES.frontera),
    resalte: leer(COLORES.resalte),
    resalteFilete: leer(COLORES.resalteFilete),
    marca: leer(COLORES.marca),
    marcaFilete: leer(COLORES.marcaFilete),
    estrella: leer(COLORES.estrella),
  };
}

/**
 * Las fronteras, comprobadas (fronteras.js). Sin red y sin copia (fetch lanza TypeError), con una respuesta de error,
 * con un cuerpo que no es JSON (SyntaxError) o si no llegan enteras en PLAZO_DE_CARGA_MS, lanza RecursoSinCargar; con
 * un JSON que no es el suyo, FronterasInvalidas.
 * @returns {Promise<import('./fronteras.js').Fronteras>}
 * @throws {RecursoSinCargar} Si no llegan, llegan con error o fuera de plazo, o no son JSON.
 * @throws {import('./fronteras.js').FronterasInvalidas} Si el JSON no tiene su forma.
 */
export async function cargarFronteras() {
  /** @type {unknown} */
  let valor;
  try {
    const signal = AbortSignal.timeout(PLAZO_DE_CARGA_MS);
    const respuesta = await fetch(RECURSOS.fronteras, { mode: 'same-origin', signal });
    if (!respuesta.ok) {
      throw new RecursoSinCargar(`fronteras.json: ${respuesta.status}`);
    }
    valor = await respuesta.json();
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError || esFueraDePlazo(error)) {
      throw new RecursoSinCargar('fronteras.json no ha llegado', { cause: error });
    }
    throw error;
  }
  return leerFronteras(valor);
}

/**
 * Una imagen del mismo origen, ya descodificada; si no lo está en PLAZO_DE_CARGA_MS, falla con RecursoSinCargar.
 * @param {URL} direccion @param {string} nombre lo que es, para el error
 * @returns {Promise<HTMLImageElement>}
 * @throws {RecursoSinCargar} Si no llega descodificada a tiempo.
 * @throws {unknown} El fallo de `decode()` si la imagen no se puede descodificar.
 */
async function cargarImagen(direccion, nombre) {
  const imagen = new Image();
  imagen.decoding = 'async';
  imagen.src = direccion.href;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plazo;
  const vencido = new Promise((_, rechazar) => {
    plazo = setTimeout(() => rechazar(new RecursoSinCargar(`${nombre} no ha llegado a tiempo`)), PLAZO_DE_CARGA_MS);
  });
  try {
    await Promise.race([imagen.decode(), vencido]);
  } finally {
    clearTimeout(plazo);
  }
  return imagen;
}

/**
 * La imagen de la Tierra, ya descodificada; si no lo está en PLAZO_DE_CARGA_MS, falla con RecursoSinCargar.
 * @returns {Promise<HTMLImageElement>}
 * @throws {RecursoSinCargar} Si no llega descodificada a tiempo.
 * @throws {unknown} El fallo de `decode()` si la imagen no se puede descodificar.
 */
export function cargarTierra() {
  return cargarImagen(RECURSOS.tierra, 'la imagen de la Tierra');
}

/**
 * Las banderas de las marcas, ya descodificadas, por el código de su territorio: `direcciones` dice dónde está cada
 * una, desde la raíz de la web (scripts/datos-globales/banderas.js). Nunca falla: la que no llega se queda fuera (y su
 * marca sigue con la luz en la cabeza).
 * @param {ReadonlyMap<string, string>} direcciones
 * @returns {Promise<Map<string, HTMLImageElement>>}
 */
export async function cargarBanderas(direcciones) {
  const cargadas = await Promise.allSettled(
    [...direcciones].map(async ([codigo, direccion]) => {
      const imagen = await cargarImagen(new URL(direccion, RECURSOS.raiz), `la bandera de ${codigo}`);
      return /** @type {const} */ ([codigo, imagen]);
    }),
  );
  return new Map(cargadas.flatMap((una) => (una.status === 'fulfilled' ? [una.value] : [])));
}

/**
 * Ajusta el tamaño del lienzo en píxeles del dispositivo a lo que ocupa en la página.
 * @param {HTMLCanvasElement} lienzo
 */
export function ajustarLienzo(lienzo) {
  const densidad = Math.min(DENSIDAD_MAXIMA, window.devicePixelRatio || 1);
  lienzo.width = Math.max(1, Math.round(lienzo.clientWidth * densidad));
  lienzo.height = Math.max(1, Math.round(lienzo.clientHeight * densidad));
}
