// Los 401 y 403 de las puertas de Faro llevan x-faro-portal: privado: el service worker solo toma por privada una
// instalación con un rechazo así (src/service-worker/modo.js, evidenciaDe), no con el de un cortafuegos o un proxy.
// Por el Worker oficial con portal (acceso-portal.ts, sin-sesion.ts) y por el privado (acceso-privado.ts, Basic).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';
import { rechazoSinSesion } from '../../src/plataforma/cloudflare/sin-sesion.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';

const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;
const ORIGEN = 'https://ejemplo.invalid';
const SIN_NAVEGAR = { 'sec-fetch-mode': 'same-origin', 'sec-fetch-dest': 'empty', accept: '*/*' };

function entornoOficial() {
  return {
    FARO_CLAVE_GENERAL: 'clave-general-sintetica',
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    REGISTRO_SOCIOS: {
      idFromName: () => 'id',
      get: () => ({
        fetch: async (peticion: Request) => {
          const ruta = new URL(peticion.url).pathname;
          if (!ruta.startsWith('/portal/')) {
            return Response.json({ permitido: true });
          }
          return Response.json(
            ruta === '/portal/disponible' ? { disponible: true } : { activa: false, correcto: true },
          );
        },
      }),
    },
    ASSETS: { fetch: async () => new Response('aplicación real') },
  };
}

function entornoPrivado() {
  return {
    ASSETS: { fetch: async () => new Response('recurso') },
    FARO_PRUEBAS_CLAVE: 'clave-sintetica-de-prueba-con-al-menos-32-bytes',
    FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
    REGISTRO_SOCIOS: {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => Response.json({ permitido: true, controles: null }) }),
    },
  };
}

const dePortal = (respuesta: Response) => respuesta.headers.get('x-faro-portal');

test('el 403 sin sesión (rechazoSinSesion) lleva x-faro-portal: privado', () => {
  const rechazo = rechazoSinSesion();
  assert.equal(rechazo.status, PROHIBIDO);
  assert.equal(dePortal(rechazo), 'privado');
});

test('Worker oficial con portal: sus 403 llevan x-faro-portal: privado', async () => {
  const sinSesion = await worker.fetch(
    new Request(`${ORIGEN}/inicio.html`, { headers: SIN_NAVEGAR }),
    entornoOficial(),
  );
  assert.equal(sinSesion.status, PROHIBIDO, 'la sonda del service worker sin sesión');
  assert.equal(dePortal(sinSesion), 'privado');
  const pantalla = await worker.fetch(new Request(`${ORIGEN}/acceso-web`, { headers: SIN_NAVEGAR }), entornoOficial());
  assert.equal(pantalla.status, PROHIBIDO, 'la pantalla de acceso pedida sin navegar');
  assert.equal(dePortal(pantalla), 'privado');
  const incorrecta = await worker.fetch(
    new Request(`${ORIGEN}/acceso-web/entrar`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': '192.0.2.10',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ usuario: 'Faro', clave: 'incorrecta' }),
    }),
    entornoOficial(),
  );
  assert.equal(incorrecta.status, PROHIBIDO, 'la contraseña incorrecta');
  assert.equal(dePortal(incorrecta), 'privado');
});

test('Worker privado (Basic): su 401 y su 403 llevan x-faro-portal: privado', async () => {
  const responder = async () => new Response('aplicación');
  const desafio = await responderAccesoPrivado(
    new Request(`${ORIGEN}/inicio.html`, { headers: { 'cf-connecting-ip': '127.0.0.1' } }),
    entornoPrivado(),
    responder,
  );
  assert.equal(desafio.status, NO_AUTENTICADO);
  assert.match(desafio.headers.get('www-authenticate') ?? '', /^Basic /);
  assert.equal(dePortal(desafio), 'privado');
  const sinHttps = await responderAccesoPrivado(
    new Request('http://ejemplo.invalid/inicio.html'),
    entornoPrivado(),
    responder,
  );
  assert.equal(sinHttps.status, PROHIBIDO);
  assert.equal(dePortal(sinHttps), 'privado');
});
