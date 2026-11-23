/** La salida parcial de una fuente viaja al panel solo cuando tiene valor, con códigos cerrados y recuentos. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type EstadoDatosPanelV3, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Documento = Mutable<EstadoDatosPanelV3>;

function fixture(): Documento {
  return JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v3.json', import.meta.url), 'utf8'));
}
function conSalida(salidaParcial: unknown): unknown {
  const d = fixture();
  const fila = d.seguimientoRemoto[0];
  assert.ok(fila);
  Object.assign(fila, { salidaParcial });
  return d;
}
function primeraFila(entrada: unknown) {
  const leido = leerEstadoDatosPanel(entrada);
  assert.ok('seguimientoRemoto' in leido && leido.seguimientoRemoto);
  return leido.seguimientoRemoto[0];
}

test('la salida parcial se lee con sus motivos y recuentos, inmutable', () => {
  const fila = primeraFila(conSalida({ motivos: ['fichas-fallidas'], descartadas: 2, aRevisar: 3 }));
  assert.ok(fila?.salidaParcial);
  assert.deepEqual(fila.salidaParcial, { motivos: ['fichas-fallidas'], descartadas: 2, aRevisar: 3 });
  assert.ok(Object.isFrozen(fila.salidaParcial));
});

test('sin el campo la fila conserva su forma; un motivo libre, repetido o un valor vacío se rechazan', () => {
  assert.equal(Object.hasOwn(primeraFila(fixture()) ?? {}, 'salidaParcial'), false);
  for (const malo of [
    { motivos: ['se cayó'], descartadas: 0, aRevisar: 0 },
    { motivos: ['indice-caido', 'indice-caido'], descartadas: 0, aRevisar: 0 },
    { motivos: [], descartadas: 0, aRevisar: 0 },
    { motivos: [], descartadas: -1, aRevisar: 1 },
    null,
  ]) {
    assert.throws(() => leerEstadoDatosPanel(conSalida(malo)));
  }
});
