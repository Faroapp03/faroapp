/** Frontera HTTP, JWT firmado y dos conexiones SQLite privadas; sin red ni cuentas reales. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearRouterAdministrativo } from '../../src/administracion/http.ts';
import { LIMITES_CONECTIVIDAD } from '../../src/administracion/instituciones.ts';
import { crearApi, type ResponderApi } from '../../src/api/api.ts';
import { huellaDelSecreto } from '../../src/api/socios/registro.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { sha256Hex } from '../../src/comun/huella.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { MS_POR_SEGUNDO } from '../../src/comun/tiempo.ts';
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const AHORA = Date.parse('2026-10-16T12:00:00Z');
const DURACION_IDENTIDAD_S = 3600;
const EXPIRA_SEGUNDOS = AHORA / MS_POR_SEGUNDO + DURACION_IDENTIDAD_S;
const RSA_BITS = 2048;
const ORIGEN = 'https://panel.example';
const EMISOR = 'https://prueba.cloudflareaccess.com';
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const politica = {
  version: 2 as const,
  api: 'habilitada' as const,
  mcp: false,
  a2a: false,
};

async function identidad() {
  const claves = await crypto.subtle.generateKey(
    {
      ...ALGORITMO,
      modulusLength: RSA_BITS,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', claves.publicKey);
  const cabecera = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'prueba' })).toString('base64url');
  const contenido = Buffer.from(
    JSON.stringify({
      iss: EMISOR,
      aud: ['panel'],
      sub: 'persona',
      email: 'persona@faro.invalid',
      iat: 1_900_000_000,
      type: 'app',
      exp: EXPIRA_SEGUNDOS,
    }),
  ).toString('base64url');
  const entrada = `${cabecera}.${contenido}`;
  const firma = await crypto.subtle.sign(ALGORITMO, claves.privateKey, new TextEncoder().encode(entrada));
  const jwt = `${entrada}.${Buffer.from(firma).toString('base64url')}`;
  const guardia = guardiaAdministrativaDelEntorno(
    { FARO_ADMIN_ACCESS_EQUIPO: 'prueba', FARO_ADMIN_ACCESS_AUD: 'panel' },
    async (url, opciones) => {
      assert.equal(String(url), `${EMISOR}/cdn-cgi/access/certs`);
      assert.equal(new Headers(opciones?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
      return Response.json({ keys: [{ ...publica, kid: 'prueba' }] });
    },
    () => AHORA,
  );
  return { jwt, guardia };
}
function peticion(jwt: string, operacion: string, token = '', cuerpo: object = {}): Request {
  return new Request(`${ORIGEN}/administracion/api/${operacion}`, {
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
async function tokenDe(respuesta: Response): Promise<string> {
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.has('set-cookie'), false);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  return cuerpo.token;
}

test('panel HTTP real con JWT: segunda pestaña expulsa primera incluso con la misma identidad Access', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'panel-integracion-'));
  const opciones = { archivo: join(dir, 'estado.sqlite'), maxClientes: 2, ahora: () => AHORA };
  const a = crearAlmacenPublicoNode(opciones);
  const b = crearAlmacenPublicoNode(opciones);
  try {
    await a.sesion.prepararPanel(politica);
    const { jwt, guardia } = await identidad();
    const uno = crearRouterAdministrativo({ guardiaAdministrativa: guardia, almacen: a.sesion, origen: ORIGEN });
    const dos = crearRouterAdministrativo({ guardiaAdministrativa: guardia, almacen: b.sesion, origen: ORIGEN });
    const anterior = await tokenDe(await uno(peticion(jwt, 'sesion/abrir', '', { retomar: true })));
    // Otro arranque comparte estado, pero no sustituye una sesión hasta una apertura explícita.
    await b.sesion.prepararPanel(politica);
    assert.equal((await uno(peticion(jwt, 'sesion/estado', anterior))).status, ESTADO_HTTP.correcto);
    const nuevo = await tokenDe(await dos(peticion(jwt, 'sesion/abrir', '', { retomar: true })));
    assert.notEqual(anterior, nuevo);
    for (const ruta of ['sesion/estado', 'sesion/actividad', 'sesion/cerrar', 'controles/leer']) {
      const rechazo = await uno(peticion(jwt, ruta, anterior));
      assert.equal(rechazo.status, ESTADO_HTTP.conflicto);
      assert.deepEqual(await rechazo.json(), { error: 'sesion_sustituida' });
    }
    const cambio = { revisionEsperada: 0, politica: { ...politica, mcp: true } };
    assert.equal((await uno(peticion(jwt, 'controles/cambiar', anterior, cambio))).status, ESTADO_HTTP.conflicto);
    assert.equal((await dos(peticion('', 'controles/cambiar', nuevo, cambio))).status, ESTADO_HTTP.prohibido);
    assert.deepEqual(await a.leerControles(), { ...politica, revision: 0 });
    assert.equal((await dos(peticion(jwt, 'controles/cambiar', nuevo, cambio))).status, ESTADO_HTTP.correcto);
    assert.deepEqual(await a.leerControles(), { ...cambio.politica, revision: 1 });
    assert.equal((await dos(peticion(jwt, 'sesion/cerrar', nuevo))).status, ESTADO_HTTP.correcto);
    assert.equal((await dos(peticion(jwt, 'controles/leer', nuevo))).status, ESTADO_HTTP.prohibido);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true });
  }
});

const SECRETO_API = 'credencial-sintetica-de-integracion-sin-cuenta-real';
const CONSULTAS_RESTANTES = 2;
const SOCIO = {
  id: 'inst-11111111-1111-4111-8111-111111111111',
  huellas: [huellaDelSecreto(SECRETO_API)],
  consultasPorHora: LIMITES_CONECTIVIDAD.consultasPorInstitucionHora,
};
const INICIAL_API = { ...politica, api: 'habilitada' as const };

async function apiPersistida(almacen: ReturnType<typeof crearAlmacenPublicoNode>): Promise<ResponderApi> {
  return crearApi({
    datos: cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))),
    origenesPermitidos: [],
    seguridad: { secretoFirma: SECRETO_API },
    administracion: {
      leerControles: async () => {
        const controles = await almacen.leerControles();
        assert.ok(controles);
        return controles;
      },
      socios: { instituciones: almacen.instituciones, accesos: almacen.accesos, almacen },
      registrarAcceso: (uso) => almacen.accesos.registrarAcceso(uso),
    },
  });
}
async function emitirTokenApi(api: ResponderApi): Promise<string> {
  const respuesta = await api(
    new Request(`${ORIGEN}/api/socios/v1/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      headers: { authorization: `Basic ${btoa(`${SOCIO.id}:${SECRETO_API}`)}` },
    }),
  );
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const credencial: unknown = await respuesta.json();
  assert.ok(esObjeto(credencial) && typeof credencial.access_token === 'string');
  return credencial.access_token;
}
function consultarMcp(api: ResponderApi): Promise<Response> {
  return api(
    new Request(`${ORIGEN}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'explorar_grupos', arguments: { padre: '4' } },
      }),
    }),
  );
}
async function comprobarAlternancia(
  api: ResponderApi,
  cambiar: (revision: number, activa: boolean) => Promise<Response>,
) {
  const token = await emitirTokenApi(api);
  const consultar = () =>
    api(
      new Request(`${ORIGEN}/api/socios/v1/consultas/explorar_grupos?padre=4`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  assert.equal((await consultar()).status, ESTADO_HTTP.correcto);
  assert.equal((await cambiar(0, false)).status, ESTADO_HTTP.correcto);
  assert.equal((await consultar()).status, ESTADO_HTTP.noEncontrado);
  assert.equal((await consultarMcp(api)).status, ESTADO_HTTP.correcto);
  assert.equal((await cambiar(1, true)).status, ESTADO_HTTP.correcto);
  assert.equal((await consultarMcp(api)).status, ESTADO_HTTP.noEncontrado);
  assert.equal((await consultar()).status, ESTADO_HTTP.correcto);
  assert.equal((await consultar()).status, ESTADO_HTTP.demasiadasPeticiones);
}

async function consumirCuotaAnterior(almacen: ReturnType<typeof crearAlmacenPublicoNode>): Promise<void> {
  // Dejamos dos lecturas de la cuota vigente para contrastar cierre/reapertura sin cambiar su cifra.
  for (let n = CONSULTAS_RESTANTES; n < SOCIO.consultasPorHora; n++) {
    assert.equal(
      await almacen.consumir([
        { clave: `consultas:cliente:${SOCIO.id}`, limite: SOCIO.consultasPorHora, ventanaMs: 3_600_000 },
      ]),
      true,
    );
  }
}

test('cambios administrativos firmados gobiernan la API viva y conservan credencial, token y cuota', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'panel-api-integracion-'));
  const almacen = crearAlmacenPublicoNode({
    archivo: join(dir, 'estado.sqlite'),
    maxClientes: 2,
  });
  try {
    await almacen.sesion.prepararPanel(INICIAL_API);
    const { jwt, guardia } = await identidad();
    const panel = crearRouterAdministrativo({
      guardiaAdministrativa: guardia,
      almacen: almacen.sesion,
      origen: ORIGEN,
    });
    const sesion = await tokenDe(await panel(peticion(jwt, 'sesion/abrir', '', { retomar: true })));
    await almacen.instituciones.prepararInstituciones();
    const acceso = { huellaSesion: sha256Hex(sesion), huellaPrincipal: sha256Hex(JSON.stringify([EMISOR, 'persona'])) };
    const invitacion = { id: '22222222-2222-4222-8222-222222222222', huella: huellaDelSecreto('invitacion sintética') };
    const creada = await almacen.instituciones.invitarInstitucionDeSesion(
      acceso,
      { revisionEsperada: 0, nombre: 'Institución de integración', correo: null },
      { ...invitacion, institucionId: SOCIO.id },
    );
    assert.equal(creada.estado, 'cambiado');
    assert.equal(
      (
        await almacen.instituciones.activarInvitacion(invitacion, {
          id: '33333333-3333-4333-8333-333333333333',
          huella: SOCIO.huellas[0] ?? '',
        })
      ).estado,
      'activada',
    );
    await consumirCuotaAnterior(almacen);
    const api = await apiPersistida(almacen);
    await comprobarAlternancia(api, (revisionEsperada, apiActiva) =>
      panel(
        peticion(jwt, 'controles/cambiar', sesion, {
          revisionEsperada,
          politica: { ...INICIAL_API, api: apiActiva ? 'habilitada' : 'deshabilitada', mcp: !apiActiva },
        }),
      ),
    );
    assert.deepEqual(await almacen.instituciones.buscarInstitucion(SOCIO.id), SOCIO);
    assert.equal((await almacen.leerControles())?.revision, 2);
  } finally {
    almacen.close();
    rmSync(dir, { recursive: true });
  }
});
