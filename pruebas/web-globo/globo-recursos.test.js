// Los recursos del globo (recursos/globo/, herramientas/web/traer-globo.ts) son los registrados: cada uno tiene la
// huella y el tamaño que anota procedencia.json, la imagen es un JPEG de 2048 × 1024 (potencia de dos, la que WebGL 1
// necesita para sus mipmaps), las fronteras caben en su presupuesto y la procedencia cita fuentes de dominio público
// por su dirección https, sin rutas de la máquina que los preparó. Y los colores del globo están en tokens.css, con la
// forma que lee el globo. Se ejecutan con npm test.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { colorDeToken, coloresDe } from '../../web/scripts/globo/recursos.js';
import { SinWebgl } from '../../web/scripts/globo/webgl.js';
import { navegador } from '../web-controles/ayudas.js';

/** Bytes por kibibyte. */
const BYTES_POR_KIB = 1024;
/** Presupuesto del diseño del globo para las fronteras, en KiB. */
const PRESUPUESTO_DE_LAS_FRONTERAS_KIB = 150;
/** Marcadores JPEG: comienzo de imagen (SOI), rango de los SOF y los tres que no lo son (DHT, JPG, DAC). */
const MARCADOR_SOI = 0xffd8;
const PRIMER_SOF = 0xc0;
const ULTIMO_SOF = 0xcf;
const MARCADOR_DHT = 0xc4;
const MARCADOR_JPG = 0xc8;
const MARCADOR_DAC = 0xcc;
const NO_SON_SOF = Object.freeze([MARCADOR_DHT, MARCADOR_JPG, MARCADOR_DAC]);
/** Bytes del segmento SOF antes del alto (precisión) y del ancho (precisión + alto), contados desde el marcador. */
const DESPLAZAMIENTO_DEL_ALTO = 5;
const DESPLAZAMIENTO_DEL_ANCHO = 7;
/** Bytes que hacen falta tras el marcador para leer el SOF entero. */
const BYTES_MINIMOS_DEL_SOF = 9;

const CARPETA = new URL('../../web/recursos/globo/', import.meta.url);
const PROCEDENCIA = JSON.parse(readFileSync(new URL('procedencia.json', CARPETA), 'utf8'));
/** Lo que pueden pesar las fronteras sin comprimir (el presupuesto del diseño del globo). */
const PRESUPUESTO_DE_LAS_FRONTERAS_BYTES = PRESUPUESTO_DE_LAS_FRONTERAS_KIB * BYTES_POR_KIB;
/** Los marcadores JPEG de comienzo de trama (SOF, Start Of Frame) que llevan el alto y el ancho: todos menos DHT, JPG y DAC. */
/** @param {number} marcador */
function esSof(marcador) {
  return marcador >= PRIMER_SOF && marcador <= ULTIMO_SOF && !NO_SON_SOF.includes(marcador);
}

/** @param {Uint8Array} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** El ancho y el alto de un JPEG, leídos de su marcador SOF; recorre los segmentos, que acaban con el archivo. */
/** @param {Buffer} bytes */
function tamanoDelJpeg(bytes) {
  assert.equal(bytes.readUInt16BE(0), MARCADOR_SOI, 'empieza como un JPEG');
  for (let posicion = 2; posicion + BYTES_MINIMOS_DEL_SOF < bytes.length; ) {
    const marcador = bytes[posicion + 1];
    assert.ok(marcador !== undefined);
    if (esSof(marcador)) {
      return {
        alto: bytes.readUInt16BE(posicion + DESPLAZAMIENTO_DEL_ALTO),
        ancho: bytes.readUInt16BE(posicion + DESPLAZAMIENTO_DEL_ANCHO),
      };
    }
    posicion += 2 + bytes.readUInt16BE(posicion + 2);
  }
  return null;
}

test('cada recurso tiene la huella y el tamaño que registra su procedencia, y no sobra ninguno', () => {
  const publicados = readdirSync(CARPETA).filter((archivo) => !['procedencia.json', 'README.md'].includes(archivo));
  assert.deepEqual(publicados.sort(), Object.keys(PROCEDENCIA.resultados).sort());
  for (const [archivo, { sha256: huella, bytes }] of Object.entries(PROCEDENCIA.resultados)) {
    const contenido = readFileSync(new URL(archivo, CARPETA));
    assert.equal(sha256(contenido), huella, archivo);
    assert.equal(contenido.length, bytes, archivo);
  }
});

