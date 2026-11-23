// JWT con claves desechables, Web Crypto real y reloj fijo; sin proveedores.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autenticarSocio, CARACTERES_DE_LA_CREDENCIAL, huellaDelSecreto } from '../../src/api/socios/registro.ts';
import {
  crearEmisorDeTokens,
  type Destino,
  type Reclamaciones,
  VIDA_DEL_TOKEN_S,
} from '../../src/api/socios/token-de-acceso.ts';
import { aBase64Url, deBase64Url } from '../../src/comun/base64url.js';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { subclaveDe, type UsoDeFirma } from '../../src/seguridad/firma.ts';

const SECRETO_FIRMA = 'firma sintética de prueba de32bytes o más';
const ANTERIOR = 'firma anterior sintética de32bytes o más';
const SECRETO_SOCIO = 'credencial sintética de socio';
const AHORA_S = 10_000;
const MARGEN_S = 60;
const MAX_TOKEN = 2048;
/** Letras base64url de un HMAC-SHA-256 sin relleno. */
const LETRAS_FIRMA = 43;
const destino: Destino = {
  emisor: 'https://socios.test/api/socios/v1',
  audiencia: 'https://socios.test/api/socios/v1/consultas',
};
const socio = { id: 'socio-prueba', huellas: [huellaDelSecreto(SECRETO_SOCIO)], consultasPorHora: 1 };
const autenticado = autenticarSocio(socio, SECRETO_SOCIO);
assert.ok(autenticado);
const base = { alg: 'HS256', typ: 'at+jwt' };
function parte(datos: unknown): string {
  return aBase64Url(new TextEncoder().encode(JSON.stringify(datos)));
}
async function firmado(cuerpo: unknown, cambios: object = {}, uso: UsoDeFirma = 'tokens-de-socios'): Promise<string> {
  const { kid, clave } = await subclaveDe(SECRETO_FIRMA, uso);
  const mensaje = `${parte({ ...base, kid, ...cambios })}.${parte(cuerpo)}`;
  return `${mensaje}.${aBase64Url(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(mensaje)))}`;
}
async function ejemplo() {
  assert.ok(autenticado);
  const emisor = await crearEmisorDeTokens(SECRETO_FIRMA, undefined, () => AHORA_S * MS_POR_SEGUNDO);
  return { emisor, ...(await emisor.emitir(autenticado, destino)) };
}

test('emisión conserva las reclamaciones, cabecera, firma y retorno completos', async () => {
  const { emisor, token, reclamaciones } = await ejemplo();
  assert.deepEqual(reclamaciones, {
    iss: destino.emisor,
    sub: 'socio-prueba',
    aud: destino.audiencia,
    client_id: 'socio-prueba',
    iat: AHORA_S,
    exp: AHORA_S + VIDA_DEL_TOKEN_S,
    jti: reclamaciones.jti,
    scope: 'faro.lectura',
    credencial: huellaDelSecreto(SECRETO_SOCIO).slice(0, CARACTERES_DE_LA_CREDENCIAL),
  });
  assert.match(reclamaciones.jti, /^[A-Za-z0-9_-]{22}$/);
  const header = deBase64Url(token.split('.')[0] ?? '');
  assert.ok(header);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(header)), {
    ...base,
    kid: (await subclaveDe(SECRETO_FIRMA, 'tokens-de-socios')).kid,
  });
  assert.equal(token, await firmado(reclamaciones));
  assert.deepEqual(await emisor.comprobar(token, destino), reclamaciones);
});

test('reloj exacto de expiración y margen de iat no se desplazan', async () => {
  const { token, reclamaciones } = await ejemplo();
  const comprobarEn = async (segundos: number) =>
    (await crearEmisorDeTokens(SECRETO_FIRMA, undefined, () => segundos * MS_POR_SEGUNDO)).comprobar(token, destino);
  assert.deepEqual(await comprobarEn(reclamaciones.exp - 1), reclamaciones);
  assert.equal(await comprobarEn(reclamaciones.exp), null);
  assert.deepEqual(await comprobarEn(AHORA_S - MARGEN_S), reclamaciones);
  assert.equal(await comprobarEn(AHORA_S - MARGEN_S - 1), null);
});

test('rotación acepta anterior, emite actual y quitar anterior invalida su token', async () => {
  assert.ok(autenticado);
  const viejo = await crearEmisorDeTokens(ANTERIOR, undefined, () => AHORA_S * MS_POR_SEGUNDO);
  const { token, reclamaciones } = await viejo.emitir(autenticado, destino);
  const rotado = await crearEmisorDeTokens(SECRETO_FIRMA, ANTERIOR, () => AHORA_S * MS_POR_SEGUNDO);
  assert.deepEqual(await rotado.comprobar(token, destino), reclamaciones);
  const nuevo = await rotado.emitir(autenticado, destino);
  assert.deepEqual(
    await (await crearEmisorDeTokens(SECRETO_FIRMA, undefined, () => AHORA_S * MS_POR_SEGUNDO)).comprobar(
      nuevo.token,
      destino,
    ),
    nuevo.reclamaciones,
  );
  assert.equal(
    await (await crearEmisorDeTokens(SECRETO_FIRMA, undefined, () => AHORA_S * MS_POR_SEGUNDO)).comprobar(
      token,
      destino,
    ),
    null,
  );
});

