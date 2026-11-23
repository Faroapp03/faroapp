// Las cuentas del globo: dónde queda un punto de la Tierra cuando el globo mira a un centro, y al revés, qué punto de
// la Tierra hay bajo un punto de la pantalla. La proyección es ortográfica (la esfera vista desde muy lejos, como en
// una foto de la Tierra) y el radio de la esfera es 1. Lógica pura, sin DOM ni WebGL: la usan el dibujo (pintor.js), la
// pulsación (globo.js) y el arrastre (interaccion.js). `proyectar`, la cuenta inversa de `coordenadasEn`, no la usa la
// página: la usan sus pruebas y el flujo del navegador para pulsar sobre un territorio, con la misma geometría.
// Ejes: x hacia la derecha de la pantalla, y hacia arriba y z hacia quien mira. Un punto de la Tierra es
// (cos φ · sin λ, sin φ, cos φ · cos λ), con λ la longitud y φ la latitud; mirar a un centro (λ0, φ0) es girar la
// Tierra −λ0 sobre el eje y y después φ0 sobre el eje x, de modo que el centro queda en (0, 0, 1).

/**
 * Los grados que miden las coordenadas: media vuelta (la longitud va de −180 a 180), una vuelta y el polo (la latitud
 * va de −90 a 90).
 */
export const GRADOS = Object.freeze({ mediaVuelta: 180, vuelta: 360, polo: 90 });
/** Radianes por grado. */
const RADIANES_POR_GRADO = Math.PI / GRADOS.mediaVuelta;
/** Cuánto gira el globo cada pulsación de una flecha o de un botón de giro, en grados. */
export const PASO_DE_GIRO_GRADOS = 15;
/** El acercamiento: de 1 (la Tierra entera) a 3, multiplicando o dividiendo por 1,25 en cada paso. */
export const ZOOM = Object.freeze({ minimo: 1, maximo: 3, paso: 1.25 });
/** El radio de la Tierra sin acercar, como parte del lado menor del lienzo: deja un margen de estrellas alrededor. */
const RADIO_RELATIVO = 0.42;

/**
 * Un punto de la Tierra, en grados.
 * @typedef {{ longitud: number, latitud: number }} Coordenadas
 */
/**
 * Hacia dónde mira el globo y cuánto se ha acercado.
 * @typedef {{ centro: Coordenadas, zoom: number }} Vista
 */
/**
 * Un giro en el espacio: matriz de 3 × 3, fila a fila.
 * @typedef {readonly [number, number, number, number, number, number, number, number, number]} Giro
 */

/** @param {number} valor @param {number} minimo @param {number} maximo @returns {number} */
function acotar(valor, minimo, maximo) {
  return Math.min(maximo, Math.max(minimo, valor));
}

/** Una longitud llevada a (−180, 180]. @param {number} longitud @returns {number} */
function longitudNormal(longitud) {
  const vueltas = Math.ceil((longitud - GRADOS.mediaVuelta) / GRADOS.vuelta);
  return longitud - vueltas * GRADOS.vuelta;
}

// ---------- Lo público ----------

/**
 * El punto de la esfera de radio 1 de unas coordenadas.
 * @param {number} longitud @param {number} latitud en grados
 * @returns {[number, number, number]}
 */
export function puntoDeLaEsfera(longitud, latitud) {
  const [lambda, phi] = [longitud * RADIANES_POR_GRADO, latitud * RADIANES_POR_GRADO];
  return [Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda)];
}

/**
 * El giro que pone `centro` delante de quien mira, en (0, 0, 1).
 * @param {Coordenadas} centro @returns {Giro}
 */
export function giroHacia({ longitud, latitud }) {
  // Primero se gira −λ0 sobre el eje y (lambda) y después φ0 sobre el eje x (phi).
  const [lambda, phi] = [-longitud * RADIANES_POR_GRADO, latitud * RADIANES_POR_GRADO];
  const [cosenoLambda, senoLambda] = [Math.cos(lambda), Math.sin(lambda)];
  const [cosenoPhi, senoPhi] = [Math.cos(phi), Math.sin(phi)];
  return [
    cosenoLambda,
    0,
    senoLambda,
    senoPhi * senoLambda,
    cosenoPhi,
    -senoPhi * cosenoLambda,
    -cosenoPhi * senoLambda,
    senoPhi,
    cosenoPhi * cosenoLambda,
  ];
}

/**
 * El giro por columnas, como lo pide WebGL (`uniformMatrix3fv` sin trasponer).
 * @param {Giro} giro @returns {Float32Array}
 */
