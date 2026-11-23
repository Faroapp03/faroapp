import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quitarIdentificadores } from '../../src/seguridad/identificadores.ts';

/** Signos de atext (RFC 5322, §3.2.3); los puntos separan átomos en una parte local dot-atom. */
const SIGNOS = "!#$%&'*+-/=?^_`{|}~";

test('quita completo el correo mínimo con signo junto a la arroba', () => {
  assert.deepEqual(quitarIdentificadores('escribe a !@a.aa cada lunes'), {
    texto: 'escribe a [correo eliminado] cada lunes',
    eliminados: 1,
  });
});

test('quita los signos de la parte local al principio, en medio y junto a la arroba', () => {
  for (const signo of SIGNOS) {
    for (const local of [signo, `${signo}laia`, `la${signo}ia`, `laia${signo}`, `laia.${signo}.roca`]) {
      assert.deepEqual(
        quitarIdentificadores(`escribe a ${local}@exemple.cat cada lunes`),
        {
          texto: 'escribe a [correo eliminado] cada lunes',
          eliminados: 1,
        },
        local,
      );
    }
  }
});

test('conserva los acentos y puntos admitidos como parte del correo y no deja el nombre delante de la marca', () => {
  assert.deepEqual(
    quitarIdentificadores('Contacta amb núria.roca+feina@example.cat o jose\u0301.garci\u0301a!@example.es'),
    {
      texto: 'Contacta amb [correo eliminado] o [correo eliminado]',
      eliminados: 2,
    },
  );
});

test('conserva puntuación exterior que no pertenece a la parte local', () => {
  assert.deepEqual(quitarIdentificadores('(!@a.aa), "laia?@exemple.cat"; <nuria/@exemple.es>: fet'), {
    texto: '([correo eliminado]), "[correo eliminado]"; <[correo eliminado]>: fet',
    eliminados: 3,
  });
});

test('preserva texto de trabajo, signos sin correo y arroba sin dominio con punto', () => {
  for (const texto of [
    'preparo facturas !#$%& y pedidos',
    'precio 25 €/h, 3+2=5',
    'escribe a !@a cada lunes',
    'escribe a ! @a.aa cada lunes',
    '1/2 y 50%: no es un correo',
  ]) {
    assert.deepEqual(quitarIdentificadores(texto), { texto, eliminados: 0 });
  }
});

test('las llamadas independientes conservan conteos y las marcas son estables', () => {
  const entrada = '!@a.aa; laia?@exemple.cat';
  const esperado = { texto: '[correo eliminado]; [correo eliminado]', eliminados: 2 };
  assert.deepEqual(quitarIdentificadores(entrada), esperado);
  assert.deepEqual(quitarIdentificadores(entrada), esperado);
  assert.deepEqual(quitarIdentificadores(esperado.texto), { texto: esperado.texto, eliminados: 0 });
});
