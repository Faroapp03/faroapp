// Inferencia de tipos: el resultado declara solo claves que Object.entries puede recorrer.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esFormaDe, esOpcional, esTexto } from '../../src/comun/json.ts';

test('la forma infiere campos string, numéricos y opcionales sin afirmar símbolos que no comprueba', () => {
  const simbolo = Symbol('campo');
  const comprobar = esFormaDe({ nombre: esTexto, 0: esTexto, aviso: esOpcional(esTexto), [simbolo]: esTexto });
  const recibido: unknown = { nombre: 'texto', 0: 'cero' };
  assert.ok(comprobar(recibido));
  const nombre: string = recibido.nombre;
  const codigo: string = recibido[0];
  const aviso: string | undefined = recibido.aviso;
  assert.deepEqual({ nombre, codigo, aviso }, { nombre: 'texto', codigo: 'cero', aviso: undefined });
  // @ts-expect-error Object.entries omite símbolos: el resultado no puede afirmar ese campo.
  assert.equal(recibido[simbolo], undefined);
  assert.equal(comprobar({ nombre: 'texto' }), false);
  assert.equal(comprobar({ 0: 'cero' }), false);
  assert.equal(comprobar({ nombre: 'texto', 0: 'cero', aviso: 1 }), false);
});
