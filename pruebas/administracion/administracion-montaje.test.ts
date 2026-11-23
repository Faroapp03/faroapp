import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import type { ConfianzaOidcGitHub } from '../../src/administracion/oidc-github.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { sha256Hex } from '../../src/comun/huella.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import {
  esRutaAdministrativa,
  esRutaApiAdministrada,
  montarAdministracion,
  politicaInicialAdministrativa,
} from '../../src/plataforma/administracion.ts';

import { opcionesDelEntorno } from '../../src/plataforma/configuracion.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';
import { principalDePrueba } from '../ayudas/principal-panel.ts';

const ORIGEN = 'https://panel.example';
const PREPARADA: PoliticaControles = {
  version: 2,
  api: 'habilitada',
  mcp: false,
  a2a: false,
};
test('semilla administrativa conserva tres interruptores exactos; la composición rechaza configuración ajena', () => {
  assert.deepEqual(politicaInicialAdministrativa({}), { ...PREPARADA, api: 'deshabilitada' });
  assert.deepEqual(politicaInicialAdministrativa({ FARO_API_SOCIOS: 'si', FARO_MCP: 'si' }), {
    ...PREPARADA,
    mcp: true,
  });
  for (const variables of [{ FARO_API_SOCIOS: 'SI' }, { FARO_MCP: 'sí' }]) {
    assert.throws(() => politicaInicialAdministrativa(variables));
  }
  assert.throws(() => variablesDelServicio({ ajena: 'privado' }));
});

test('rutas reservadas incluyen alias codificados y normalización que podría efectuar un servidor de archivos', () => {
  for (const ruta of [
    '/mcp',
    '/mcp/',
    '/mc%70',
    '/MCP',
    '/x/%2e%2e%2fmcp',
    '/x%2f..%2fa2a',
    '//.well-known//agent-card.json',
    '/%61pi/salud',
    '/api/../mcp',
    '/api\\salud',
  ]) {
    assert.equal(esRutaApiAdministrada(ruta), true, ruta);
  }
  for (const ruta of [
    '/administracion',
    '/Administracion/',
    '/%61dministracion/api/sesion/abrir',
    '/x/%2e%2e%2fadministracion/api/sesion/abrir',
    '//administracion//api',
  ]) {
    assert.equal(esRutaAdministrativa(ruta), true, ruta);
  }
  for (const ruta of ['/inicio', '/administracion-publica', '/mcp.txt', '/%E0%A4%A']) {
    assert.equal(esRutaAdministrativa(ruta), false, ruta);
    assert.equal(esRutaApiAdministrada(ruta), false, ruta);
  }
});

