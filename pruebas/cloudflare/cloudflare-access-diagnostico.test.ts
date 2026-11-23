/** Diagnósticos locales sintéticos: nunca se registran JWT ni detalles del fallo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearVerificadorAccess } from '../../src/seguridad/access.ts';

const EMISOR = 'https://equipo-prueba.cloudflareaccess.com';
const AUDIENCIA = 'audiencia-sintetica';
const AHORA = Date.parse('2026-10-16T12:00:00Z');
const EXPIRACION = 2_000_000_000;
const AVISO = 'No se ha podido completar la verificación de Cloudflare Access: la petición no pasa';
const AVISO_INTERNO = 'Error interno al verificar Cloudflare Access: la petición no pasa';
const MARCA = 'detalle-sintetico-no-registrar';

function peticion(token: string): Request {
  return new Request('https://ejemplo.invalid/', { headers: { 'cf-access-jwt-assertion': token } });
}

/** La forma y claims superan el filtro inicial; el fallo simulado ocurre antes de verificar firma. */
function tokenSintetico(): string {
  const partes = [
    { alg: 'RS256', kid: 'clave-sintetica' },
    { iss: EMISOR, aud: AUDIENCIA, exp: EXPIRACION, dato: MARCA },
  ].map((parte) => Buffer.from(JSON.stringify(parte)).toString('base64url'));
  return `${partes.join('.')}.YQ`;
}

test('JWT malformado se rechaza sin descarga ni diagnóstico', async (t) => {
  const aviso = t.mock.method(console, 'warn', () => {});
  let consultas = 0;
  const pedir: typeof fetch = async () => {
    consultas++;
    throw new Error(MARCA);
  };
  const verificar = crearVerificadorAccess({ emisor: EMISOR, audiencia: AUDIENCIA }, pedir, () => AHORA);
  assert.equal(await verificar(peticion('token-malformado-sintetico')), null);
  assert.equal(consultas, 0);
  assert.equal(aviso.mock.callCount(), 0);
});

test('el servicio de claves caído avisa como fallo operativo y un error interno como error: ambos rechazan sin datos internos', async (t) => {
  const aviso = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  let consultas = 0;
  const pedir: typeof fetch = async () => {
    consultas++;
    throw new Error(MARCA);
  };
  const aplicacion = { emisor: EMISOR, audiencia: AUDIENCIA };
  const token = tokenSintetico();
  assert.equal(await crearVerificadorAccess(aplicacion, pedir, () => AHORA)(peticion(token)), null);
  assert.equal(consultas, 1);
  assert.equal(
    await crearVerificadorAccess(aplicacion, pedir, () => {
      throw new Error(MARCA);
    })(peticion(token)),
    null,
  );
  assert.equal(consultas, 1);
  assert.deepEqual(
    aviso.mock.calls.map((llamada) => llamada.arguments),
    [[AVISO]],
  );
  assert.deepEqual(
    error.mock.calls.map((llamada) => llamada.arguments),
    [[AVISO_INTERNO]],
  );
});
