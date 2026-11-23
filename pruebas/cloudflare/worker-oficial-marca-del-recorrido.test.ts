/**
 * Lo que entrega el acceso temporal al recorrido inactivo lleva su marca (x-faro-recorrido), también a través del
 * Worker oficial y de las cabeceras del portal: el acceso (su formulario, su redirección y su 503) dice «acceso» y la
 * página delegada con la sesión temporal, «temporal». El recorrido del modo activo no lleva marca. El service worker no
 * guarda nunca en la copia nada marcado (src/service-worker/copia.js, noSirveComoCopia).
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { AccesoPublicoDurable } from '../../src/plataforma/acceso-publico/durable.ts';
import { AlmacenRecorridoDurable } from '../../src/plataforma/acceso-publico/recorrido-cliente-durable.ts';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { alarmaDurableDePrueba } from '../ayudas/alarma-durable.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const ORIGEN = 'https://ejemplo.invalid';
const CLAVE = 'clave-general-sintetica';
const CLAVE_DEL_RECORRIDO = 'clave-inactiva-sintetica';
const IP = '192.0.2.10';
const LONGITUD_HUELLA = 64;
const ACCESO = { huellaSesion: 'a'.repeat(LONGITUD_HUELLA), huellaPrincipal: 'b'.repeat(LONGITUD_HUELLA) };
const [EXTENSION] = EXTENSIONES;
const PAGINA = '<!doctype html><h1>Recorrido</h1>';
const MARCA = 'x-faro-recorrido';
const NAVEGACION = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'cf-connecting-ip': IP };

/** La autoridad durable real sobre `db`: cada llamada crea una instancia nueva que solo conserva lo guardado. */
function autoridadSobre(db: DatabaseSync): AccesoPublicoDurable {
  return new AccesoPublicoDurable(
    {
      storage: {
        ...alarmaDurableDePrueba(),
        sql: { exec: (sql, ...valores) => ({ toArray: () => db.prepare(sql).all(...valores) }) },
        transactionSync: <T>(accion: () => T): T => {
          db.exec('BEGIN IMMEDIATE');
          try {
            const resultado = accion();
            db.exec('COMMIT');
            return resultado;
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        },
      },
    },
    {},
  );
}

/** Un entorno inventado cuyo espacio de nombres reenvía a la autoridad que devuelva `vigente` en cada petición. */
function entornoSintetico(vigente: () => AccesoPublicoDurable) {
  // Nunca responde con datos fijados en la prueba: todo sale de la autoridad durable de ese momento.
  const espacio = { idFromName: () => 'id', get: () => ({ fetch: (p: Request) => vigente().fetch(p) }) };
  return {
    REGISTRO_SOCIOS: espacio,
    ASSETS: { fetch: async () => new Response(PAGINA, { headers: { 'content-type': 'text/html' } }) },
    FARO_CLAVE_GENERAL: CLAVE,
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    FARO_RECORRIDO_CLAVE: 'clave-inactiva-sintetica',
    FARO_RECORRIDO_FIRMA: 'firma-recorrido-sintetica-mas-de-32-bytes',
    FARO_RECORRIDO_LIMITE: 'limite-recorrido-sintetico-mas-de-32-bytes',
  };
}

/** Entra en el portal con la clave general y devuelve la cookie de su sesión. */
async function entrarEnElPortal(entorno: ReturnType<typeof entornoSintetico>): Promise<string> {
  const entrada = await oficial.fetch(
    new Request(`${ORIGEN}/acceso-web/entrar`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': IP,
      },
      body: new URLSearchParams({ usuario: 'Faro', clave: CLAVE }),
    }),
    entorno,
  );
  assert.equal(entrada.status, ESTADO_HTTP.correcto);
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

/** Envía la clave del recorrido inactivo con la sesión del portal `portal`, como el formulario del acceso. */
function entrarConLaClave(entorno: ReturnType<typeof entornoSintetico>, portal: string): Promise<Response> {
  return oficial.fetch(
    new Request(`${ORIGEN}/recorrido.html`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
        'cf-connecting-ip': IP,
        cookie: portal,
      },
      body: new URLSearchParams({ clave: CLAVE_DEL_RECORRIDO }),
    }),
    entorno,
  );
}

test('el acceso temporal marca lo suyo y el modo activo no lleva marca', {
  skip: EXTENSION === undefined && 'Sin extensiones instaladas no hay recorrido inactivo.',
}, async () => {
  assert.ok(EXTENSION);
  const db = new DatabaseSync(':memory:');
  try {
    const autoridad = autoridadSobre(db);
    const entorno = entornoSintetico(() => autoridad);
    const almacen = new AlmacenRecorridoDurable(entorno.REGISTRO_SOCIOS);
    await almacen.prepararPanel({ version: 2, api: 'deshabilitada', mcp: false, a2a: false });
    await abrirSesionDePrueba(almacen, ACCESO);
    assert.equal((await almacen.cambiarRecorridoDeSesion(ACCESO, 0, EXTENSION.id)).estado, 'cambiado');
    const portal = await entrarEnElPortal(entorno);
    const navegar = (ruta: string, cookie: string) =>
      oficial.fetch(new Request(`${ORIGEN}${ruta}`, { headers: { ...NAVEGACION, cookie } }), entorno);

    const activa = await navegar(`/${EXTENSION.entrada}`, portal);
    assert.equal(activa.status, ESTADO_HTTP.correcto);
    assert.equal(activa.headers.get(MARCA), null, 'el modo activo no lleva marca');

    const formulario = await navegar('/recorrido.html', portal);
    assert.equal(formulario.status, ESTADO_HTTP.correcto);
    assert.match(await formulario.text(), /<form id="acceso-recorrido"/);
    assert.equal(formulario.headers.get(MARCA), 'acceso', 'el formulario');

    const entrada = await entrarConLaClave(entorno, portal);
    assert.equal(entrada.status, ESTADO_HTTP.verOtra);
    assert.equal(entrada.headers.get(MARCA), 'acceso', 'la redirección tras entrar');
    const temporal = entrada.headers.get('set-cookie')?.split(';')[0];
    assert.ok(temporal);

    const delegada = await navegar('/recorrido.html', `${portal}; ${temporal}`);
    assert.equal(delegada.status, ESTADO_HTTP.correcto);
    assert.equal(await delegada.text(), PAGINA);
    assert.equal(delegada.headers.get(MARCA), 'temporal', 'la página delegada con la sesión temporal');

    db.exec('DELETE FROM administracion_recorrido');
    const sinModo = await navegar('/recorrido.html', portal);
    assert.equal(sinModo.status, ESTADO_HTTP.noDisponible);
    assert.equal(sinModo.headers.get(MARCA), 'acceso', 'el acceso no disponible');
  } finally {
    db.close();
  }
});
