import assert from 'node:assert/strict';
import { test } from 'node:test';
import { varianteDeRuta } from '../../src/plataforma/cloudflare/entrada-recorrido.ts';

// Las rutas de una variante registrada pero no disponible se prueban con su extensión, en su carpeta de pruebas.
test('con solo el real disponible, su entrada es la variante real y una página corriente no es variante', () => {
  assert.equal(varianteDeRuta('/recorrido.html', ['real']), 'real');
  assert.equal(varianteDeRuta('/inicio.html', ['real']), null);
});
