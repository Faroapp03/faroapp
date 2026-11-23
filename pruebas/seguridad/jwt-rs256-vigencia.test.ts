/** Un JWT no puede ganar vigencia mientras espera las claves públicas; firma real y reloj inyectado, sin red. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearVerificadorAccess } from '../../src/seguridad/access.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const VIDA_S = 10;
const RSA_BITS = 2048;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const EMISOR = 'https://equipo-prueba.cloudflareaccess.com';
const AUDIENCIA = 'vigencia-sintetica';
test('Access deniega un JWT que caduca mientras espera JWKS aunque su firma sea correcta', async () => {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const claims = { iss: EMISOR, aud: [AUDIENCIA], exp: AHORA / MS_POR_SEGUNDO + VIDA_S };
  const entrada = `${Buffer.from('{"alg":"RS256","kid":"sintetica"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(entrada));
  const peticion = new Request('https://local.test/api/salud', {
    headers: { 'cf-access-jwt-assertion': `${entrada}.${Buffer.from(firma).toString('base64url')}` },
  });
  let ahora = AHORA;
  let descargas = 0;
  const pedir: typeof fetch = async (url, opciones) => {
    assert.equal(String(url), `${EMISOR}/cdn-cgi/access/certs`);
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    descargas++;
    ahora += VIDA_S * MS_POR_SEGUNDO;
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };
  const verificar = crearVerificadorAccess({ emisor: EMISOR, audiencia: AUDIENCIA }, pedir, () => ahora);
  assert.equal(await verificar(peticion), null);
  assert.equal(descargas, 1);
});
