/** Worker real, protocolo DO real y SQLite/JWT locales: no despliegue ni peticiones de red. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { before, test } from 'node:test';
import { prepararVigilanteRemoto } from '../../herramientas/mantenimiento/preparar-vigilante-remoto.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import type { VariablesDelEntorno } from '../../src/comun/entorno.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { AccesoPublicoDurable, type EstadoAccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { AlmacenVigilanteDurable } from '../../src/plataforma/acceso-publico/vigilante-cliente-durable.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { ID_INSTITUCION_SINTETICA, sembrarInstitucionAdmitida } from '../ayudas/institucion-admitida.ts';
import { objeto } from '../ayudas/objeto-json.ts';
import { CONFIG_VIGILANTE } from '../ayudas/vigilante.ts';

const ORIGEN = 'https://panel.example';
const EQUIPO = 'https://equipo-prueba.cloudflareaccess.com';
const EXITO = 200;
const PROHIBIDO = 403;
const NO_AUTENTICADO = 401;
const METODO = 405;
const CONFLICTO = 409;
const AUSENTE = 404;
const CUOTA = 429;
const NO_DISPONIBLE = 503;
const RSA_BITS = 2048;
const VIDA_JWT_S = 3600;
const MS_POR_SEGUNDO = 1000;
const SECRETO = 'firma y credencial sintetica de mas de treinta y dos caracteres';
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const ACEPTADA = 202;
const TAM_SHA = 40;
const TAM_HUELLA = 64;
const TAM_VERSION = 16;
const SOLICITUD_ACTUALIZACION = {
  solicitudId: '11111111-1111-4111-8111-111111111111',
  accion: 'actualizar-datos',
  revisionEsperada: 0,
};
const CONFIANZA_ACTUALIZACION: ConfianzaOidcGitHub = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'c'.repeat(TAM_SHA),
  workflowSha: 'd'.repeat(TAM_SHA),
};
const CONFIGURACION_ACTUALIZACION = JSON.stringify({
  version: 1,
  confianza: CONFIANZA_ACTUALIZACION,
  destino: { propietario: 'equipo', repositorio: 'fuente', workflow: 'actualizar.yml', ref: 'main' },
});
const politica = (cambios: Partial<PoliticaControles> = {}): PoliticaControles => ({
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
  ...cambios,
});
function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (sql: string, ...valores: ValorSql[]) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const valor = accion();
          db.exec('COMMIT');
          return valor;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}
function fixture(cambios: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  const rutas: string[] = [];
  const estaticos: string[] = [];
  let durable: AccesoPublicoDurable | undefined;
  const disponibilidad = { caido: false };
  const variables: Record<string, unknown> = {
    FARO_ADMINISTRACION: 'si',
    FARO_ADMIN_ORIGEN: ORIGEN,
    FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
    FARO_ADMIN_ACCESS_AUD: 'panel',
    FARO_ACCESS_AUD: 'publica',
    FARO_SECRETO_FIRMA: SECRETO,

    ...cambios,
  };
  const espacio = {
    idFromName: (nombre: string) => {
      assert.equal(nombre, 'registro-publico-v1');
      return nombre;
    },
    get: () => ({
      fetch: async (peticion: Request) => {
        rutas.push(new URL(peticion.url).pathname);
        if (disponibilidad.caido) {
          throw new Error('fallo sintético del binding');
        }
        durable ??= new AccesoPublicoDurable(estadoSqlite(db), variables as VariablesDelEntorno);
        return durable.fetch(peticion);
      },
    }),
  };
  const env = {
    ...variables,
    ASSETS: {
      fetch: async (peticion: Request) => {
        estaticos.push(new URL(peticion.url).pathname);
        return new Response('estático', { status: AUSENTE });
      },
    },
    REGISTRO_SOCIOS: espacio,
  };
  return { db, env, rutas, estaticos, disponibilidad };
}
function request(ruta: string, jwt = '') {
  return new Request(`${ORIGEN}${ruta}`, {
    headers: {
      [CABECERA_CONTRATO]: String(CONTRATO_API),
      'cf-access-jwt-assertion': jwt,
      'cf-connecting-ip': '198.51.100.20',
    },
  });
}
function panel(ruta: string, jwt = '', token = '', cuerpo: object = {}) {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      'cf-access-jwt-assertion': jwt,
      'x-faro-sesion': token,
    },
  });
}

async function abrir(env: ReturnType<typeof fixture>['env'], jwt: string) {
  const respuesta = await worker.fetch(panel('sesion/abrir', jwt, '', { retomar: true }), env);
  assert.equal(respuesta.status, EXITO);
  return String(objeto(await respuesta.json()).token);
}
function cambiar(env: ReturnType<typeof fixture>['env'], jwt: string, token: string) {
  return (revisionEsperada: number, politica: PoliticaControles) =>
    worker.fetch(panel('controles/cambiar', jwt, token, { revisionEsperada, politica }), env);
}
async function tokenOidc(clave: CryptoKey, cambios: Record<string, unknown> = {}) {
  const ahora = Math.floor(Date.now() / MS_POR_SEGUNDO);
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: CONFIANZA_ACTUALIZACION.audiencia,
    repository_id: CONFIANZA_ACTUALIZACION.repositorioId,
    repository_owner_id: CONFIANZA_ACTUALIZACION.propietarioId,
    ref: CONFIANZA_ACTUALIZACION.ref,
    workflow_ref: CONFIANZA_ACTUALIZACION.workflowRef,
    workflow_sha: CONFIANZA_ACTUALIZACION.workflowSha,
    sha: CONFIANZA_ACTUALIZACION.sha,
    run_id: '789',
    run_attempt: '1',
    jti: 'jti-worker-sintetico',
    iat: ahora,
    nbf: ahora,
    exp: ahora + VIDA_JWT_S,
    ...cambios,
  };
  const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'sintetica' })).toString('base64url');
  const entrada = `${cabecera}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const firma = await crypto.subtle.sign(ALGORITMO, clave, new TextEncoder().encode(entrada));
  return `${entrada}.${Buffer.from(firma).toString('base64url')}`;
}

async function equipo() {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const firmar = async (aud = 'panel') => {
    const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'sintetica' })).toString('base64url');
    const claims = {
      iss: EQUIPO,
      aud: [aud],
      type: 'app',
      sub: 'persona',
      email: 'persona@faro.invalid',
      iat: 1_900_000_000,
      exp: Math.floor(Date.now() / MS_POR_SEGUNDO) + VIDA_JWT_S,
    };
    const entrada = `${cabecera}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    const firma = await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(entrada));
    return `${entrada}.${Buffer.from(firma).toString('base64url')}`;
  };
  const pedir: typeof fetch = async (entrada, opciones) => {
    assert.equal(String(entrada), `${EQUIPO}/cdn-cgi/access/certs`);
    assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [{ ...publica, kid: 'sintetica' }] });
  };

  return {
    firmar,
    pedir,
    firmarOidc: (cambios?: Record<string, unknown>) => tokenOidc(par.privateKey, cambios),
    jwks: { keys: [{ ...publica, kid: 'sintetica' }] },
  };
}
let identidad: Awaited<ReturnType<typeof equipo>>;
before(async () => {
  identidad = await equipo();
});

test('configuración y guardia administrativas se validan antes de tocar REGISTRO_SOCIOS', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const cambios of [
    { FARO_ADMIN_ORIGEN: 'http://publico.example' },
    { FARO_ADMIN_ACCESS_AUD: '' },
    { FARO_ADMIN_ACCESS_AUD: 'publica' },
    { FARO_ADMINISTRACION: 'sí' },
  ]) {
    const f = fixture(cambios);
    try {
      assert.equal((await worker.fetch(panel('sesion/abrir'), f.env)).status, NO_DISPONIBLE);
      assert.deepEqual(f.rutas, []);
      assert.deepEqual(f.estaticos, []);
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM sqlite_master').get()?.n, 0);
    } finally {
      f.db.close();
    }
  }
});

test('panel real con conectividad OFF sustituye sesión y exige identidad en cada petición', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture();
  try {
    assert.equal((await worker.fetch(panel('sesion/abrir'), f.env)).status, PROHIBIDO);
    const jwt = await identidad.firmar();
    const anterior = await abrir(f.env, jwt);
    const nuevo = await abrir(f.env, jwt);
    assert.notEqual(nuevo, anterior);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, anterior), f.env)).status, CONFLICTO);
    assert.equal((await worker.fetch(panel('controles/leer', '', nuevo), f.env)).status, PROHIBIDO);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, nuevo), f.env)).status, EXITO);
    assert.equal(f.rutas.filter((ruta) => ruta === '/panel/preparar').length, 1);
    assert.deepEqual(f.estaticos, []);
  } finally {
    f.db.close();
  }
});

test('Worker: el destino de los avisos está montado y se lee y se cambia dentro de la sesión', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture();
  try {
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    const leido = await worker.fetch(panel('avisos/leer', jwt, sesion), f.env);
    assert.equal(leido.status, EXITO);
    assert.deepEqual(objeto(await leido.json()).destino, {
      version: 1,
      correo: null,
      revision: 0,
      cambiadoEn: null,
      verificacion: 'sin_destino',
    });
    const cambio = { revisionEsperada: 0, correo: 'persona@example.org' };
    assert.equal((await worker.fetch(panel('avisos/cambiar', jwt, sesion, cambio), f.env)).status, EXITO);
    const guardado = objeto(await (await worker.fetch(panel('avisos/leer', jwt, sesion), f.env)).json());
    assert.equal(objeto(guardado.destino).correo, 'persona@example.org');
    assert.ok(f.rutas.includes('/avisos/cambiar-sesion'));
    assert.deepEqual(f.estaticos, []);
  } finally {
    f.db.close();
  }
});

test('rutas reservadas y alias no caen en ASSETS; catálogo actualiza GET/HEAD sin caché ni reconstrucción', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture();
  try {
    for (const ruta of [
      '/mcp',
      '/mcp/',
      '/MCP',
      '/%6dcp',
      '/a2a',
      '/.well-known/agent-card.json',
      '/administracion/no-existe',
    ]) {
      assert.equal((await worker.fetch(request(ruta), f.env)).status, AUSENTE);
    }
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    assert.equal((await cambiar(f.env, jwt, sesion)(0, politica({ mcp: true, a2a: true }))).status, EXITO);
    const catalogo = await worker.fetch(request('/.well-known/api-catalog'), f.env);
    assert.equal(catalogo.headers.get('cache-control'), 'no-store');
    assert.match(await catalogo.text(), /\/mcp/);
    assert.equal((await worker.fetch(request('/mcp'), f.env)).status, METODO);
    assert.equal((await cambiar(f.env, jwt, sesion)(1, politica())).status, EXITO);
    const cerrado = await worker.fetch(request('/.well-known/api-catalog'), f.env);
    assert.doesNotMatch(await cerrado.text(), /\/mcp/);
    const head = await worker.fetch(new Request(`${ORIGEN}/.well-known/api-catalog`, { method: 'HEAD' }), f.env);
    assert.equal(head.headers.get('cache-control'), 'no-store');
    assert.equal(await head.text(), '');
    assert.equal(f.rutas.filter((ruta) => ruta === '/panel/preparar').length, 1);
    assert.ok(f.estaticos.every((ruta) => !/administracion|mcp|a2a|agent-card/.test(ruta)));
  } finally {
    f.db.close();
  }
});

test('persistencia rota no vuelve a env ni estáticos y mantiene panel/datos independientes del proveedor', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture({ FARO_MCP: 'si' });
  try {
    const jwt = await identidad.firmar();
    await abrir(f.env, jwt);
    f.db.exec('DROP TABLE administracion_controles');
    assert.equal((await worker.fetch(request('/mcp'), f.env)).status, NO_DISPONIBLE);
    assert.equal((await worker.fetch(request('/api/grupos'), f.env)).status, EXITO);
    const catalogo = await worker.fetch(request('/.well-known/api-catalog'), f.env);
    assert.equal(catalogo.status, NO_DISPONIBLE);
    assert.equal(catalogo.headers.get('cache-control'), 'no-store');
    assert.equal((await worker.fetch(panel('controles/leer', jwt, 'token-invalido'), f.env)).status, PROHIBIDO);
    assert.ok(f.estaticos.every((ruta) => !ruta.includes('mcp')));
  } finally {
    f.db.close();
  }
});

test('Access del despliegue mantiene el bloqueo global con la administración deshabilitada', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture({
    FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
    FARO_ACCESS_EQUIPO: 'equipo-prueba',
  });
  try {
    assert.equal((await worker.fetch(request('/api/grupos'), f.env)).status, PROHIBIDO);
    const jwt = await identidad.firmar('publica');
    assert.equal((await worker.fetch(request('/api/grupos', jwt), f.env)).status, EXITO);
    const legacy = fixture({ FARO_ADMINISTRACION: 'no' });
    try {
      assert.equal((await worker.fetch(request('/mcp'), legacy.env)).status, AUSENTE);
      assert.deepEqual(legacy.rutas, []);
      assert.ok(!legacy.estaticos.includes('/mcp'));
      assert.equal((await worker.fetch(panel('sesion/abrir'), legacy.env)).status, AUSENTE);
    } finally {
      legacy.db.close();
    }
  } finally {
    f.db.close();
  }
});

async function tokenCliente(env: ReturnType<typeof fixture>['env']) {
  const respuesta = await worker.fetch(
    new Request(`${ORIGEN}/api/socios/v1/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      headers: { authorization: `Basic ${btoa(`${ID_INSTITUCION_SINTETICA}:${SECRETO}`)}` },
    }),
    env,
  );
  assert.equal(respuesta.status, EXITO);
  return String(objeto(await respuesta.json()).access_token);
}
function consulta(token: string) {
  return new Request(`${ORIGEN}/api/socios/v1/consultas/explorar_grupos?padre=4`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

test('institución invitada y cuota persisten al apagar/reabrir REST sin reconstruir API', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture();
  try {
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    assert.equal((await cambiar(f.env, jwt, sesion)(0, politica({ api: 'habilitada' }))).status, EXITO);
    await sembrarInstitucionAdmitida(f.db, SECRETO, 2);
    const token = await tokenCliente(f.env);
    assert.equal((await worker.fetch(consulta(token), f.env)).status, EXITO);
    assert.equal((await cambiar(f.env, jwt, sesion)(1, politica())).status, EXITO);
    assert.equal((await worker.fetch(consulta(token), f.env)).status, AUSENTE);
    assert.equal((await cambiar(f.env, jwt, sesion)(2, politica({ api: 'habilitada' }))).status, EXITO);
    assert.equal((await worker.fetch(consulta(token), f.env)).status, EXITO);
    assert.equal((await worker.fetch(consulta(token), f.env)).status, CUOTA);
    assert.equal(
      f.db.prepare('SELECT huella FROM instituciones_claves WHERE institucion=?').get(ID_INSTITUCION_SINTETICA)?.huella,
      huellaDelSecreto(SECRETO),
    );
    assert.equal(f.rutas.filter((ruta) => ruta === '/panel/preparar').length, 1);
  } finally {
    f.db.close();
  }
});

test('binding caído desde primer arranque conserva datos y recupera panel sin fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture({ FARO_MCP: 'si' });
  f.disponibilidad.caido = true;
  try {
    assert.equal((await worker.fetch(request('/mcp'), f.env)).status, NO_DISPONIBLE);
    assert.equal((await worker.fetch(request('/api/grupos'), f.env)).status, EXITO);
    const respuesta = await worker.fetch(request('/api/salud'), f.env);
    assert.equal(respuesta.status, EXITO);
    const salud = objeto(await respuesta.json());
    for (const campo of ['cerebro', 'ia', 'estimador', 'turnstile', 'proveedor_ia']) {
      assert.equal(Object.hasOwn(salud, campo), false);
    }
    f.disponibilidad.caido = false;
    assert.equal((await worker.fetch(request('/mcp'), f.env)).status, METODO);
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, sesion), f.env)).status, EXITO);
    assert.ok(f.estaticos.every((ruta) => !ruta.includes('mcp')));
  } finally {
    f.db.close();
  }
});

function transporteActualizacion(despachos: unknown[]): typeof fetch {
  return async (entrada, opciones) => {
    const peticion = new Request(entrada, opciones);
    assert.equal(peticion.headers.get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    if (peticion.url === `${EQUIPO}/cdn-cgi/access/certs`) {
      return identidad.pedir(entrada, opciones);
    }
    if (peticion.url === 'https://token.actions.githubusercontent.com/.well-known/jwks') {
      return Response.json(identidad.jwks);
    }
    assert.equal(
      peticion.url,
      'https://api.github.com/repos/equipo/fuente/actions/workflows/actualizar.yml/dispatches',
    );
    assert.equal(peticion.method, 'POST');
    despachos.push(await peticion.json());
    return Response.json({
      workflow_run_id: 789,
      run_url: 'https://api.github.com/repos/equipo/fuente/actions/runs/789',
      html_url: 'https://github.com/equipo/fuente/actions/runs/789',
    });
  };
}
function resultadoCandidato() {
  const terminadoEn = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    version: 1,
    solicitudId: SOLICITUD_ACTUALIZACION.solicitudId,
    revisionReserva: 1,
    accion: 'actualizar-datos',
    resultado: 'validado',
    veredicto: 'verde',
    terminadoEn,
    huellaPaquete: 'f'.repeat(TAM_VERSION),
    error: null,
    estado: {
      version: 1,
      observadoEn: terminadoEn,
      fuentes: [{ id: 'esco', politica: 'fija', fecha: null, plazoDias: null }],
      modulos: ['esco', 'paquete'].map((id) => ({
        id,
        ultimoIntento: terminadoEn,
        veredicto: 'verde',
        ultimaVersionBuena: { fecha: terminadoEn, huella: 'a'.repeat(TAM_HUELLA) },
        fallos: 0,
        proximoReintento: null,
      })),
      formacionAbiertaCaduca: null,
    },
  };
}
function callback(cuerpo: object, token = '', ruta = '/mantenimiento/resultado') {
  return new Request(`${ORIGEN}${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
}
async function confirmarInicioWorker(env: ReturnType<typeof fixture>['env'], jwt: string, oidc: string) {
  const inicio = { solicitudId: SOLICITUD_ACTUALIZACION.solicitudId, revisionReserva: 1, accion: 'actualizar-datos' };
  assert.equal((await worker.fetch(callback(inicio, jwt, '/mantenimiento/inicio'), env)).status, NO_AUTENTICADO);
  assert.equal((await worker.fetch(callback(inicio, oidc, '/mantenimiento/inicio'), env)).status, EXITO);
}
test('mantenimiento queda reservado aun OFF o sin capacidad y todos sus alias evitan ASSETS', async () => {
  for (const cambios of [{ FARO_ADMINISTRACION: 'no' }, {}]) {
    const f = fixture(cambios);
    try {
      for (const ruta of [
        '/mantenimiento/activacion',
        '/mantenimiento/activacion/',
        '/%6dantenimiento/activacion',
        '/mantenimiento/inicio',
        '/mantenimiento/inicio/',
        '/%6dantenimiento/inicio',
        '/mantenimiento/resultado',
        '/mantenimiento/resultado/',
        '/MANTENIMIENTO/resultado',
        '/%6dantenimiento/resultado',
        '/mantenimiento//resultado',
        '/x/%2e%2e%2fmantenimiento/resultado',
      ]) {
        const respuesta = await worker.fetch(callback({}, '', ruta), f.env);
        assert.equal(respuesta.status, AUSENTE);
        assert.equal(respuesta.headers.get('cache-control'), 'no-store');
        assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
      }
      assert.deepEqual(f.estaticos, []);
    } finally {
      f.db.close();
    }
  }
});

interface CasoDatosWorker {
  readonly env: ReturnType<typeof fixture>['env'];
  readonly jwt: string;
  readonly sesion: string;
  readonly cuerpo: ReturnType<typeof resultadoCandidato>;
  readonly oidc: string;
}
async function verificarObservacionAdmitida({ env, jwt, sesion, cuerpo, oidc }: CasoDatosWorker) {
  const estado = await worker.fetch(panel('datos/estado', jwt, sesion), env);
  assert.equal(estado.status, EXITO);
  assert.equal(estado.headers.get('cache-control'), 'no-store');
  const lectura = objeto(await estado.json());
  assert.deepEqual(lectura.datos, cuerpo.estado);
  assert.equal(lectura.deLaActualizacionAnterior, false);
  assert.deepEqual(Object.keys(lectura).sort(), ['datos', 'deLaActualizacionAnterior', 'estado', 'sesion']);
  assert.equal((await worker.fetch(panel('datos/estado', '', sesion), env)).status, PROHIBIDO);
  assert.equal((await worker.fetch(callback(cuerpo, oidc), env)).status, EXITO);
  const repetida = await worker.fetch(panel('datos/estado', jwt, sesion), env);
  assert.deepEqual(objeto(await repetida.json()).datos, cuerpo.estado);
  const incompatible = { ...cuerpo, estado: { ...cuerpo.estado, formacionAbiertaCaduca: '2026-10-01' } };
  assert.equal((await worker.fetch(callback(incompatible, oidc), env)).status, CONFLICTO);
  assert.deepEqual(
    objeto(await (await worker.fetch(panel('datos/estado', jwt, sesion), env)).json()).datos,
    cuerpo.estado,
  );
}
/** Con una reserva nueva, el panel sigue viendo la última observación admitida, marcada, y nunca como del trabajo nuevo. */
async function verificarObservacionAnteriorMarcada({ env, jwt, sesion, cuerpo, oidc }: CasoDatosWorker) {
  const final = await worker.fetch(panel('datos/trabajo', jwt, sesion), env);
  const trabajos = objeto(objeto(await final.json()).trabajos);
  const trabajo = objeto(trabajos.ultimoTrabajo);
  assert.equal(trabajo.estado, 'terminado');
  assert.equal(objeto(trabajo.resultado).resultado, 'validado');
  assert.ok(!JSON.stringify(trabajo).includes('confianza'));
  const siguiente = {
    ...SOLICITUD_ACTUALIZACION,
    solicitudId: '22222222-2222-4222-8222-222222222222',
    revisionEsperada: trabajos.revision,
  };
  assert.equal((await worker.fetch(panel('datos/actualizar', jwt, sesion, siguiente), env)).status, ACEPTADA);
  const durante = await worker.fetch(panel('datos/estado', jwt, sesion), env);
  assert.equal(durante.status, EXITO);
  const lectura = objeto(await durante.json());
  assert.deepEqual(lectura.datos, cuerpo.estado);
  assert.equal(lectura.deLaActualizacionAnterior, true);
  assert.equal((await worker.fetch(callback(cuerpo, oidc), env)).status, CONFLICTO);
}

