/** Worker real y namespaces SQLite independientes: no hay red, Turnstile ni registro estático alternativo. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { type TestContext, test } from 'node:test';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { RUTA_CONSULTAR_INVITACION, RUTA_TOKEN } from '../../src/api/socios/metadatos.ts';
import { huellaDelSecreto, secretoNuevo } from '../../src/api/socios/registro.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { esObjeto } from '../../src/comun/json.ts';
import {
  AccesoPublicoDurable,
  type EspacioAccesoPublicoDurable,
  type EstadoAccesoPublicoDurable,
} from '../../src/plataforma/acceso-publico/durable.ts';
import { SesionUnicaDurable } from '../../src/plataforma/acceso-publico/sesion-unica-cliente-durable.ts';
import type { ValorSql } from '../../src/plataforma/acceso-publico/sqlite.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const ORIGEN = 'https://servicio.invalid';
const FIRMA = 'firma-sintetica-estable-de-worker-para-pruebas-institucionales';
const VARIABLES = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: ORIGEN,
  FARO_ADMIN_ACCESS_EQUIPO: 'equipo-sintetico',
  FARO_ADMIN_ACCESS_AUD: 'panel-pruebas',
  FARO_API_SOCIOS: 'si',
  FARO_MCP: 'no',
  FARO_A2A: 'no',
  FARO_SECRETO_FIRMA: FIRMA,
};
type EntornoWorker = Parameters<typeof worker.fetch>[1];
interface Clave {
  client_id: string;
  client_secret: string;
}
const TAM_HUELLA = 64;
const BYTE_UTF8_INVALIDO = 0xff;
function estadoSqlite(db: DatabaseSync): EstadoAccesoPublicoDurable {
  return {
    storage: {
      ...alarmaDurableDePrueba(),
      sql: { exec: (s: string, ...v: ValorSql[]) => ({ toArray: () => db.prepare(s).all(...v) }) },
      transactionSync: <T>(accion: () => T): T => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = accion();
          db.exec('COMMIT');
          return r;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
}
async function montar(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const durable = new AccesoPublicoDurable(estadoSqlite(db), VARIABLES);
  const espacio: EspacioAccesoPublicoDurable = { idFromName: (n) => n, get: () => durable };
  const almacen = new SesionUnicaDurable(espacio);
  await almacen.prepararPanel({ version: 2, api: 'habilitada', mcp: false, a2a: false });
  const acceso = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
  await abrirSesionDePrueba(almacen, acceso);
  await almacen.prepararInstituciones();
  const secreto = secretoNuevo(),
    invitacion = { id: crypto.randomUUID(), huella: huellaDelSecreto(secreto) };
  const clave = { client_id: `inst-${crypto.randomUUID()}`, client_secret: secretoNuevo() };
  assert.equal(
    (
      await almacen.invitarInstitucionDeSesion(
        acceso,
        { revisionEsperada: 0, nombre: 'Institución sintética', correo: null },
        { ...invitacion, institucionId: clave.client_id },
      )
    ).estado,
    'cambiado',
  );
  assert.equal(
    (
      await almacen.activarInvitacion(invitacion, {
        id: crypto.randomUUID(),
        huella: huellaDelSecreto(clave.client_secret),
      })
    ).estado,
    'activada',
  );
  const env: EntornoWorker = {
    ...VARIABLES,
    REGISTRO_SOCIOS: espacio,
    ASSETS: { fetch: async () => new Response(null, { status: ESTADO_HTTP.noEncontrado }) },
  };
  return { db, env, espacio, clave, invitacion: `${invitacion.id}.${secreto}` };
}
function peticion(ruta: string, inicio: RequestInit = {}) {
  return new Request(new URL(ruta, ORIGEN), {
    ...inicio,
    headers: {
      [CABECERA_CONTRATO]: String(CONTRATO_API),
      'cf-connecting-ip': '198.51.100.99',
      ...Object.fromEntries(new Headers(inicio.headers)),
    },
  });
}
function solicitarToken(clave: Clave) {
  return peticion(RUTA_TOKEN, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${clave.client_id}:${clave.client_secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'faro.lectura' }),
  });
}
async function token(env: EntornoWorker, clave: Clave) {
  const r = await worker.fetch(solicitarToken(clave), env);
  assert.equal(r.status, ESTADO_HTTP.correcto);
  const o: unknown = await r.json();
  assert(esObjeto(o) && typeof o.access_token === 'string');
  return o.access_token;
}
function consulta(acceso: string) {
  return peticion('/api/socios/v1/consultas/explorar_grupos?padre=4', {
    headers: { authorization: `Bearer ${acceso}` },
  });
}
test('Worker institucional consulta mediante binding real y no almacena secreto ni IP', async (t) => {
  const f = await montar(t),
    acceso = await token(f.env, f.clave);
  const r = await worker.fetch(consulta(acceso), f.env);
  assert.equal(r.status, ESTADO_HTTP.correcto);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(f.db.serialize());
  assert(!bytes.includes(Buffer.from(f.clave.client_secret)));
  assert(!bytes.includes(Buffer.from('198.51.100.99')));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM conectividad_uso').get()?.n, 1);
});
test('Worker sin binding falla 503, no reutiliza instancia anterior y al recuperar reintenta la misma autoridad', async (t) => {
  const f = await montar(t);
  const acceso = await token(f.env, f.clave);
  const { REGISTRO_SOCIOS, ...sinBinding } = f.env;
  assert(REGISTRO_SOCIOS);
  for (const p of [solicitarToken(f.clave), consulta(acceso), peticion('/api/conectividad/estado')]) {
    const r = await worker.fetch(p, sinBinding);
    assert.equal(r.status, ESTADO_HTTP.noDisponible);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await worker.fetch(consulta(acceso), f.env)).status, ESTADO_HTTP.correcto);
});
test('cambiar solo identidad del namespace aísla institución y tokens aunque ASSETS y variables sean iguales', async (t) => {
  const uno = await montar(t),
    dos = await montar(t),
    acceso = await token(uno.env, uno.clave);
  const otro = { ...uno.env, REGISTRO_SOCIOS: dos.espacio };
  assert.equal((await worker.fetch(solicitarToken(uno.clave), otro)).status, ESTADO_HTTP.noAutenticado);
  assert.equal((await worker.fetch(consulta(acceso), otro)).status, ESTADO_HTTP.noAutenticado);
  assert.equal((await worker.fetch(consulta(acceso), uno.env)).status, ESTADO_HTTP.correcto);
});
test('los métodos retirados nunca quedan públicos y el registro anterior no se crea en instalación nueva', async (t) => {
  const f = await montar(t);
  for (const ruta of ['registro', 'fijar-altas', 'retirar', 'insertar', 'buscar']) {
    assert.equal(
      (await worker.fetch(peticion(`/api/socios/v1/${ruta}`, { method: 'POST', body: '{}' }), f.env)).status,
      ESTADO_HTTP.noEncontrado,
    );
  }
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='publico_socios'").get(), undefined);
});
test('invitación rechaza HTTP remoto, Origin ajeno, campos extra y UTF8 inválido sin crear otra clave', async (t) => {
  const f = await montar(t);
  const inicio = {
    method: 'POST',
    headers: { origin: ORIGEN, 'content-type': 'application/json', [CABECERA_CONTRATO]: String(CONTRATO_API) },
    body: JSON.stringify({ invitacion: f.invitacion }),
  };
  const http = new Request(`http://servicio.invalid${RUTA_CONSULTAR_INVITACION}`, {
    ...inicio,
    headers: { ...inicio.headers, origin: 'http://servicio.invalid' },
  });
  assert.equal((await worker.fetch(http, f.env)).status, ESTADO_HTTP.prohibido);
  assert.equal(
    (
      await worker.fetch(
        peticion(RUTA_CONSULTAR_INVITACION, {
          ...inicio,
          headers: { ...inicio.headers, origin: 'https://ajeno.invalid' },
        }),
        f.env,
      )
    ).status,
    ESTADO_HTTP.prohibido,
  );
  const extra = { ...inicio, body: JSON.stringify({ invitacion: f.invitacion, correo: 'canario' }) };
  const bytes = new Uint8Array([BYTE_UTF8_INVALIDO]);
  for (const opciones of [extra, { ...inicio, body: bytes }]) {
    const r = await worker.fetch(peticion(RUTA_CONSULTAR_INVITACION, opciones), f.env);
    assert.equal(r.status, ESTADO_HTTP.solicitudIncorrecta);
    assert.doesNotMatch(await r.text(), /canario/);
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM instituciones_claves').get()?.n, 1);
});

test('el wrapper oficial conserva credenciales institucionales y falla cerrado sin autoridad', async (t) => {
  const f = await montar(t);
  const env = {
    ...f.env,
    FARO_PRUEBAS_CLAVE: 'residuo',
    FARO_PRUEBAS_LIMITE: 'residuo',
    FARO_PRUEBAS_ADMINISTRACION: 'si',
  };
  const valido = await oficial.fetch(solicitarToken(f.clave), env);
  assert.equal(valido.status, ESTADO_HTTP.correcto);
  const cuerpo: unknown = await valido.json();
  assert(esObjeto(cuerpo) && typeof cuerpo.access_token === 'string');
  assert.equal((await oficial.fetch(consulta(cuerpo.access_token), env)).status, ESTADO_HTTP.correcto);
  const invalida = { ...f.clave, client_secret: 'secreto-incorrecto' };
  assert.equal((await oficial.fetch(solicitarToken(invalida), env)).status, ESTADO_HTTP.noAutenticado);
  assert.equal((await oficial.fetch(consulta('invalido'), env)).status, ESTADO_HTTP.noAutenticado);
  const { REGISTRO_SOCIOS: _binding, ...sinBinding } = env;
  assert.equal((await oficial.fetch(solicitarToken(f.clave), sinBinding)).status, ESTADO_HTTP.noDisponible);
});

test('el portal oficial revoca cookies copiadas en el Durable real sin borrar otras sesiones', async (t) => {
  const f = await montar(t);
  const env = {
    ...f.env,
    FARO_CLAVE_GENERAL: 'clave-portal-sintetica',
    FARO_SESION_PORTAL: 'firma-portal-sintetica-con-longitud-suficiente',
    FARO_LIMITE_PORTAL: 'limite-portal-sintetico-con-longitud-suficiente',
  };
  const login = () =>
    oficial.fetch(
      peticion('/acceso-web/entrar', {
        method: 'POST',
        headers: { origin: ORIGEN, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ usuario: 'Faro', clave: env.FARO_CLAVE_GENERAL }),
      }),
      env,
    );
  const primera = await login();
  const segunda = await login();
  assert.equal(primera.status, ESTADO_HTTP.correcto);
  assert.equal(segunda.status, ESTADO_HTTP.correcto);
  const cookie1 = primera.headers.get('set-cookie')?.split(';')[0];
  const cookie2 = segunda.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie1 && cookie2);
  const estado = (cookie: string) => oficial.fetch(peticion('/acceso-web/estado', { headers: { cookie } }), env);
  assert.deepEqual(await (await estado(cookie1)).json(), { portal: true });
  const salida = await oficial.fetch(
    peticion('/acceso-web/salir', { method: 'POST', headers: { cookie: cookie1, origin: ORIGEN } }),
    env,
  );
  assert.equal(salida.status, ESTADO_HTTP.correcto);
  assert.equal((await estado(cookie1)).status, ESTADO_HTTP.prohibido);
  assert.equal((await estado(cookie2)).status, ESTADO_HTTP.correcto);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM portal_sesiones').get()?.n, 1);
  assert(!Buffer.from(f.db.serialize()).includes(Buffer.from(cookie2)));
});
