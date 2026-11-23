import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validarCredenciales } from './portal-remoto-utilidades.mjs';
import { errorSinSecretos } from './remoto-ayudas.mjs';

test('la entrada exige credenciales y la clave del recorrido sin incorporarlas a errores', () => {
  const correcto = { usuario: 'Faro', clave: 'clave-portal-prueba', claveRecorrido: 'clave-recorrido-prueba' };
  assert.deepEqual(validarCredenciales(correcto), correcto);
  for (const entrada of [null, [], {}, { ...correcto, clave: '' }, { ...correcto, claveRecorrido: 'corta' }]) {
    assert.throws(() => validarCredenciales(entrada), { message: /credenciales|objeto/ });
  }
  const error = new Error(`Problema ${correcto.clave} https://ejemplo.invalid/?state=privado`);
  const diagnostico = JSON.stringify(errorSinSecretos(error, Object.values(correcto)));
  assert.ok(!diagnostico.includes(correcto.clave));
  assert.ok(!diagnostico.includes('state=privado'));
});
