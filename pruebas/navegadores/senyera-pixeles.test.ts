/** El análisis de píxeles de la senyera, con imágenes sintéticas: no necesita navegador. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analizarSenyera, type ImagenRgba } from './senyera-pixeles.ts';

type Rgb = readonly [number, number, number];

/** Un color #rrggbb en sus tres componentes. */
function rgb(hex: string): Rgb {
  const valor = Number.parseInt(hex.slice(1), 16);
  const byte = 0xff;
  const verde = 8;
  const rojo = 16;
  return [(valor >> rojo) & byte, (valor >> verde) & byte, valor & byte];
}

const AMARILLO = rgb('#fcdd09');
const ROJO = rgb('#da121a');
const BLANCO = rgb('#ffffff');
const NARANJA = rgb('#f08010');
/** El borde gris semitransparente sobre el fondo oscuro de la cabecera. */
const BORDE = rgb('#48484b');
const NEGRO = rgb('#000000');
const OPACO = 255;
const COMPONENTES = 4;
const ANCHO = 26;
const ALTO_MOVIL = 16;
/** Alturas de la bandera en filas: la de móvil, otras intermedias y las de pantallas de alta densidad. */
const ALTO_INTERMEDIO = 18;
const ALTO_IMPAR = 27;
const ALTO_DENSO = 32;
const ALTO_ANCHO = 64;
const ALTOS = [ALTO_MOVIL, ALTO_INTERMEDIO, ALTO_IMPAR, ALTO_DENSO, ALTO_ANCHO];
/** Desfases de subpíxel de las franjas, en fracciones de fila. */
const CUARTO_DE_FILA = 0.25;
const MEDIA_FILA = 0.5;
const DESFASES = [0, CUARTO_DE_FILA, MEDIA_FILA];
/** Filas de borde de la captura, una arriba y otra abajo. */
const FILAS_DE_BORDE = 2;
/**
 * La bandera real de la portada: .bandera-idioma mide 24×16 en border-box con 1 px de borde, así que su contenido es
 * de 22×14. object-fit:cover escala la senyera (810×540) a 22 de ancho, 14,67 filas de alto, y recorta 1/3 de fila
 * arriba y abajo.
 */
const ALTO_REAL = 14;
const ANCHO_CONTENIDO_REAL = 22;
/** Alto y ancho del viewBox de BANDERA_CA. */
const ALTO_SENYERA = 540;
const ANCHO_SENYERA = 810;
const PROPORCION_SENYERA = ALTO_SENYERA / ANCHO_SENYERA;
const ALTO_ESCALADO_REAL = ANCHO_CONTENIDO_REAL * PROPORCION_SENYERA;
const RECORTE_REAL = (ALTO_ESCALADO_REAL - ALTO_REAL) / FILAS_DE_BORDE;
const FRANJA_NARANJA = 4;
const FRANJAS_DE_TRES_ROJAS = 7;
const SENYERA = [AMARILLO, ROJO, AMARILLO, ROJO, AMARILLO, ROJO, AMARILLO, ROJO, AMARILLO];

/**
 * Rasteriza franjas horizontales iguales en `alto` filas promediando el área de cada franja en cada fila, como el
 * suavizado de un motor, con una fila de borde arriba y abajo. `desfase` desplaza las franjas una fracción de fila
 * (negativo: recorte arriba) y `altoBandera` es la altura escalada de la bandera, mayor que `alto` si se recorta.
 */
function bandera(franjas: readonly Rgb[], alto = ALTO_MOVIL, desfase = 0, altoBandera = alto): ImagenRgba {
  const filas: Rgb[] = [BORDE];
  const paso = altoBandera / franjas.length;
  for (let y = 0; y < alto; y += 1) {
    const color = [0, 0, 0];
    for (const [indice, franja] of franjas.entries()) {
      const inicio = indice * paso + desfase;
      const cobertura = Math.max(0, Math.min(y + 1, inicio + paso) - Math.max(y, inicio));
      for (const c of [0, 1, 2]) {
        color[c] = (color[c] ?? 0) + (franja[c] ?? 0) * cobertura;
      }
    }
    const cubierta = Math.min(1, Math.max(0, Math.min(y + 1, altoBandera + desfase) - Math.max(y, desfase)));
    const relleno = 1 - cubierta;
    filas.push(color.map((valor, c) => Math.round(valor + (BORDE[c] ?? 0) * relleno)) as unknown as Rgb);
  }
  filas.push(BORDE);
  return imagen(filas);
}

