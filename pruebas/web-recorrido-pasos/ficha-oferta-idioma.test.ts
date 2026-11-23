/** La hoja del plan dice de dónde sale el idioma de cada curso, con las mismas palabras que la lista de Cursos. */
import './dom.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineasDeLaFicha, resumenDeOferta } from '../../web/scripts/recorrido/plan-formacion/ficha-oferta.js';
import { opcionConOrigen } from '../fixtures/plan-del-catalogo-publicado.ts';

test('el idioma del programa se dice con su origen en castellano y en catalán', () => {
  const opcion = opcionConOrigen('programa');
  assert.match(lineasDeLaFicha(opcion, 'es').join('\n'), /Idioma: castellano \(programa · edición por confirmar\)/u);
  assert.match(lineasDeLaFicha(opcion, 'ca').join('\n'), /Idioma: castellà \(programa · edició per confirmar\)/u);
  assert.match(resumenDeOferta(opcion, 'es'), /Idioma: castellano \(programa · edición por confirmar\)/u);
});

test('la norma general dice la voz y los subtítulos, y que sale de la norma del proveedor', () => {
  const opcion = opcionConOrigen('norma-general');
  assert.match(
    lineasDeLaFicha(opcion, 'es').join('\n'),
    /Idioma: Vídeo en catalán; subtítulos en castellano \(norma general del proveedor\)/u,
  );
  assert.match(
    lineasDeLaFicha(opcion, 'ca').join('\n'),
    /Idioma: Vídeo en català; subtítols en castellà \(norma general del proveïdor\)/u,
  );
});

test('el idioma publicado para el curso se dice sin nota de origen, como hasta ahora', () => {
  const opcion = opcionConOrigen('edicion');
  assert.doesNotMatch(lineasDeLaFicha(opcion, 'es').join('\n'), /Idioma: [^·]*\(/u);
});
