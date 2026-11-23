// Contabilidad de recursos en las ramas fallidas reales de los constructores; no simula imagen/renderizado.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import { crearPintor } from '../../web/scripts/globo/pintor.js';
import { programa, SinWebgl } from '../../web/scripts/globo/webgl.js';
import { navegador } from '../web-controles/ayudas.js';

interface Fallo {
  shader?: number;
  enlace?: number;
  textura?: number;
  extension?: boolean;
}

function contextoDe(operaciones: Record<string, unknown>): WebGLRenderingContext {
  return new Proxy(operaciones, {
    get(objeto, clave) {
      if (typeof clave === 'string' && clave in objeto) {
        return objeto[clave];
      }
      if (typeof clave === 'string' && /^[A-Z0-9_]+$/u.test(clave)) {
        return 1;
      }
      return () => undefined;
    },
  }) as unknown as WebGLRenderingContext;
}

function crear(grupo: Set<object>) {
  const valor = {};
  grupo.add(valor);
  return valor;
}

function tarjeta({ shader, enlace, textura, extension = false }: Fallo = {}) {
  const vivos = {
    programas: new Set<object>(),
    shaders: new Set<object>(),
    buferes: new Set<object>(),
    texturas: new Set<object>(),
  };
  let compilaciones = 0;
  let enlaces = 0;
  let subidas = 0;
  let perdidas = 0;
  const fallidos = new Set<object>();
  const operaciones: Record<string, unknown> = {
    createProgram: () => crear(vivos.programas),
    createShader: () => crear(vivos.shaders),
    createBuffer: () => crear(vivos.buferes),
    createTexture: () => crear(vivos.texturas),
    deleteProgram: (valor: object) => vivos.programas.delete(valor),
    deleteShader: (valor: object) => vivos.shaders.delete(valor),
    deleteBuffer: (valor: object) => vivos.buferes.delete(valor),
    deleteTexture: (valor: object) => vivos.texturas.delete(valor),
    compileShader: (valor: object) => {
      if (++compilaciones === shader) {
        fallidos.add(valor);
      }
    },
    getShaderParameter: (valor: object) => !fallidos.has(valor),
    getShaderInfoLog: () => 'compilación rechazada',
    linkProgram: () => enlaces++,
    getProgramParameter: () => enlaces !== enlace,
    getProgramInfoLog: () => 'enlace rechazado',
    texImage2D: () => {
      if (++subidas === textura) {
        throw new SinWebgl('textura rechazada');
      }
    },
    getExtension: () =>
      extension
        ? {
            loseContext: () => {
              perdidas++;
            },
          }
        : null,
  };
  const gl = contextoDe(operaciones);
  return { gl, vivos, perdidas: () => perdidas };
}

function lienzo(gl: WebGLRenderingContext): HTMLCanvasElement {
  return { getContext: () => gl } as unknown as HTMLCanvasElement;
}

function dibujo2d(t: TestContext) {
  const contexto = new Proxy({}, { get: () => () => undefined });
  navegador(t, {
    document: { createElement: () => ({ getContext: () => contexto }) },
    Path2D: class {},
  });
}

const GEOMETRIA = { lineas: new Float32Array(), mapa: new Uint8Array(1), ancho: 1, alto: 1 };
const COLORES = {
  espacio: [0, 0, 0],
  mar: [0, 0, 1],
  frontera: [1, 1, 1],
  resalte: [1, 1, 0],
  resalteFilete: [1, 1, 1],
  marca: [0, 1, 0],
  marcaFilete: [1, 1, 1],
  estrella: [1, 1, 1],
} as const;

function crearEn(gl: WebGLRenderingContext) {
  // El doble no dibuja; los colores entregados son los mismos tuples que requiere el constructor.
  return crearPintor(lienzo(gl), GEOMETRIA, {
    ...COLORES,
    espacio: [...COLORES.espacio],
    mar: [...COLORES.mar],
    frontera: [...COLORES.frontera],
    resalte: [...COLORES.resalte],
    resalteFilete: [...COLORES.resalteFilete],
    marca: [...COLORES.marca],
    marcaFilete: [...COLORES.marcaFilete],
    estrella: [...COLORES.estrella],
  });
}

function vacia(vivos: ReturnType<typeof tarjeta>['vivos']) {
  assert.deepEqual(Object.fromEntries(Object.entries(vivos).map(([nombre, grupo]) => [nombre, grupo.size])), {
    programas: 0,
    shaders: 0,
    buferes: 0,
    texturas: 0,
  });
}

test('programa elimina sus shaders y programa cuando falla compilación o enlace', () => {
  for (const fallo of [{ shader: 2 }, { enlace: 1 }]) {
    const { gl, vivos } = tarjeta(fallo);
    assert.throws(() => programa(gl, 'vértices', 'color'), SinWebgl);
    vacia(vivos);
  }
});

test('un programa enlazado solo conserva su programa; los shaders ya se han entregado a WebGL', () => {
  const { gl, vivos } = tarjeta();
  const creado = programa(gl, 'vértices', 'color');
  assert.equal(vivos.programas.size, 1);
  assert.equal(vivos.shaders.size, 0);
  gl.deleteProgram(creado.enlazado);
  vacia(vivos);
});

test('crearPintor limpia después del primer programa, al crear luces y al subir textura, incluso sin extensión', (t) => {
  dibujo2d(t);
  for (const extension of [false, true]) {
    for (const fallo of [{ shader: 3 }, { shader: 7 }, { textura: 2 }]) {
      const { gl, vivos } = tarjeta({ ...fallo, extension });
      assert.throws(() => crearEn(gl), SinWebgl);
      vacia(vivos);
    }
  }
});

test('liberar un pintor válido es idempotente con y sin extensión', (t) => {
  dibujo2d(t);
  for (const extension of [false, true]) {
    const { gl, vivos, perdidas } = tarjeta({ extension });
    const pintor = crearEn(gl);
    pintor.ponerLuces([], null);
    pintor.liberar();
    pintor.liberar();
    vacia(vivos);
    assert.equal(perdidas(), extension ? 1 : 0);
  }
});
