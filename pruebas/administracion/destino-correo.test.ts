import assert from 'node:assert/strict';
import test from 'node:test';
import { DestinoCorreoInvalido, leerDestinoCorreo, MAX_CORREO } from '../../src/administracion/destino-correo.ts';

test('una dirección válida se guarda con el dominio en minúsculas y la parte local tal cual', () => {
  assert.equal(leerDestinoCorreo('persona@example.org'), 'persona@example.org');
  assert.equal(leerDestinoCorreo('Persona.Avisos+faro@Example.ORG'), 'Persona.Avisos+faro@example.org');
  assert.equal(leerDestinoCorreo('persona@correo.example.org'), 'persona@correo.example.org');
});

test('el máximo es de 254 caracteres, contados también después de normalizar', () => {
  const dominio = '@example.org';
  const justa = `${'p'.repeat(MAX_CORREO - dominio.length)}${dominio}`;
  assert.equal(justa.length, MAX_CORREO);
  assert.equal(leerDestinoCorreo(justa), justa);
  assert.throws(() => leerDestinoCorreo(`p${justa}`), DestinoCorreoInvalido);
  // «İ» pasa a dos caracteres en minúsculas: la dirección guardada superaría el máximo.
  const alargada = `${'p'.repeat(MAX_CORREO - dominio.length - 1)}@İexample.org`;
  assert.equal(alargada.length, MAX_CORREO);
  assert.throws(() => leerDestinoCorreo(alargada), DestinoCorreoInvalido);
});

test('se rechazan las direcciones mal formadas', () => {
  for (const valor of [
    '',
    'persona',
    '@example.org',
    'persona@',
    'persona@@example.org',
    'persona@otra@example.org',
    'persona@example',
    'persona@.org',
    'persona@example.',
    'persona@example..org',
  ]) {
    assert.throws(() => leerDestinoCorreo(valor), DestinoCorreoInvalido, valor);
  }
  for (const valor of [null, undefined, 1, ['persona@example.org'], { correo: 'persona@example.org' }]) {
    assert.throws(() => leerDestinoCorreo(valor), DestinoCorreoInvalido);
  }
});

test('ningún intento de colar cabeceras o más destinatarios pasa', () => {
  for (const valor of [
    'persona@example.org\r\nBcc: otra@example.org',
    'persona@example.org\nBcc: otra@example.org',
    'persona@example.org\rBcc: otra@example.org',
    'persona@example.org\u0085Bcc:otra@example.org',
    'persona@example.org Bcc:otra@example.org',
    'persona@example.org\u0000',
    'persona@example.org\t',
    ' persona@example.org',
    'persona @example.org',
    'persona@example.org,otra@example.org',
    'persona@example.org;otra@example.org',
    'Persona <persona@example.org>',
    '<persona@example.org>',
    'persona@example.org>',
  ]) {
    assert.throws(() => leerDestinoCorreo(valor), DestinoCorreoInvalido, JSON.stringify(valor));
  }
});

test('el rechazo no repite la dirección recibida', () => {
  try {
    leerDestinoCorreo('persona@example.org\r\nBcc: otra@example.org');
    assert.fail('debía rechazarse');
  } catch (error) {
    assert.ok(error instanceof DestinoCorreoInvalido);
    assert.doesNotMatch(`${error.message} ${error.stack ?? ''}`, /persona|otra|example/);
  }
});
