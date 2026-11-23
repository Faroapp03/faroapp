/** Reglas lingüísticas compartidas por las tareas del motor local. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { empiezaPorInfinitivo, empiezaPorInfinitivoEnSuIdioma, mayuscula } from '../../src/ia/frases.ts';

test('el filtro de infinitivo acepta pronombres, el verbo ir y formas catalanas', () => {
  for (const entrada of ['Atender clientes', 'Encargarse del almacén', 'Dárselos', 'Ir a domicilio']) {
    assert.equal(empiezaPorInfinitivo(entrada), true, entrada);
  }
  for (const entrada of [
    'Dur a terme inspeccions',
    "Col·laborar amb l'equip",
    'Encarregar-se del magatzem',
    'Fer factures',
    'Atendre les trucades',
  ]) {
    assert.equal(empiezaPorInfinitivo(entrada, 'ca'), true, entrada);
    assert.equal(empiezaPorInfinitivoEnSuIdioma(entrada), true, entrada);
  }
  for (const entrada of ['', '   ', 'Ar', 'Revisa los pedidos', 'La capital de França']) {
    assert.equal(empiezaPorInfinitivoEnSuIdioma(entrada), false, entrada);
  }
});

test('el filtro morfológico conserva su alcance y no comprueba el significado de un verbo', () => {
  assert.equal(empiezaPorInfinitivo('Taller de reparación'), true);
  assert.equal(empiezaPorInfinitivo('Mujer'), true);
  assert.equal(empiezaPorInfinitivo('Mare', 'ca'), true);
});

test('mayuscula conserva el resto del texto y admite el vacío', () => {
  assert.equal(mayuscula(''), '');
  assert.equal(mayuscula('áRBOL'), 'ÁRBOL');
  assert.equal(mayuscula(' texto'), ' texto');
});
