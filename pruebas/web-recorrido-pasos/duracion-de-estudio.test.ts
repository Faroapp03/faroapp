// El tiempo de estudio del plan se escribe en horas y minutos enteros, sin decimales que arrastre el cálculo de
// horas × 60. Las abreviaturas (h, min) son las mismas en castellano y en catalán.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { duracionDeEstudio } from '../../web/scripts/recorrido/plan-formacion/duracion-de-estudio.js';

const MINUTOS_POR_HORA = 60;
const DOS_HORAS = 2;
const DOS_HORAS_Y_UN_POCO = 2.05;
const MINUTOS_ENTEROS_DE_ESA_DURACION = 123;
const MENOS_DE_UN_MINUTO = 0.000006;

test('2,05 h se escribe «2 h 3 min», no con los decimales que deja multiplicar por 60', () => {
  const minutos = DOS_HORAS_Y_UN_POCO * MINUTOS_POR_HORA;
  assert.notEqual(minutos, MINUTOS_ENTEROS_DE_ESA_DURACION, 'el cálculo de horas × 60 trae decimales de más');
  assert.equal(duracionDeEstudio(minutos), '2 h 3 min');
});

test('las horas enteras, los minutos sueltos y la nada se escriben sin partes vacías', () => {
  assert.equal(duracionDeEstudio(DOS_HORAS * MINUTOS_POR_HORA), '2 h');
  assert.equal(duracionDeEstudio(MINUTOS_POR_HORA / DOS_HORAS), '30 min');
  assert.equal(duracionDeEstudio(MINUTOS_POR_HORA + MINUTOS_POR_HORA / DOS_HORAS), '1 h 30 min');
  assert.equal(duracionDeEstudio(0), '0 min');
  assert.equal(duracionDeEstudio(MENOS_DE_UN_MINUTO), '0 min');
});

test('el plan escribe la duración en un solo lugar: ninguna otra pieza compone horas y minutos por su cuenta', () => {
  const carpeta = new URL('../../web/scripts/recorrido/plan-formacion/', import.meta.url);
  const conFormatoPropio = readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith('.js') && nombre !== 'duracion-de-estudio.js')
    .filter((nombre) => /\} (?:h|min)`/u.test(readFileSync(new URL(nombre, carpeta), 'utf8')));
  assert.deepEqual(conFormatoPropio, []);
});
