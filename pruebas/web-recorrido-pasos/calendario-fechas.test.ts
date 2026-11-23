import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diasDelMes, fechaConTecla, moverMes } from '../../web/scripts/recorrido/formacion/fechas-selector.js';

test('el calendario conserva días válidos y permite navegar con teclado', () => {
  assert.equal(moverMes('2024-01-31', 1), '2024-02-29');
  assert.equal(moverMes('2025-01-31', 1), '2025-02-28');
  const huecosHastaJueves = 3;
  const diasBisiestos = 29;
  const febrero = diasDelMes('2024-02-14');
  assert.equal(febrero.huecos, huecosHastaJueves);
  assert.equal(febrero.dias.length, diasBisiestos);
  assert.equal(fechaConTecla('2024-02-29', 'ArrowRight'), '2024-03-01');
  assert.equal(fechaConTecla('2024-02-29', 'PageDown'), '2024-03-29');
  assert.equal(fechaConTecla('2024-02-29', 'Home'), '2024-02-26');
  assert.equal(fechaConTecla('2024-02-29', 'End'), '2024-03-03');
  assert.equal(fechaConTecla('2024-02-29', 'Escape'), null);
});
