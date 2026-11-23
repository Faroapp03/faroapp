// Las marcas del globo de «El mundo»: una chincheta para cada territorio con datos (los países y Cataluña), clavada en
// su centro (fronteras.js), con la bandera del territorio en un círculo de la cabeza. Se dibuja en código a partir de
// su trazado SVG (`MARCA`): cuerpo blanco con un filete oscuro fino, para que se vea sobre el mar oscuro, la tierra
// clara, el hielo y las nubes; la del territorio elegido es amarilla, como el tinte de su contorno, más grande y con el
// mismo filete oscuro: no se distingue solo por el color. Las banderas llegan en un atlas (atlas.js) cuando se han cargado;
// hasta entonces, o si la de un territorio no se puede dibujar, su chincheta lleva una luz en la cabeza en su lugar.
// Un país sin contorno en las fronteras (una isla pequeña o una ciudad-Estado) no tiene marca y sigue en la lista.
// Las marcas no se mueven, no titilan, no tienen halo ni sombra y no cambian de tamaño al acercar: se dibujan con el
// resto del fotograma, solo cuando un gesto lo pide (pintor.js), y su tamaño va en píxeles de CSS. Los colores, de
// tokens.css.

import { dibujarAtlas } from './atlas.js';
import { proyectar } from './esfera.js';
import { bufer, dibujarCon, programa } from './webgl.js';

/** El lado del cuadro de una marca, en píxeles de CSS: la chincheta mide 26 de sus 30 unidades de alto. */
export const ALTO_PX = 28;
/** Cuánto más grande es la marca del país elegido. */
export const AUMENTO_DEL_ELEGIDO = 0.4;
/** El lado del cuadro de la marca en su trazado SVG. */
const LADO = 30;
/** La chincheta en su cuadro de 30: la cabeza, un círculo de radio 9 con centro en (15, 12), y la punta en (15, 29). */
export const MARCA = 'M15 29C15 29 24 19.8 24 12A9 9 0 0 0 6 12C6 19.8 15 29 15 29z';
/** El círculo de la bandera (y de la luz que la sustituye, más pequeña), en el mismo cuadro. */
export const BANDERA = Object.freeze({ horizontal: 15, vertical: 11.5, radio: 6.5 });
const RADIO_DE_LA_LUZ = 3.5;
/** El grosor del filete de la chincheta y el del aro que rodea la bandera, en el mismo cuadro. */
const FILETE = 1.5;
const ARO = 0.6;
/** La altura de la punta de la chincheta en su cuadro de 30. */
const ALTO_DE_LA_PUNTA = 29;
/** La altura del centro de su cabeza. */
const ALTO_DE_LA_CABEZA = 12;
/** La mitad del cuadro, en fracción del lado. */
const MITAD_DEL_CUADRO = 0.5;
/** Cuánto de la casilla del atlas cabe en el círculo: el resto es margen, para que no se cuele la bandera vecina. */
const AJUSTE_DE_LA_CASILLA = 0.875;
/** Decimales con que se escriben los números del sombreador. */
const DECIMALES = 4;
/** Grados de media vuelta: pasa de grados a radianes. */
const GRADOS_DE_MEDIA_VUELTA = 180;
/** La punta y el centro de la cabeza, de arriba abajo, en fracción del lado: la punta señala el centro del país. */
const PUNTA = ALTO_DE_LA_PUNTA / LADO;
const CABEZA = ALTO_DE_LA_CABEZA / LADO;
/** El lado en píxeles de la imagen de la marca que se sube a la tarjeta gráfica: nítida hasta 4 píxeles por píxel de CSS. */
const RESOLUCION = 128;
/** La forma de la chincheta, para quien la dibuja sin WebGL (plano.js): su cuadro, su punta, el filete, el aro de la
 * bandera, la luz y cuánto de la bandera cabe en el círculo, todo en unidades de su cuadro. */
export const FORMA_DE_LA_MARCA = Object.freeze({
  lado: LADO,
  punta: ALTO_DE_LA_PUNTA,
  filete: FILETE,
  aro: ARO,
  radioDeLaLuz: RADIO_DE_LA_LUZ,
  ajuste: AJUSTE_DE_LA_CASILLA,
});
/** Cuánto sobresale la marca de la superficie de la esfera (radio 1), para que la superficie no la tape. */
const ALTURA = 1.004;
/** Los números de cada marca en su búfer: la posición (3), si es la elegida y su casilla en el atlas (−1, sin bandera). */
const NUMEROS_POR_MARCA = 5;
/** Las unidades de textura de la marca y del atlas (la esfera usa las primeras). */
const UNIDAD_DE_LA_MARCA = 2;
const UNIDAD_DEL_ATLAS = 3;
/** Los bytes de un píxel RGBA. */
const BYTES_DE_UN_PIXEL = 4;

