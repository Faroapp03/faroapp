/** Composición de Node y Worker: perfiles cerrados, controles de Access y salud factual sin red externa. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import { cerrojoDelEntorno } from '../../src/plataforma/cloudflare/cerrojo-access.ts';
import { datosMinimos } from '../fixtures/datos-referencias-grupos.ts';

const EXITO = 200;

const PERFIL_NODE = {
  FARO_MCP: 'si',
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: 'https://panel.example',
  FARO_ADMIN_ACCESS_EQUIPO: 'prueba',
  FARO_ADMIN_ACCESS_AUD: 'administrativa',
  FARO_SECRETO_FIRMA: 'firma exclusivamente sintetica sin cuenta ni servicio real',
  FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios',
};

test('Node conserva el perfil y valida Access antes de abrir su almacén', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No se permite red en esta prueba'));
  const raiz = mkdtempSync(join(tmpdir(), 'Configuracion Año 2026 '));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const perfil = Object.entries(PERFIL_NODE)
    .map(([clave, valor]) => `${clave}=${valor}`)
    .join('\n');
  writeFileSync(join(raiz, '.dev.vars'), `${perfil}\n`);
  const rutas = new URL('../../src/plataforma/node/rutas.ts', import.meta.url).href;
  const hooks = registerHooks({
    load(url, contexto, siguiente) {
      return url === rutas
        ? {
            format: 'module',
            shortCircuit: true,
            source: `export const RUTAS=${JSON.stringify({ raiz, registro: join(raiz, 'registro'), codigo: join(raiz, 'src'), paquete: join(raiz, 'datos'), web: join(raiz, 'web') })};`,
          }
        : siguiente(url, contexto);
    },
  });
  t.after(() => hooks.deregister());
  const { leerEntornoDelServidor } = await import('../../src/plataforma/node/entorno.ts');
  const entorno = leerEntornoDelServidor();
  assert.deepEqual(entorno.variables, PERFIL_NODE);
  assert.throws(() => cerrojoDelEntorno(entorno.variables), /FARO_ACCESS_EQUIPO/);
  const { montarAdministracionNode } = await import('../../src/plataforma/node/administracion.ts');
  const archivo = join(raiz, 'no-debe-abrirse.sqlite');
  await assert.rejects(
    montarAdministracionNode({ perfil: entorno, archivo, datos: datosMinimos(), origenesPermitidos: [] }),
    /FARO_ACCESS_EQUIPO/,
  );
  assert.equal(existsSync(archivo), false);
  assert.deepEqual(Object.keys(entorno), ['variables']);
  writeFileSync(join(raiz, '.dev.vars'), `${perfil}\nFARO_OPCION_DESCONOCIDA=valor-sintetico\n`);
  assert.throws(() => leerEntornoDelServidor(), /opciones no admitidas/);
});

test('Worker real sirve salud factual y rechaza un perfil desconocido sin conexión saliente', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No se permite red en esta prueba'));
  const paquete = new URL('../../src/plataforma/cloudflare/paquete.ts', import.meta.url).href;
  const hooks = registerHooks({
    load(url, contexto, siguiente) {
      return url === paquete
        ? {
            format: 'module',
            shortCircuit: true,
            source: `export const PAQUETE={esco:{ocupaciones:{}},clasificaciones:{isco08_a_cno11:{},cno11:{},isco08_es:{}},vectores:{modelo:'sintetico',dimensiones:1,ids:[],escalas:[],datos:''}};`,
          }
        : siguiente(url, contexto);
    },
  });
  t.after(() => hooks.deregister());
  const { default: worker } = await import('../../src/plataforma/cloudflare/worker.ts');
  const env = {
    FARO_SECRETO_FIRMA: 'firma exclusivamente sintetica mayor de treinta y dos caracteres',
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  };
  const respuesta = await worker.fetch(
    new Request('https://faro.example/api/salud', {
      headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
    env,
  );
  assert.equal(respuesta.status, EXITO);
  const salud = await respuesta.json();
  assert.ok(esObjeto(salud));
  assert.equal(salud.estado, 'ok');
  assert.deepEqual(Object.keys(salud).sort(), ['estado', 'interruptores', 'version']);
  const diagnosticos: unknown[] = [];
  t.mock.method(console, 'error', (...valores: unknown[]) => diagnosticos.push(valores));
  const rechazada = await worker.fetch(
    new Request('https://faro.example/api/salud', { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } }),
    { ...env, FARO_OPCION_DESCONOCIDA: 'valor-confidencial-sintetico' },
  );
  assert.equal(rechazada.status, ESTADO_HTTP.noDisponible);
  assert.doesNotMatch(await rechazada.text(), /valor-confidencial-sintetico/);
  assert.ok(diagnosticos.length > 0);
  assert.doesNotMatch(JSON.stringify(diagnosticos), /valor-confidencial-sintetico/);
});
