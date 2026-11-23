/** Contratos cerrados y diagnósticos técnicos sin contenido recibido. Ninguna consulta de red. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpcionesApi } from '../../src/api/api.ts';
import type { CapacidadesAdministradas } from '../../src/api/controles-administrativos.ts';
import { capturarControles, problemaDeServiciosSinMontar } from '../../src/api/controles-administrativos.ts';
import { registrarErrorOperativo } from '../../src/api/errores.ts';
import { crearServidorDeAgentes } from '../../src/api/mcp/servidor-mcp.ts';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { exigirOpcionesApi } from '../../src/api/opciones-api.ts';
import { registradorAdministrado } from '../../src/api/registro-operativo.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { cerrojoDelEntorno } from '../../src/plataforma/cloudflare/cerrojo-access.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { comprobarVariablesDelServicio, variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';

const politica = { version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false } as const;
test('opciones API rechazan todo campo ajeno, accesores y prototipos sin ejecutarlos ni copiar valores', () => {
  const base = { datos: {}, origenesPermitidos: [] } as unknown as OpcionesApi;
  exigirOpcionesApi(base);
  for (const extra of [
    { ajena: 'valor privado' },
    { seguridad: { ajena: true } },
    { agentes: { ajena: true } },
    { administracion: { leerControles: () => politica, ajena: true } },
    { agentes: { mcp: { ajena: true } } },
  ]) {
    assert.throws(() => exigirOpcionesApi({ ...base, ...extra } as OpcionesApi), {
      name: 'TypeError',
      message: 'Opciones de API no válidas',
    });
  }
  let leidas = 0;
  const accesor = { ...base };
  Object.defineProperty(accesor, 'datos', { get: () => ++leidas, enumerable: true });
  assert.throws(() => exigirOpcionesApi(accesor));
  assert.throws(() => exigirOpcionesApi(Object.create(base)));
  assert.throws(() => exigirOpcionesApi({ ...base, [Symbol('ajena')]: true }));
  assert.equal(leidas, 0);
});
test('el inventario del perfil conserva Access y secretos conocidos; opciones ajenas fallan sin filtrar por familia', () => {
  const entrada = { FARO_ACCESS_DECLARACION: 'si', FARO_SECRETO_FIRMA: 'valor sintético', FARO_MCP: 'no' };
  const copia = variablesDelServicio(entrada);
  assert.deepEqual(copia, entrada);
  assert.notEqual(copia, entrada);
  for (const variables of [{ OPCION_AJENA: 'valor privado' }, { ...entrada, FARO_AJENA: 'valor privado' }]) {
    assert.throws(
      () => variablesDelServicio(variables),
      (e: unknown) => e instanceof Error && !e.message.includes('valor privado'),
    );
    assert.throws(() => cerrojoDelEntorno(variables));
  }
  let leidas = 0;
  const accesor = {};
  Object.defineProperty(accesor, 'FARO_ACCESS_DECLARACION', { get: () => ++leidas, enumerable: true });
  assert.throws(() => comprobarVariablesDelServicio(accesor));
  assert.equal(leidas, 0);
});
test('Access conserva la obligación de pruebas en originales y rechaza declaraciones no reconocidas', () => {
  assert.equal(cerrojoDelEntorno({}), null);
  assert.equal(cerrojoDelEntorno({ FARO_ACCESS_DECLARACION: 'si' }), null);
  for (const declaracion of ['SI', 'prueba', '']) {
    assert.throws(() => cerrojoDelEntorno({ FARO_ACCESS_DECLARACION: declaracion }));
  }
  const prueba = { FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios' };
  assert.throws(() => cerrojoDelEntorno(prueba));
  assert.throws(() => cerrojoDelEntorno(variablesDelServicio(prueba)));
});
test('fallos de controles y registro preservan tipo técnico y código seguro sin mensajes ni nombres recibidos', async (t) => {
  const lineas: string[] = [];
  t.mock.method(console, 'error', (linea: unknown) => lineas.push(String(linea)));
  const fallo = new TypeError('CONTENIDO-PRIVADO-NO-REGISTRAR');
  Object.defineProperty(fallo, 'name', { value: 'NOMBRE-PRIVADO-NO-REGISTRAR' });
  const captura = await capturarControles(
    {
      leerControles: async () => {
        throw fallo;
      },
    },
    new AbortController().signal,
  );
  assert.equal(captura, null);
  await assert.rejects(
    registradorAdministrado({
      leerControles: async () => politica,
      registrarAcceso: async () => {
        throw fallo;
      },
    })({ canal: 'a2a', habilidad: 'ficha_grupo' }),
  );
  const sqlite = new Error('OTRO-CONTENIDO-PRIVADO');
  Object.defineProperty(sqlite, 'code', { value: 'SQLITE_CORRUPT' });
  registrarErrorOperativo('controles', sqlite);
  let leidas = 0;
  const conAccesor = new Error('secreto');
  Object.defineProperty(conAccesor, 'code', { get: () => ++leidas });
  registrarErrorOperativo('registro-conectividad', conAccesor);
  assert.equal(leidas, 0);
  const registros = lineas.map((l) => JSON.parse(l));
  assert.deepEqual(
    registros.map((r) => r.tipo),
    ['TypeError', 'TypeError', 'Error', 'Error'],
  );
  assert.equal(registros[2]?.codigo, 'SQLITE_CORRUPT');
  assert(registros.every((r) => r.estado === ESTADO_HTTP.noDisponible && typeof r.peticion === 'string'));
  assert.doesNotMatch(lineas.join(''), /PRIVADO|secreto|message|stack|headers/);
});

test('una capacidad ON inyectada sin autoridad sigue bloqueada 503; OFF conocido es 404 sin fabricar documento', () => {
  const apagadas: CapacidadesAdministradas = { mcp: null, a2a: null, socios: null };
  const encendidas = { ...apagadas, mcp: crearServidorDeAgentes() };
  assert.equal(problemaDeServiciosSinMontar(apagadas, '/mcp')?.estado, ESTADO_HTTP.noEncontrado);
  assert.equal(problemaDeServiciosSinMontar(encendidas, '/mcp')?.estado, ESTADO_HTTP.noDisponible);
  assert.equal(problemaDeServiciosSinMontar(apagadas, '/api/grupos'), null);
});

test('Worker sin administración, sin firma y con tres no comprueba OFF sin crear registro; semilla inválida es desconocida', async () => {
  const env = {
    FARO_ADMINISTRACION: 'no',
    FARO_API_SOCIOS: 'no',
    FARO_MCP: 'no',
    FARO_A2A: 'no',
    ASSETS: { fetch: async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }) },
  };
  const estado = await worker.fetch(
    new Request('https://servicio.invalid/api/conectividad/estado', {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
    env,
  );
  assert.equal(estado.status, ESTADO_HTTP.correcto);
  const cuerpo = (await estado.json()) as { servicios: unknown; revision?: unknown };
  assert.deepEqual(cuerpo.servicios, { api: false, mcp: false, a2a: false });
  assert.equal(Object.hasOwn(cuerpo, 'revision'), false);
  for (const ruta of ['/mcp', '/a2a', '/.well-known/agent-card.json', '/api/socios/v1/token']) {
    assert.equal(
      (await worker.fetch(new Request(`https://servicio.invalid${ruta}`), env)).status,
      ESTADO_HTTP.noEncontrado,
    );
  }
  const desconocido = await worker.fetch(
    new Request('https://servicio.invalid/api/conectividad/estado', {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
    {
      ...env,
      FARO_MCP: 'SI',
    },
  );
  assert.equal(desconocido.status, ESTADO_HTTP.noDisponible);
  assert.deepEqual(await desconocido.json(), { error: 'controles_no_disponibles' });
});