/** Un número del sombreador. @param {number} numero */
const glsl = (numero) => numero.toFixed(DECIMALES);

const VERTICES = `
attribute vec3 posicion;
attribute float esElegida;
attribute float casilla;
uniform mat3 giro;
uniform vec2 escala;
uniform float tamano;
uniform float alto;
uniform vec2 rejilla;
varying float delante;
varying float elegida;
varying float lado;
varying float conBandera;
varying vec2 origen;
varying vec2 casillaEnElAtlas;
void main() {
  vec3 punto = giro * posicion;
  lado = tamano * (1.0 + ${AUMENTO_DEL_ELEGIDO.toFixed(2)} * esElegida);
  elegida = esElegida;
  delante = punto.z;
  // La casilla de su bandera en el atlas: su esquina, en fracción del atlas.
  conBandera = step(0.0, casilla);
  float numero = max(casilla, 0.0);
  float fila = floor((numero + 0.5) / rejilla.x);
  origen = vec2(numero - fila * rejilla.x, fila) / rejilla;
  casillaEnElAtlas = 1.0 / rejilla;
  gl_PointSize = lado;
  // El centro del cuadro sube lo que va de la punta al centro: la punta queda en el centro del país.
  float subida = ${glsl(2 * (PUNTA - MITAD_DEL_CUADRO))} * lado / alto;
  gl_Position = vec4(punto.x * escala.x, punto.y * escala.y + subida, -punto.z * 0.5, 1.0);
}`;
// La imagen de la marca dice en su canal rojo dónde va el relleno (1) y dónde el filete (0), en el verde dónde no va la
// luz de la cabeza (0, la luz) y en su canal alfa dónde hay marca. Con bandera, la luz no se pinta y, en su lugar, un
// círculo de la casilla del atlas con un aro fino del color del filete; los bordes del círculo se suavizan medio píxel.
// Las marcas de la cara de atrás de la esfera no se dibujan.
const COLOR = `
precision mediump float;
uniform sampler2D marca;
uniform sampler2D atlas;
uniform vec3 colorDelRelleno;
uniform vec3 colorDelElegido;
uniform vec3 colorDelFilete;
uniform vec3 colorDelFileteElegido;
varying float delante;
varying float elegida;
varying float lado;
varying float conBandera;
varying vec2 origen;
varying vec2 casillaEnElAtlas;
void main() {
  if (delante < 0.0) discard;
  vec4 muestra = texture2D(marca, gl_PointCoord);
  if (muestra.a < 0.02) discard;
  vec3 relleno = mix(colorDelRelleno, colorDelElegido, elegida);
  vec3 filete = mix(colorDelFilete, colorDelFileteElegido, elegida);
  vec3 color = mix(filete, relleno, muestra.r);
  color = mix(color, filete, (1.0 - muestra.g) * (1.0 - conBandera));
  vec2 desdeElCentro = gl_PointCoord - vec2(${glsl(BANDERA.horizontal / LADO)}, ${glsl(BANDERA.vertical / LADO)});
  vec2 dentro = desdeElCentro * ${glsl(AJUSTE_DE_LA_CASILLA * MITAD_DEL_CUADRO * (LADO / BANDERA.radio))} + 0.5;
  vec3 bandera = texture2D(atlas, origen + dentro * casillaEnElAtlas).rgb;
  float distancia = length(desdeElCentro) * lado;
  float radio = ${glsl(BANDERA.radio / LADO)} * lado;
  float aro = max(${glsl(ARO / LADO)} * lado, 1.0);
  color = mix(color, filete, conBandera * clamp(radio + aro - distancia + 0.5, 0.0, 1.0));
  color = mix(color, bandera, conBandera * clamp(radio - distancia + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(color, muestra.a);
}`;

/**
 * Una marca: dónde está y de qué país es.
 * @typedef {{ codigo: string, longitud: number, latitud: number }} Luz
 */

