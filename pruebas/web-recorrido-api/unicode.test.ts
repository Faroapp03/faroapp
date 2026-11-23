import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recortarEnPalabras as recorteDelMotor } from '../../src/comun/recorte.ts';
import { recortar, recortarEnPalabras } from '../../web/scripts/recorrido/formato.js';

const LIMITE = 3;
const FRAGMENTOS = ['a', 'ç', '漢', '😀', '𐐀', 'a\u0301', ' ', '\u00a0', ',', '.', '!', '?'];
const REPETICIONES = 3;

test('recortar no deja sustituto alto aislado al borde', () => {
  assert.equal(recortar('a😀bc', LIMITE), 'a…');
  assert.equal(recortar('😀abc', 2), '…');
  assert.equal(recortar('😀abc', LIMITE), '😀…');
});

test('recortarEnPalabras conserva el par sustituto y el contrato del motor', () => {
  assert.equal(recortarEnPalabras('a😀bc', LIMITE), 'a…');
  assert.equal(recortarEnPalabras('😀abc', 2), '…');
});

function comprobarResultado(f: typeof recortar, texto: string, limite: number) {
  const resultado = f(texto, limite);
  assert.ok(resultado.isWellFormed(), JSON.stringify([texto, limite]));
  assert.ok(resultado.length <= limite);
  assert.equal(f(resultado, limite), resultado);
  if (texto.length <= limite) {
    assert.equal(resultado, texto);
  }
}

test('muestra determinista: UTF-16 válido, límite y cotejo exacto de palabras con motor actual', () => {
  for (const a of FRAGMENTOS) {
    for (const b of FRAGMENTOS) {
      const texto = `${a}${b}`.repeat(REPETICIONES);
      for (let limite = 1; limite <= texto.length + 1; limite++) {
        for (const f of [recortar, recortarEnPalabras]) {
          comprobarResultado(f, texto, limite);
        }
        assert.equal(recortarEnPalabras(texto, limite), recorteDelMotor(texto, limite));
      }
    }
  }
});
