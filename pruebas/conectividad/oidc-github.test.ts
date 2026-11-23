/** JWT/JWKS sintéticos y reloj fijo. Ninguna cuenta, token o petición real de GitHub. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { type ConfianzaOidcGitHub, crearVerificadorOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { MS_POR_MINUTO, MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { crearVerificadorAccess } from '../../src/seguridad/access.ts';

const RSA_BITS = 2048;
const LONGITUD_SHA = 40;
const MAX_TOKEN = 16_384;
const VIDA_S = 300;
const FRACCION_S = 0.5;
const INTENTOS_RECUPERADO = 3;
const MAX_ANTIGUEDAD_S = 600;
const CADUCIDAD_LEJANA_S = 3600;
const MARGEN_IAT_S = 30;
const AHORA = Date.parse('2026-10-16T12:00:00Z');
const EMISOR = 'https://token.actions.githubusercontent.com';
const JWKS = `${EMISOR}/.well-known/jwks`;
const SHA = 'a'.repeat(LONGITUD_SHA);
const WORKFLOW_SHA = 'b'.repeat(LONGITUD_SHA);
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: 'urn:ejecutor:recibos',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: WORKFLOW_SHA,
  sha: SHA,
};
function claims(ahora = AHORA): Record<string, unknown> {
  return {
    iss: EMISOR,
    aud: CONFIANZA.audiencia,
    repository_id: CONFIANZA.repositorioId,
    repository_owner_id: CONFIANZA.propietarioId,
    ref: CONFIANZA.ref,
    workflow_ref: CONFIANZA.workflowRef,
    workflow_sha: WORKFLOW_SHA,
    sha: SHA,
    run_id: '789',
    run_attempt: '2',
    jti: 'id-sintetico',
    iat: Math.floor(ahora / MS_POR_SEGUNDO),
    nbf: Math.floor(ahora / MS_POR_SEGUNDO),
    exp: Math.floor(ahora / MS_POR_SEGUNDO) + VIDA_S,
    workflow: 'Nombre visible no autoriza',
    actor: 'No-retener',
  };
}
async function fixture() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', par.publicKey);
  let descargas = 0;
  const firmar = async (contenido = claims(), cabecera: Record<string, unknown> = {}) => {
    const partes = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'sintetica', typ: 'JWT', ...cabecera })).toString('base64url')}.${Buffer.from(JSON.stringify(contenido)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(partes));
    return `${partes}.${Buffer.from(firma).toString('base64url')}`;
  };
  const pedir: typeof fetch = async (url, opciones) => {
    descargas++;
    assert.equal(String(url), JWKS);
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    assert.equal(opciones?.redirect, 'manual');
    assert.ok(opciones?.signal instanceof AbortSignal);
    return Response.json({ keys: [{ ...jwk, kid: 'sintetica' }] });
  };
  return { firmar, pedir, descargas: () => descargas };
}
const DOBLE = fixture();
test('normal propio devuelve solo identidad firmada inmutable; workflow_sha es distinto de sha de fuente', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  const identidad = await verificar(await doble.firmar());
  assert.deepEqual(identidad, {
    repositorioId: '123',
    propietarioId: '456',
    ref: CONFIANZA.ref,
    workflowRef: CONFIANZA.workflowRef,
    workflowSha: WORKFLOW_SHA,
    sha: SHA,
    runId: '789',
    runAttempt: '2',
    jti: 'id-sintetico',
    emitidoEn: AHORA / MS_POR_SEGUNDO,
    caducaEn: AHORA / MS_POR_SEGUNDO + VIDA_S,
  });
  assert.equal(Object.isFrozen(identidad), true);
});
test('configuración cerrada exacta se captura sin normalizar ni leer accesores', async () => {
  const doble = await DOBLE;
  const entrada = { ...CONFIANZA };
  const verificar = crearVerificadorOidcGitHub(entrada, doble.pedir, () => AHORA);
  entrada.sha = WORKFLOW_SHA;
  assert.ok(await verificar(await doble.firmar()));
  let accesos = 0;
  const getter = Object.defineProperty({ ...CONFIANZA }, 'audiencia', {
    get: () => {
      accesos++;
      return CONFIANZA.audiencia;
    },
    enumerable: true,
  });
  for (const configuracion of [
    getter,
    Object.create(CONFIANZA),
    { ...CONFIANZA, extra: true },
    { ...CONFIANZA, audiencia: ' espacio' },
    { ...CONFIANZA, repositorioId: '0123' },
    { ...CONFIANZA, propietarioId: '9007199254740992' },
    { ...CONFIANZA, ref: 'main' },
    { ...CONFIANZA, workflowRef: 'Nombre visible' },
    { ...CONFIANZA, sha: SHA.toUpperCase() },
    { ...CONFIANZA, workflowSha: undefined },
    { ...CONFIANZA, workflowSha: WORKFLOW_SHA.toUpperCase() },
  ]) {
    assert.throws(() => crearVerificadorOidcGitHub(configuracion, doble.pedir, () => AHORA), {
      message: 'Confianza OIDC de GitHub no válida',
    });
  }
  assert.equal(accesos, 0);
});
test('firma, algoritmo y formato se verifican antes de producir identidad; no acepta Access u OAuth', async () => {
  const doble = await DOBLE;
  const ajeno = await fixture();
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  const token = await doble.firmar();
  for (const valor of [
    '',
    'token-estatico',
    'Bearer token-oauth',
    'x'.repeat(MAX_TOKEN + 1),
    token.replace(/\.[^.]+\./, '.e30.'),
    await ajeno.firmar(),
    await doble.firmar(claims(), { alg: 'HS256' }),
    await doble.firmar({ ...claims(), iss: 'https://equipo.cloudflareaccess.com' }),
  ]) {
    assert.equal(await verificar(valor), null);
  }
});
test('anclas de confianza y campos de ejecución no se infieren de nombres visibles ni del cuerpo', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  for (const cambio of [
    { iss: `${EMISOR}/ajeno` },
    { aud: 'otra' },
    { aud: [CONFIANZA.audiencia] },
    { repository_id: '999' },
    { repository_id: 123 },
    { repository_owner_id: '999' },
    { ref: 'refs/heads/otra' },
    { workflow_ref: CONFIANZA.workflowRef.replace('actualizar.yml', 'ajeno.yml') },
    { workflow_ref: undefined },
    { sha: WORKFLOW_SHA },
    { sha: undefined },
    { workflow_sha: 'invalida' },
    { workflow_sha: undefined },
    { run_id: 789 },
    { run_id: '0' },
    { run_id: '9007199254740992' },
    { run_attempt: '02' },
    { run_attempt: 2 },
    { jti: '' },
    { jti: 'con espacio' },
  ]) {
    assert.equal(await verificar(await doble.firmar({ ...claims(), ...cambio })), null, JSON.stringify(cambio));
  }
});
test('GitHub identifica el job directo con ambas referencias fijadas o con las dos ausentes', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  const propio = { job_workflow_ref: CONFIANZA.workflowRef, job_workflow_sha: WORKFLOW_SHA };
  const normal = await verificar(await doble.firmar());
  assert.ok(normal);
  assert.deepEqual(await verificar(await doble.firmar({ ...claims(), ...propio })), normal);
  for (const cambio of [
    { job_workflow_ref: CONFIANZA.workflowRef },
    { job_workflow_sha: WORKFLOW_SHA },
    { ...propio, job_workflow_sha: SHA },
    { ...propio, job_workflow_ref: CONFIANZA.workflowRef.replace('actualizar.yml', 'otro.yml') },
    { ...propio, workflow_sha: SHA },
  ]) {
    assert.equal(await verificar(await doble.firmar({ ...claims(), ...cambio })), null);
  }
});
test('el job propio rechaza referencias de otro workflow, vacías o nulas', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  for (const campo of ['job_workflow_ref', 'job_workflow_sha']) {
    for (const valor of ['', null, 'equipo/otro/.github/workflows/reutilizable.yml@refs/heads/main']) {
      assert.equal(await verificar(await doble.firmar({ ...claims(), [campo]: valor })), null);
    }
  }
});
test('tiempos enteros seguros y frescura estricta; caducado/futuro/no finito fallan', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  const ahoraS = AHORA / MS_POR_SEGUNDO;
  for (const cambio of [
    { exp: ahoraS },
    { exp: '2000000000' },
    { exp: Number.MAX_VALUE },
    { iat: ahoraS + MARGEN_IAT_S + 1 },
    { iat: ahoraS - MAX_ANTIGUEDAD_S - 1 },
    { iat: ahoraS + FRACCION_S },
    { iat: undefined },
    { nbf: ahoraS + 1 },
    { nbf: '0' },
    { nbf: undefined },
    { nbf: -1 },
  ]) {
    assert.equal(await verificar(await doble.firmar({ ...claims(), ...cambio })), null, JSON.stringify(cambio));
  }
  assert.ok(await verificar(await doble.firmar({ ...claims(), iat: ahoraS + MARGEN_IAT_S, exp: ahoraS + VIDA_S })));
});
test('exp y frescura se vuelven a comprobar después de esperar JWKS', async () => {
  const doble = await DOBLE;
  let ahora = AHORA;
  const pedir: typeof fetch = async (url, opciones) => {
    const respuesta = await doble.pedir(url, opciones);
    ahora += VIDA_S * MS_POR_SEGUNDO;
    return respuesta;
  };
  assert.equal(await crearVerificadorOidcGitHub(CONFIANZA, pedir, () => ahora)(await doble.firmar()), null);
});
test('caché de GitHub conserva vuelo único, TTL, freno y recuperación sin claves vencidas', async () => {
  const doble = await fixture();
  let ahora = AHORA;
  let falla = false;
  let intentos = 0;
  const pedir: typeof fetch = async (url, opciones) => {
    intentos++;
    if (falla) {
      throw new Error('NO-FILTRAR');
    }
    return doble.pedir(url, opciones);
  };
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, pedir, () => ahora);
  const token = await doble.firmar(claims(ahora));
  assert.ok((await Promise.all([verificar(token), verificar(token), verificar(token)])).every(Boolean));
  assert.equal(intentos, 1);
  ahora += 60 * MS_POR_MINUTO;
  falla = true;
  assert.equal(await verificar(await doble.firmar(claims(ahora))), null);
  assert.equal(intentos, 2);
  ahora++;
  assert.equal(await verificar(await doble.firmar(claims(ahora))), null);
  assert.equal(intentos, 2);
  ahora += MS_POR_MINUTO;
  falla = false;
  assert.ok(await verificar(await doble.firmar(claims(ahora))));
  assert.equal(intentos, INTENTOS_RECUPERADO);
});
test('audiencias se aíslan; endpoints no salen de configuración ni jku recibido', async () => {
  const doble = await fixture();
  const primera = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  const segunda = crearVerificadorOidcGitHub({ ...CONFIANZA, audiencia: 'otra' }, doble.pedir, () => AHORA);
  assert.ok(await primera(await doble.firmar(claims(), { jku: 'https://ajeno.invalid/keys' })));
  assert.equal(await segunda(await doble.firmar()), null);
  assert.ok(await segunda(await doble.firmar({ ...claims(), aud: 'otra' })));
  assert.equal(doble.descargas(), 2);
});
test('fallos JWKS no registran tokens o errores externos; Access conserva aviso literal', async (t) => {
  const doble = await DOBLE;
  const avisos = t.mock.method(console, 'warn', () => {});
  const pedir: typeof fetch = async () => {
    throw new Error('NO-FILTRAR-ERROR');
  };
  assert.equal(await crearVerificadorOidcGitHub(CONFIANZA, pedir, () => AHORA)(await doble.firmar()), null);
  assert.equal(avisos.mock.callCount(), 0);
  const access = crearVerificadorAccess({ emisor: EMISOR, audiencia: CONFIANZA.audiencia }, pedir, () => AHORA);
  assert.equal(
    await access(new Request('https://local.test', { headers: { 'cf-access-jwt-assertion': await doble.firmar() } })),
    null,
  );
  assert.deepEqual(
    avisos.mock.calls.map((c) => c.arguments),
    [['No se ha podido completar la verificación de Cloudflare Access: la petición no pasa']],
  );
});

test('frescura local no presupone duración del JWT: exp lejano válido solo durante diez minutos desde iat', async () => {
  const doble = await DOBLE;
  let ahora = AHORA;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => ahora);
  const token = await doble.firmar({ ...claims(), exp: AHORA / MS_POR_SEGUNDO + CADUCIDAD_LEJANA_S });
  assert.ok(await verificar(token));
  ahora += (MAX_ANTIGUEDAD_S + 1) * MS_POR_SEGUNDO;
  assert.equal(await verificar(token), null);
});

test('workflow_ref mutable no sustituye el pin exacto del commit del workflow revisado', async () => {
  const doble = await DOBLE;
  const verificar = crearVerificadorOidcGitHub(CONFIANZA, doble.pedir, () => AHORA);
  assert.notEqual(CONFIANZA.workflowSha, CONFIANZA.sha);
  assert.ok(await verificar(await doble.firmar()));
  assert.equal(await verificar(await doble.firmar({ ...claims(), workflow_sha: SHA })), null);
});
