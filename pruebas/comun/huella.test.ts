// SHA-256 frente a node:crypto: relleno, codificación UTF-8, bytes y vistas sin mutación.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { huella, sha256Hex } from '../../src/comun/huella.ts';

const BYTES_BLOQUE = 64;
const LONGITUD_LARGA = 4096;
const LONGITUDES = [...Array.from({ length: BYTES_BLOQUE * 2 + 2 }, (_, indice) => indice), LONGITUD_LARGA];
const LONGITUD_HUELLA = 16;
const VALORES_DEL_BYTE = 256;
const REPETICIONES_VECTOR = 1_000_000;
const TEXTOS = ['', 'abc', 'España · català · Año 2026', 'a\u0301', '💡𐐀', '\0\r\n', '\ud800', '\udc00'];

function nativa(contenido: string | Uint8Array): string {
  return createHash('sha256').update(contenido).digest('hex');
}

test('los bordes de relleno producen el mismo SHA-256 y su prefijo que node:crypto', () => {
  for (const longitud of LONGITUDES) {
    const texto = 'a'.repeat(longitud);
    const esperado = nativa(texto);
    assert.equal(sha256Hex(texto), esperado, `longitud ${longitud}`);
    assert.equal(huella(texto), esperado.slice(0, LONGITUD_HUELLA));
  }
});

test('UTF-8 conserva acentos, caracteres suplementarios y reemplazo de sustitutos solitarios', () => {
  const codificador = new TextEncoder();
  for (const texto of [...TEXTOS, ...LONGITUDES.map((longitud) => 'é💡'.repeat(longitud))]) {
    const esperado = nativa(texto);
    assert.equal(sha256Hex(texto), esperado);
    assert.equal(sha256Hex(codificador.encode(texto)), esperado);
  }
});

test('los bytes binarios y todos sus valores coinciden con node:crypto sin cambiar el mensaje', () => {
  for (const longitud of [...LONGITUDES, VALORES_DEL_BYTE]) {
    const bytes = Uint8Array.from({ length: longitud }, (_, indice) => indice % VALORES_DEL_BYTE);
    const antes = bytes.slice();
    assert.equal(sha256Hex(bytes), nativa(bytes));
    assert.equal(huella(bytes), nativa(bytes).slice(0, LONGITUD_HUELLA));
    assert.deepEqual(bytes, antes);
  }
});

test('una subarray resume solo sus bytes y deja intacto el búfer compartido', () => {
  const margen = 7;
  for (const longitud of LONGITUDES) {
    const almacen = Uint8Array.from({ length: longitud + margen + margen }, (_, indice) => indice);
    const vista = almacen.subarray(margen, margen + longitud);
    const antes = almacen.slice();
    assert.equal(sha256Hex(vista), nativa(vista));
    assert.equal(sha256Hex(vista), sha256Hex(vista.slice()));
    assert.deepEqual(almacen, antes);
  }
});

test('el vector largo de un millón de aes coincide con el resumen conocido y node:crypto', () => {
  const texto = 'a'.repeat(REPETICIONES_VECTOR);
  const esperado = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
  assert.equal(sha256Hex(texto), esperado);
  assert.equal(sha256Hex(texto), nativa(texto));
});