test('Worker y binding real reservan antes de dispatch y reciben candidato OIDC sin Access humano ni API pública', async (t) => {
  const despachos: unknown[] = [];
  t.mock.method(globalThis, 'fetch', transporteActualizacion(despachos));
  const f = fixture({
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
    FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
    FARO_ACCESS_EQUIPO: 'equipo-prueba',
  });
  try {
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    const consulta = await worker.fetch(panel('datos/trabajo', jwt, sesion), f.env);
    assert.equal(consulta.status, EXITO);
    assert.equal(objeto(objeto(await consulta.json()).trabajos).revision, 0);
    assert.equal((await worker.fetch(panel('datos/estado', jwt, sesion), f.env)).status, NO_DISPONIBLE);
    const solicitar = () => worker.fetch(panel('datos/actualizar', jwt, sesion, SOLICITUD_ACTUALIZACION), f.env);
    assert.equal((await solicitar()).status, ACEPTADA);
    assert.equal((await solicitar()).status, EXITO);
    assert.deepEqual(despachos, [
      {
        ref: 'main',
        inputs: {
          solicitud_id: SOLICITUD_ACTUALIZACION.solicitudId,
          accion: 'actualizar-datos',
          revision_reserva: '1',
        },
        return_run_details: true,
      },
    ]);
    const cuerpo = resultadoCandidato();
    const oidc = await identidad.firmarOidc();
    assert.equal((await worker.fetch(callback(cuerpo, oidc), f.env)).status, CONFLICTO);
    await confirmarInicioWorker(f.env, jwt, oidc);
    const respuesta = await worker.fetch(callback(cuerpo, oidc), f.env);
    assert.equal(respuesta.status, EXITO);
    assert.deepEqual(await respuesta.json(), { estado: 'aplicado' });
    const caso = { env: f.env, jwt, sesion, cuerpo, oidc };
    await verificarObservacionAdmitida(caso);
    await verificarObservacionAnteriorMarcada(caso);
    assert.deepEqual(f.estaticos, []);
  } finally {
    f.db.close();
  }
});

