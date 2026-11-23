// Ensamblaje real del Worker: datos, seguridad base y respuestas web sin inferencia externa.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { CABECERAS_WEB, POLITICA_DE_LA_API, VALOR_HSTS } from '../../src/plataforma/cabeceras-web.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';

const CORRECTO = 200;
const PROHIBIDO = 403;
const NO_DISPONIBLE = 503;
const MOVIMIENTO = 301;
const BYTES_SECRETO = 48;
function entorno(cambios: Record<string, unknown> = {}) {
  return {
    ASSETS: { fetch: async () => new Response('archivo de la web', { status: 404 }) },
    FARO_SECRETO_FIRMA: 's'.repeat(BYTES_SECRETO),
    FARO_ADMINISTRACION: 'no',
    FARO_MCP: 'no',
    FARO_A2A: 'no',
    FARO_API_SOCIOS: 'no',
    ...cambios,
  };
}

function peticion(ruta: string): Request {
  return new Request(`https://faro.prueba${ruta}`, {
    headers: { [CABECERA_CONTRATO]: String(CONTRATO_API), 'cf-connecting-ip': '198.51.100.20' },
  });
}

async function salud(env: ReturnType<typeof entorno>): Promise<Record<string, unknown>> {
  const respuesta = await worker.fetch(peticion('/api/salud'), env);
  assert.equal(respuesta.status, CORRECTO);
  const datos: unknown = await respuesta.json();
  assert.ok(esObjeto(datos));
  return datos;
}

test('perfil vigente apagado conserva datos y cabeceras sin habilitar conexiones', async (contexto) => {
  contexto.mock.method(globalThis, 'fetch', async () => assert.fail('red externa inesperada'));
  const env = entorno();
  const datos = await salud(env);
  assert.equal(datos.estado, 'ok');
  for (const campo of ['cerebro', 'ia', 'estimador', 'turnstile', 'proveedor_ia']) {
    assert.equal(Object.hasOwn(datos, campo), false);
  }
  const grupos = await worker.fetch(peticion('/api/grupos'), env);
  assert.equal(grupos.status, CORRECTO);
  assert.equal(grupos.headers.get('strict-transport-security'), VALOR_HSTS);
  assert.equal(grupos.headers.get('content-security-policy'), POLITICA_DE_LA_API);
});

test('firma y Access siguen siendo obligatorios con un perfil vigente', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('red externa inesperada'));
  t.mock.method(console, 'error', () => undefined);
  for (const cambio of [{ FARO_SECRETO_FIRMA: '' }, { FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios' }]) {
    assert.equal((await worker.fetch(peticion('/api/grupos'), entorno(cambio))).status, NO_DISPONIBLE);
  }
  const conAccess = entorno({
    FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
    FARO_ACCESS_EQUIPO: 'equipo-prueba',
    FARO_ACCESS_AUD: 'audiencia',
  });
  assert.equal((await worker.fetch(peticion('/api/grupos'), conAccess)).status, PROHIBIDO);
});
test('un campo ajeno rechaza la composición sin invocar red ni reflejar su valor en diagnóstico', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('red externa inesperada'));
  const errores = t.mock.method(console, 'error', () => undefined);
  const r = await worker.fetch(peticion('/api/grupos'), entorno({ campoAjeno: 'secreto-sintetico-PRIVADO' }));
  assert.equal(r.status, NO_DISPONIBLE);
  assert.doesNotMatch(await r.text(), /PRIVADO/);
  assert.doesNotMatch(JSON.stringify(errores.mock.calls.map((c) => c.arguments)), /PRIVADO|message|stack/);
});

test('redirecciones y estáticos conservan dirección y cabeceras', async () => {
  const respuesta = await worker.fetch(new Request('https://www.faro.prueba/ruta?paso=2'), entorno());
  assert.equal(respuesta.status, MOVIMIENTO);
  assert.equal(respuesta.headers.get('location'), 'https://faro.prueba/ruta?paso=2');
  const estatica = await worker.fetch(peticion('/inicio.html'), entorno());
  assert.equal(await estatica.text(), 'archivo de la web');
  for (const [nombre, valor] of Object.entries(CABECERAS_WEB)) {
    assert.equal(estatica.headers.get(nombre), valor);
    assert.equal(respuesta.headers.get(nombre), valor);
  }
});

test('el inicio público declara la política pública sin confiar en cabeceras de petición', async () => {
  const env = entorno({ ASSETS: { fetch: async () => new Response('inicio') } });
  const respuesta = await worker.fetch(
    new Request('https://faro.prueba/inicio.html', {
      headers: { 'x-faro-portal': 'privado' },
    }),
    env,
  );
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get('x-faro-portal'), 'publico');
});
