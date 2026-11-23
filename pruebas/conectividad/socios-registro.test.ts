/** Credenciales sintéticas: huellas completas de las dos claves vigentes y secreto aleatorio de 256 bits. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autenticarSocio, huellaDelSecreto, type Socio, secretoNuevo } from '../../src/api/socios/registro.ts';

const SECRETO = 'secreto sintético primero de pruebas';
const NUEVO = 'secreto sintético segundo de pruebas';
const TAM_BYTES = 32,
  TAM_BASE64URL = 43,
  TAM_HUELLA = 64;
const socio: Socio = {
  id: 'inst-11111111-1111-4111-8111-111111111111',
  huellas: [huellaDelSecreto(SECRETO), huellaDelSecreto(NUEVO)],
  consultasPorHora: 1000,
};
test('autenticación conserva institución y huella completa exacta de cualquiera de las dos claves', () => {
  for (const secreto of [SECRETO, NUEVO]) {
    assert.deepEqual(autenticarSocio(socio, secreto), { socio, credencial: huellaDelSecreto(secreto) });
    assert.equal(autenticarSocio(socio, secreto)?.credencial.length, TAM_HUELLA);
  }
  assert.equal(autenticarSocio(null, SECRETO), null);
  assert.equal(autenticarSocio(socio, 'equivocado'), null);
  assert(!JSON.stringify(socio).includes(SECRETO));
});
test('una clave retirada deja de autenticar aunque otra siga vigente y no se acepta solo su prefijo', () => {
  const revalidada = { ...socio, huellas: [huellaDelSecreto(NUEVO)] };
  assert.equal(autenticarSocio(revalidada, SECRETO), null);
  assert.deepEqual(autenticarSocio(revalidada, NUEVO), { socio: revalidada, credencial: huellaDelSecreto(NUEVO) });
  assert.equal(autenticarSocio({ ...socio, huellas: [] }, SECRETO), null);
});
test('secretoNuevo conserva 256 bits codificados canónicos y la huella solo contiene hexadecimal completo', () => {
  const secreto = secretoNuevo();
  assert.match(secreto, /^[A-Za-z0-9_-]+$/);
  assert.equal(secreto.length, TAM_BASE64URL);
  assert.equal(Buffer.from(secreto, 'base64url').byteLength, TAM_BYTES);
  assert.equal(Buffer.from(secreto, 'base64url').toString('base64url'), secreto);
  assert.match(huellaDelSecreto(secreto), /^[0-9a-f]{64}$/);
});