test('Worker no entrega el estado de fuentes si la sesión se sustituye durante la lectura durable', async (t) => {
  t.mock.method(globalThis, 'fetch', transporteActualizacion([]));
  const f = fixture({
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
  });
  try {
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    assert.equal(
      (await worker.fetch(panel('datos/actualizar', jwt, sesion, SOLICITUD_ACTUALIZACION), f.env)).status,
      ACEPTADA,
    );
    const oidc = await identidad.firmarOidc();
    await confirmarInicioWorker(f.env, jwt, oidc);
    const cuerpo = resultadoCandidato();
    assert.equal((await worker.fetch(callback(cuerpo, oidc), f.env)).status, EXITO);
    const obtener = f.env.REGISTRO_SOCIOS.get;
    let nuevaSesion = '';
    t.mock.method(f.env.REGISTRO_SOCIOS, 'get', () => {
      const remoto = obtener();
      return {
        fetch: async (peticion: Request) => {
          const respuesta = await remoto.fetch(peticion);
          if (new URL(peticion.url).pathname === '/trabajos/datos-panel') {
            nuevaSesion = await abrir(f.env, jwt);
          }
          return respuesta;
        },
      };
    });
    const respuesta = await worker.fetch(panel('datos/estado', jwt, sesion), f.env);
    assert.equal(respuesta.status, CONFLICTO);
    assert.notEqual(nuevaSesion, '');
    const contenido = objeto(await respuesta.json());
    assert.equal(contenido.error, 'sesion_sustituida');
    assert.equal(Object.hasOwn(contenido, 'datos'), false);
    assert.equal(Object.hasOwn(contenido, 'deLaActualizacionAnterior'), false);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, nuevaSesion), f.env)).status, EXITO);
    assert.deepEqual(f.estaticos, []);
  } finally {
    f.db.close();
  }
});

