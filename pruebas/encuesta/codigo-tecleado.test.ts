/** Lo que la persona teclea se lleva a la forma canónica del servidor, sin navegador (web/scripts/encuesta-codigo.js). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codigoNuevo, leerCodigo } from '../../src/encuesta/codigos.ts';
import { FORMATO, normalizarCodigo } from '../../web/scripts/encuesta-codigo.js';

const CANONICO = 'PROF-0123-4567-89AB-CDEF-GHJK-MNPQ-1100';

test('la página y el servidor aceptan la misma forma canónica', () => {
  for (const tipo of ['participante', 'profesional'] as const) {
    const codigo = codigoNuevo(tipo);
    assert.match(codigo, FORMATO);
    assert.equal(normalizarCodigo(codigo), codigo);
  }
  assert.equal(leerCodigo(CANONICO).tipo, 'profesional');
});

test('lo tecleado se normaliza: prefijo, O y 0, I y L, minúsculas, espacios y guiones', () => {
  const casos: [string, string][] = [
    // Minúsculas, espacios y guiones de más o de menos.
    ['prof-0123-4567-89ab-cdef-ghjk-mnpq-1100', CANONICO],
    ['  PROF 0123 4567 89AB CDEF GHJK MNPQ 1100 ', CANONICO],
    ['PROF0123456789ABCDEFGHJKMNPQ1100', CANONICO],
    ['PROF--0123--4567-89AB-CDEF-GHJK-MNPQ-1100-', CANONICO],
    // En el tipo, un 0 es la O de PROF; tras el tipo, la O es 0 y la I y la L son 1.
    ['PR0F-0123-4567-89AB-CDEF-GHJK-MNPQ-1100', CANONICO],
    ['pr0f-O123-4567-89AB-CDEF-GHJK-MNPQ-ILOO', CANONICO],
    ['PROF-0123-4567-89AB-CDEF-GHJK-MNPQ-il00', CANONICO],
  ];
  for (const [tecleado, esperado] of casos) {
    const normalizado = normalizarCodigo(tecleado);
    assert.equal(normalizado, esperado, tecleado);
    assert.equal(leerCodigo(normalizado).codigo, esperado, tecleado);
  }
  assert.equal(normalizarCodigo('PART-ABCD'), 'PART-ABCD');
  assert.doesNotMatch(normalizarCodigo('PART-ABCD'), FORMATO);
  // La U no está en el alfabeto y no se adivina qué quería decir: el código no tiene la forma correcta.
  assert.doesNotMatch(normalizarCodigo('PART-UUUU-4567-89AB-CDEF-GHJK-MNPQ-1100'), FORMATO);
});