test('las claves de estimaciones no firman tokens aunque compartan kid', async () => {
  const { emisor, reclamaciones } = await ejemplo();
  assert.equal(await emisor.comprobar(await firmado(reclamaciones, {}, 'estimaciones'), destino), null);
});

test('tokens mal formados, firma distinta y cabeceras no admitidas devuelven null', async () => {
  const { emisor, reclamaciones, token } = await ejemplo();
  const casos = [
    '',
    'a.b',
    'a.b.c.d',
    'x'.repeat(MAX_TOKEN + 1),
    `${token.slice(0, token.lastIndexOf('.') + 1)}${'A'.repeat(LETRAS_FIRMA)}`,
  ];
  for (const cambios of [{ alg: 'none' }, { typ: 'JWT' }, { kid: 'abcdefgh' }, { extra: true }]) {
    casos.push(await firmado(reclamaciones, cambios));
  }
  for (const roto of casos) {
    assert.equal(await emisor.comprobar(roto, destino), null);
  }
  assert.deepEqual(
    await emisor.comprobar(await firmado(reclamaciones, { typ: 'application/at+jwt' }), destino),
    reclamaciones,
  );
});

test('reclamaciones firmadas fuera del contrato no se aceptan', async () => {
  const { emisor, reclamaciones } = await ejemplo();
  const { credencial: _omitida, ...sinCredencial } = reclamaciones;
  const casos: unknown[] = [sinCredencial, null, [], { ...reclamaciones, extra: true }];
  for (const cambio of [
    { iss: 'otro' },
    { aud: 'otro' },
    { sub: 'otro' },
    { exp: reclamaciones.exp + 1 },
    { iat: -1 },
    { jti: 'corto' },
    { credencial: 'invalida' },
  ]) {
    casos.push({ ...reclamaciones, ...cambio });
  }
  for (const cuerpo of casos) {
    assert.equal(await emisor.comprobar(await firmado(cuerpo), destino), null);
  }
  assert.equal(await emisor.comprobar(await firmado(reclamaciones), { ...destino, audiencia: 'otro' }), null);
  const sinAmbito: Reclamaciones = { ...reclamaciones, scope: '' };
  assert.equal(await emisor.comprobar(await firmado(sinAmbito), destino), null);
});

test('solo lectura y su audiencia operativa permiten emitir y validar incluso con firma auténtica', async () => {
  assert.ok(autenticado);
  const { emisor, reclamaciones } = await ejemplo();
  const retirados = [
    { scope: 'faro.ia.mcp', aud: 'https://socios.test/mcp' },
    { scope: 'faro.ia.a2a', aud: 'https://socios.test/a2a' },
    { scope: 'faro.ia.api', aud: 'https://socios.test/api/socios/v1/operaciones' },
    { scope: 'faro.lectura faro.ia.mcp', aud: destino.audiencia },
    { scope: 'desconocido', aud: destino.audiencia },
    { scope: '', aud: destino.audiencia },
    { scope: 'faro.lectura', aud: 'https://socios.test/mcp' },
    { scope: 'faro.lectura', aud: 'https://ajeno.test/api/socios/v1/consultas' },
    { scope: 'faro.lectura', aud: `${destino.audiencia}/otra` },
  ];
  for (const { scope, aud } of retirados) {
    const objetivo = { ...destino, audiencia: aud };
    await assert.rejects(emisor.emitir(autenticado, objetivo, scope));
    assert.equal(await emisor.comprobar(await firmado({ ...reclamaciones, scope, aud }), objetivo), null);
  }
  const noCanonico = { ...destino, emisor: `${destino.emisor}/` };
  await assert.rejects(emisor.emitir(autenticado, noCanonico));
  assert.equal(await emisor.comprobar(await firmado({ ...reclamaciones, iss: noCanonico.emisor }), noCanonico), null);
});

test('un objeto interno con permisos históricos tampoco autoriza emitir tokens retirados', async () => {
  assert.ok(autenticado);
  const emisor = await crearEmisorDeTokens(SECRETO_FIRMA, undefined, () => AHORA_S * MS_POR_SEGUNDO);
  const legado = {
    ...autenticado,
    socio: { ...autenticado.socio, ambitosIa: ['faro.ia.mcp', 'faro.ia.a2a', 'faro.ia.api'] },
  };
  for (const [scope, ruta] of [
    ['faro.ia.mcp', '/mcp'],
    ['faro.ia.a2a', '/a2a'],
    ['faro.ia.api', '/api/socios/v1/operaciones'],
  ]) {
    await assert.rejects(emisor.emitir(legado, { ...destino, audiencia: `https://socios.test${ruta}` }, scope));
  }
});