test('credencial OAuth de lectura o Access humano no autoriza callback; sesión expulsada no inicia otro trabajo', async (t) => {
  const despachos: unknown[] = [];
  t.mock.method(globalThis, 'fetch', transporteActualizacion(despachos));
  const f = fixture({
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
  });
  try {
    const jwt = await identidad.firmar();
    const anterior = await abrir(f.env, jwt);
    await cambiar(f.env, jwt, anterior)(0, politica({ api: 'habilitada' }));
    await sembrarInstitucionAdmitida(f.db, SECRETO);
    const lectura = await tokenCliente(f.env);
    const estaticosPrevios = [...f.estaticos];
    assert.equal(
      (await worker.fetch(panel('datos/actualizar', jwt, anterior, SOLICITUD_ACTUALIZACION), f.env)).status,
      ACEPTADA,
    );
    for (const token of [lectura, jwt, 'token-estatico']) {
      assert.equal((await worker.fetch(callback(resultadoCandidato(), token), f.env)).status, NO_AUTENTICADO);
    }
    const nuevo = await abrir(f.env, jwt);
    const otra = {
      ...SOLICITUD_ACTUALIZACION,
      solicitudId: '22222222-2222-4222-8222-222222222222',
      revisionEsperada: 2,
    };
    assert.equal((await worker.fetch(panel('datos/actualizar', jwt, anterior, otra), f.env)).status, CONFLICTO);
    assert.equal((await worker.fetch(panel('datos/trabajo', jwt, nuevo), f.env)).status, EXITO);
    assert.equal(despachos.length, 1);
    assert.deepEqual(f.estaticos, estaticosPrevios);
  } finally {
    f.db.close();
  }
});

