// SHA-256 síncrono sin dependencias, con salida completa o sus primeros 16 caracteres hexadecimales.
// La identidad de los objetivos y las claves de contadores se calculan sin esperar promesas. Esta implementación
// conserva la notación de FIPS 180-4 para contrastar sus pasos y funciona en Node, Workers y navegador.
// pruebas/comun/huella.test.ts contrasta UTF-8, bytes y bordes de relleno con node:crypto.
// El relleno copia el mensaje completo: el consumo de memoria es lineal y los consumidores acotan sus entradas.

/** Posiciones de las ocho palabras del resumen, en el orden H0…H7 de FIPS 180-4. */
const POSICION_RESUMEN = Object.freeze({ a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, k: 7 });

/** Bits de una palabra del algoritmo (FIPS 180-4, apartado 2.2.2). */
const BITS_PALABRA = 32;
/** Bytes de una palabra. */
const BYTES_PALABRA = 4;
/** Bytes de un bloque de mensaje: 16 palabras (apartado 1). */
const BYTES_BLOQUE = 64;
/** Palabras de un bloque de mensaje. */
const PALABRAS_BLOQUE = 16;
/** Vueltas de la compresión y largo del programa de mensajes W (apartado 6.2.2). */
const VUELTAS = 64;
/** Bytes de la longitud en bits con que termina el relleno (apartado 5.1.1). */
const BYTES_LONGITUD = 8;
/** Distancias del programa de mensajes (apartado 6.2.2): W[t-2], W[t-7], W[t-15] y W[t-16]. */
const DISTANCIA_2 = 2;
const DISTANCIA_7 = 7;
const DISTANCIA_15 = 15;
/** Bits por byte. */
const BITS_POR_BYTE = 8;
/** Primer bit del relleno: un 1 seguido de ceros, en el byte (apartado 5.1.1). */
const BYTE_DE_RELLENO = 0x80;
/** Base de los números de las tablas. */
const BASE_HEX = 16;
/** Caracteres hexadecimales de una palabra de 32 bits. */
const HEX_POR_PALABRA = 8;
/** Cifras hexadecimales de la huella corta: las 16 primeras de la SHA-256. */
const CIFRAS_DE_LA_HUELLA_CORTA = 16;
/** Las palabras de una tabla, escritas en hexadecimal y separadas por un espacio. */
function tabla(palabras: string): number[] {
  return palabras.split(' ').map((palabra) => Number.parseInt(palabra, BASE_HEX));
}

/** Constantes K de las 64 vueltas (apartado 4.2.2). */
const K = new Uint32Array(
  tabla(
    '428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 ' +
      'd807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 ' +
      'e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da ' +
      '983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 ' +
      '27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 ' +
      'a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 ' +
      '19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 ' +
      '748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2',
  ),
);

/** Valores iniciales del resumen, H(0) (FIPS 180-4, apartado 5.3.3). */
const H0 = Object.freeze(tabla('6a09e667 bb67ae85 3c6ef372 a54ff53a 510e527f 9b05688c 1f83d9ab 5be0cd19'));

// Las rotaciones y desplazamientos de las cuatro funciones de la norma (apartado 4.1.2): Σ0 y Σ1 de las vueltas, σ0 y
// σ1 del programa de mensajes.
const SIGMA0_A = 2;
const SIGMA0_B = 13;
const SIGMA0_C = 22;
const SIGMA1_A = 6;
const SIGMA1_B = 11;
const SIGMA1_C = 25;
const MINUSCULA0_A = 7;
const MINUSCULA0_B = 18;
const MINUSCULA0_DESPLAZA = 3;
const MINUSCULA1_A = 17;
const MINUSCULA1_B = 19;
const MINUSCULA1_DESPLAZA = 10;

/** El codificador de texto a UTF-8, creado una vez. */
const CODIFICADOR = new TextEncoder();

/** Rotación a la derecha de 32 bits, ROTR^n(x) (apartado 3.2). */
function rot(x: number, n: number): number {
  return (x >>> n) | (x << (BITS_PALABRA - n));
}

/** Relleno del mensaje (apartado 5.1.1): un bit 1, ceros y la longitud en bits en los 8 últimos bytes. */
function rellenar(datos: Uint8Array): DataView {
  const bits = datos.length * BITS_POR_BYTE;
  const total = Math.ceil((datos.length + BYTES_LONGITUD + 1) / BYTES_BLOQUE) * BYTES_BLOQUE;
  const m = new Uint8Array(total);
  m.set(datos);
  m[datos.length] = BYTE_DE_RELLENO;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - BYTES_LONGITUD, Math.floor(bits / 2 ** BITS_PALABRA));
  dv.setUint32(total - BYTES_PALABRA, bits >>> 0);
  return dv;
}