async function montaje(t: TestContext) {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'panel-montaje-'));
  const almacen = crearAlmacenPublicoNode({
    archivo: join(carpeta, 'estado.sqlite'),
    maxClientes: 2,
  });
  t.after(() => {
    almacen.close();
    rmSync(carpeta, { recursive: true });
  });
  const opciones = {
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    almacen,
    sesion: almacen.sesion,
    inicial: PREPARADA,

    guardiaAdministrativa: async (peticion: Request) =>
      peticion.headers.get('cf-access-jwt-assertion') === 'fixture'
        ? principalDePrueba('https://fixture.cloudflareaccess.com', 'persona')
        : null,
  };
  return { almacen, opciones, panel: await montarAdministracion(opciones) };
}
function peticion(ruta: string, token = '', cuerpo: object = {}, identidad = 'fixture') {
  return new Request(`${ORIGEN}/administracion/api/${ruta}`, {
    method: 'POST',
    body: JSON.stringify(cuerpo),
    headers: {
      origin: ORIGEN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-faro-panel': '1',
      'x-faro-sesion': token,
      'cf-access-jwt-assertion': identidad,
    },
  });
}
async function abrir(panel: Awaited<ReturnType<typeof montarAdministracion>>): Promise<string> {
  const respuesta = await panel.responder(peticion('sesion/abrir'));
  assert.equal(respuesta.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await respuesta.json();
  assert.ok(esObjeto(cuerpo) && typeof cuerpo.token === 'string');
  return cuerpo.token;
}

test('montaje repite arranque sin expulsar; una política inválida no altera revisión ni datos', async (t) => {
  const { almacen, opciones, panel } = await montaje(t);
  const token = await abrir(panel);
  const segundo = await montarAdministracion({ ...opciones, inicial: { ...PREPARADA, mcp: true } });
  assert.equal((await segundo.responder(peticion('sesion/estado', token))).status, ESTADO_HTTP.correcto);
  const cambio = { revisionEsperada: 0, politica: { ...PREPARADA, api: 'valor-no-admitido' } };
  assert.equal(
    (await panel.responder(peticion('controles/cambiar', token, cambio))).status,
    ESTADO_HTTP.solicitudIncorrecta,
  );
  assert.deepEqual(await almacen.leerControles(), { ...PREPARADA, revision: 0 });
  assert.equal((await panel.responder(peticion('controles/leer', token, {}, ''))).status, ESTADO_HTTP.prohibido);
  assert.equal((await panel.responder(peticion('sesion/estado', token))).status, ESTADO_HTTP.correcto);
});

test('catálogo refleja revisiones sin caché y rechaza indisponibilidad sin anunciar un catálogo vacío', async (t) => {
  const { almacen, panel } = await montaje(t);
  const pedir = (method = 'GET') => panel.catalogo(new Request(`${ORIGEN}/.well-known/api-catalog`, { method }));
  const anterior = await pedir();
  assert.equal(anterior.headers.get('cache-control'), 'no-store');
  assert.equal((await anterior.text()).includes('/mcp'), false);
  await almacen.cambiarControles(0, { ...PREPARADA, mcp: true, a2a: true });
  const actual = await pedir();
  assert.equal((await actual.text()).includes('/mcp'), true);
  assert.equal((await pedir('HEAD')).body, null);
  assert.equal((await pedir('POST')).status, ESTADO_HTTP.metodoNoAdmitido);
  almacen.leerControles = async () => null;
  const fallo = await pedir();
  assert.equal(fallo.status, ESTADO_HTTP.noDisponible);
  assert.equal(fallo.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await fallo.json(), { error: 'controles_no_disponibles' });
});

test('servicios encendidos requieren administración y ninguna fuente de registro del entorno se adopta', () => {
  assert.doesNotThrow(() => opcionesDelEntorno({ FARO_ADMINISTRACION: 'si', FARO_API_SOCIOS: 'si' }));
  assert.throws(() => opcionesDelEntorno({ FARO_ADMINISTRACION: 'no', FARO_API_SOCIOS: 'si' }));
  assert.throws(() => variablesDelServicio({ FARO_API_SOCIOS_REGISTRO: '[]' }));
  assert.throws(() => opcionesDelEntorno({ FARO_ADMINISTRACION: 'sí' }));
});

function trabajosPausados(base: ReturnType<typeof crearAlmacenPublicoNode>['trabajos']) {
  const esperando = Promise.withResolvers<void>();
  const continuar = Promise.withResolvers<void>();
  const preparado = Promise.withResolvers<void>();
  let retiradas = 0;
  const trabajos = new Proxy(base, {
    get(objeto, clave) {
      if (clave === 'prepararTrabajos') {
        return async () => {
          esperando.resolve();
          await continuar.promise;
          await objeto.prepararTrabajos();
          preparado.resolve();
        };
      }
      if (clave === 'retirarTrabajoDeSesion') {
        return (...args: Parameters<typeof objeto.retirarTrabajoDeSesion>) => {
          retiradas++;
          return objeto.retirarTrabajoDeSesion(...args);
        };
      }
      const valor = Reflect.get(objeto, clave);
      return typeof valor === 'function' ? valor.bind(objeto) : valor;
    },
  });
  return { trabajos, esperando, continuar, preparado, retiradas: () => retiradas };
}

const tamanoSha = 40;
const destino = { propietario: 'equipo', repositorio: 'producto', workflow: 'actualizar.yml', ref: 'main' };
const confianza: ConfianzaOidcGitHub = {
  audiencia: `${ORIGEN}/mantenimiento/resultado`,
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/producto/.github/workflows/actualizar.yml@refs/heads/main',
  workflowSha: 'a'.repeat(tamanoSha),
  sha: 'b'.repeat(tamanoSha),
};

test('retirada cancelada durante preparación lazy nunca inicia la escritura después del aborto', async (t) => {
  const { almacen, opciones, panel } = await montaje(t);
  const token = await abrir(panel);
  const acceso = {
    huellaSesion: sha256Hex(token),
    huellaPrincipal: sha256Hex(JSON.stringify(['https://fixture.cloudflareaccess.com', 'persona'])),
  };
  const solicitudId = '11111111-1111-4111-8111-111111111111';
  await almacen.trabajos.prepararTrabajos();
  await almacen.trabajos.reservarTrabajoDeSesion(
    acceso,
    { solicitudId, accion: 'actualizar-datos', revisionEsperada: 0 },
    confianza,
  );
  const antes = await almacen.trabajos.leerTrabajoPrivado();
  const demora = trabajosPausados(almacen.trabajos);
  const diferido = await montarAdministracion({
    ...opciones,
    trabajos: demora.trabajos,
    actualizacion: { configuracion: () => ({ destino, confianza, obtenerToken: async () => 'fixture' }) },
  });
  const control = new AbortController();
  const solicitud = peticion('datos/retirar', token, {
    solicitudId,
    revisionReserva: 1,
    revisionEsperada: antes.revision,
  });
  const pendiente = diferido.responder(new Request(solicitud, { signal: control.signal }));
  await demora.esperando.promise;
  control.abort();
  assert.notEqual((await pendiente).status, ESTADO_HTTP.correcto);
  demora.continuar.resolve();
  await demora.preparado.promise;
  await new Promise<void>((resolver) => setImmediate(resolver));
  assert.equal(demora.retiradas(), 0);
  assert.deepEqual(await almacen.trabajos.leerTrabajoPrivado(), antes);
});