test('configuración rota del actualizador aísla su 503 y conserva controles y salud 200 sin adoptar trabajos', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture({
    FARO_ACTUALIZACION_GITHUB: '{',
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico',
  });
  try {
    const jwt = await identidad.firmar();
    const sesion = await abrir(f.env, jwt);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, sesion), f.env)).status, EXITO);
    assert.equal((await worker.fetch(request('/api/salud'), f.env)).status, EXITO);
    assert.equal((await cambiar(f.env, jwt, sesion)(0, politica({ mcp: true }))).status, EXITO);
    const solicitud = await worker.fetch(panel('datos/actualizar', jwt, sesion, SOLICITUD_ACTUALIZACION), f.env);
    assert.equal(solicitud.status, NO_DISPONIBLE);
    assert.equal(solicitud.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await solicitud.json(), { error: 'no_disponible' });
    const controles = await worker.fetch(panel('controles/leer', jwt, sesion), f.env);
    assert.equal(controles.status, EXITO);
    assert.deepEqual(objeto(await controles.json()).controles, { ...politica({ mcp: true }), revision: 1 });
    assert.equal((await worker.fetch(request('/api/salud'), f.env)).status, EXITO);
    assert.equal(f.rutas.filter((ruta) => ruta === '/panel/preparar').length, 1);
    assert.ok(f.rutas.every((ruta) => !ruta.startsWith('/trabajos/')));
    assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='administracion_trabajo'").get(), undefined);
  } finally {
    f.db.close();
  }
});