test('la imagen de la Tierra es un JPEG de 2048 × 1024', () => {
  assert.deepEqual(tamanoDelJpeg(readFileSync(new URL('tierra.jpg', CARPETA))), { alto: 1024, ancho: 2048 });
});

test('las fronteras caben en su presupuesto', () => {
  assert.ok(PROCEDENCIA.resultados['fronteras.json'].bytes <= PRESUPUESTO_DE_LAS_FRONTERAS_BYTES);
});

test('cada original se cita por su dirección https, con su página, su licencia y su huella', () => {
  for (const [nombre, original] of Object.entries(PROCEDENCIA.originales)) {
    assert.match(original.url, /^https:\/\//, nombre);
    assert.match(original.pagina, /^https:\/\//, nombre);
    assert.match(original.licencia, /public domain|not subject to copyright/, nombre);
    assert.match(original.sha256, /^[0-9a-f]{64}$/, nombre);
  }
  assert.match(PROCEDENCIA.consulta, /^\d{4}-\d{2}-\d{2}$/);
});

test('la procedencia no lleva rutas de la máquina que preparó los recursos', () => {
  // JSON.stringify duplica las barras invertidas, de ahí «\\\\» al buscar rutas de Windows (C:\\...).
  assert.doesNotMatch(JSON.stringify(PROCEDENCIA), /\/Users\/|\/home\/|[A-Z]:\\\\/);
});

test('los colores del globo están en tokens.css, en hexadecimal, que es lo que lee el globo', () => {
  const tokens = readFileSync(new URL('../../web/estilos/tokens.css', import.meta.url), 'utf8');
  for (const nombre of [
    'espacio',
    'mar',
    'frontera',
    'resalte',
    'resalte-filete',
    'estrella',
    'marca',
    'marca-filete',
  ]) {
    const valor = new RegExp(`--globo-${nombre}:\\s*([^;]+);`).exec(tokens)?.[1] ?? '';
    assert.ok(colorDeToken(valor), `--globo-${nombre}: «${valor}»`);
  }
});

test('un color de tokens.css se lee en sus tres canales, de 0 a 1', () => {
  assert.deepEqual(colorDeToken(' #ff0000 '), [1, 0, 0]);
  assert.deepEqual(colorDeToken('#0f0'), [0, 1, 0]);
  assert.equal(colorDeToken('rgb(0 0 0)'), null);
  assert.equal(colorDeToken(''), null);
});

/** Los tokens del globo tal como los declara tokens.css, para leerlos con coloresDe sin navegador. */
function tokensDelGlobo() {
  const tokens = readFileSync(new URL('../../web/estilos/tokens.css', import.meta.url), 'utf8');
  /** @type {Map<string, string>} */
  const valores = new Map();
  for (const [, nombre = '', valor = ''] of tokens.matchAll(/(--globo-[a-z-]+):\s*([^;]+);/g)) {
    valores.set(nombre, valor);
  }
  return valores;
}

test('coloresDe lee los colores de marca de los tokens, y sin alguno el globo no se dibuja', (t) => {
  const valores = tokensDelGlobo();
  /** @param {Map<string, string>} propias */
  const leerCon = (propias) => {
    navegador(t, { getComputedStyle: () => ({ getPropertyValue: (/** @type {string} */ n) => propias.get(n) ?? '' }) });
    return coloresDe(/** @type {HTMLElement} */ (/** @type {unknown} */ ({})));
  };
  const colores = leerCon(valores);
  assert.deepEqual(colores.marca, colorDeToken(valores.get('--globo-marca') ?? ''));
  assert.deepEqual(colores.marcaFilete, colorDeToken(valores.get('--globo-marca-filete') ?? ''));
  assert.deepEqual(colores.resalteFilete, colorDeToken(valores.get('--globo-resalte-filete') ?? ''));
  for (const faltante of ['--globo-marca', '--globo-marca-filete', '--globo-resalte', '--globo-resalte-filete']) {
    const sin = new Map(valores);
    sin.delete(faltante);
    assert.throws(() => leerCon(sin), SinWebgl, faltante);
  }
});

/** WCAG 2.x: el umbral del canal lineal, su divisor, el desplazamiento y el divisor de la curva y su exponente. */
const SRGB = Object.freeze({ umbral: 0.03928, divisor: 12.92, desplazamiento: 0.055, escala: 1.055, exponente: 2.4 });
/** WCAG 2.x: el peso de cada canal en la luminancia y lo que se suma a cada luminancia en el contraste. */
const PESOS = Object.freeze({ rojo: 0.2126, verde: 0.7152, azul: 0.0722 });
const DESTELLO = 0.05;
/** El contraste mínimo de un elemento gráfico (WCAG 1.4.11). */
const CONTRASTE_GRAFICO = 3;

/** La luminancia relativa de un color de 0 a 1 (WCAG 2.x). @param {[number, number, number]} color */
function luminancia(color) {
  const lineal = color.map((canal) =>
    canal <= SRGB.umbral ? canal / SRGB.divisor : ((canal + SRGB.desplazamiento) / SRGB.escala) ** SRGB.exponente,
  );
  const [rojo = 0, verde = 0, azul = 0] = lineal;
  return PESOS.rojo * rojo + PESOS.verde * verde + PESOS.azul * azul;
}
/** El contraste entre dos colores (WCAG 2.x). @param {[number, number, number]} a @param {[number, number, number]} b */
function contraste(a, b) {
  const [clara = 0, oscura = 0] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + DESTELLO) / (oscura + DESTELLO);
}

test('las marcas sin elegir son blancas con filete oscuro; el elegido, amarillo con filete oscuro, y su país en amarillo', () => {
  const valores = tokensDelGlobo();
  const color = (/** @type {string} */ nombre) =>
    /** @type {[number, number, number]} */ (colorDeToken(valores.get(nombre) ?? ''));
  const blanco = /** @type {[number, number, number]} */ ([1, 1, 1]);
  assert.deepEqual(color('--globo-marca'), blanco);
  assert.deepEqual(color('--globo-resalte'), colorDeToken('#ffc93c'), 'el elegido y el tinte de su país, en amarillo');
  assert.deepEqual(color('--globo-resalte-filete'), color('--globo-marca-filete'), 'con el mismo filete oscuro');
  // El filete oscuro se ve sobre el hielo, las nubes y una tierra clara; el cuerpo blanco, sobre el mar (WCAG 1.4.11).
  for (const fondo of ['#eef2f5', '#f0f0f0', '#d9d3b8']) {
    const sobre = /** @type {[number, number, number]} */ (colorDeToken(fondo));
    assert.ok(contraste(color('--globo-marca-filete'), sobre) >= CONTRASTE_GRAFICO, `filete sobre ${fondo}`);
  }
  assert.ok(contraste(color('--globo-marca'), color('--globo-mar')) >= CONTRASTE_GRAFICO, 'cuerpo blanco sobre el mar');
  assert.ok(
    contraste(color('--globo-marca'), color('--globo-marca-filete')) >= CONTRASTE_GRAFICO,
    'cuerpo frente a su filete',
  );
  assert.ok(
    contraste(color('--globo-resalte'), color('--globo-resalte-filete')) >= CONTRASTE_GRAFICO,
    'amarillo frente a su filete',
  );
  assert.ok(contraste(color('--globo-resalte'), color('--globo-mar')) >= CONTRASTE_GRAFICO, 'amarillo sobre el mar');
  // El filete del elegido separa el amarillo de una tierra clara, del hielo y de las nubes.
  for (const fondo of ['#eef2f5', '#d9d3b8']) {
    const sobre = /** @type {[number, number, number]} */ (colorDeToken(fondo));
    assert.ok(
      contraste(color('--globo-resalte-filete'), sobre) >= CONTRASTE_GRAFICO,
      `filete del elegido sobre ${fondo}`,
    );
  }
});
