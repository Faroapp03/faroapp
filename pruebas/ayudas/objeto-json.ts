/** Comprobación de forma en las pruebas: el valor es un objeto JSON y se devuelve ya acotado para leer sus campos. */
import assert from 'node:assert/strict';
import { esObjeto } from '../../src/comun/json.ts';

export function objeto(valor: unknown): Record<string, unknown> {
  assert.ok(esObjeto(valor));
  return valor;
}