test('Worker monta activación OIDC optativa sobre el binding privado y conserva salud ante configuración inválida', async (t) => {
  t.mock.method(globalThis, 'fetch', transporteActualizacion([]));
  for (const flag of ['si', 'sí']) {
    const f = fixture({
      FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
      FARO_ACTUALIZACION_GITHUB_TOKEN: 'sintetico',
      FARO_ACTIVACION_AUTOMATICA: flag,
    });
    try {
      const oidc = await identidad.firmarOidc();
      const leer = () => worker.fetch(callback({ operacion: 'leer' }, oidc, '/mantenimiento/activacion'), f.env);
      const respuesta = await leer();
      assert.equal(respuesta.status, flag === 'si' ? EXITO : NO_DISPONIBLE);
      if (flag === 'si') {
        assert.deepEqual(await respuesta.json(), {
          estado: 'leido',
          activacion: { version: 1, revision: 0, ultimaActivacion: null },
        });
        assert.ok(f.rutas.includes('/activacion/leer'));
        assert.equal(
          (
            await worker.fetch(
              callback({ operacion: 'leer' }, await identidad.firmar(), '/mantenimiento/activacion'),
              f.env,
            )
          ).status,
          NO_AUTENTICADO,
        );
      }
      assert.deepEqual(f.estaticos, []);
      assert.equal((await worker.fetch(request('/api/salud'), f.env)).status, EXITO);
    } finally {
      f.db.close();
    }
  }
});