function imagen(filas: readonly Rgb[]): ImagenRgba {
  const datos = new Uint8ClampedArray(ANCHO * filas.length * COMPONENTES);
  for (const [y, [r, g, b]] of filas.entries()) {
    for (let x = 0; x < ANCHO; x += 1) {
      datos.set([r, g, b, OPACO], (y * ANCHO + x) * COMPONENTES);
    }
  }
  return { ancho: ANCHO, alto: filas.length, datos };
}

test('la senyera a tamaño móvil, con suavizado y desfases de subpíxel, se acepta', () => {
  for (const alto of ALTOS) {
    for (const desfase of DESFASES) {
      const resultado = analizarSenyera(bandera(SENYERA, alto, desfase));
      assert.equal(
        resultado.valida,
        true,
        `${alto} px, desfase ${desfase}: ${resultado.motivo} (${resultado.franjas})`,
      );
      assert.match(resultado.franjas, /^A?RARARARA?$/);
    }
  }
});

test('la senyera con la geometría real de la portada (14 filas, cover con 1/3 de fila recortado) se acepta', () => {
  const resultado = analizarSenyera(bandera(SENYERA, ALTO_REAL, -RECORTE_REAL, ALTO_ESCALADO_REAL));
  assert.equal(resultado.valida, true, `${resultado.motivo} (${resultado.franjas})`);
  assert.equal(resultado.franjas, 'ARARARARA');
});

test('con la geometría real, dos bloques, rojo y blanco y cinco franjas siguen rechazándose', () => {
  const real = (franjas: readonly Rgb[]): boolean =>
    analizarSenyera(bandera(franjas, ALTO_REAL, -RECORTE_REAL, ALTO_ESCALADO_REAL)).valida;
  assert.equal(real([ROJO, AMARILLO]), false);
  assert.equal(real(SENYERA.map((color) => (color === AMARILLO ? BLANCO : color))), false);
  assert.equal(real([...SENYERA, ROJO, AMARILLO]), false);
});

test('dos bloques, rojo y amarillo, se rechazan', () => {
  const resultado = analizarSenyera(bandera([ROJO, AMARILLO]));
  assert.equal(resultado.valida, false);
  assert.match(resultado.motivo, /1 franjas rojas/);
});

test('rojo y blanco no pasan por amarillo', () => {
  const resultado = analizarSenyera(bandera(SENYERA.map((color) => (color === AMARILLO ? BLANCO : color))));
  assert.equal(resultado.valida, false);
  assert.match(resultado.motivo, /no es rojo ni amarillo/);
});

test('cinco franjas rojas se rechazan', () => {
  const cinco = [...SENYERA, ROJO, AMARILLO];
  for (const alto of [ALTO_MOVIL, ALTO_DENSO]) {
    const resultado = analizarSenyera(bandera(cinco, alto));
    assert.equal(resultado.valida, false, `${alto} px`);
    assert.match(resultado.motivo, /5 franjas rojas|franjas de más/, `${alto} px`);
  }
});

test('tres franjas rojas, una franja naranja o una captura negra se rechazan', () => {
  assert.equal(analizarSenyera(bandera(SENYERA.slice(0, FRANJAS_DE_TRES_ROJAS))).valida, false);
  const conNaranja = SENYERA.map((color, i) => (i === FRANJA_NARANJA ? NARANJA : color));
  const naranja = analizarSenyera(bandera(conNaranja, ALTO_ANCHO));
  assert.equal(naranja.valida, false);
  assert.match(naranja.motivo, /filas seguidas de mezcla/);
  assert.equal(analizarSenyera(imagen(Array.from({ length: ALTO_MOVIL + FILAS_DE_BORDE }, () => NEGRO))).valida, false);
});

test('unos datos que no corresponden al tamaño indicado se rechazan', () => {
  const resultado = analizarSenyera({ ancho: 2, alto: 2, datos: new Uint8ClampedArray(COMPONENTES) });
  assert.equal(resultado.valida, false);
});
