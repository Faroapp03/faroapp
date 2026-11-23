/** Identidad de un ciclo a demanda: JWT y JWKS sintéticos, reloj fijo; ninguna cuenta ni petición real de GitHub. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crearVerificadorDemandaGitHub,
  leerActoresDemanda,
  puedeReservar,
} from '../../src/administracion/oidc-demanda.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import {
  AHORA_OIDC,
  afirmacionesOidc,
  CONFIANZA_MANTENIMIENTO,
  VIDA_TOKEN_OIDC_S,
} from '../ayudas/oidc-mantenimiento.ts';

const RSA_BITS = 2048;
const CIFRAS_SHA = 40;
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const ACTOR_ID = '1001';
const ACTOR = 'agente-sintetico';
const ACTORES = [ACTOR_ID];
const OTRA_REVISION = 'c'.repeat(CIFRAS_SHA);

async function firmante() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', par.publicKey)), kid: 'sintetica' };
  const firmar = async (contenido: Record<string, unknown>) => {
    const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })).toString('base64url');
    const texto = `${cabecera}.${Buffer.from(JSON.stringify(contenido)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(texto));
    return `${texto}.${Buffer.from(firma).toString('base64url')}`;
  };
  return { jwk, firmar };
}
const GITHUB = firmante();
/** Firma con otra clave y el mismo `kid`: el JWKS de la prueba no la publica. */
const AJENA = firmante();

/** Un lanzamiento manual válido; cada caso cambia una sola afirmación (`undefined` la quita). */
function lanzamiento(cambios: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...afirmacionesOidc(CONFIANZA_MANTENIMIENTO),
    event_name: 'workflow_dispatch',
    actor_id: ACTOR_ID,
    actor: ACTOR,
    runner_environment: 'github-hosted',
    ...cambios,
  };
}
async function verificador(actores: readonly string[] = ACTORES) {
  const { jwk } = await GITHUB;
  const pedir: typeof fetch = async () => Response.json({ keys: [jwk] });
  return crearVerificadorDemandaGitHub(CONFIANZA_MANTENIMIENTO, actores, pedir, () => AHORA_OIDC);
}
const IDENTIDAD = {
  ejecucion: {
    repositorioId: CONFIANZA_MANTENIMIENTO.repositorioId,
    propietarioId: CONFIANZA_MANTENIMIENTO.propietarioId,
    ref: CONFIANZA_MANTENIMIENTO.ref,
    workflowRef: CONFIANZA_MANTENIMIENTO.workflowRef,
    workflowSha: CONFIANZA_MANTENIMIENTO.workflowSha,
    sha: CONFIANZA_MANTENIMIENTO.sha,
    runId: '789',
    runAttempt: '1',
    jti: 'sintetico',
    emitidoEn: AHORA_OIDC / MS_POR_SEGUNDO,
    caducaEn: AHORA_OIDC / MS_POR_SEGUNDO + VIDA_TOKEN_OIDC_S,
  },
  actor: { id: ACTOR_ID, nombre: ACTOR },
};

test('un lanzamiento manual de la revisión autorizada y de un actor admitido da la identidad con su actor', async () => {
  const verificar = await verificador();
  const identidad = await verificar(await (await GITHUB).firmar(lanzamiento()));
  assert.deepEqual(identidad, IDENTIDAD);
  assert.ok(Object.isFrozen(identidad) && Object.isFrozen(identidad?.actor) && Object.isFrozen(identidad?.ejecucion));
});

test('un actor de una lista de varios y el nombre de una aplicación también dan la identidad', async () => {
  const { firmar } = await GITHUB;
  assert.deepEqual(await (await verificador(['42', ACTOR_ID]))(await firmar(lanzamiento())), IDENTIDAD);
  const bot = lanzamiento({ actor: 'mantenimiento-sintetico[bot]' });
  assert.deepEqual((await (await verificador())(await firmar(bot)))?.actor, {
    id: ACTOR_ID,
    nombre: 'mantenimiento-sintetico[bot]',
  });
});

