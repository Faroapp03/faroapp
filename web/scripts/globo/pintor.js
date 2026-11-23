// El dibujo del globo en WebGL 1, sin bibliotecas: un fondo de estrellas fijo, la esfera con la imagen de satélite de
// la NASA (recursos/globo/tierra.jpg) y las fronteras de Natural Earth en líneas finas encima; el territorio elegido se
// tiñe con el mapa de territorios (fronteras.js), que viaja a la tarjeta gráfica como una segunda textura.
// Solo dibuja cuando se le pide (`pintar`): no hay ningún bucle de animación, así que nada se mueve si la persona no
// arrastra ni pulsa. Los colores llegan de tokens.css (recursos.js los lee) y las estrellas salen de una semilla fija:
// siempre las mismas, en el mismo sitio, sin titilar.
// Encima de todo, las marcas fijas de los países con datos, con su bandera (luces.js y atlas.js). Los programas de la
// tarjeta gráfica (GLSL) son texto que compila WebGL, no JavaScript: no pasan por eval ni por la política de Trusted
// Types.

import { giroHacia, giroPorColumnas, radioEnPixeles } from './esfera.js';
import { crearLuces } from './luces.js';
import { bufer, dibujarCon, programa, SinWebgl } from './webgl.js';

/** Divisiones de la esfera en longitud y en latitud: con 128 × 64, cada lado abarca 2,8° y la silueta se ve redonda. */
const DIVISIONES = Object.freeze({ longitud: 128, latitud: 64 });
/** Cuántas estrellas y la semilla que las coloca. */
const ESTRELLAS = Object.freeze({ cuantas: 260, semilla: 20261011 });
/** Cuánto se tiñe de amarillo el territorio elegido (0, nada; 1, color plano): lo justo para que se vean el relieve y las
 * fronteras, que van encima. */
const TINTE_DEL_ELEGIDO = 0.5;
/** La opacidad de las líneas de frontera sobre la imagen. */
const OPACIDAD_DE_LAS_FRONTERAS = 0.55;

/** La luz de la esfera: la mínima (de canto) y lo que suma de cara; entre ambas, según el frente de cada punto. */
const LUZ_DE_LA_ESFERA = Object.freeze({ minima: 0.6, deFrente: 0.4 });
/** Cuánto pesa la z de un punto girado en la profundidad que ve el búfer de profundidad: lo de delante gana. */
const PESO_DE_LA_PROFUNDIDAD = 0.5;
/** La profundidad de las estrellas: detrás de todo (de 0 a 1, 1 es lo más lejos). */
const PROFUNDIDAD_DE_LAS_ESTRELLAS = 0.99;

