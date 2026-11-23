import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  quitarCuentasAnunciadas,
  quitarIdentificadores,
  quitarNumerosDeAfiliacion,
} from '../../src/seguridad/identificadores.ts';

test('quita correos Unicode completos y correos dichos en castellano y catalán', () => {
  assert.deepEqual(
    quitarIdentificadores(
      'josé.garcía@gmail.com; núria punto gil arroba gmail punto com; laia [dot] roca [at] correu punt cat',
    ),
    {
      texto: '[correo eliminado]; [correo eliminado]; [correo eliminado]',
      eliminados: 3,
    },
  );
});

test('quita cuentas y documentos sin consumir la puntuación ni el resto del relato', () => {
  assert.deepEqual(
    quitarIdentificadores(
      'ES58 1234 5678 0101 2345 6789; FR76 3000 6000 0112 3456 7890 189; X-1234567-A; 12 345 678 Z.',
    ),
    {
      texto: '[cuenta eliminada]; [cuenta eliminada]; [documento eliminado]; [documento eliminado].',
      eliminados: 4,
    },
  );
});

test('los teléfonos se quitan antes de que dos seguidos se lean como una tarjeta', () => {
  assert.deepEqual(quitarIdentificadores('964990873 0034 859-009-000'), {
    texto: '[teléfono eliminado] [teléfono eliminado]',
    eliminados: 2,
  });
  assert.deepEqual(quitarIdentificadores('sis dos tres quatre cinc sis set'), {
    texto: '[teléfono eliminado]',
    eliminados: 1,
  });
});

test('quita tarjetas con Luhn y código de seguridad, incluida American Express', () => {
  assert.deepEqual(quitarIdentificadores('4111 1111 1111 1111 123; 3782 822463 10005 1234'), {
    texto: '[tarjeta eliminada]; [tarjeta eliminada]',
    eliminados: 2,
  });
  assert.deepEqual(quitarIdentificadores('4111.1111.1111.1111'), { texto: '[tarjeta eliminada]', eliminados: 1 });
});

test('encuentra tarjeta dentro de una serie conservando los grupos ajenos', () => {
  assert.deepEqual(quitarIdentificadores('12 4111 1111 1111 1111'), {
    texto: '12 [tarjeta eliminada]',
    eliminados: 1,
  });
});

test('preserva tarjeta de control incorrecto, versiones, dominios sin ruta y arroba como unidad', () => {
  const texto = '4111111111111112; 10.0.19045.3803; www.idealista.com; cobro por arroba de aceituna';
  assert.deepEqual(quitarIdentificadores(texto), { texto, eliminados: 0 });
  assert.deepEqual(quitarIdentificadores('https://exemple.cat/perfil/laia; @usuari'), {
    texto: '[enlace eliminado]; [usuario eliminado]',
    eliminados: 2,
  });
});

test('las cuentas anunciadas cuentan tramos y preservan cantidades por debajo del umbral', () => {
  const texto = 'Reviso el IBAN y cuadro 1500 movimientos.';
  assert.deepEqual(quitarCuentasAnunciadas(texto), { texto, eliminados: 0 });
  assert.deepEqual(quitarCuentasAnunciadas('IBAN ES58 1234, luego 5678-0101 y 2345-6789.'), {
    texto: 'IBAN [cifras eliminadas], luego [cifras eliminadas] y [cifras eliminadas].',
    eliminados: 1,
  });
  assert.deepEqual(quitarCuentasAnunciadas('número de compte 1111, luego 2222 y 3333-4444.'), {
    texto: 'número de compte [cifras eliminadas], luego [cifras eliminadas] y [cifras eliminadas].',
    eliminados: 1,
  });
});

test('la afiliación exige control y provincia salvo cuando está anunciada', () => {
  assert.deepEqual(quitarNumerosDeAfiliacion('28/12345678/40; NAF 28/12345678/41; Seguretat Social 1234567890.'), {
    texto:
      '[número de la Seguridad Social eliminado]; NAF [número de la Seguridad Social eliminado]; Seguretat Social [número de la Seguridad Social eliminado].',
    eliminados: 3,
  });
  const texto = '28/12345678/41; 00/12345678/03; tramito 150 altas en la Seguridad Social.';
  assert.deepEqual(quitarNumerosDeAfiliacion(texto), { texto, eliminados: 0 });
});

test('las sustituciones repetidas no heredan cursores y las marcas quedan intactas', () => {
  const texto = '612 345 678; laia@example.cat';
  const esperado = { texto: '[teléfono eliminado]; [correo eliminado]', eliminados: 2 };
  assert.deepEqual(quitarIdentificadores(texto), esperado);
  assert.deepEqual(quitarIdentificadores(texto), esperado);
  assert.deepEqual(quitarIdentificadores(esperado.texto), { texto: esperado.texto, eliminados: 0 });
});
