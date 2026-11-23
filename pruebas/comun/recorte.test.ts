// Recortes para citas: límites UTF-16, blancos, puntuación y pares sustitutos sin partir.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recortarEnPalabras } from '../../src/comun/recorte.ts';

const LIMITE_PALABRAS = 8;
const LIMITE_PUNTUACION = 9;
const LIMITE_FRASE = 14;
const LIMITE_ESPACIO_INICIAL = 10;
const LIMITE_PALABRA_LARGA = 5;
const LIMITE_UN_EMOJI = 3;
const LIMITE_PAR_SUSTITUTO = 4;

const RECORTES = [
  ['uno dos tres', LIMITE_PALABRAS, 'uno dos…'],
  ['uno dos, tres', LIMITE_PUNTUACION, 'uno dos…'],
  ['uno dos; tres', LIMITE_PUNTUACION, 'uno dos…'],
  ['uno dos: tres', LIMITE_PUNTUACION, 'uno dos…'],
  ['uno dos. tres', LIMITE_PUNTUACION, 'uno dos…'],
  ['uno dos! tres', LIMITE_PUNTUACION, 'uno dos!…'],
  ['uno dos? tres', LIMITE_PUNTUACION, 'uno dos?…'],
  ['uno dos\u00a0tres', LIMITE_PALABRAS, 'uno dos…'],
  ['uno dos\ttres', LIMITE_PALABRAS, 'uno dos…'],
  ['uno dos\ntres', LIMITE_PALABRAS, 'uno dos…'],
  ['…y a veces ayudo', LIMITE_FRASE, '…y a veces…'],
  [' empieza con espacio y sigue largo', LIMITE_ESPACIO_INICIAL, ' empieza…'],
  ['abcdefgh', LIMITE_PALABRA_LARGA, 'abcd…'],
  ['abc', 1, '…'],
  ['😀abc', 2, '…'],
  ['😀abc', LIMITE_UN_EMOJI, '😀…'],
  ['a😀bc', LIMITE_UN_EMOJI, 'a…'],
  ['a😀bc', LIMITE_PAR_SUSTITUTO, 'a😀…'],
  ['𐐀𐐁𐐂', LIMITE_PAR_SUSTITUTO, '𐐀…'],
] as const;
const SIN_RECORTE = ['', 'uno', 'uno, ', '😀', 'a\u0301', '𐐀𐐁'];
const FRAGMENTOS = ['a', 'ç', '漢', '😀', '𐐀', 'a\u0301', ' ', '\u00a0', '\t', '\n', ',', ';', ':', '.', '!', '?'];
const REPETICIONES = 3;
const MARGEN_DEL_LIMITE = 2;

test('lo que cabe se devuelve idéntico, incluso sus blancos y signos finales', () => {
  for (const texto of SIN_RECORTE) {
    assert.equal(recortarEnPalabras(texto, Math.max(1, texto.length)), texto);
    assert.equal(recortarEnPalabras(texto, texto.length + 1), texto);
  }
});

test('el recorte respeta palabras completas, signos retirados y límites de una sola palabra', () => {
  for (const [texto, limite, esperado] of RECORTES) {
    assert.equal(recortarEnPalabras(texto, limite), esperado, JSON.stringify([texto, limite]));
  }
});

test('el límite se cuenta en unidades UTF-16 y la elipsis ocupa una unidad', () => {
  assert.equal(recortarEnPalabras('😀😀😀', 1), '…');
  assert.equal(recortarEnPalabras('😀😀😀', 2), '…');
  assert.equal(recortarEnPalabras('😀😀😀', LIMITE_UN_EMOJI), '😀…');
  assert.equal(recortarEnPalabras('😀😀😀', LIMITE_PAR_SUSTITUTO), '😀…');
  assert.equal(recortarEnPalabras('😀😀😀', LIMITE_PALABRA_LARGA), '😀😀…');
});

test('el recorte no normaliza Unicode ni promete conservar un grafema completo', () => {
  assert.equal(recortarEnPalabras('a\u0301bc', 2), 'a…');
  assert.equal(recortarEnPalabras('a\u0301bc', LIMITE_UN_EMOJI), 'a\u0301…');
  assert.equal(recortarEnPalabras('👩‍💻abc', LIMITE_PAR_SUSTITUTO), '👩‍…');
});

test('una muestra determinista conserva prefijo, cota e idempotencia sin romper Unicode válido', () => {
  for (const primero of FRAGMENTOS) {
    for (const segundo of FRAGMENTOS) {
      const texto = `${primero}${segundo}`.repeat(REPETICIONES);
      for (let limite = 1; limite <= texto.length + MARGEN_DEL_LIMITE; limite += 1) {
        const resultado = recortarEnPalabras(texto, limite);
        const caso = JSON.stringify([texto, limite]);
        assert.ok(resultado.length <= limite, caso);
        assert.ok(resultado.isWellFormed(), caso);
        assert.equal(recortarEnPalabras(resultado, limite), resultado, caso);
        if (texto.length <= limite) {
          assert.equal(resultado, texto, caso);
        } else {
          assert.ok(resultado.endsWith('…'), caso);
          assert.ok(texto.startsWith(resultado.slice(0, -1)), caso);
        }
      }
    }
  }
});