test('procedimiento de preparación exige Access humano y conserva la autoridad durable', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const config = { ...CONFIG_VIGILANTE, activadoEn: Date.now() - MS_POR_SEGUNDO };
  const f = fixture({ FARO_VIGILANTE: JSON.stringify(config) });
  try {
    const jwt = await identidad.firmar();
    const previa = await abrir(f.env, jwt);
    const cliente = new AlmacenVigilanteDurable(f.env.REGISTRO_SOCIOS);
    await cliente.prepararTrabajos();
    await cliente.prepararActivacion();
    assert.equal((await worker.fetch(panel('datos/vigilante/preparar'), f.env)).status, PROHIBIDO);
    // El procedimiento abre su propia sesión única: con otra abierta quedaría bloqueado.
    assert.equal((await worker.fetch(panel('sesion/cerrar', jwt, previa), f.env)).status, EXITO);
    const pasos: string[] = [];
    await prepararVigilanteRemoto(async (ruta, token) => {
      pasos.push(ruta);
      const respuesta = await worker.fetch(panel(ruta, jwt, token), f.env);
      assert.equal(respuesta.status, EXITO);
      return respuesta.json();
    });
    assert.deepEqual(pasos, ['sesion/abrir', 'datos/vigilante/preparar', 'sesion/cerrar']);
    assert.ok(f.rutas.includes('/vigilante/preparar'));
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
      1,
    );
  } finally {
    f.db.close();
  }
});