const VERTICES_DE_LA_ESFERA = `
attribute vec3 posicion;
attribute vec2 coordenada;
uniform mat3 giro;
uniform vec2 escala;
varying vec2 enLaTextura;
varying float luz;
void main() {
  vec3 punto = giro * posicion;
  enLaTextura = coordenada;
  luz = ${LUZ_DE_LA_ESFERA.minima.toFixed(1)} + ${LUZ_DE_LA_ESFERA.deFrente.toFixed(1)} * max(punto.z, 0.0);
  gl_Position = vec4(punto.x * escala.x, punto.y * escala.y, -punto.z * ${PESO_DE_LA_PROFUNDIDAD.toFixed(1)}, 1.0);
}`;
const COLOR_DE_LA_ESFERA = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D tierra;
uniform sampler2D territorios;
uniform float conTierra;
uniform vec3 colorDelMar;
uniform vec3 colorDelResalte;
uniform vec2 elegidos;
varying vec2 enLaTextura;
varying float luz;
void main() {
  vec3 color = mix(colorDelMar, texture2D(tierra, enLaTextura).rgb, conTierra);
  float territorio = floor(texture2D(territorios, enLaTextura).r * 255.0 + 0.5);
  float elegido = max(1.0 - step(0.5, abs(territorio - elegidos.x)), 1.0 - step(0.5, abs(territorio - elegidos.y)));
  gl_FragColor = vec4(mix(color, colorDelResalte, ${TINTE_DEL_ELEGIDO.toFixed(2)} * elegido) * luz, 1.0);
}`;
const VERTICES_DE_LAS_LINEAS = `
attribute vec3 posicion;
uniform mat3 giro;
uniform vec2 escala;
void main() {
  vec3 punto = giro * posicion;
  gl_Position = vec4(punto.x * escala.x, punto.y * escala.y, -punto.z * ${PESO_DE_LA_PROFUNDIDAD.toFixed(1)}, 1.0);
}`;
const VERTICES_DE_LAS_ESTRELLAS = `
attribute vec3 posicion;
uniform float tamano;
varying float brillo;
void main() {
  brillo = posicion.z;
  gl_PointSize = tamano * (0.6 + posicion.z);
  gl_Position = vec4(posicion.xy, ${PROFUNDIDAD_DE_LAS_ESTRELLAS.toFixed(2)}, 1.0);
}`;
const COLOR_PLANO = `
precision mediump float;
uniform vec4 color;
void main() { gl_FragColor = color; }`;
const COLOR_DE_LAS_ESTRELLAS = `
precision mediump float;
uniform vec3 color;
varying float brillo;
void main() { gl_FragColor = vec4(color * brillo, 1.0); }`;

/**
 * Un color: [rojo, verde, azul], cada canal de 0 a 1.
 * @typedef {[number, number, number]} Color
 */
/**
 * Los colores del dibujo.
 * @typedef {Object} Colores
 * @property {Color} espacio
 * @property {Color} mar
 * @property {Color} frontera
 * @property {Color} resalte el tinte del territorio elegido y el cuerpo de su marca
 * @property {Color} resalteFilete el filete y la luz de la marca del elegido
 * @property {Color} marca el cuerpo de las marcas sin elegir
 * @property {Color} marcaFilete el filete y la luz de la cabeza de las marcas sin elegir
 * @property {Color} estrella
 */
/**
 * Lo que dibuja: las líneas de las fronteras y el mapa de territorios (fronteras.js), de `ancho` × `alto` píxeles.
 * @typedef {Object} Geometria
 * @property {Float32Array<ArrayBuffer>} lineas
 * @property {Uint8Array<ArrayBuffer>} mapa
 * @property {number} ancho
 * @property {number} alto
 */
/**
 * El pintor de un lienzo.
 * @typedef {Object} Pintor
 * @property {(imagen: TexImageSource) => void} ponerTierra la imagen de satélite, cuando llega
 * @property {(luces: import('./luces.js').Luz[], elegido: string | null) => void} ponerLuces las marcas de los países
 *   con datos y el código del elegido, cuya marca se resalta
 * @property {(imagenes: ReadonlyMap<string, CanvasImageSource>) => boolean} ponerBanderas las banderas de las marcas,
 *   cuando llegan, por el código de su territorio; dice si alguna marca la lleva ya
 * @property {(vista: import('./esfera.js').Vista, elegidos: number[]) => void} pintar un fotograma, una vez
 * @property {() => void} liberar
 */

/**
 * La malla de la esfera: posición (x, y, z) y coordenada de la textura (u, v) de cada vértice, y los triángulos. La
 * columna de la longitud 180 se repite con u = 1, para que la textura cierre sin costura.
 */
function mallaDeLaEsfera() {
  const vertices = [];
  for (let fila = 0; fila <= DIVISIONES.latitud; fila += 1) {
    const phi = Math.PI / 2 - (fila / DIVISIONES.latitud) * Math.PI;
    for (let columna = 0; columna <= DIVISIONES.longitud; columna += 1) {
      const lambda = (columna / DIVISIONES.longitud) * 2 * Math.PI - Math.PI;
      vertices.push(
        Math.cos(phi) * Math.sin(lambda),
        Math.sin(phi),
        Math.cos(phi) * Math.cos(lambda),
        columna / DIVISIONES.longitud,
        fila / DIVISIONES.latitud,
      );
    }
  }
  const indices = [];
  const ancho = DIVISIONES.longitud + 1;
  for (let fila = 0; fila < DIVISIONES.latitud; fila += 1) {
    for (let columna = 0; columna < DIVISIONES.longitud; columna += 1) {
      const esquina = fila * ancho + columna;
      indices.push(esquina, esquina + ancho, esquina + 1, esquina + 1, esquina + ancho, esquina + ancho + 1);
    }
  }
  return { vertices: Float32Array.from(vertices), indices: Uint16Array.from(indices) };
}

/**
 * Las constantes del generador mulberry32 (Tommy Ettinger, dominio público): el incremento de su estado, los tres
 * desplazamientos de la mezcla, el impar de la segunda multiplicación y 2³², que lleva el resultado a [0, 1).
 */
const MULBERRY32_INCREMENTO = 0x6d2b79f5;
const MULBERRY32_PRIMER_DESPLAZAMIENTO = 15;
const MULBERRY32_SEGUNDO_DESPLAZAMIENTO = 7;
const MULBERRY32_TERCER_DESPLAZAMIENTO = 14;
const MULBERRY32_IMPAR = 61;
const DOS_A_LA_32 = 4294967296;
const MULBERRY32 = Object.freeze({
  incremento: MULBERRY32_INCREMENTO,
  desplazamientos: Object.freeze(
    /** @type {const} */ ([
      MULBERRY32_PRIMER_DESPLAZAMIENTO,
      MULBERRY32_SEGUNDO_DESPLAZAMIENTO,
      MULBERRY32_TERCER_DESPLAZAMIENTO,
    ]),
  ),
  impar: MULBERRY32_IMPAR,
  dosALa32: DOS_A_LA_32,
});
/** El brillo de una estrella: el mínimo y lo que puede sumar, con el azar al cubo (pocas brillan mucho). */
const BRILLO_DE_ESTRELLA = Object.freeze({ minimo: 0.25, rango: 0.75, exponente: 3 });
/** Lo que mide una estrella, en píxeles de CSS. */
const TAMANO_DE_ESTRELLA_CSS = 1.6;
/** Los números de un punto 3D en los búferes: x, y, z. */
const COMPONENTES_3D = 3;

/**
 * Las estrellas: posición en la pantalla (de −1 a 1) y brillo, de un generador con semilla fija (mulberry32), así que
 * salen siempre iguales. El bucle lo acota el número de estrellas.
 */
function estrellas() {
  /** @type {number} */
  let estado = ESTRELLAS.semilla;
  const azar = () => {
    estado = (estado + MULBERRY32.incremento) | 0;
    let mezcla = Math.imul(estado ^ (estado >>> MULBERRY32.desplazamientos[0]), 1 | estado);
    mezcla =
      (mezcla + Math.imul(mezcla ^ (mezcla >>> MULBERRY32.desplazamientos[1]), MULBERRY32.impar | mezcla)) ^ mezcla;
    return ((mezcla ^ (mezcla >>> MULBERRY32.desplazamientos[2])) >>> 0) / MULBERRY32.dosALa32;
  };
  const puntos = [];
  for (let i = 0; i < ESTRELLAS.cuantas; i += 1) {
    // x e y, de [0, 1) a [−1, 1); el brillo, del mínimo al máximo.
    puntos.push(
      azar() * 2 - 1,
      azar() * 2 - 1,
      BRILLO_DE_ESTRELLA.minimo + azar() ** BRILLO_DE_ESTRELLA.exponente * BRILLO_DE_ESTRELLA.rango,
    );
  }
  return Float32Array.from(puntos);
}

/**
 * Una textura de la tarjeta gráfica. El mapa de territorios se lee sin suavizar (NEAREST): su valor es un número de
 * territorio, no un color, y mezclar dos vecinos daría un tercero que no existe.
 * @param {WebGLRenderingContext} gl @param {boolean} suave
 */
function textura(gl, suave) {
  const creada = gl.createTexture();
  try {
    gl.bindTexture(gl.TEXTURE_2D, creada);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, suave ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, suave ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return creada;
  } catch (error) {
    gl.deleteTexture(creada);
    throw error;
  }
}

/**
 * Sube el mapa de territorios a su textura: un byte por píxel, sin alinear filas.
 * @param {WebGLRenderingContext} gl @param {Geometria} geometria @param {WebGLTexture | null} destino
 */
function subirMapa(gl, { mapa, ancho, alto }, destino) {
  gl.bindTexture(gl.TEXTURE_2D, destino);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, ancho, alto, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mapa);
}

/**
 * Lo que necesita cada fotograma: el contexto, el lienzo, los programas, los búferes, las texturas, los colores y si ya
 * llegó la imagen de la Tierra.
 * @typedef {Object} Dibujos
 * @property {WebGLRenderingContext} gl
 * @property {HTMLCanvasElement} lienzo
 * @property {Record<'esfera' | 'lineas' | 'cielo', ReturnType<typeof programa>>} programas
 * @property {Record<'malla' | 'triangulos' | 'lineas' | 'estrellas', WebGLBuffer | null>} buferes
 * @property {Record<'tierra' | 'territorios', WebGLTexture | null>} texturas
 * @property {Colores} colores
 * @property {{ conTierra: number }} estado
 * @property {number} triangulos cuántos índices tiene la malla
 * @property {ReturnType<typeof crearLuces>} luces
 */

/** Las estrellas, sin profundidad: quedan detrás de todo. @param {Dibujos} dibujos */
function pintarCielo({ gl, lienzo, programas, buferes, colores }) {
  const { cielo } = programas;
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(cielo.enlazado);
  // El tamaño de cada estrella va en píxeles del dispositivo: uno por cada píxel de CSS.
  gl.uniform1f(
    cielo.variable('tamano'),
    Math.max(1, lienzo.width / Math.max(1, lienzo.clientWidth)) * TAMANO_DE_ESTRELLA_CSS,
  );
  gl.uniform3fv(cielo.variable('color'), colores.estrella);
  const enlace = { atributo: cielo.atributo('posicion'), bufer: buferes.estrellas, componentes: 3 };
  dibujarCon(gl, [enlace], () => gl.drawArrays(gl.POINTS, 0, ESTRELLAS.cuantas));
}

/**
 * La esfera con la imagen de la Tierra y los territorios elegidos teñidos (hasta dos: un país y la región elegida
 * dentro de él; −1, ninguno).
 * @param {Dibujos} dibujos @param {{ giro: Float32Array, escala: number[] }} vista @param {number[]} elegidos
 */
function pintarEsfera({ gl, programas, buferes, texturas, colores, estado, triangulos }, vista, elegidos) {
  const { esfera } = programas;
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.useProgram(esfera.enlazado);
  gl.uniformMatrix3fv(esfera.variable('giro'), false, vista.giro);
  gl.uniform2fv(esfera.variable('escala'), vista.escala);
  gl.uniform1f(esfera.variable('conTierra'), estado.conTierra);
  gl.uniform3fv(esfera.variable('colorDelMar'), colores.mar);
  gl.uniform3fv(esfera.variable('colorDelResalte'), colores.resalte);
  gl.uniform2f(esfera.variable('elegidos'), elegidos[0] ?? -1, elegidos[1] ?? -1);
  for (const [unidad, nombre] of /** @type {const} */ ([
    [0, 'tierra'],
    [1, 'territorios'],
  ])) {
    gl.activeTexture(gl.TEXTURE0 + unidad);
    gl.bindTexture(gl.TEXTURE_2D, texturas[nombre]);
    gl.uniform1i(esfera.variable(nombre), unidad);
  }
  const enlaces = [
    { atributo: esfera.atributo('posicion'), bufer: buferes.malla, componentes: 3, paso: 5 },
    { atributo: esfera.atributo('coordenada'), bufer: buferes.malla, componentes: 2, paso: 5, desde: 3 },
  ];
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buferes.triangulos);
  dibujarCon(gl, enlaces, () => gl.drawElements(gl.TRIANGLES, triangulos, gl.UNSIGNED_SHORT, 0));
}

/**
 * Las fronteras, mezcladas con la imagen por su opacidad; la esfera ya pintada tapa las de la cara de atrás.
 * @param {Dibujos} dibujos @param {{ giro: Float32Array, escala: number[] }} vista @param {number} puntos
 */
function pintarFronteras({ gl, programas, buferes, colores }, vista, puntos) {
  const { lineas } = programas;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(lineas.enlazado);
  gl.uniformMatrix3fv(lineas.variable('giro'), false, vista.giro);
  gl.uniform2fv(lineas.variable('escala'), vista.escala);
  const [rojo = 1, verde = 1, azul = 1] = colores.frontera;
  gl.uniform4f(lineas.variable('color'), rojo, verde, azul, OPACIDAD_DE_LAS_FRONTERAS);
  const enlace = { atributo: lineas.atributo('posicion'), bufer: buferes.lineas, componentes: 3 };
  dibujarCon(gl, [enlace], () => gl.drawArrays(gl.LINES, 0, puntos));
  gl.disable(gl.BLEND);
}

/**
 * Un fotograma entero, con el globo centrado en el lienzo y su radio según el acercamiento.
 * @param {Dibujos} dibujos @param {import('./esfera.js').Vista} vista @param {number[]} elegidos
 * @param {number} puntos los extremos de las fronteras
 */
function pintarFotograma(dibujos, vista, elegidos, puntos) {
  const { gl, lienzo, colores } = dibujos;
  const [ancho, alto] = [lienzo.width, lienzo.height];
  const radio = radioEnPixeles(ancho, alto, vista.zoom);
  const enLaTarjeta = {
    giro: giroPorColumnas(giroHacia(vista.centro)),
    escala: [(2 * radio) / ancho, (2 * radio) / alto],
  };
  gl.viewport(0, 0, ancho, alto);
  gl.clearColor(colores.espacio[0] ?? 0, colores.espacio[1] ?? 0, colores.espacio[2] ?? 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  pintarCielo(dibujos);
  pintarEsfera(dibujos, enLaTarjeta, elegidos);
  pintarFronteras(dibujos, enLaTarjeta, puntos);
  dibujos.luces.pintar(enLaTarjeta, Math.max(1, ancho / Math.max(1, lienzo.clientWidth)));
}

/** @typedef {{ programasCreados: WebGLProgram[], buferesCreados: (WebGLBuffer | null)[],
 * texturasCreadas: (WebGLTexture | null)[], luces: ReturnType<typeof crearLuces> | null, liberado: boolean }} Propios */

/** Libera solo las asignaciones de este constructor; también sirve sin extensión de pérdida de contexto.
 * @param {WebGLRenderingContext} gl @param {Propios} propios */
function liberarPropios(gl, propios) {
  if (propios.liberado) {
    return;
  }
  propios.liberado = true;
  propios.luces?.liberar();
  gl.useProgram(null);
  for (const uno of propios.programasCreados) {
    gl.deleteProgram(uno);
  }
  for (const uno of propios.buferesCreados) {
    gl.deleteBuffer(uno);
  }
  for (const una of propios.texturasCreadas) {
    gl.deleteTexture(una);
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/** Los tres constructores solo registran recursos terminados de este pintor.
 * @param {WebGLRenderingContext} gl @param {Propios} propios */
function constructoresDe(gl, propios) {
  /** @param {string} vertices @param {string} color */
  const crearPrograma = (vertices, color) => {
    const uno = programa(gl, vertices, color);
    propios.programasCreados.push(uno.enlazado);
    return uno;
  };
  /** @param {BufferSource} datos @param {number} [destino] */
  const crearBufer = (datos, destino) => {
    const uno = bufer(gl, datos, destino);
    propios.buferesCreados.push(uno);
    return uno;
  };
  /** @param {boolean} suave */
  const crearTextura = (suave) => {
    const una = textura(gl, suave);
    propios.texturasCreadas.push(una);
    return una;
  };
  return { crearPrograma, crearBufer, crearTextura };
}

/** @param {Dibujos} dibujos @param {Geometria} geometria @param {() => void} liberar @returns {Pintor} */
function interfazDelPintor(dibujos, geometria, liberar) {
  return {
    ponerTierra(imagen) {
      dibujos.gl.bindTexture(dibujos.gl.TEXTURE_2D, dibujos.texturas.tierra);
      dibujos.gl.texImage2D(dibujos.gl.TEXTURE_2D, 0, dibujos.gl.RGB, dibujos.gl.RGB, dibujos.gl.UNSIGNED_BYTE, imagen);
      dibujos.gl.generateMipmap(dibujos.gl.TEXTURE_2D);
      dibujos.estado.conTierra = 1;
    },
    ponerLuces: dibujos.luces.poner,
    ponerBanderas: dibujos.luces.ponerBanderas,
    pintar: (vista, elegidos) => pintarFotograma(dibujos, vista, elegidos, geometria.lineas.length / COMPONENTES_3D),
    liberar,
  };
}

// ---------- Lo público ----------

/**
 * El pintor de un lienzo: prepara los programas, la malla, las estrellas, las fronteras y el mapa de territorios. Si el
 * navegador no ofrece WebGL o la tarjeta gráfica rechaza un programa, lanza SinWebgl y el globo no se dibuja (la lista
 * y el panel siguen funcionando).
 * @param {HTMLCanvasElement} lienzo @param {Geometria} geometria @param {Colores} colores @returns {Pintor}
 * @throws {SinWebgl} Si el navegador no ofrece WebGL o la tarjeta gráfica rechaza un programa.
 */
export function crearPintor(lienzo, geometria, colores) {
  const gl = lienzo.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) {
    throw new SinWebgl('el navegador no ofrece WebGL');
  }
  /** @type {Propios} */
  const propios = { programasCreados: [], buferesCreados: [], texturasCreadas: [], luces: null, liberado: false };
  const liberar = () => liberarPropios(gl, propios);
  const { crearPrograma, crearBufer, crearTextura } = constructoresDe(gl, propios);
  try {
    const programas = {
      esfera: crearPrograma(VERTICES_DE_LA_ESFERA, COLOR_DE_LA_ESFERA),
      lineas: crearPrograma(VERTICES_DE_LAS_LINEAS, COLOR_PLANO),
      cielo: crearPrograma(VERTICES_DE_LAS_ESTRELLAS, COLOR_DE_LAS_ESTRELLAS),
    };
    const malla = mallaDeLaEsfera();
    const buferes = {
      malla: crearBufer(malla.vertices),
      triangulos: crearBufer(malla.indices, gl.ELEMENT_ARRAY_BUFFER),
      lineas: crearBufer(geometria.lineas),
      estrellas: crearBufer(estrellas()),
    };
    const texturas = { tierra: crearTextura(true), territorios: crearTextura(false) };
    subirMapa(gl, geometria, texturas.territorios);
    const estado = { conTierra: 0 };
    const luces = crearLuces(gl, colores);
    propios.luces = luces;
    const dibujos = {
      gl,
      lienzo,
      programas,
      buferes,
      texturas,
      colores,
      estado,
      triangulos: malla.indices.length,
      luces,
    };
    return interfazDelPintor(dibujos, geometria, liberar);
  } catch (error) {
    liberar();
    throw error;
  }
}
