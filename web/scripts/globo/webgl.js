// Las piezas de WebGL 1 que comparten los dibujos del globo (pintor.js y luces.js): compilar y enlazar un programa,
// subir un búfer y dibujar con sus atributos enlazados y soltados después. Si el navegador no ofrece WebGL o la tarjeta
// gráfica rechaza un programa, SinWebgl: el globo no se dibuja y la lista y la ficha siguen funcionando.
// Los programas de la tarjeta gráfica (GLSL) son texto que compila WebGL, no JavaScript: no pasan por eval ni por la
// política de Trusted Types.

/** El lienzo no admite WebGL, o la tarjeta gráfica rechaza un programa: el globo no se puede dibujar. */
export class SinWebgl extends Error {
  /** @override */
  name = 'SinWebgl';
}

/** Bytes de cada número de las listas de vértices (Float32Array). */
const BYTES_POR_NUMERO = Float32Array.BYTES_PER_ELEMENT;

/**
 * Un programa compilado y enlazado, con la posición de cada atributo y de cada variable que usa.
 * @param {WebGLRenderingContext} gl @param {string} vertices @param {string} color
 * @returns {{ enlazado: WebGLProgram, variable: (nombre: string) => WebGLUniformLocation | null,
 *   atributo: (nombre: string) => number }} el programa y sus buscadores de variables y atributos
 * @throws {SinWebgl} si no se puede crear, compilar o enlazar el programa
 */
export function programa(gl, vertices, color) {
  const enlazado = gl.createProgram();
  if (!enlazado) {
    throw new SinWebgl('no se pudo crear un programa');
  }
  /** @type {WebGLShader[]} */
  const partes = [];
  let entregado = false;
  try {
    for (const [tipo, fuente] of /** @type {const} */ ([
      [gl.VERTEX_SHADER, vertices],
      [gl.FRAGMENT_SHADER, color],
    ])) {
      const parte = gl.createShader(tipo);
      if (!parte) {
        throw new SinWebgl('no se pudo crear un programa');
      }
      partes.push(parte);
      gl.shaderSource(parte, fuente);
      gl.compileShader(parte);
      if (!gl.getShaderParameter(parte, gl.COMPILE_STATUS)) {
        throw new SinWebgl(gl.getShaderInfoLog(parte) ?? '');
      }
      gl.attachShader(enlazado, parte);
    }
    gl.linkProgram(enlazado);
    if (!gl.getProgramParameter(enlazado, gl.LINK_STATUS)) {
      throw new SinWebgl(gl.getProgramInfoLog(enlazado) ?? '');
    }
    entregado = true;
    /** @param {string} nombre */
    const variable = (nombre) => gl.getUniformLocation(enlazado, nombre);
    return { enlazado, variable, atributo: (/** @type {string} */ nombre) => gl.getAttribLocation(enlazado, nombre) };
  } finally {
    // WebGL conserva un shader adjunto mientras el programa lo necesite; no hace falta retener su handle.
    for (const parte of partes) {
      gl.deleteShader(parte);
    }
    if (!entregado) {
      gl.deleteProgram(enlazado);
    }
  }
}

/**
 * Un búfer de la tarjeta gráfica con `datos`.
 * @param {WebGLRenderingContext} gl @param {BufferSource} datos @param {number} [destino] ARRAY_BUFFER o ELEMENT_ARRAY_BUFFER
 * @returns {WebGLBuffer | null} el búfer creado
 */
export function bufer(gl, datos, destino = gl.ARRAY_BUFFER) {
  const creado = gl.createBuffer();
  try {
    gl.bindBuffer(destino, creado);
    gl.bufferData(destino, datos, gl.STATIC_DRAW);
    return creado;
  } catch (error) {
    gl.deleteBuffer(creado);
    throw error;
  }
}

/**
 * Enlaza `bufer` al atributo `atributo` con `componentes` números por vértice, saltando `paso` números entre vértices
 * y empezando en el número `desde`.
 * @param {WebGLRenderingContext} gl @param {number} atributo
 * @param {{ bufer: WebGLBuffer | null, componentes: number, paso?: number, desde?: number }} forma
 */
function enlazarAtributo(gl, atributo, { bufer: datos, componentes, paso = componentes, desde = 0 }) {
  gl.bindBuffer(gl.ARRAY_BUFFER, datos);
  gl.enableVertexAttribArray(atributo);
  gl.vertexAttribPointer(atributo, componentes, gl.FLOAT, false, paso * BYTES_POR_NUMERO, desde * BYTES_POR_NUMERO);
}

/**
 * Enlaza cada atributo con su búfer, dibuja y los suelta: un atributo que queda encendido sin uso podría leer fuera de
 * su búfer en el dibujo siguiente, con otro programa.
 * @param {WebGLRenderingContext} gl
 * @param {{ atributo: number, bufer: WebGLBuffer | null, componentes: number, paso?: number, desde?: number }[]} enlaces
 * @param {() => void} dibujar
 */
export function dibujarCon(gl, enlaces, dibujar) {
  for (const { atributo, ...forma } of enlaces) {
    enlazarAtributo(gl, atributo, forma);
  }
  dibujar();
  for (const { atributo } of enlaces) {
    gl.disableVertexAttribArray(atributo);
  }
}
