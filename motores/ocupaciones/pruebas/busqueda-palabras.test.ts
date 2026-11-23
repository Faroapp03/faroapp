import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coincidencia,
  derivada,
  enFormaComun,
  formaComun,
  fraseSinGenero,
  MIN_LETRAS_PREFIJO,
  palabrasDe,
  VALOR_DEL_PREFIJO,
} from '../src/busqueda/palabras.ts';

const LETRAS_MINIMAS_VIGENTES = 4;
const RESPALDO_PREFIJO_VIGENTE = 0.5;

test('normaliza signos, acentos y apóstrofos y conserva orden y repeticiones significativas', () => {
  assert.deepEqual(palabrasDe('Soy TÉCNICA, técnica de informática; 2026.'), [
    'tecnica',
    'tecnica',
    'informatica',
    '2026',
  ]);
  assert.deepEqual(palabrasDe("Sóc infermera a l'hospital i treballo amb els nens"), ['infermera', 'hospital', 'nens']);
  assert.deepEqual(palabrasDe('de la y sin contra sobre mediante no se'), []);
});

test('texto vacío, espacios, otros alfabetos y UTF-16 incompleto no crean palabras', () => {
  for (const texto of ['', ' \t\n ', '中文 русский 😀', '\ud800\udfff', '...---']) {
    assert.deepEqual(palabrasDe(texto), []);
  }
  assert.deepEqual(palabrasDe('cafe\u0301\ud800operador'), ['cafe', 'operador']);
});

test('iguala género y número regulares y los femeninos irregulares conocidos', () => {
  for (const palabra of ['administrativo', 'administrativa', 'administrativos', 'administrativas']) {
    assert.equal(formaComun(palabra), 'administrativ');
  }
  for (const [femenino, masculino] of [
    ['jefa', 'jefe'],
    ['moza', 'mozo'],
    ['actriz', 'actor'],
    ['actrices', 'actores'],
    ['alcaldesa', 'alcalde'],
    ['alcaldesas', 'alcaldes'],
    ['choferesa', 'chofer'],
    ['choferesas', 'choferes'],
  ] as const) {
    assert.equal(formaComun(femenino), formaComun(masculino));
  }
});

test('conserva el límite documentado de plurales de palabras cortas', () => {
  for (const [singular, plural, raizPlural] of [
    ['jefe', 'jefes', 'jef'],
    ['guia', 'guias', 'gui'],
    ['mozo', 'mozos', 'moz'],
  ] as const) {
    assert.equal(formaComun(singular), singular);
    assert.equal(formaComun(plural), raizPlural);
    assert.equal(coincidencia(formaComun(singular), raizPlural, false), 0);
  }
});

test('enFormaComun crea otro conjunto sin alterar el original y conserva la primera aparición', () => {
  const originales = new Set(['administrativa', 'administrativo', 'actriz', 'actor', 'jefa']);
  assert.deepEqual([...enFormaComun(originales)], ['administrativ', 'actor', 'jefe']);
  assert.deepEqual([...originales], ['administrativa', 'administrativo', 'actriz', 'actor', 'jefa']);
});

test('la frase conserva palabras vacías y número, igualando únicamente género', () => {
  assert.equal(fraseSinGenero('analista financiera'), fraseSinGenero('analista financiero'));
  assert.equal(fraseSinGenero('cajeros'), fraseSinGenero('cajeras'));
  assert.notEqual(fraseSinGenero('cajero'), fraseSinGenero('cajeros'));
  assert.notEqual(fraseSinGenero('técnico de drenajes'), fraseSinGenero('técnico de drenaje'));
  assert.notEqual(fraseSinGenero('soy camarera'), fraseSinGenero('camarero'));
  assert.equal(fraseSinGenero(''), '');
});

test('coincidencia da igualdad completa, prefijo simétrico desde cuatro letras y cero sin relación', () => {
  assert.equal(MIN_LETRAS_PREFIJO, LETRAS_MINIMAS_VIGENTES);
  assert.equal(VALOR_DEL_PREFIJO, RESPALDO_PREFIJO_VIGENTE);
  assert.equal(coincidencia('pan', 'pan', true), 1);
  assert.equal(coincidencia('pan', 'panader', false), 0);
  assert.equal(coincidencia('limpi', 'limpiador', false), RESPALDO_PREFIJO_VIGENTE);
  assert.equal(coincidencia('limpiador', 'limpi', false), RESPALDO_PREFIJO_VIGENTE);
  assert.equal(coincidencia('fuster', 'caixer', false), 0);
});

test('un nombre probable exige derivación y derivada conserva su precondición de prefijo', () => {
  assert.equal(derivada('limpi', 'limpiador'), true);
  assert.equal(derivada('mari', 'marin'), false);
  assert.equal(coincidencia('mari', 'mariner', false), RESPALDO_PREFIJO_VIGENTE);
  assert.equal(coincidencia('mari', 'mariner', true), 0);
  assert.equal(coincidencia('limpi', 'limpiador', true), RESPALDO_PREFIJO_VIGENTE);
  assert.equal(coincidencia('limpiador', 'limpi', true), RESPALDO_PREFIJO_VIGENTE);
});