const CASOS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['otro evento: push', { event_name: 'push' }],
  ['otro evento: cron', { event_name: 'schedule' }],
  ['otro evento: llamada externa', { event_name: 'repository_dispatch' }],
  ['sin evento', { event_name: undefined }],
  ['actor fuera de la lista', { actor_id: '1002' }],
  ['actor mal formado: número', { actor_id: 1001 }],
  ['actor mal formado: cero a la izquierda', { actor_id: '01001' }],
  ['actor mal formado: espacio', { actor_id: '1001 ' }],
  ['actor mal formado: vacío', { actor_id: '' }],
  ['sin actor', { actor_id: undefined }],
  ['nombre del actor mal formado', { actor: 'agente sintetico' }],
  ['sin nombre del actor', { actor: undefined }],
  ['runner propio', { runner_environment: 'self-hosted' }],
  ['runner declarado vacío', { runner_environment: '' }],
  ['sin runner declarado', { runner_environment: undefined }],
  ['otra revisión del código', { sha: OTRA_REVISION }],
  ['otra revisión del workflow', { workflow_sha: OTRA_REVISION }],
  ['otro repositorio', { repository_id: '124' }],
  ['otra audiencia', { aud: 'https://mantenimiento.example/mantenimiento/inicio' }],
];
for (const [nombre, cambio] of CASOS) {
  test(`${nombre}: nada, en el primer intento y en el segundo; sin el cambio, la identidad`, async () => {
    const verificar = await verificador();
    const { firmar } = await GITHUB;
    assert.deepEqual(await verificar(await firmar(lanzamiento())), IDENTIDAD);
    assert.equal(await verificar(await firmar(lanzamiento(cambio))), null);
    assert.notEqual(await verificar(await firmar(lanzamiento({ run_attempt: '2' }))), null);
    assert.equal(await verificar(await firmar(lanzamiento({ ...cambio, run_attempt: '2' }))), null);
  });
}

test('firma de otra clave con el mismo kid: nada; firmado por la clave publicada, la identidad', async () => {
  const verificar = await verificador();
  assert.deepEqual(await verificar(await (await GITHUB).firmar(lanzamiento())), IDENTIDAD);
  assert.equal(await verificar(await (await AJENA).firmar(lanzamiento())), null);
});

test('lista de actores vacía: nada; con el actor en la lista, la identidad', async () => {
  const token = await (await GITHUB).firmar(lanzamiento());
  assert.deepEqual(await (await verificador(ACTORES))(token), IDENTIDAD);
  assert.equal(await (await verificador([]))(token), null);
});

test('la lista de actores admite solo identificadores numéricos sin repetir, como mucho ocho', async () => {
  assert.deepEqual(leerActoresDemanda(['1', '42', '9007199254740991']), ['1', '42', '9007199254740991']);
  assert.ok(Object.isFrozen(leerActoresDemanda([])));
  const MAX_ACTORES = 8;
  const ocho = Array.from({ length: MAX_ACTORES }, (_, i) => String(i + 1));
  assert.deepEqual(leerActoresDemanda(ocho), ocho);
  for (const lista of [
    [...ocho, '9'],
    ['agente-sintetico'],
    [Number(ACTOR_ID)],
    ['1001', '1001'],
    ['0'],
    ['9007199254740992'],
    '1001',
    { 0: '1001', length: 1 },
    null,
  ]) {
    assert.throws(() => leerActoresDemanda(lista), /Actores de la actualización a demanda no válidos/);
  }
  const { jwk } = await GITHUB;
  const pedir: typeof fetch = async () => Response.json({ keys: [jwk] });
  assert.throws(() => crearVerificadorDemandaGitHub(CONFIANZA_MANTENIMIENTO, ['agente'], pedir), /no válidos/);
});

test('el segundo intento da su identidad, que puede consultar pero no reservar; el primero, las dos cosas', async () => {
  const verificar = await verificador();
  const { firmar } = await GITHUB;
  const segundo = await verificar(await firmar(lanzamiento({ run_attempt: '2' })));
  assert.deepEqual(segundo, { ...IDENTIDAD, ejecucion: { ...IDENTIDAD.ejecucion, runAttempt: '2' } });
  assert.ok(segundo !== null && !puedeReservar(segundo));
  const primero = await verificar(await firmar(lanzamiento()));
  assert.ok(primero !== null && puedeReservar(primero));
});
