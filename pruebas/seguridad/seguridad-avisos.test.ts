// Los textos visibles de los avisos, incluidos ES/CA y cifras de los límites.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as avisos from '../../src/seguridad/avisos.ts';
import referencia from '../fixtures/avisos-referencia.json' with { type: 'json' };

test('cada aviso conserva su texto exacto y los límites se escriben con sus cifras', () => {
  // Lo que exporta el módulo: los textos de la referencia y su función de cifras, que avisos-miles.test.ts ata a la
  // común. Una exportación nueva no pasa sin añadirse aquí.
  assert.deepEqual(Object.keys(avisos).sort(), [...Object.keys(referencia), 'conPuntosDeMiles'].sort());
  const textos = Object.fromEntries(Object.entries(avisos).filter(([, valor]) => typeof valor === 'string'));
  assert.deepEqual(textos, referencia);
});
