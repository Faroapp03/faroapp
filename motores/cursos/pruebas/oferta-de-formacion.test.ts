// Contrato autónomo de la oferta del despliegue: valores, orden, inmutabilidad y las seis descripciones posibles.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  descripcionDeLaOferta,
  MODOS_FORMACION_ABIERTA,
  OFERTA_POR_DEFECTO,
  type OfertaDeFormacion,
} from '../src/oferta-de-formacion.ts';

test('los modos conservan sus valores y orden y la oferta predeterminada es pública sin pago', () => {
  assert.deepEqual(MODOS_FORMACION_ABIERTA, ['no', 'publica', 'gratis']);
  assert.deepEqual(OFERTA_POR_DEFECTO, { formacionAbierta: 'publica', citilabDePago: false });
});

test('los valores compartidos están congelados y rechazan modificaciones en ejecución', () => {
  assert.equal(Object.isFrozen(MODOS_FORMACION_ABIERTA), true);
  assert.equal(Object.isFrozen(OFERTA_POR_DEFECTO), true);
  assert.equal(Reflect.set(MODOS_FORMACION_ABIERTA, '0', 'gratis'), false);
  assert.equal(Reflect.set(OFERTA_POR_DEFECTO, 'citilabDePago', true), false);
  assert.deepEqual(OFERTA_POR_DEFECTO, { formacionAbierta: 'publica', citilabDePago: false });
});

for (const [modo, descripcion] of [
  ['no', 'apagada'],
  ['publica', 'solo pública'],
  ['gratis', 'pública y gratuita de otras entidades'],
] as const) {
  for (const [pago, deCitilab] of [
    [false, 'sin'],
    [true, 'con'],
  ] as const) {
    test(`la descripción del modo ${modo} ${deCitilab} pago conserva el texto y la oferta recibida`, () => {
      const oferta: OfertaDeFormacion = { formacionAbierta: modo, citilabDePago: pago };
      const antes = { ...oferta };
      assert.equal(
        descripcionDeLaOferta(oferta),
        `formación abierta ${descripcion} · Citilab ${deCitilab} cursos de pago`,
      );
      assert.deepEqual(oferta, antes);
    });
  }
}
