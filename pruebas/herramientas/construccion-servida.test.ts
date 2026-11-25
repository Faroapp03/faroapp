/** Identidad servida con JWT/JWKS reales locales; no red, construcción, SQL ni activación. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { PLAZO_PRUEBA_MANIFIESTO_MS } from '../../src/administracion/plazos-mantenimiento.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import {
  crearLectorConstruccionServida,
  RUTA_CONSTRUCCION_SERVIDA,
} from '../../src/plataforma/cloudflare/construccion-servida.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import workerOficial from '../../src/plataforma/cloudflare/worker-oficial.ts';

const ORIGEN = 'https://construccion.example';
const URL = `${ORIGEN}${RUTA_CONSTRUCCION_SERVIDA}`;
const PRUEBA = `${URL}?prueba=manifiesto`;
const MANIFIESTO = `${ORIGEN}/firmas/manifiesto.json`;
const MAX_MANIFIESTO_BYTES = 8_388_608;
const MS_SEGUNDO = 1000;
const AHORA = Math.floor(Date.now() / MS_SEGUNDO) * MS_SEGUNDO;
const VIDA_JWT = 300;
const RSA_BITS = 2048;
const TAM_SHA = 40;
const MAX_TOKEN = 16_384;
const PLAZO_MS = 5000;
const CONFIGURACIONES_DISTINTAS = 3;
const OK = 200;
const INVALIDO = 400;
const SIN_AUTENTICAR = 401;
const PROHIBIDO = 403;
const REDIRECCION = 302;
const AUSENTE = 404;
const METODO = 405;
const INDISPONIBLE = 503;
const PLAZO = 504;
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-0000-0000-222222222222';
const PRIVADO = 'secreto-sintetico-nunca-en-respuesta-mas-de-32-caracteres';
const CONFIANZA: ConfianzaOidcGitHub = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(TAM_SHA),
  sha: 'b'.repeat(TAM_SHA),
};
const CONFIGURACION = {
  version: 1,
  destino: { propietario: 'equipo', repositorio: 'producto', workflow: 'actualizar.yml', ref: 'main' },
  confianza: CONFIANZA,
};
const VARIABLES = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: ORIGEN,
  FARO_SECRETO_FIRMA: PRIVADO,
  FARO_ACTUALIZACION_GITHUB: JSON.stringify(CONFIGURACION),
  FARO_ACTUALIZACION_GITHUB_TOKEN: PRIVADO,
};
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
function claims() {
  return {
    iss: 'https://token.actions.githubusercontent.com',
    aud: CONFIANZA.audiencia,
    repository_id: CONFIANZA.repositorioId,
    repository_owner_id: CONFIANZA.propietarioId,
    ref: CONFIANZA.ref,
    workflow_ref: CONFIANZA.workflowRef,
    workflow_sha: CONFIANZA.workflowSha,
    sha: CONFIANZA.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'jti-sintetico',
    iat: AHORA / MS_SEGUNDO,
    nbf: AHORA / MS_SEGUNDO,
    exp: AHORA / MS_SEGUNDO + VIDA_JWT,
  };
}
async function claves() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  return {
    jwk,
    async firmar(delta: Record<string, unknown> = {}) {
      const entrada = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid })).toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims(), ...delta })).toString('base64url')}`;
      const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(entrada));
      return `${entrada}.${Buffer.from(firma).toString('base64url')}`;
    },
  };
}
const CRIPTO = claves();
async function fixture() {
  const cripto = await CRIPTO;
  const reloj = { ahora: AHORA };
  const contador = { jwks: 0 };
  const pedir: typeof fetch = async (url, init) => {
    contador.jwks++;
    assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks');
    assert.equal(new Headers(init?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    assert.equal(init?.redirect, 'manual');
    return Response.json({ keys: [cripto.jwk] });
  };
  return {
    reloj,
    contador,
    pedir,
    firmar: cripto.firmar,
    crear: (transporte = pedir) => crearLectorConstruccionServida({ pedir: transporte, ahora: () => reloj.ahora }),
  };
}
function peticion(token = '', url = URL, cambios: RequestInit = {}) {
  return new Request(url, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': IDENTIDAD_WEB['User-Agent'] },
    ...cambios,
  });
}
async function comprobarError(respuesta: Response, estado: number) {
  assert.equal(respuesta.status, estado);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  const texto = await respuesta.text();
  assert.ok(!texto.includes(PRIVADO));
  assert.ok(!texto.includes(VERSION_A));
  assert.deepEqual(Object.keys(JSON.parse(texto)), ['error']);
}

test('JWT vigente devuelve solo UUID actual y reutiliza JWKS, nunca autorización o metadata', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  for (const id of [VERSION_A, VERSION_B]) {
    const respuesta = await leer(peticion(token), VARIABLES, { id, tag: PRIVADO, timestamp: PRIVADO });
    assert.equal(respuesta.status, OK);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await respuesta.json(), { version: 1, versionId: id });
  }
  assert.deepEqual(
    await (await leer(peticion(await f.firmar({ run_attempt: '2' })), VARIABLES, { id: VERSION_A })).json(),
    { version: 1, versionId: VERSION_A },
  );
  f.reloj.ahora += (VIDA_JWT + 1) * MS_SEGUNDO;
  await comprobarError(await leer(peticion(token), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
  assert.equal(f.contador.jwks, 1);
});

test('pins, firma, audiencia e intento ajenos nunca revelan identidad', async () => {
  const f = await fixture();
  const leer = f.crear();
  for (const delta of [
    { iss: 'https://equipo.cloudflareaccess.com' },
    { aud: URL },
    { repository_id: '999' },
    { repository_owner_id: '999' },
    { ref: 'refs/heads/otra' },
    { workflow_ref: 'otro/producto/.github/workflows/actualizar.yml@refs/heads/main' },
    { workflow_sha: 'c'.repeat(TAM_SHA) },
    { sha: 'c'.repeat(TAM_SHA) },
    { run_attempt: '0' },
    { run_attempt: '02' },
    { run_attempt: '9007199254740992' },
    { exp: AHORA / MS_SEGUNDO },
    { job_workflow_ref: CONFIANZA.workflowRef },
  ]) {
    await comprobarError(await leer(peticion(await f.firmar(delta)), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
  }
  const ajena = await claves();
  await comprobarError(await leer(peticion(await ajena.firmar()), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
  assert.equal(f.contador.jwks, 1);
});

test('frontera URL, método, token y cuerpo rechazan antes de JWKS', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  for (const url of [
    `${URL}?x=1`,
    `${URL}/`,
    `${ORIGEN}/MANTENIMIENTO/construccion`,
    `${ORIGEN}/mantenimiento/%63onstruccion`,
    `https://otro.example${RUTA_CONSTRUCCION_SERVIDA}`,
  ]) {
    await comprobarError(await leer(peticion(token, url), VARIABLES, { id: VERSION_A }), AUSENTE);
  }
  for (const method of ['HEAD', 'POST', 'OPTIONS']) {
    const respuesta = await leer(peticion(token, URL, { method }), VARIABLES, { id: VERSION_A });
    assert.equal(respuesta.headers.get('allow'), 'GET');
    await comprobarError(respuesta, METODO);
  }
  for (const invalido of ['', PRIVADO, `${'a'.repeat(MAX_TOKEN)}.a.a`]) {
    await comprobarError(await leer(peticion(invalido), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
  }
  for (const longitud of ['1', '-1', '00', '999999999999999']) {
    const req = peticion(token, URL, { headers: { authorization: `Bearer ${token}`, 'content-length': longitud } });
    await comprobarError(await leer(req, VARIABLES, { id: VERSION_A }), INVALIDO);
  }
  let cancelado = false;
  const req = peticion(token, URL, {
    method: 'POST',
    body: new ReadableStream({
      cancel() {
        cancelado = true;
      },
    }),
    duplex: 'half',
  });
  Object.defineProperty(req, 'method', { value: 'GET' });
  await comprobarError(await leer(req, VARIABLES, { id: VERSION_A }), INVALIDO);
  assert.equal(cancelado, true);
  assert.equal(f.contador.jwks, 0);
});

test('OFF, configuración rota o parcial no habilitan consulta ni resuelven IA', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  for (const FARO_ADMINISTRACION of [undefined, 'no']) {
    await comprobarError(
      await leer(peticion(token), { ...VARIABLES, FARO_ADMINISTRACION }, { id: VERSION_A }),
      AUSENTE,
    );
  }
  for (const delta of [
    { FARO_ADMINISTRACION: 'sí' },
    { FARO_ADMIN_ORIGEN: 'http://publico.example' },
    { FARO_SECRETO_FIRMA: 'corta' },
    { FARO_ACTUALIZACION_GITHUB: undefined },
    { FARO_ACTUALIZACION_GITHUB: '{' },
    { FARO_ACTUALIZACION_GITHUB_TOKEN: undefined },
  ]) {
    await comprobarError(await leer(peticion(token), { ...VARIABLES, ...delta }, { id: VERSION_A }), INDISPONIBLE);
  }
  assert.equal(f.contador.jwks, 0);
});

test('metadata inválida falla 503 tras autenticar y jamás infiere del tag o salud', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  for (const metadata of [
    undefined,
    null,
    VERSION_A,
    {},
    { tag: VERSION_A },
    { id: '1.0.0' },
    { id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA' },
    { id: `${VERSION_A}\n` },
    { id: ` ${VERSION_A}` },
  ]) {
    await comprobarError(await leer(peticion(token), VARIABLES, metadata), INDISPONIBLE);
  }
  await comprobarError(await leer(peticion(), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
  assert.equal(f.contador.jwks, 1);
});

test('caché conserva solo la confianza actual y no acepta JWT anterior tras cambio de pins', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  assert.equal((await leer(peticion(token), VARIABLES, { id: VERSION_A })).status, OK);
  const nueva = { ...CONFIGURACION, confianza: { ...CONFIANZA, sha: 'c'.repeat(TAM_SHA) } };
  const variables = { ...VARIABLES, FARO_ACTUALIZACION_GITHUB: JSON.stringify(nueva) };
  await comprobarError(await leer(peticion(token), variables, { id: VERSION_A }), SIN_AUTENTICAR);
  assert.equal(
    (await leer(peticion(await f.firmar({ sha: nueva.confianza.sha })), variables, { id: VERSION_A })).status,
    OK,
  );
  assert.equal((await leer(peticion(token), VARIABLES, { id: VERSION_A })).status, OK);
  assert.equal(f.contador.jwks, CONFIGURACIONES_DISTINTAS);
});

test('JWT que vence durante JWKS falla incluso con firma correcta', async () => {
  const f = await fixture();
  const leer = f.crear(async (url, init) => {
    const respuesta = await f.pedir(url, init);
    f.reloj.ahora += (VIDA_JWT + 1) * MS_SEGUNDO;
    return respuesta;
  });
  await comprobarError(await leer(peticion(await f.firmar()), VARIABLES, { id: VERSION_A }), SIN_AUTENTICAR);
});

test('retirada no confirma tarde ni cancela JWKS compartido de otra petición', async () => {
  const f = await fixture();
  const listo = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const leer = f.crear(async (url, init) => {
    listo.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const token = await f.firmar();
  const control = new AbortController();
  const primera = leer(peticion(token, URL, { signal: control.signal }), VARIABLES, { id: VERSION_A });
  await listo.promise;
  const segunda = leer(peticion(token), VARIABLES, { id: VERSION_B });
  control.abort(new Error('retirada sintética'));
  await assert.rejects(primera, /retirada sintética/);
  continuar.resolve();
  assert.deepEqual(await (await segunda).json(), { version: 1, versionId: VERSION_B });
  assert.equal(f.contador.jwks, 1);
});

test('plazo total limita JWKS bloqueado y un resultado tardío no cambia el 504', async (t) => {
  const f = await fixture();
  const listo = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const leer = f.crear(async (url, init) => {
    listo.resolve();
    await continuar.promise;
    return f.pedir(url, init);
  });
  const token = await f.firmar();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendiente = leer(peticion(token), VARIABLES, { id: VERSION_A });
  await listo.promise;
  t.mock.timers.tick(PLAZO_MS);
  await comprobarError(await pendiente, PLAZO);
  continuar.resolve();
  await new Promise<void>((resolver) => setImmediate(resolver));
});

test('Worker consulta versiones por petición sin SQL, IA, Access humano ni ASSETS', async (t) => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', f.pedir);
  const env = {
    ...VARIABLES,
    FARO_ADMIN_ACCESS_EQUIPO: 'roto',
    ASSETS: { fetch: async () => assert.fail('No ASSETS') },
    REGISTRO_SOCIOS: { idFromName: () => assert.fail('No SQL'), get: () => assert.fail('No SQL') },
    CF_VERSION_METADATA: { id: VERSION_A, tag: PRIVADO },
  };
  const token = await f.firmar();
  assert.deepEqual(await (await worker.fetch(peticion(token), env)).json(), { version: 1, versionId: VERSION_A });
  env.CF_VERSION_METADATA = { id: VERSION_B, tag: PRIVADO };
  assert.deepEqual(await (await worker.fetch(peticion(token), env)).json(), { version: 1, versionId: VERSION_B });
  assert.equal(f.contador.jwks, 1);
  await comprobarError(await worker.fetch(peticion(token), { ...env, FARO_ADMINISTRACION: 'no' }), AUSENTE);
  await comprobarError(
    await worker.fetch(peticion(token), { ...env, FARO_ACTUALIZACION_GITHUB: undefined }),
    INDISPONIBLE,
  );
  for (const ruta of [
    '/mantenimiento/construccion/',
    '/MANTENIMIENTO/construccion',
    '/%6dantenimiento/construccion',
    '/mantenimiento//construccion',
    '/mantenimiento/%63onstruccion',
  ]) {
    const respuesta = await worker.fetch(peticion(token, `${ORIGEN}${ruta}`), env);
    assert.equal(respuesta.status, AUSENTE);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  }
});

test('el portal protege el archivo y acredita con OIDC la huella de los bytes ASSETS de su versión', async (t) => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', f.pedir);
  const bytes = Buffer.from(' { "fixture": "à" }\r\n');
  let lecturas = 0;
  const env = {
    ...VARIABLES,
    FARO_CLAVE_GENERAL: 'clave-general-sintetica',
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    ASSETS: {
      async fetch(solicitud: Request) {
        lecturas++;
        assert.equal(solicitud.url, MANIFIESTO);
        assert.equal(solicitud.method, 'GET');
        assert.equal(solicitud.credentials, 'omit');
        assert.equal(solicitud.redirect, 'manual');
        assert.deepEqual(Object.fromEntries(solicitud.headers), { 'accept-encoding': 'identity' });
        return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } });
      },
    },
  };
  const bloqueado = await workerOficial.fetch(new Request(MANIFIESTO), env);
  assert.equal(bloqueado.status, PROHIBIDO);
  assert.equal(bloqueado.headers.get('x-faro-portal'), 'privado');
  assert.equal(await bloqueado.text(), '');
  await comprobarError(await workerOficial.fetch(peticion('', PRUEBA), env), SIN_AUTENTICAR);
  assert.equal(lecturas, 0);
  const token = await f.firmar();
  const autenticada = () =>
    peticion(token, PRUEBA, {
      headers: { authorization: `Bearer ${token}`, cookie: 'sesion=sintetica', 'if-none-match': '*' },
    });
  const sha256ManifiestoWeb = createHash('sha256').update(bytes).digest('hex');
  for (const id of [VERSION_A, VERSION_B]) {
    const respuesta = await workerOficial.fetch(autenticada(), { ...env, CF_VERSION_METADATA: { id, tag: PRIVADO } });
    assert.equal(respuesta.status, OK);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await respuesta.json(), { version: 1, versionId: id, sha256ManifiestoWeb });
  }
  assert.equal(lecturas, 2);
});

test('la prueba admite solo el origen y la consulta exactos y exige ASSETS y metadata válidos', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  const assets = { fetch: async () => assert.fail('No ASSETS fuera de la frontera') };
  for (const url of [
    `${PRUEBA}&ruta=/inicio.html`,
    `${PRUEBA}&prueba=manifiesto`,
    `https://otro.example${RUTA_CONSTRUCCION_SERVIDA}?prueba=manifiesto`,
  ]) {
    await comprobarError(await leer(peticion(token, url), VARIABLES, { id: VERSION_A }, assets), AUSENTE);
  }
  await comprobarError(
    await leer(peticion(token, PRUEBA, { method: 'HEAD' }), VARIABLES, { id: VERSION_A }, assets),
    METODO,
  );
  await comprobarError(await leer(peticion(token, PRUEBA), VARIABLES, undefined, assets), INDISPONIBLE);
  await comprobarError(await leer(peticion(token, PRUEBA), VARIABLES, { id: VERSION_A }), INDISPONIBLE);
  await comprobarError(
    await leer(peticion(await f.firmar({ repository_id: '999' }), PRUEBA), VARIABLES, { id: VERSION_A }, assets),
    SIN_AUTENTICAR,
  );
});

test('la prueba rechaza archivos ausentes, redirecciones, longitudes falsas y cuerpos excesivos', async () => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  const cuerposInvalidos = [
    new Response('ausente', { status: AUSENTE }),
    Response.redirect('https://ajeno.example/firmas/manifiesto.json', REDIRECCION),
    new Response(),
    new Response(''),
    new Response('{}', { headers: { 'content-length': '1' } }),
    new Response('{}', { headers: { 'content-length': '3' } }),
    new Response('{}', { headers: { 'content-length': String(MAX_MANIFIESTO_BYTES + 1) } }),
    new Response('{}', { headers: { 'content-encoding': 'gzip' } }),
    new Response(new Uint8Array(MAX_MANIFIESTO_BYTES + 1)),
  ];
  for (const archivo of cuerposInvalidos) {
    await comprobarError(
      await leer(peticion(token, PRUEBA), VARIABLES, { id: VERSION_A }, { fetch: async () => archivo }),
      INDISPONIBLE,
    );
  }
});

test('la prueba admite una lectura válida de ASSETS después de un JWKS frío lento', async (t) => {
  const f = await fixture();
  const esperandoClaves = Promise.withResolvers<void>();
  const entregarClaves = Promise.withResolvers<void>();
  const esperandoAssets = Promise.withResolvers<void>();
  const entregarAssets = Promise.withResolvers<Response>();
  const leer = f.crear(async (url, init) => {
    esperandoClaves.resolve();
    await entregarClaves.promise;
    return f.pedir(url, init);
  });
  const token = await f.firmar();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const assets = {
    fetch() {
      esperandoAssets.resolve();
      return entregarAssets.promise;
    },
  };
  const pendiente = leer(peticion(token, PRUEBA), VARIABLES, { id: VERSION_A }, assets);
  await esperandoClaves.promise;
  t.mock.timers.tick(PLAZO_MS - 1);
  entregarClaves.resolve();
  await esperandoAssets.promise;
  t.mock.timers.tick(PLAZO_MS);
  entregarAssets.resolve(new Response('{}'));
  const respuesta = await pendiente;
  assert.equal(respuesta.status, OK);
  assert.deepEqual(await respuesta.json(), {
    version: 1,
    versionId: VERSION_A,
    sha256ManifiestoWeb: createHash('sha256').update('{}').digest('hex'),
  });
});

test('el plazo de la autoridad corta la lectura del manifiesto', async (t) => {
  const f = await fixture();
  const leer = f.crear();
  const token = await f.firmar();
  const leyendo = Promise.withResolvers<void>();
  const cancelado = Promise.withResolvers<void>();
  const assets = {
    async fetch() {
      return new Response(
        new ReadableStream(
          {
            pull() {
              leyendo.resolve();
            },
            cancel() {
              cancelado.resolve();
            },
          },
          { highWaterMark: 0 },
        ),
      );
    },
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pendiente = leer(peticion(token, PRUEBA), VARIABLES, { id: VERSION_A }, assets);
  await leyendo.promise;
  t.mock.timers.tick(PLAZO_PRUEBA_MANIFIESTO_MS);
  await comprobarError(await pendiente, PLAZO);
  await cancelado.promise;
});
