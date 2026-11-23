// Valores y textos del interruptor de selección manual, sin iniciar servidores ni leer configuración.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMINO_A_MANO_POR_DEFECTO, descripcionDelCaminoAMano } from '../../src/dominio/camino-a-mano.ts';

test('por defecto la persona puede seguir por el camino a mano', () => {
  assert.equal(CAMINO_A_MANO_POR_DEFECTO, true);
});

test('el registro de un camino a mano encendido conserva su descripción', () => {
  assert.equal(descripcionDelCaminoAMano(true), 'selección manual disponible');
});

test('el registro de un camino a mano apagado conserva su descripción', () => {
  assert.equal(descripcionDelCaminoAMano(false), 'selección manual deshabilitada');
});
