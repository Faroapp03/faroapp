// Confirmación y nombre con entradas propias, ausentes y heredadas; sin informe ni API.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_OCUPACION_PERSONA as MAXIMO_DEL_PROTOCOLO } from '../../src/comun/protocolo-web.ts';
import { EntradaInvalida } from '../../src/dominio/errores.ts';
import {
  type CodigosOcupacion,
  MAX_OCUPACION_PERSONA,
  nombreDeLaOcupacion,
  resolverOcupacion,
} from '../../src/dominio/ocupacion-confirmada.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { datosMinimos, ocupacion } from '../fixtures/datos-referencias-grupos.ts';

function catalogo(): Datos {
  const datos = datosMinimos();
  datos.clasificaciones.isco08_es = { '1111': 'Primer grupo', '2222': 'Segundo grupo', '111': 'Subgrupo' };
  datos.esco.ocupaciones = { esco: ocupacion('1111', '  Operador / Operadora / Operador  ') };
  return datos;
}

test('confirma el grupo solo, la ocupación ESCO sola o ambos si coinciden, con segundo grupo opcional', () => {
  const datos = catalogo();
  assert.deepEqual(resolverOcupacion(datos, { isco08: '1111' }), { esco: null, isco08: '1111', secundario: null });
  assert.deepEqual(resolverOcupacion(datos, { ocupacionEsco: 'esco' }), {
    esco: 'esco',
    isco08: '1111',
    secundario: null,
  });
  assert.deepEqual(resolverOcupacion(datos, { ocupacionEsco: 'esco', isco08: '1111', isco08Secundario: '2222' }), {
    esco: 'esco',
    isco08: '1111',
    secundario: '2222',
  });
});

const RECHAZADAS: readonly CodigosOcupacion[] = [
  {},
  { isco08: '' },
  { isco08: '111' },
  { isco08: '11111' },
  { isco08: '9999' },
  { isco08: 'constructor' },
  { ocupacionEsco: '' },
  { ocupacionEsco: 'ausente' },
  { ocupacionEsco: 'constructor' },
  { ocupacionEsco: 'esco', isco08: '2222' },
  { isco08: '1111', isco08Secundario: '1111' },
  { isco08: '1111', isco08Secundario: '' },
  { isco08: '1111', isco08Secundario: 'constructor' },
];

for (const codigos of RECHAZADAS) {
  test(`rechaza como entrada inválida los códigos ${JSON.stringify(codigos)}`, () => {
    assert.throws(() => resolverOcupacion(catalogo(), codigos), EntradaInvalida);
  });
}

test('el nombre quita formas repetidas de ESCO y conserva el título del grupo sin ESCO', () => {
  const datos = catalogo();
  assert.equal(nombreDeLaOcupacion(datos, { esco: 'esco', isco08: '1111' }), 'Operador / Operadora');
  assert.equal(nombreDeLaOcupacion(datos, { esco: null, isco08: '1111' }), 'Primer grupo');
});

test('un nombre con código ausente o heredado lanza EntradaInvalida con el código', () => {
  const datos = catalogo();
  for (const codigo of ['ausente', 'constructor', '__proto__', 'toString']) {
    for (const codigos of [
      { esco: null, isco08: codigo },
      { esco: codigo, isco08: '1111' },
    ]) {
      assert.throws(
        () => nombreDeLaOcupacion(datos, codigos),
        (error: unknown) => error instanceof EntradaInvalida && error.message === `No está en el catálogo: ${codigo}`,
      );
    }
  }
});

test('la confirmación y el nombre conservan las entradas y el límite compartido del protocolo', () => {
  const datos = catalogo();
  const antes = structuredClone(datos);
  const codigos = { ocupacionEsco: 'esco', isco08: '1111' };
  nombreDeLaOcupacion(datos, resolverOcupacion(datos, codigos));
  assert.deepEqual(codigos, { ocupacionEsco: 'esco', isco08: '1111' });
  assert.deepEqual(datos, antes);
  assert.equal(MAX_OCUPACION_PERSONA, MAXIMO_DEL_PROTOCOLO);
});