/**
 * El resumen tiene ocho palabras y las tablas, 64; los índices quedan dentro de esas colecciones
 * por POSICION_RESUMEN y por los límites de prepararW y comprimir.
 * La aserción expresa ese límite interno que noUncheckedIndexedAccess no deduce; no valida entradas externas.
 */
function palabra(palabras: Uint32Array, indice: number): number {
  return palabras[indice] as number;
}

/** Programa de mensajes W del bloque que empieza en el byte `i` (apartado 6.2.2, paso 1); rellena `w` en el sitio. */
function prepararW(w: Uint32Array, dv: DataView, i: number): void {
  for (let t = 0; t < PALABRAS_BLOQUE; t++) {
    w[t] = dv.getUint32(i + t * BYTES_PALABRA);
  }
  for (let t = PALABRAS_BLOQUE; t < VUELTAS; t++) {
    const w15 = palabra(w, t - DISTANCIA_15);
    const w2 = palabra(w, t - DISTANCIA_2);
    const s0 = rot(w15, MINUSCULA0_A) ^ rot(w15, MINUSCULA0_B) ^ (w15 >>> MINUSCULA0_DESPLAZA);
    const s1 = rot(w2, MINUSCULA1_A) ^ rot(w2, MINUSCULA1_B) ^ (w2 >>> MINUSCULA1_DESPLAZA);
    w[t] = (palabra(w, t - PALABRAS_BLOQUE) + s0 + palabra(w, t - DISTANCIA_7) + s1) >>> 0;
  }
}

/**
 * Las 64 vueltas de un bloque y su suma al resumen h, que se actualiza en el sitio (apartado 6.2.2, pasos 2 a 4).
 * La octava variable de trabajo se llama k y no h, porque h ya es el resumen.
 */
function comprimir(h: Uint32Array, w: Uint32Array): void {
  let a = palabra(h, POSICION_RESUMEN.a);
  let b = palabra(h, POSICION_RESUMEN.b);
  let c = palabra(h, POSICION_RESUMEN.c);
  let d = palabra(h, POSICION_RESUMEN.d);
  let e = palabra(h, POSICION_RESUMEN.e);
  let f = palabra(h, POSICION_RESUMEN.f);
  let g = palabra(h, POSICION_RESUMEN.g);
  let k = palabra(h, POSICION_RESUMEN.k);
  for (let t = 0; t < VUELTAS; t++) {
    const t1 =
      (k +
        (rot(e, SIGMA1_A) ^ rot(e, SIGMA1_B) ^ rot(e, SIGMA1_C)) +
        ((e & f) ^ (~e & g)) +
        palabra(K, t) +
        palabra(w, t)) >>>
      0;
    const t2 = ((rot(a, SIGMA0_A) ^ rot(a, SIGMA0_B) ^ rot(a, SIGMA0_C)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    k = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = palabra(h, POSICION_RESUMEN.a) + a;
  h[1] = palabra(h, POSICION_RESUMEN.b) + b;
  h[2] = palabra(h, POSICION_RESUMEN.c) + c;
  h[3] = palabra(h, POSICION_RESUMEN.d) + d;
  h[4] = palabra(h, POSICION_RESUMEN.e) + e;
  h[5] = palabra(h, POSICION_RESUMEN.f) + f;
  h[6] = palabra(h, POSICION_RESUMEN.g) + g;
  h[7] = palabra(h, POSICION_RESUMEN.k) + k;
}

/**
 * SHA-256 completo, en hexadecimal (64 caracteres).
 *
 * @param contenido - Texto (se codifica en UTF-8) o bytes.
 * @returns Los 64 caracteres hexadecimales del SHA-256.
 */
export function sha256Hex(contenido: string | Uint8Array): string {
  const datos = typeof contenido === 'string' ? CODIFICADOR.encode(contenido) : contenido;
  const dv = rellenar(datos);
  const h = new Uint32Array(H0);
  const w = new Uint32Array(VUELTAS);
  for (let i = 0; i < dv.byteLength; i += BYTES_BLOQUE) {
    prepararW(w, dv, i);
    comprimir(h, w);
  }
  return Array.from(h, (x) => x.toString(BASE_HEX).padStart(HEX_POR_PALABRA, '0')).join('');
}

/**
 * Huella corta: los 16 primeros caracteres del SHA-256 en hexadecimal.
 *
 * @param contenido - Texto (se codifica en UTF-8) o bytes.
 * @returns Los 16 primeros caracteres hexadecimales del SHA-256.
 */
export function huella(contenido: string | Uint8Array): string {
  return sha256Hex(contenido).slice(0, CIFRAS_DE_LA_HUELLA_CORTA);
}
