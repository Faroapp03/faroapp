/**
 * La muestra del motor empaquetado en navegador elige navegadores (FARO_NAVEGADORES) y variantes (FARO_VARIANTES):
 * ausente o vacía, todos en su orden; una lista válida, solo esos y en su orden; un nombre desconocido, error.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VARIANTES, variantesPedidas } from './motor-empaquetado/medicion.ts';
import { navegadoresPedidos } from './motor-empaquetado/navegador.ts';

const NAVEGADORES = ['chromium', 'firefox', 'webkit'];

test('sin FARO_NAVEGADORES, o con ella vacía, se piden los tres navegadores en su orden', () => {
  for (const pedidos of [undefined, '', '  ']) {
    assert.deepEqual(navegadoresPedidos(pedidos), NAVEGADORES, `pedidos: ${String(pedidos)}`);
  }
});

test('una lista de navegadores válida da solo esos, en su orden, aunque se escriban en otro', () => {
  assert.deepEqual(navegadoresPedidos('webkit, firefox'), ['firefox', 'webkit']);
  assert.deepEqual(navegadoresPedidos('chromium'), ['chromium']);
});

test('un navegador desconocido es un error que lo nombra, no se descarta en silencio', () => {
  assert.throws(() => navegadoresPedidos('safari'), /FARO_NAVEGADORES: «safari»/u);
  assert.throws(() => navegadoresPedidos('firefox,edge'), /«edge»/u);
});

test('sin FARO_VARIANTES, o con ella vacía, se piden las tres variantes en su orden', () => {
  for (const pedidas of [undefined, '', '  ']) {
    assert.deepEqual(variantesPedidas(pedidas), Object.keys(VARIANTES), `pedidas: ${String(pedidas)}`);
  }
});

test('una lista de variantes válida da solo esas, en su orden, aunque se escriban en otro', () => {
  assert.deepEqual(variantesPedidas('sin-vectores,normal'), ['normal', 'sin-vectores']);
  assert.deepEqual(variantesPedidas('ruido'), ['ruido']);
});

test('una variante desconocida es un error que la nombra, no se descarta en silencio', () => {
  assert.throws(() => variantesPedidas('ruidoso'), /FARO_VARIANTES: «ruidoso»/u);
});
