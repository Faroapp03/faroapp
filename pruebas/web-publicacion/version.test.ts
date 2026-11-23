// La versión servida y la de distribución deben identificar la misma entrega.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { VERSION_FARO } from '../../src/comun/version.ts';

test('el producto y sus metadatos de distribución publican la misma versión', () => {
  for (const archivo of ['package.json', 'package-lock.json']) {
    const paquete: unknown = JSON.parse(readFileSync(new URL(`../../${archivo}`, import.meta.url), 'utf8'));
    assert.ok(typeof paquete === 'object' && paquete !== null && 'version' in paquete);
    assert.equal(VERSION_FARO, paquete.version, archivo);
  }
});
