import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContextoApi } from '../../src/api/contexto-api.ts';
import { RUTA_TOKEN } from '../../src/api/socios/metadatos.ts';
import { atenderToken } from '../../src/api/socios/oauth.ts';
import { REINO, type ServidorDeSocios } from '../../src/api/socios/servidor-socios.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cabecerasDeDesafio } from '../../src/seguridad/desafio-http.ts';

test('un 401 lleva el desafío Bearer si no se indica otro', () => {
  assert.deepEqual(cabecerasDeDesafio(ESTADO_HTTP.noAutenticado), { 'www-authenticate': 'Bearer' });
});

test('un 401 lleva el desafío indicado', () => {
  const desafio = 'Basic realm="faro-socios", charset="UTF-8"';
  assert.deepEqual(cabecerasDeDesafio(ESTADO_HTTP.noAutenticado, desafio), { 'www-authenticate': desafio });
});

test('ningún otro estado lleva desafío', () => {
  for (const estado of Object.values(ESTADO_HTTP).filter((estado) => estado !== ESTADO_HTTP.noAutenticado)) {
    assert.deepEqual(cabecerasDeDesafio(estado), {}, `${estado}`);
    assert.deepEqual(cabecerasDeDesafio(estado, 'Basic realm="faro-socios"'), {}, `${estado}`);
  }
});

test('la emisión de tokens de socios pide Basic en su 401 y no en sus otros errores', async () => {
  // Sin credenciales Basic el socio no se busca: el servidor solo necesita el límite por red.
  const servidor = { limites: { credencialesPorRed: () => true } } as unknown as ServidorDeSocios;
  const contexto = { ipDeCloudflare: false } as ContextoApi;
  const pedir = (tipo: string) =>
    atenderToken(
      contexto,
      servidor,
      new Request(`https://faro.invalid${RUTA_TOKEN}`, {
        method: 'POST',
        headers: { 'content-type': tipo },
        body: 'grant_type=client_credentials',
      }),
    );
  const sinCredenciales = await pedir('application/x-www-form-urlencoded');
  assert.equal(sinCredenciales.status, ESTADO_HTTP.noAutenticado);
  assert.equal(sinCredenciales.headers.get('www-authenticate'), `Basic realm="${REINO}", charset="UTF-8"`);
  const malFormada = await pedir('text/plain');
  assert.equal(malFormada.status, ESTADO_HTTP.solicitudIncorrecta);
  assert.equal(malFormada.headers.has('www-authenticate'), false);
});
