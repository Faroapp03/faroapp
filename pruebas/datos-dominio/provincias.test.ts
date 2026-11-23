// Contratos de selección provincial, reparto por restos exactos y rótulos de periodo.

import assert from 'node:assert/strict';
import test from 'node:test';
import { crearLengua } from '../../src/dominio/lengua.ts';
import { periodoDelObservatori, provinciasDeLaOcupacion } from '../../src/dominio/provincias.ts';
import { contratacionDePrueba, datosEstadisticos, observatoriDePrueba } from '../fixtures/datos-estadisticas.ts';

const CUOTA_IGUAL = 25;
const PROVINCIAS_CATALANAS = 4;

test('el reparto exige paquete, un único grupo, una tabla y el mínimo inclusivo de contratos', () => {
  const lengua = crearLengua(datosEstadisticos());
  const grupo = contratacionDePrueba();
  const observatori = observatoriDePrueba({ Barcelona: 99, Girona: 0, Lleida: 0, Tarragona: 0 });
  assert.equal(provinciasDeLaOcupacion(undefined, [grupo], lengua), null);
  assert.equal(provinciasDeLaOcupacion(observatori, [], lengua), null);
  assert.equal(provinciasDeLaOcupacion(observatori, [grupo, grupo], lengua), null);
  assert.equal(provinciasDeLaOcupacion(observatori, [contratacionDePrueba('9999')], lengua), null);
  assert.equal(provinciasDeLaOcupacion(observatori, [grupo], lengua), null);
  observatori.provincias.cno4['2111'] = { Barcelona: 100, Girona: 0, Lleida: 0, Tarragona: 0 };
  assert.equal(provinciasDeLaOcupacion(observatori, [grupo], lengua)?.total, observatori.min_base);
});

test('a igual resto exacto recibe la unidad la provincia que figura antes en el reparto ordenado', () => {
  const observatori = observatoriDePrueba({ Barcelona: 50, Girona: 30, Lleida: 20, Tarragona: 20 });
  const lengua = crearLengua(datosEstadisticos());
  assert.deepEqual(provinciasDeLaOcupacion(observatori, [contratacionDePrueba()], lengua)?.provincias, [
    { provincia: 'Barcelona', contratos: 50, deCada100: 42 },
    { provincia: 'Girona', contratos: 30, deCada100: 25 },
    { provincia: 'Lleida', contratos: 20, deCada100: 17 },
    { provincia: 'Tarragona', contratos: 20, deCada100: 16 },
  ]);
});

test('un empate de contratos usa el código de provincia sin depender del orden de las claves', () => {
  const observatori = observatoriDePrueba({ Tarragona: 25, Lleida: 25, Girona: 25, Barcelona: 25 });
  const lengua = crearLengua(datosEstadisticos());
  assert.deepEqual(
    provinciasDeLaOcupacion(observatori, [contratacionDePrueba()], lengua)?.provincias.map(
      ({ provincia, deCada100 }) => [provincia, deCada100],
    ),
    [
      ['Barcelona', CUOTA_IGUAL],
      ['Girona', CUOTA_IGUAL],
      ['Lleida', CUOTA_IGUAL],
      ['Tarragona', CUOTA_IGUAL],
    ],
  );
});

test('conserva contratos positivos que redondean a cero y provincias sin contratos', () => {
  const observatori = observatoriDePrueba({ Barcelona: 990, Girona: 6, Lleida: 4, Tarragona: 0 });
  assert.deepEqual(
    provinciasDeLaOcupacion(observatori, [contratacionDePrueba()], crearLengua(datosEstadisticos()))?.provincias,
    [
      { provincia: 'Barcelona', contratos: 990, deCada100: 99 },
      { provincia: 'Girona', contratos: 6, deCada100: 1 },
      { provincia: 'Lleida', contratos: 4, deCada100: 0 },
      { provincia: 'Tarragona', contratos: 0, deCada100: 0 },
    ],
  );
});

test('el periodo provincial usa el rótulo bilingüe de contratos firmados', () => {
  const observatori = observatoriDePrueba({ Barcelona: 100, Girona: 0, Lleida: 0, Tarragona: 0 });
  const lengua = crearLengua(datosEstadisticos(), 'ca');
  assert.equal(periodoDelObservatori(observatori, 'es'), 'Periodo castellano');
  assert.equal(periodoDelObservatori(observatori, 'ca'), 'Període català');
  assert.equal(provinciasDeLaOcupacion(observatori, [contratacionDePrueba()], lengua)?.periodo, 'Període català');
});

test('las lecturas conservan el reparto recibido y cada resultado es independiente', () => {
  const observatori = observatoriDePrueba({ Tarragona: 20, Lleida: 20, Girona: 30, Barcelona: 50 });
  const antes = structuredClone(observatori);
  const grupo = contratacionDePrueba();
  const lengua = crearLengua(datosEstadisticos());
  const primero = provinciasDeLaOcupacion(observatori, [grupo], lengua);
  assert.ok(primero);
  primero.provincias.length = 0;
  assert.equal(provinciasDeLaOcupacion(observatori, [grupo], lengua)?.provincias.length, PROVINCIAS_CATALANAS);
  assert.deepEqual(observatori, antes);
});
