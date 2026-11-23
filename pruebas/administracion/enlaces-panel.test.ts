/** Los enlaces de la formación comprobados, ocultos y sin comprobar viajan al panel solo cuando tienen valor. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type EstadoDatosPanelV3, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Documento = Mutable<EstadoDatosPanelV3>;

function fixture(): Documento {
  return JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v3.json', import.meta.url), 'utf8'));
}
function conEnlaces(enlaces: unknown): unknown {
  const d = fixture();
  const fila = d.seguimientoRemoto[0];
  assert.ok(fila);
  Object.assign(fila, { enlaces });
  return d;
}
function primeraFila(entrada: unknown) {
  const leido = leerEstadoDatosPanel(entrada);
  assert.ok('seguimientoRemoto' in leido && leido.seguimientoRemoto);
  return leido.seguimientoRemoto[0];
}

test('los enlaces se leen con sus tres cifras, inmutables', () => {
  const fila = primeraFila(conEnlaces({ comprobados: 120, ocultos: 3, sinComprobar: 40 }));
  assert.ok(fila?.enlaces);
  assert.deepEqual(fila.enlaces, { comprobados: 120, ocultos: 3, sinComprobar: 40 });
  assert.ok(Object.isFrozen(fila.enlaces));
});

test('sin el campo la fila conserva su forma; una cifra mala o sin campo se rechaza', () => {
  assert.equal(Object.hasOwn(primeraFila(fixture()) ?? {}, 'enlaces'), false);
  for (const malo of [
    { comprobados: -1, ocultos: 0, sinComprobar: 0 },
    { comprobados: 1.5, ocultos: 0, sinComprobar: 0 },
    { comprobados: 1, ocultos: 5, sinComprobar: 1 },
    { comprobados: 1, ocultos: 0 },
    null,
  ]) {
    assert.throws(() => leerEstadoDatosPanel(conEnlaces(malo)));
  }
});

test('el motivo de dominio con límite viaja en la salida parcial', () => {
  const d = fixture();
  const fila = d.seguimientoRemoto[0];
  assert.ok(fila);
  Object.assign(fila, {
    salidaParcial: { motivos: ['tope-de-consultas', 'dominio-con-limite'], descartadas: 0, aRevisar: 0 },
  });
  const leida = primeraFila(d);
  assert.deepEqual(leida?.salidaParcial?.motivos, ['tope-de-consultas', 'dominio-con-limite']);
});
