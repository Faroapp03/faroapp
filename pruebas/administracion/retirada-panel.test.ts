/** Los avisos de la regla de retirada de una fuente (cambio de modo y retirada amplia) viajan al panel solo con valor y
 * con su forma cerrada. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type EstadoDatosPanelV3, leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Documento = Mutable<EstadoDatosPanelV3>;

const ACTIVADA = { cambio: 'activada', decisiones: 30, en: '2026-11-22T05:00:00Z' };

function fixture(): Documento {
  return JSON.parse(readFileSync(new URL('../fixtures/estado-datos-v3.json', import.meta.url), 'utf8'));
}
function conRetirada(retirada: unknown, campo = 'retirada'): unknown {
  const d = fixture();
  const fila = d.seguimientoRemoto[0];
  assert.ok(fila);
  Object.assign(fila, { [campo]: retirada });
  return d;
}
function primeraFila(entrada: unknown) {
  const leido = leerEstadoDatosPanel(entrada);
  assert.ok('seguimientoRemoto' in leido && leido.seguimientoRemoto);
  return leido.seguimientoRemoto[0];
}

test('el cambio de modo se lee con su cifra y su hora, inmutable', () => {
  const fila = primeraFila(conRetirada(ACTIVADA));
  assert.deepEqual(fila?.retirada, ACTIVADA);
  assert.ok(Object.isFrozen(fila?.retirada));
  const vuelta = primeraFila(conRetirada({ ...ACTIVADA, cambio: 'vuelta-a-sombra' }));
  assert.equal(vuelta?.retirada?.cambio, 'vuelta-a-sombra');
});

test('sin el campo la fila conserva su forma; un aviso fuera de su forma se rechaza', () => {
  assert.equal(Object.hasOwn(primeraFila(fixture()) ?? {}, 'retirada'), false);
  for (const malo of [
    { ...ACTIVADA, cambio: 'otra' },
    { ...ACTIVADA, decisiones: -1 },
    { ...ACTIVADA, decisiones: 1.5 },
    { ...ACTIVADA, en: '22/11/2026' },
    { ...ACTIVADA, extra: 1 },
    { cambio: 'activada', decisiones: 30 },
    null,
  ]) {
    assert.throws(() => leerEstadoDatosPanel(conRetirada(malo)));
  }
});

const AMPLIA = { retiradas: 30, cursos: 100, en: '2026-11-22T05:00:00Z' };

test('la retirada amplia se lee con sus cifras y su hora; fuera de su forma se rechaza', () => {
  const fila = primeraFila(conRetirada(AMPLIA, 'retiradaAmplia'));
  assert.deepEqual(fila?.retiradaAmplia, AMPLIA);
  assert.ok(Object.isFrozen(fila?.retiradaAmplia));
  assert.equal(Object.hasOwn(primeraFila(fixture()) ?? {}, 'retiradaAmplia'), false);
  for (const malo of [
    { ...AMPLIA, retiradas: 0 },
    { ...AMPLIA, retiradas: 101 },
    { ...AMPLIA, cursos: 1.5 },
    { ...AMPLIA, en: '22/11/2026' },
    { ...AMPLIA, extra: 1 },
    { retiradas: 30, cursos: 100 },
    null,
  ]) {
    assert.throws(() => leerEstadoDatosPanel(conRetirada(malo, 'retiradaAmplia')));
  }
});