test('preparación no crea autoridades de mantenimiento ausentes', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const config = { ...CONFIG_VIGILANTE, activadoEn: Date.now() - MS_POR_SEGUNDO };
  const f = fixture({ FARO_VIGILANTE: JSON.stringify(config) });
  try {
    const jwt = await identidad.firmar();
    const token = await abrir(f.env, jwt);
    const respuesta = await worker.fetch(panel('datos/vigilante/preparar', jwt, token), f.env);
    assert.equal(respuesta.status, NO_DISPONIBLE);
    const nombres = [
      'administracion_trabajo',
      'administracion_programacion',
      'administracion_activacion',
      'administracion_vigilante',
    ];
    for (const nombre of nombres) {
      assert.equal(f.db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get(nombre)?.n, 0);
    }
  } finally {
    f.db.close();
  }
});

test('política de vigilante inválida no bloquea el panel ni prepara autoridades', async (t) => {
  t.mock.method(globalThis, 'fetch', identidad.pedir);
  const f = fixture({
    FARO_VIGILANTE: '{invalido',
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
  });
  try {
    const jwt = await identidad.firmar();
    const token = await abrir(f.env, jwt);
    assert.equal((await worker.fetch(panel('controles/leer', jwt, token), f.env)).status, EXITO);
    const resultado = await worker.fetch(panel('datos/comprobar-estado', jwt, token), f.env);
    assert.equal(resultado.status, NO_DISPONIBLE);
    assert.equal(objeto(await resultado.json()).error, 'vigilante_configuracion_invalida');
    assert.ok(!f.rutas.includes('/vigilante/preparar'));
    assert.equal(
      f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='administracion_vigilante'").get()?.n,
      0,
    );
    assert.equal((await worker.fetch(panel('datos/trabajo', jwt, token), f.env)).status, EXITO);
  } finally {
    f.db.close();
  }
});

const DESTINO_AVISO = 'https://avisos.example/faro';
/** Vigilante preparado por su procedimiento, sesión abierta y una reserva despachada que espera su inicio. */
async function reservaConVigilante(f: ReturnType<typeof fixture>) {
  const jwt = await identidad.firmar();
  const previa = await abrir(f.env, jwt);
  const cliente = new AlmacenVigilanteDurable(f.env.REGISTRO_SOCIOS);
  await cliente.prepararTrabajos();
  await cliente.prepararActivacion();
  await worker.fetch(panel('sesion/cerrar', jwt, previa), f.env);
  await prepararVigilanteRemoto(async (ruta, token) => (await worker.fetch(panel(ruta, jwt, token), f.env)).json());
  const sesion = await abrir(f.env, jwt);
  const solicitud = await worker.fetch(panel('datos/actualizar', jwt, sesion, SOLICITUD_ACTUALIZACION), f.env);
  assert.equal(solicitud.status, ACEPTADA);
  return jwt;
}
test('Worker: un inicio rechazado responde el mismo 401 y deja un solo aviso en waitUntil', async (t) => {
  type Aviso = { decisiones: { clave: string; motivo: string }[] };
  const avisos: Aviso[] = [];
  const transporte = transporteActualizacion([]);
  t.mock.method(globalThis, 'fetch', async (entrada: Parameters<typeof fetch>[0], opciones?: RequestInit) => {
    const peticion = new Request(entrada, opciones);
    if (peticion.url !== DESTINO_AVISO) {
      return transporte(entrada, opciones);
    }
    avisos.push((await peticion.json()) as Aviso);
    return new Response(null, { status: ACEPTADA });
  });
  const config = { ...CONFIG_VIGILANTE, activadoEn: Date.now() - MS_POR_SEGUNDO };
  const f = fixture({
    FARO_VIGILANTE: JSON.stringify(config),
    FARO_ACTUALIZACION_GITHUB: CONFIGURACION_ACTUALIZACION,
    FARO_ACTUALIZACION_GITHUB_TOKEN: 'token-sintetico-privado',
    FARO_AVISO_URL: DESTINO_AVISO,
  });
  try {
    const jwt = await reservaConVigilante(f);
    const tareas: Promise<unknown>[] = [];
    const contexto = { waitUntil: (tarea: Promise<unknown>) => void tareas.push(tarea) };
    const inicio = { solicitudId: SOLICITUD_ACTUALIZACION.solicitudId, revisionReserva: 1, accion: 'actualizar-datos' };
    const otra = await identidad.firmarOidc({ sha: 'e'.repeat(TAM_SHA) });
    for (const token of [otra, otra, jwt]) {
      const respuesta = await worker.fetch(callback(inicio, token, '/mantenimiento/inicio'), f.env, contexto);
      assert.equal(respuesta.status, NO_AUTENTICADO);
      assert.deepEqual(await respuesta.json(), { error: 'no_autorizado' });
    }
    assert.equal(tareas.length, 1);
    await Promise.all(tareas);
    assert.equal(avisos.length, 1);
    assert.ok(avisos[0]?.decisiones.some((d) => d.clave === 'ejecutor' && d.motivo === 'inicio_rechazado'));
  } finally {
    f.db.close();
  }
});