/**
 * Las marcas de los países que salen en «El mundo» (datos.js, `paisesConIa`) y tienen contorno en las fronteras.
 * Lógica pura.
 * @param {readonly import('../datos-globales/datos.js').Territorio[]} paises
 * @param {import('./fronteras.js').Fronteras} fronteras
 * @param {(territorio: import('../datos-globales/datos.js').Territorio) => string} codigoEnElMapa
 * @returns {Luz[]}
 */
export function lucesDe(paises, fronteras, codigoEnElMapa) {
  const centros = new Map(fronteras.territorios.map(({ codigo, centro }) => [codigo, centro]));
  return paises.flatMap((territorio) => {
    const centro = centros.get(codigoEnElMapa(territorio));
    if (!centro) {
      return [];
    }
    return [{ codigo: territorio.codigo, longitud: centro.longitud, latitud: centro.latitud }];
  });
}

/**
 * La marca bajo un punto del lienzo, o null: la más cercana cuya cabeza (un círculo del ancho de la marca) contiene el
 * punto, en la cara visible. Lógica pura.
 * @param {Luz[]} luces @param {import('./esfera.js').Vista} vista
 * @param {{ derecha: number, arriba: number, radio: number, proyeccion?: typeof proyectar }} punto en píxeles de CSS
 *   desde el centro del lienzo, a la derecha y hacia arriba, con el radio del globo y su proyección (la de la esfera,
 *   si no se dice otra: la del mapa plano, en plano.js)
 * @param {string | null} elegido el código del país elegido, cuya marca es más grande
 * @returns {Luz | null}
 */
export function marcaBajo(luces, vista, { derecha, arriba, radio, proyeccion = proyectar }, elegido) {
  /** @type {{ luz: Luz, distancia: number } | null} */
  let mejor = null;
  for (const luz of luces) {
    const { horizontal, vertical, visible } = proyeccion(vista, luz.longitud, luz.latitud);
    if (!visible) {
      continue;
    }
    const lado = ALTO_PX * (luz.codigo === elegido ? 1 + AUMENTO_DEL_ELEGIDO : 1);
    const cabeza = { derecha: horizontal * radio, arriba: vertical * radio + (PUNTA - CABEZA) * lado };
    const distancia = Math.hypot(derecha - cabeza.derecha, arriba - cabeza.arriba);
    if (distancia <= lado / 2 && (!mejor || distancia < mejor.distancia)) {
      mejor = { luz, distancia };
    }
  }
  return mejor?.luz ?? null;
}

/** Un punto de la esfera, un poco por encima de su superficie. @param {number} longitud @param {number} latitud */
function sobreLaEsfera(longitud, latitud) {
  const [lambda, phi] = [(longitud * Math.PI) / GRADOS_DE_MEDIA_VUELTA, (latitud * Math.PI) / GRADOS_DE_MEDIA_VUELTA];
  return [ALTURA * Math.cos(phi) * Math.sin(lambda), ALTURA * Math.sin(phi), ALTURA * Math.cos(phi) * Math.cos(lambda)];
}

/**
 * La imagen de la marca: el relleno en blanco y el filete en negro, sobre transparente, y la luz de la cabeza en magenta
 * (sin verde), para que el sombreador la pinte solo cuando no hay bandera.
 */
function imagenDeLaMarca() {
  const lienzo = document.createElement('canvas');
  [lienzo.width, lienzo.height] = [RESOLUCION, RESOLUCION];
  const dibujo = lienzo.getContext('2d');
  if (!dibujo) {
    return null;
  }
  dibujo.scale(RESOLUCION / LADO, RESOLUCION / LADO);
  const chincheta = new Path2D(MARCA);
  Object.assign(dibujo, { fillStyle: '#fff', strokeStyle: '#000', lineWidth: FILETE, lineJoin: 'round' });
  dibujo.fill(chincheta);
  dibujo.stroke(chincheta);
  dibujo.fillStyle = '#f0f';
  dibujo.beginPath();
  dibujo.arc(BANDERA.horizontal, BANDERA.vertical, RADIO_DE_LA_LUZ, 0, 2 * Math.PI);
  dibujo.fill();
  return lienzo;
}

/**
 * Una textura con `imagen` (o un píxel transparente, si no la hay), suavizada al reducirla. Los lados de la imagen han
 * de ser potencia de dos.
 * @param {WebGLRenderingContext} gl @param {TexImageSource | null} imagen
 */
