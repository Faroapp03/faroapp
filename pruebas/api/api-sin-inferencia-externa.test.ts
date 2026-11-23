/** La API pública conserva consultas factuales y no admite inferencia externa por composición o inyección. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crearApi, type OpcionesApi } from '../../src/api/api.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import type { Datos } from '../../src/dominio/tipos-paquete.ts';
import { administracionDeAgentes } from '../ayudas/socios-api.ts';

const EXITO = 200;
const NO_ENCONTRADO = 404;
const NO_DISPONIBLE = 503;
const CONSULTAS_FACTUALES = 8;
const DATOS = {
  esco: { ocupaciones: {} },
  clasificaciones: { isco08_a_cno11: {}, cno11: {}, isco08_es: {} },
} as unknown as Datos;
const OPCIONES: OpcionesApi = {
  datos: DATOS,
  origenesPermitidos: [],
  agentes: { mcp: true, a2a: true },
  administracion: administracionDeAgentes().opciones,
  seguridad: { secretoFirma: 'secreto exclusivamente sintetico de estas pruebas' },
};
function pedir(ruta: string, cuerpo?: object) {
  return new Request(`https://faro.example${ruta}`, {
    ...(cuerpo ? { method: 'POST', body: JSON.stringify(cuerpo) } : {}),
    headers: {
      [CABECERA_CONTRATO]: String(CONTRATO_API),
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
  });
}

test('crearApi rechaza un Cerebro inyectado antes de preparar servicios', async () => {
  let llamadas = 0;
  const cerebro = {
    proveedor: 'sintetico',
    modelo: 'no utilizado',
    async generarJson() {
      llamadas += 1;
      assert.fail('No se permite inferencia');
    },
    async vectores() {
      llamadas += 1;
      assert.fail('No se permiten vectores externos');
    },
  };
  await assert.rejects(crearApi({ ...OPCIONES, ...{ cerebro } }), {
    name: 'TypeError',
    message: 'Opciones de API no válidas',
  });
  assert.equal(llamadas, 0);
});

test('unos permisos de inferencia en las opciones se rechazan y no ofrecen operaciones de inferencia en MCP ni A2A', async () => {
  await assert.rejects(crearApi({ ...OPCIONES, ...{ ia: { permisos: { mcp: true, a2a: true } } } }), {
    name: 'TypeError',
    message: 'Opciones de API no válidas',
  });
  const api = await crearApi(OPCIONES);
  const lista = await api(pedir('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.equal(lista.status, EXITO);
  const mcp = await lista.json();
  assert.ok(esObjeto(mcp) && esObjeto(mcp.result) && Array.isArray(mcp.result.tools));
  assert.equal(mcp.result.tools.length, CONSULTAS_FACTUALES);
  assert.ok(mcp.result.tools.some((herramienta: { name: string }) => herramienta.name === 'buscar_ocupacion'));
  const tarjeta = await api(pedir('/.well-known/agent-card.json'));
  const a2a = await tarjeta.json();
  assert.ok(esObjeto(a2a) && Array.isArray(a2a.skills));
  assert.equal(a2a.skills.length, CONSULTAS_FACTUALES);
  assert.equal(Object.hasOwn(a2a, 'securitySchemes'), false);
});

test('la política durable no invoca un resolvedor de proveedor ni reabre permisos', async () => {
  let llamadas = 0;
  const administracion = {
    async leerControles() {
      return {
        version: 2 as const,
        revision: 4,
        api: 'habilitada' as const,
        mcp: true,
        a2a: true,
      };
    },
    async resolverCapacidadIa() {
      llamadas += 1;
      throw new Error('No debe resolverse el proveedor');
    },
  };
  await assert.rejects(crearApi({ ...OPCIONES, administracion }), {
    name: 'TypeError',
    message: 'Opciones de API no válidas',
  });
  const api = await crearApi(OPCIONES);
  const respuesta = await api(pedir('/api/salud'));
  assert.equal(respuesta.status, EXITO);
  const salud = await respuesta.json();
  assert.ok(esObjeto(salud));
  for (const campo of ['ia', 'cerebro', 'estimador', 'turnstile', 'proveedor_ia']) {
    assert.equal(Object.hasOwn(salud, campo), false);
  }
  assert.equal(llamadas, 0);
});

test('las operaciones generativas no forman parte de las rutas públicas', async () => {
  const api = await crearApi(OPCIONES);
  for (const ruta of ['/api/entender', '/api/enlazar', '/api/estimar']) {
    const respuesta = await api(pedir(ruta, { relato: 'Texto sintético sin efecto' }));
    assert.equal(respuesta.status, NO_ENCONTRADO);
    const rechazo: unknown = await respuesta.json();
    assert.ok(esObjeto(rechazo) && typeof rechazo.type === 'string');
    assert.match(rechazo.type, /ruta_desconocida$/);
    assert.equal(Object.hasOwn(rechazo, 'tareas'), false);
    assert.equal(Object.hasOwn(rechazo, 'estimacion'), false);
  }
});

test('la indisponibilidad de controles mantiene cerrados los servicios administrados', async () => {
  const api = await crearApi({
    ...OPCIONES,
    administracion: {
      async leerControles() {
        throw new Error('Fallo sintetico de autoridad');
      },
    },
  });
  const respuesta = await api(pedir('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.equal(respuesta.status, NO_DISPONIBLE);
});
