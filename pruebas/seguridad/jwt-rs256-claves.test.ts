/** JWT/JWK sintéticos: una clave ajena no inutiliza las RSA aptas; un kid ambiguo no autoriza. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { crearVerificadorJwtRs256 } from '../../src/seguridad/jwt-rs256.ts';

const AHORA = Date.parse('2026-10-18T12:00:00Z');
const SEGUNDO = 1000;
const VIDA_S = 300;
const RSA_BITS = 2048;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const APLICACION = {
  emisor: 'https://emisor.example',
  audiencia: 'sintetica',
  urlClaves: 'https://emisor.example/jwks',
};
const CLAIMS = { iss: APLICACION.emisor, aud: APLICACION.audiencia, exp: AHORA / SEGUNDO + VIDA_S };

async function fixture() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'propia' };
  const firmar = async (kid = 'propia') => {
    const partes = [JSON.stringify({ alg: 'RS256', kid }), JSON.stringify(CLAIMS)]
      .map((texto) => Buffer.from(texto).toString('base64url'))
      .join('.');
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    return `${partes}.${Buffer.from(firma).toString('base64url')}`;
  };
  const verificarCon = (keys: unknown[]) =>
    crearVerificadorJwtRs256(
      APLICACION,
      async () => Response.json({ keys }),
      () => AHORA,
    );
  return { publica, firmar, verificarCon };
}
const DOBLE = fixture();

test('JWKS mixto conserva exactamente los claims de la RSA válida aunque haya EC u otras claves no aptas', async () => {
  const { publica, firmar, verificarCon } = await DOBLE;
  const token = await firmar();
  const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const ajenas = [
    { ...(await crypto.subtle.exportKey('jwk', ec.publicKey)), kid: 'ec' },
    { ...publica, kid: 'cifrado', use: 'enc' },
    { ...publica, kid: 'algoritmo', alg: 'RS512' },
    { ...publica, kid: 'solo-firma', key_ops: ['sign'] },
    { ...publica, kid: 'operaciones-malformadas', key_ops: 'verify' },
    { ...publica, kid: 'operaciones-duplicadas', key_ops: ['verify', 'verify'] },
    { kty: 'RSA', kid: 'incompleta' },
    { ...publica, kid: 'modulo-malformado', n: '!!!!' },
  ];
  const originales = await verificarCon([publica])(token);
  assert.deepEqual(originales, CLAIMS);
  for (const ajena of ajenas) {
    assert.deepEqual(await verificarCon([ajena, publica])(token), originales);
    assert.deepEqual(await verificarCon([publica, ajena])(token), originales);
  }
});

test('una RSA pública sin restricciones opcionales conserva los claims exactos', async () => {
  const { publica, firmar, verificarCon } = await DOBLE;
  const minima = { kty: publica.kty, kid: publica.kid, n: publica.n, e: publica.e };
  assert.deepEqual(await verificarCon([minima])(await firmar()), CLAIMS);
});

test('los fallos inesperados de WebCrypto se propagan, sin confundirlos con JWK defectuoso', async (prueba) => {
  const { publica, firmar, verificarCon } = await DOBLE;
  const inesperado = new Error('fallo de programación sintético');
  prueba.mock.method(crypto.subtle, 'importKey', async () => {
    throw inesperado;
  });
  const token = await firmar();
  await assert.rejects(
    () => verificarCon([publica])(token),
    (error: unknown) => error === inesperado,
  );
});

test('una RSA no apta para verify nunca se usa aunque la firma matemática coincida', async () => {
  const { publica, firmar, verificarCon } = await DOBLE;
  for (const cambio of [{ use: 'enc' }, { alg: 'RS512' }, { key_ops: ['sign'] }, { key_ops: [] }]) {
    assert.equal(await verificarCon([{ ...publica, ...cambio }])(await firmar()), null);
  }
});

test('kid duplicado queda cerrado sin depender del orden y otras claves inequívocas siguen operativas', async () => {
  const { publica, firmar, verificarCon } = await DOBLE;
  const otra = { ...publica, kid: 'otra' };
  for (const keys of [
    [publica, { ...publica }, otra],
    [otra, { ...publica }, publica],
  ]) {
    const verificar = verificarCon(keys);
    assert.equal(await verificar(await firmar()), null);
    assert.deepEqual(await verificar(await firmar('otra')), CLAIMS);
  }
});