function textura(gl, imagen) {
  const creada = gl.createTexture();
  try {
    gl.bindTexture(gl.TEXTURE_2D, creada);
    if (imagen) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imagen);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(BYTES_DE_UN_PIXEL));
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return creada;
  } catch (error) {
    gl.deleteTexture(creada);
    throw error;
  }
}

/**
 * Las marcas en el orden en que se dibujan: de norte a sur, para que la de abajo tape a la de arriba como en una vista
 * de frente, y la elegida al final, encima de todas. Lógica pura.
 * @param {readonly Luz[]} luces @param {string | null} elegido @returns {Luz[]}
 */
export function enOrdenDeDibujo(luces, elegido) {
  return [...luces].sort(
    (a, b) => Number(a.codigo === elegido) - Number(b.codigo === elegido) || b.latitud - a.latitud,
  );
}

/**
 * Lo que las marcas tienen en la tarjeta gráfica: el búfer de las marcas y cuántas son, las últimas que se pusieron y
 * la casilla de cada bandera en el atlas, con las casillas que caben de ancho y de alto.
 * @typedef {{ datos: WebGLBuffer | null, cuantas: number, luces: Luz[], elegido: string | null,
 *   casillas: ReadonlyMap<string, number>, rejilla: [number, number] }} EstadoDeLasLuces
 */

/** Sube las marcas ordenadas, con la casilla de su bandera, y reemplaza el búfer anterior.
 * @param {WebGLRenderingContext} gl @param {EstadoDeLasLuces} estado
 * @param {Luz[]} luces @param {string | null} elegido */
function ponerLuces(gl, estado, luces, elegido) {
  const datos = enOrdenDeDibujo(luces, elegido).flatMap(({ codigo, longitud, latitud }) => [
    ...sobreLaEsfera(longitud, latitud),
    codigo === elegido ? 1 : 0,
    estado.casillas.get(codigo) ?? -1,
  ]);
  if (estado.datos) {
    gl.deleteBuffer(estado.datos);
  }
  Object.assign(estado, { datos: bufer(gl, Float32Array.from(datos)), cuantas: luces.length, luces, elegido });
}

/**
 * Sube el atlas de las banderas a su textura y vuelve a poner las marcas con sus casillas. Si el atlas no se puede
 * dibujar o no cabe en la tarjeta gráfica, las marcas siguen con la luz en la cabeza.
 * @param {WebGLRenderingContext} gl @param {EstadoDeLasLuces} estado @param {WebGLTexture | null} destino
 * @param {ReadonlyMap<string, CanvasImageSource>} imagenes
 * @returns {boolean} si alguna marca lleva ya su bandera
 */
function ponerBanderas(gl, estado, destino, imagenes) {
  try {
    const atlas = dibujarAtlas(imagenes);
    const maximo = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (!atlas || Math.max(atlas.lienzo.width, atlas.lienzo.height) > maximo) {
      return false;
    }
    gl.bindTexture(gl.TEXTURE_2D, destino);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.lienzo);
    gl.generateMipmap(gl.TEXTURE_2D);
    Object.assign(estado, { casillas: atlas.casillas, rejilla: [atlas.columnas, atlas.filas] });
  } catch (error) {
    console.warn('Sin las banderas en las marcas del globo: siguen con la luz en la cabeza.', error);
    return false;
  }
  ponerLuces(gl, estado, estado.luces, estado.elegido);
  return estado.casillas.size > 0;
}

/**
 * Da a las variables del sombreador los colores, las texturas y la vista de este fotograma.
 * @param {WebGLRenderingContext} gl @param {ReturnType<typeof programa>} dibujo
 * @param {{ colores: { marca: number[], marcaFilete: number[], resalte: number[], resalteFilete: number[] },
 *   texturas: { marca: WebGLTexture | null, atlas: WebGLTexture | null }, rejilla: [number, number] }} materiales
 * @param {{ giro: Float32Array, escala: number[], tamano: number }} vista
 */
