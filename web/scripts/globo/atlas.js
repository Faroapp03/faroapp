// El atlas de las banderas de las marcas del globo (luces.js): una sola imagen con una casilla cuadrada por bandera, que
// viaja a la tarjeta gráfica como una textura. Cada bandera llena su casilla de alto y se recorta por los lados (en la
// cabeza de la marca se ve un círculo de su centro); la casilla es de 64 píxeles, nítida en pantallas de doble
// densidad, y el atlas tiene lados potencia de dos, para poder reducirlo con suavidad. Las banderas son SVG del mismo
// origen (imagenes/banderas/ e imagenes/identidad/, scripts/datos-globales/banderas.js): no ensucian el lienzo. Una
// bandera que no se puede dibujar se queda sin casilla y su marca sigue con la luz en la cabeza.

/** El lado de una casilla, en píxeles. */
export const CELDA = 64;
/** Las casillas de cada fila del atlas. */
export const COLUMNAS = 8;
/** La proporción de una bandera (3:2), por si la imagen no dice la suya. */
const PROPORCION_DE_UNA_BANDERA = 1.5;

/**
 * El atlas dibujado: la imagen, la casilla de cada territorio (su orden, de izquierda a derecha y de arriba abajo) y
 * cuántas casillas caben de ancho y de alto.
 * @typedef {{ lienzo: HTMLCanvasElement, casillas: Map<string, number>, columnas: number, filas: number }} Atlas
 */

/** La menor potencia de dos que no baja de `valor`. Lógica pura. @param {number} valor */
export function potenciaDeDos(valor) {
  let potencia = 1;
  while (potencia < valor) {
    potencia *= 2;
  }
  return potencia;
}

/**
 * Cuántas casillas caben de alto en el atlas de `cuantas` banderas, con un alto potencia de dos. Lógica pura.
 * @param {number} cuantas @returns {number}
 */
export function filasDelAtlas(cuantas) {
  return potenciaDeDos(Math.max(1, Math.ceil(cuantas / COLUMNAS)) * CELDA) / CELDA;
}

/** El ancho y el alto de una imagen, o los de una bandera 3:2 si no los dice. @param {CanvasImageSource} imagen */
function proporcionDe(imagen) {
  const { naturalWidth: ancho = 0, naturalHeight: alto = 0 } = /** @type {Partial<HTMLImageElement>} */ (imagen);
  return ancho > 0 && alto > 0 ? ancho / alto : PROPORCION_DE_UNA_BANDERA;
}

/**
 * Dibuja una bandera en su casilla: de alto entero, centrada y recortada por los lados. Si falla, deja la casilla
 * vacía y lo dice.
 * @param {CanvasRenderingContext2D} dibujo @param {CanvasImageSource} imagen @param {number} casilla
 * @returns {boolean}
 */
function dibujarBandera(dibujo, imagen, casilla) {
  const [x, y] = [(casilla % COLUMNAS) * CELDA, Math.floor(casilla / COLUMNAS) * CELDA];
  const ancho = CELDA * Math.max(1, proporcionDe(imagen));
  dibujo.save();
  try {
    dibujo.beginPath();
    dibujo.rect(x, y, CELDA, CELDA);
    dibujo.clip();
    dibujo.drawImage(imagen, x + (CELDA - ancho) / 2, y, ancho, CELDA);
    return true;
  } catch {
    dibujo.clearRect(x, y, CELDA, CELDA);
    return false;
  } finally {
    dibujo.restore();
  }
}

/**
 * El atlas de `imagenes` (la bandera de cada territorio, por su código), o null si no hay ninguna que dibujar o el
 * navegador no da un lienzo.
 * @param {ReadonlyMap<string, CanvasImageSource>} imagenes
 * @param {() => HTMLCanvasElement} [crearLienzo]
 * @returns {Atlas | null}
 */
export function dibujarAtlas(imagenes, crearLienzo = () => document.createElement('canvas')) {
  if (imagenes.size === 0) {
    return null;
  }
  const filas = filasDelAtlas(imagenes.size);
  const lienzo = crearLienzo();
  [lienzo.width, lienzo.height] = [COLUMNAS * CELDA, filas * CELDA];
  const dibujo = lienzo.getContext('2d');
  if (!dibujo) {
    return null;
  }
  /** @type {Map<string, number>} */
  const casillas = new Map();
  for (const [codigo, imagen] of imagenes) {
    if (dibujarBandera(dibujo, imagen, casillas.size)) {
      casillas.set(codigo, casillas.size);
    }
  }
  return casillas.size > 0 ? { lienzo, casillas, columnas: COLUMNAS, filas } : null;
}
