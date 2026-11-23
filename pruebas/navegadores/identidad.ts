/** Identidad sintética firmada; no consulta Access ni utiliza claves o cuentas de la instalación. */
import assert from 'node:assert/strict';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';

const EMISOR = 'https://navegadores-sintetico.cloudflareaccess.com';
const SEGUNDOS_POR_MS = 1000;
const DURACION_S = 3600;
const BITS_RSA = 2048;

export async function crearIdentidad() {
  const algoritmo = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const claves = await crypto.subtle.generateKey(
    { ...algoritmo, modulusLength: BITS_RSA, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', claves.publicKey);
  const claims = {
    iss: EMISOR,
    aud: ['panel'],
    type: 'app',
    sub: 'persona-sintetica',
    email: 'persona-sintetica@faro.invalid',
    iat: 1_900_000_000,
    exp: Math.floor(Date.now() / SEGUNDOS_POR_MS) + DURACION_S,
  };
  const entrada = `${Buffer.from('{"alg":"RS256","kid":"prueba"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const firma = await crypto.subtle.sign(algoritmo, claves.privateKey, new TextEncoder().encode(entrada));
  const jwt = `${entrada}.${Buffer.from(firma).toString('base64url')}`;
  const guardia = guardiaAdministrativaDelEntorno(
    { FARO_ADMIN_ACCESS_EQUIPO: 'navegadores-sintetico', FARO_ADMIN_ACCESS_AUD: 'panel' },
    async (url, opciones) => {
      assert.equal(String(url), `${EMISOR}/cdn-cgi/access/certs`);
      for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB)) {
        assert.equal(new Headers(opciones?.headers).get(nombre), valor);
      }
      return Response.json({ keys: [{ ...publica, kid: 'prueba' }] });
    },
  );
  return { jwt, guardia };
}