function darVariables(gl, dibujo, { colores, texturas, rejilla }, vista) {
  gl.activeTexture(gl.TEXTURE0 + UNIDAD_DE_LA_MARCA);
  gl.bindTexture(gl.TEXTURE_2D, texturas.marca);
  gl.uniform1i(dibujo.variable('marca'), UNIDAD_DE_LA_MARCA);
  gl.activeTexture(gl.TEXTURE0 + UNIDAD_DEL_ATLAS);
  gl.bindTexture(gl.TEXTURE_2D, texturas.atlas);
  gl.uniform1i(dibujo.variable('atlas'), UNIDAD_DEL_ATLAS);
  gl.uniform2fv(dibujo.variable('rejilla'), rejilla);
  gl.uniformMatrix3fv(dibujo.variable('giro'), false, vista.giro);
  gl.uniform2fv(dibujo.variable('escala'), vista.escala);
  gl.uniform1f(dibujo.variable('tamano'), vista.tamano);
  gl.uniform1f(dibujo.variable('alto'), gl.drawingBufferHeight);
  gl.uniform3fv(dibujo.variable('colorDelRelleno'), colores.marca);
  gl.uniform3fv(dibujo.variable('colorDelElegido'), colores.resalte);
  gl.uniform3fv(dibujo.variable('colorDelFilete'), colores.marcaFilete);
  gl.uniform3fv(dibujo.variable('colorDelFileteElegido'), colores.resalteFilete);
}

/** Las dos texturas de las marcas: la chincheta y el atlas, vacío hasta que lleguen las banderas.
 * @param {WebGLRenderingContext} gl */
function texturasDeLasLuces(gl) {
  const marca = textura(gl, imagenDeLaMarca());
  try {
    return { marca, atlas: textura(gl, null) };
  } catch (error) {
    gl.deleteTexture(marca);
    throw error;
  }
}

/**
 * Las marcas en la tarjeta gráfica: `poner` sube la lista, con la del elegido al final para que quede encima;
 * `ponerBanderas` sube el atlas de las banderas cuando llegan (dice si alguna marca la lleva), y `pintar` las dibuja
 * encima de la esfera.
 * @param {WebGLRenderingContext} gl
 * @param {{ marca: number[], marcaFilete: number[], resalte: number[], resalteFilete: number[] }} colores
 * @returns {{ poner: (luces: Luz[], elegido: string | null) => void,
 *   ponerBanderas: (imagenes: ReadonlyMap<string, CanvasImageSource>) => boolean,
 *   pintar: (vista: { giro: Float32Array, escala: number[] }, densidad: number) => void, liberar: () => void }}
 */
export function crearLuces(gl, colores) {
  const dibujo = programa(gl, VERTICES, COLOR);
  let texturas;
  try {
    texturas = texturasDeLasLuces(gl);
  } catch (error) {
    gl.deleteProgram(dibujo.enlazado);
    throw error;
  }
  /** @type {EstadoDeLasLuces} */
  const estado = { datos: null, cuantas: 0, luces: [], elegido: null, casillas: new Map(), rejilla: [1, 1] };
  let liberado = false;
  return {
    liberar() {
      if (liberado) {
        return;
      }
      liberado = true;
      gl.deleteBuffer(estado.datos);
      gl.deleteTexture(texturas.marca);
      gl.deleteTexture(texturas.atlas);
      gl.deleteProgram(dibujo.enlazado);
    },
    /** @param {Luz[]} luces @param {string | null} elegido */
    poner: (luces, elegido) => ponerLuces(gl, estado, luces, elegido),
    ponerBanderas: (imagenes) => !liberado && ponerBanderas(gl, estado, texturas.atlas, imagenes),
    /** @param {{ giro: Float32Array, escala: number[] }} vista @param {number} densidad píxeles del dispositivo por píxel de CSS */
    pintar(vista, densidad) {
      if (estado.cuantas === 0) {
        return;
      }
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(dibujo.enlazado);
      darVariables(
        gl,
        dibujo,
        { colores, texturas, rejilla: estado.rejilla },
        { ...vista, tamano: ALTO_PX * densidad },
      );
      const paso = NUMEROS_POR_MARCA;
      const enlaces = [
        { atributo: dibujo.atributo('posicion'), bufer: estado.datos, componentes: 3, paso },
        { atributo: dibujo.atributo('esElegida'), bufer: estado.datos, componentes: 1, paso, desde: 3 },
        { atributo: dibujo.atributo('casilla'), bufer: estado.datos, componentes: 1, paso, desde: 4 },
      ];
      dibujarCon(gl, enlaces, () => gl.drawArrays(gl.POINTS, 0, estado.cuantas));
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
    },
  };
}