export function giroPorColumnas(giro) {
  return Float32Array.of(giro[0], giro[3], giro[6], giro[1], giro[4], giro[7], giro[2], giro[5], giro[8]);
}

/**
 * Dónde queda un punto de la Tierra en el disco del globo (radio 1, centro en 0) y si está en la cara visible.
 * @param {Vista} vista @param {number} longitud @param {number} latitud
 * @returns {{ horizontal: number, vertical: number, visible: boolean }}
 */
export function proyectar(vista, longitud, latitud) {
  const giro = giroHacia(vista.centro);
  const [puntoX, puntoY, puntoZ] = puntoDeLaEsfera(longitud, latitud);
  return {
    horizontal: giro[0] * puntoX + giro[1] * puntoY + giro[2] * puntoZ,
    vertical: giro[3] * puntoX + giro[4] * puntoY + giro[5] * puntoZ,
    visible: giro[6] * puntoX + giro[7] * puntoY + giro[8] * puntoZ >= 0,
  };
}

/**
 * El punto de la Tierra bajo un punto del disco del globo (radio 1, centro en 0, y hacia arriba), o null si cae
 * fuera de la esfera, en las estrellas. Deshace el giro con su traspuesta, que es su inversa.
 * @param {Vista} vista @param {number} horizontal @param {number} vertical
 * @returns {Coordenadas | null}
 */
export function coordenadasEn(vista, horizontal, vertical) {
  const distancia = horizontal * horizontal + vertical * vertical;
  if (distancia > 1) {
    return null;
  }
  const profundidad = Math.sqrt(1 - distancia);
  const giro = giroHacia(vista.centro);
  // La traspuesta del giro aplicada al punto (horizontal, vertical, profundidad): sus columnas son las filas del giro.
  const puntoX = giro[0] * horizontal + giro[3] * vertical + giro[6] * profundidad;
  const puntoY = giro[1] * horizontal + giro[4] * vertical + giro[7] * profundidad;
  const puntoZ = giro[2] * horizontal + giro[5] * vertical + giro[8] * profundidad;
  return {
    longitud: Math.atan2(puntoX, puntoZ) / RADIANES_POR_GRADO,
    latitud: Math.asin(acotar(puntoY, -1, 1)) / RADIANES_POR_GRADO,
  };
}

/**
 * El radio del globo en píxeles para un lienzo de `ancho` × `alto` y un acercamiento.
 * @param {number} ancho @param {number} alto @param {number} zoom @returns {number}
 */
export function radioEnPixeles(ancho, alto, zoom) {
  return Math.min(ancho, alto) * RADIO_RELATIVO * zoom;
}

/**
 * La vista girada: la longitud da la vuelta al mundo y la latitud se queda entre los polos.
 * @param {Vista} vista @param {number} longitud @param {number} latitud grados que se suman al centro
 * @returns {Vista}
 */
export function girar(vista, longitud, latitud) {
  return {
    centro: {
      longitud: longitudNormal(vista.centro.longitud + longitud),
      latitud: acotar(vista.centro.latitud + latitud, -GRADOS.polo, GRADOS.polo),
    },
    zoom: vista.zoom,
  };
}

/**
 * La vista tras arrastrar `dx`, `dy` píxeles con el globo de `radio` píxeles: un píxel en el centro del disco es
 * 1 / radio radianes, tanto de longitud como de latitud. Es una aproximación: la superficie sigue exactamente al dedo
 * en el ecuador y va algo por detrás a latitudes altas, donde un grado de longitud mide menos.
 * @param {Vista} vista @param {number} dx @param {number} dy @param {number} radio
 * @returns {Vista}
 */
export function arrastrar(vista, dx, dy, radio) {
  return girar(vista, -dx / radio / RADIANES_POR_GRADO, dy / radio / RADIANES_POR_GRADO);
}

/**
 * La vista acercada (`sentido` 1) o alejada (−1) un paso, dentro de sus límites.
 * @param {Vista} vista @param {1 | -1} sentido @returns {Vista}
 */
export function acercar(vista, sentido) {
  const zoom = acotar(vista.zoom * ZOOM.paso ** sentido, ZOOM.minimo, ZOOM.maximo);
  return { centro: vista.centro, zoom };
}

/**
 * La vista con `centro` en el medio y el mismo acercamiento («Volver a mi país»), o la misma si no hay centro (un
 * territorio sin contorno, como la UE).
 * @param {Vista} vista @param {Coordenadas | null | undefined} centro @returns {Vista}
 */
export function centrarEn(vista, centro) {
  return centro ? { centro: { longitud: centro.longitud, latitud: centro.latitud }, zoom: vista.zoom } : vista;
}
