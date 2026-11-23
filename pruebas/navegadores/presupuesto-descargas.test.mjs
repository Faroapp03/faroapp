/** El presupuesto de JavaScript de descargas-js.mjs: sus valores medidos y dónde pasa de dentro a fuera, sin navegador. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comprobarPresupuesto, PRESUPUESTO_DESCARGAS, presupuestoDe } from './presupuesto-descargas.mjs';

/** El criterio anterior: menos de este número en cada cifra. */
const LIMITE_ANTERIOR = 50;

test('el presupuesto son los valores medidos para los cinco escenarios', () => {
  assert.deepEqual(PRESUPUESTO_DESCARGAS, {
    portada: { direcciones: 0, peticiones: 0 },
    acceso: { direcciones: 0, peticiones: 0 },
    inicio: { direcciones: 70, peticiones: 82 },
    'recorrido real': { direcciones: 70, peticiones: 99 },
    informe: { direcciones: 70, peticiones: 82 },
  });
  assert.ok(Object.isFrozen(PRESUPUESTO_DESCARGAS));
  for (const cifras of Object.values(PRESUPUESTO_DESCARGAS)) {
    assert.ok(Object.isFrozen(cifras));
  }
});

test('cada escenario con sus cifras iguales al presupuesto está dentro', () => {
  for (const [escenario, cifras] of Object.entries(PRESUPUESTO_DESCARGAS)) {
    const { dentro, motivo } = comprobarPresupuesto(escenario, cifras);
    assert.equal(dentro, true, escenario);
    assert.equal(
      motivo,
      `${cifras.direcciones} direcciones y ${cifras.peticiones} peticiones (presupuesto: hasta ` +
        `${cifras.direcciones} direcciones y ${cifras.peticiones} peticiones)`,
    );
  }
});

test('una dirección más que el presupuesto queda fuera', () => {
  for (const [escenario, { direcciones, peticiones }] of Object.entries(PRESUPUESTO_DESCARGAS)) {
    assert.equal(
      comprobarPresupuesto(escenario, { direcciones: direcciones + 1, peticiones }).dentro,
      false,
      escenario,
    );
  }
  assert.equal(
    comprobarPresupuesto('inicio', { direcciones: 71, peticiones: 82 }).motivo,
    '71 direcciones y 82 peticiones (presupuesto: hasta 70 direcciones y 82 peticiones)',
  );
});

test('una petición más que el presupuesto queda fuera', () => {
  for (const [escenario, { direcciones, peticiones }] of Object.entries(PRESUPUESTO_DESCARGAS)) {
    assert.equal(comprobarPresupuesto(escenario, { direcciones, peticiones: peticiones + 1 }).dentro, false, escenario);
  }
});

test('un escenario sin presupuesto es un error, no un pase', () => {
  const sinPresupuesto = /El escenario «desconocido» no tiene presupuesto de descargas/u;
  assert.throws(() => comprobarPresupuesto('desconocido', { direcciones: 0, peticiones: 0 }), sinPresupuesto);
  assert.throws(() => presupuestoDe('desconocido'), sinPresupuesto);
  assert.throws(() => presupuestoDe('toString'), /no tiene presupuesto/u);
});

test('lo medido en inicio falla con el criterio anterior y está dentro de su presupuesto', () => {
  const medida = { direcciones: 70, peticiones: 82 };
  const conElAnterior = medida.direcciones < LIMITE_ANTERIOR && medida.peticiones < LIMITE_ANTERIOR;
  assert.equal(conElAnterior, false);
  assert.equal(comprobarPresupuesto('inicio', medida).dentro, true);
  assert.equal(comprobarPresupuesto('inicio', { direcciones: 70, peticiones: 83 }).dentro, false);
});
