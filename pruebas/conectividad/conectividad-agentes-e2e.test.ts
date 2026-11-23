/** Montajes reales con SQLite sintética: interruptores independientes y consultas útiles, sin red externa. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerPaginaAccesosRecibida } from '../../src/administracion/accesos.ts';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { VERSION_A2A } from '../../src/api/a2a/tarjeta.ts';
import { RUTA_ESTADO_CONECTIVIDAD } from '../../src/api/estado-conectividad.ts';
import { META, VERSION_MODERNA } from '../../src/api/mcp/protocolo.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { type ServidorConectividadPrueba, servidorConectividadPrueba } from '../ayudas/conectividad-servidores.ts';

const HERRAMIENTAS_PUBLICADAS = 8,
  CLIENTES_PROBADOS = 4;
const OK = 200,
  AUSENTE = 404,
  NO_DISPONIBLE = 503;
async function objeto(r: Response) {
  assert.equal(r.status, OK);
  const o: unknown = await r.json();
  assert(esObjeto(o));
  return o;
}
async function abrir(s: ServidorConectividadPrueba): Promise<string> {
  const o = await objeto(await s.panel('sesion/abrir'));
  assert(typeof o.token === 'string');
  return o.token;
}
async function cambiar(
  s: ServidorConectividadPrueba,
  sesion: string,
  revision: number,
  politica: Omit<PoliticaControles, 'version'>,
): Promise<void> {
  await objeto(
    await s.panel('controles/cambiar', { revisionEsperada: revision, politica: { version: 2, ...politica } }, sesion),
  );
}
function estado(s: ServidorConectividadPrueba): Promise<Response> {
  return s.pedir(RUTA_ESTADO_CONECTIVIDAD, { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } });
}
async function comprobarEstado(s: ServidorConectividadPrueba, servicios: { api: boolean; mcp: boolean; a2a: boolean }) {
  const r = await estado(s);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const o = await objeto(r);
  assert.equal(o.version, 1);
  assert.deepEqual(o.servicios, servicios);
  assert(typeof o.comprobadoEn === 'string');
  assert.equal(new Date(o.comprobadoEn).toISOString(), o.comprobadoEn);
}
function rpcConCabeceras(
  s: ServidorConectividadPrueba,
  ruta: string,
  { method, params, headers = {} }: { method: string; params: object; headers?: Record<string, string> },
) {
  return s.pedir(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
function rpc(s: ServidorConectividadPrueba, ruta: string, method: string, params: object) {
  return rpcConCabeceras(s, ruta, { method, params });
}
async function fichaMcp(s: ServidorConectividadPrueba, nombre?: string) {
  const modernas =
    nombre === undefined
      ? {}
      : {
          _meta: {
            [META.version]: VERSION_MODERNA,
            [META.capacidades]: {},
            [META.cliente]: { name: nombre, version: '1' },
          },
        };
  const headers =
    nombre === undefined
      ? {}
      : { 'mcp-protocol-version': VERSION_MODERNA, 'mcp-method': 'tools/call', 'mcp-name': 'ficha_grupo' };
  const o = await objeto(
    await rpcConCabeceras(s, '/mcp', {
      method: 'tools/call',
      params: { name: 'ficha_grupo', arguments: { isco: '4224' }, ...modernas },
      headers,
    }),
  );
  assert(esObjeto(o.result) && esObjeto(o.result.structuredContent));
  const ficha = o.result.structuredContent;
  assert.equal(ficha.isco08, '4224');
  assert(Array.isArray(ficha.tareas) && ficha.tareas.length > 0);
  assert(Object.hasOwn(ficha, 'procedencia'));
  return ficha;
}
async function fichaA2a(s: ServidorConectividadPrueba) {
  const o = await objeto(
    await rpcConCabeceras(s, '/a2a', {
      method: 'SendMessage',
      params: {
        message: {
          role: 'ROLE_USER',
          messageId: 'sintetico',
          parts: [{ data: { skill: 'ficha_grupo', arguments: { isco: '4224' } } }],
        },
      },
      headers: { 'a2a-version': VERSION_A2A },
    }),
  );
  assert(esObjeto(o.result) && esObjeto(o.result.message) && Array.isArray(o.result.message.parts));
  const parte: unknown = o.result.message.parts[0];
  assert(esObjeto(parte));
  return parte.data;
}
for (const modo of ['Node', 'Worker'] as const) {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: una misma autoridad prueba apertura, consultas registradas y cierre independiente, sin recrear servidor.
  test(`${modo}: tres interruptores, MCP y A2A útiles con registro mínimo y nombres solo de cada petición`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, false);
    try {
      const sesion = await abrir(s);
      await comprobarEstado(s, { api: false, mcp: false, a2a: false });
      assert.equal((await rpc(s, '/mcp', 'tools/list', {})).status, AUSENTE);
      assert.equal((await rpc(s, '/a2a', 'SendMessage', {})).status, AUSENTE);
      await cambiar(s, sesion, 0, { api: 'deshabilitada', mcp: true, a2a: true });
      await comprobarEstado(s, { api: false, mcp: true, a2a: true });
      const bienvenida = await objeto(
        await rpc(s, '/mcp', 'initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'Cliente inicial', version: '1' },
        }),
      );
      assert(esObjeto(bienvenida.result));
      const lista = await objeto(await rpc(s, '/mcp', 'tools/list', {}));
      assert(esObjeto(lista.result) && Array.isArray(lista.result.tools));
      assert.equal(lista.result.tools.length, HERRAMIENTAS_PUBLICADAS);
      const original = await fichaMcp(s);
      assert.deepEqual(await fichaMcp(s, 'Cliente uno'), original);
      assert.deepEqual(await fichaMcp(s, 'Cliente dos'), original);
      const datoPersonal = 'persona@correo.example';
      assert.deepEqual(await fichaMcp(s, datoPersonal), original);
      assert.deepEqual(await fichaA2a(s), original);
      assert.deepEqual(await fichaA2a(s), original);
      const respuesta = await objeto(await s.panel('accesos/leer', { pagina: 1 }, sesion));
      const accesos = leerPaginaAccesosRecibida(respuesta.accesos);
      assert.equal(accesos.api.length, 0);
      assert.equal(accesos.mcp.length, CLIENTES_PROBADOS);
      assert.equal(
        accesos.mcp.reduce((n, f) => n + f.consultas, 0),
        CLIENTES_PROBADOS,
      );
      assert.deepEqual(
        accesos.mcp.map((f) => [f.clienteDeclarado, f.categoriaCliente]).sort(),
        [
          [null, 'no_declarado'],
          [null, 'omitido'],
          ['Cliente uno', 'declarado'],
          ['Cliente dos', 'declarado'],
        ].sort(),
      );
      assert(!JSON.stringify(s.filas('conectividad_uso')).includes(datoPersonal));
      assert(!JSON.stringify(s.filas('conectividad_uso')).includes('Cliente inicial'));
      assert.equal(accesos.a2a[0]?.habilidad, 'ficha_grupo');
      assert.equal(accesos.a2a[0]?.consultas, 2);
      assert.equal((await s.pedir('/.well-known/oauth-authorization-server/api/socios/v1')).status, AUSENTE);
      await cambiar(s, sesion, 1, { api: 'habilitada', mcp: false, a2a: true });
      await comprobarEstado(s, { api: true, mcp: false, a2a: true });
      assert.equal((await rpc(s, '/mcp', 'tools/list', {})).status, AUSENTE);
      assert.deepEqual(await fichaA2a(s), original);
      await cambiar(s, sesion, 2, { api: 'deshabilitada', mcp: false, a2a: false });
      await comprobarEstado(s, { api: false, mcp: false, a2a: false });
      assert.equal((await rpc(s, '/a2a', 'SendMessage', {})).status, AUSENTE);
      assert.equal((await s.pedir('/.well-known/agent-card.json')).status, AUSENTE);
      const catalogo = await s.pedir('/.well-known/api-catalog');
      assert.equal(catalogo.status, OK);
      assert.doesNotMatch(await catalogo.text(), /\/mcp|\/a2a|\/api\/socios/);
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: OpenAPI y llms siguen controles vivos, HEAD limpio y autoridad ilegible sin anuncios almacenados`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, false);
    try {
      const sesion = await abrir(s);
      const pedirDescripcion = (ruta: string, method = 'GET') =>
        s.pedir(ruta, {
          method,
          headers: { 'if-none-match': 'fixture', 'if-modified-since': 'fixture', authorization: 'privado' },
        });
      const antes = await pedirDescripcion('/llms.txt');
      assert.equal(antes.status, OK);
      assert.equal(antes.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await antes.text(), /\]\(\/mcp\)|\]\(\/a2a\)|API para instituciones/);
      await cambiar(s, sesion, 0, { api: 'habilitada', mcp: true, a2a: true });
      const actual = await pedirDescripcion('/llms.txt');
      assert.equal(actual.status, OK);
      assert.match(await actual.text(), /\]\(\/mcp\)/);
      const head = await pedirDescripcion('/openapi.json', 'HEAD');
      assert.equal(head.status, OK);
      assert.equal(await head.text(), '');
      const api = await pedirDescripcion('/openapi.json');
      assert.equal(api.status, OK);
      assert.match(await api.text(), /api\/socios\/v1\/token/);
      s.perderControles();
      for (const ruta of ['/llms.txt', '/openapi.json']) {
        const r = await pedirDescripcion(ruta);
        assert.equal(r.status, NO_DISPONIBLE);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.doesNotMatch(await r.text(), /\]\(\/mcp\)|Bearer|paths/);
      }
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: pérdida de autoridad devuelve desconocido 503, nunca tres servicios apagados ni fallback`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, true);
    try {
      const sesion = await abrir(s);
      await cambiar(s, sesion, 0, { api: 'habilitada', mcp: true, a2a: true });
      await comprobarEstado(s, { api: true, mcp: true, a2a: true });
      s.perderControles();
      const r = await estado(s);
      assert.equal(r.status, NO_DISPONIBLE);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await r.json(), { error: 'controles_no_disponibles' });
      assert.equal((await rpc(s, '/mcp', 'tools/list', {})).status, NO_DISPONIBLE);
      assert.equal((await rpc(s, '/a2a', 'SendMessage', {})).status, NO_DISPONIBLE);
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: registro averiado impide entregar consultas, mantiene estado confirmado y permite apagar desde el panel`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, false);
    try {
      const sesion = await abrir(s);
      await cambiar(s, sesion, 0, { api: 'deshabilitada', mcp: true, a2a: true });
      await fichaMcp(s);
      s.perderRegistro();
      const mcp = await rpc(s, '/mcp', 'tools/call', { name: 'ficha_grupo', arguments: { isco: '4224' } });
      assert.equal(mcp.status, NO_DISPONIBLE);
      assert.doesNotMatch(await mcp.text(), /structuredContent|Estado de|sqlite|tareas/);
      const a2a = await rpcConCabeceras(s, '/a2a', {
        method: 'SendMessage',
        params: {
          message: { parts: [{ data: { skill: 'ficha_grupo', arguments: { isco: '4224' } } }] },
        },
        headers: { 'a2a-version': VERSION_A2A },
      });
      assert.equal(a2a.status, NO_DISPONIBLE);
      await comprobarEstado(s, { api: false, mcp: true, a2a: true });
      const lectura = await s.panel('accesos/leer', { pagina: 1 }, sesion);
      assert.equal(lectura.status, NO_DISPONIBLE);
      await cambiar(s, sesion, 1, { api: 'deshabilitada', mcp: false, a2a: false });
      await comprobarEstado(s, { api: false, mcp: false, a2a: false });
      assert.equal((await rpc(s, '/mcp', 'tools/list', {})).status, AUSENTE);
    } finally {
      await s.cerrar();
    }
  });
  test(`${modo}: sin administración y con todo apagado las rutas dan 404; estado confirmado sin revisión y API factual conservada`, async (t) => {
    const s = await servidorConectividadPrueba(t, modo, false, false);
    try {
      await comprobarEstado(s, { api: false, mcp: false, a2a: false });
      assert.equal(
        (await rpc(s, '/mcp', 'tools/call', { name: 'ficha_grupo', arguments: { isco: '4224' } })).status,
        AUSENTE,
      );
      assert.equal(
        (
          await rpcConCabeceras(s, '/a2a', {
            method: 'SendMessage',
            params: { message: { parts: [{ data: { skill: 'ficha_grupo', arguments: { isco: '4224' } } }] } },
            headers: { 'a2a-version': VERSION_A2A },
          })
        ).status,
        AUSENTE,
      );
      for (const ruta of [
        '/.well-known/agent-card.json',
        '/api/socios/v1/token',
        '/api/socios/v1/consultas/ficha_grupo?isco=4224',
      ]) {
        assert.equal((await s.pedir(ruta)).status, AUSENTE);
      }
      const factual = await s.pedir('/api/grupos/4224', { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } });
      assert.equal(factual.status, OK);
      const cuerpo = await objeto(factual);
      assert.equal(cuerpo.isco08, '4224');
    } finally {
      await s.cerrar();
    }
  });
}
