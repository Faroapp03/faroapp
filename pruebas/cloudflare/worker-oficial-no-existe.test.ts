import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cabecerasParaRuta, VALOR_HSTS } from '../../src/plataforma/cabeceras-web.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';

const OK = 200;
const VER_OTRA = 303;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const ORIGEN = 'https://ejemplo.invalid';
const CLAVE = 'clave-general-sintetica';
const PAGINA = readFileSync(new URL('../../web/no-existe.html', import.meta.url), 'utf8');
/** Lo que manda el navegador al cargar una página escrita en la barra de direcciones. */
const NAVEGACION = {
  accept: 'text/html,application/xhtml+xml',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

/** Un entorno del Worker oficial cuyos archivos son inicio.html y la página que no existe; lo demás, 404. */
function entorno() {
  const sesiones = new Set<string>();
  async function peticionDurable(peticion: Request) {
    const ruta = new URL(peticion.url).pathname;
    if (!ruta.startsWith('/portal/')) {
      return Response.json({ permitido: true });
    }
    if (ruta === '/portal/disponible') {
      return Response.json({ disponible: true });
    }
    const { huella } = (await peticion.json()) as { huella: string };
    if (ruta === '/portal/registrar') {
      sesiones.add(huella);
    }
    return Response.json(ruta === '/portal/activa' ? { activa: sesiones.has(huella) } : { correcto: true });
  }
  return {
    FARO_CLAVE_GENERAL: CLAVE,
    FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
    FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
    REGISTRO_SOCIOS: { idFromName: () => 'id', get: () => ({ fetch: peticionDurable }) },
    ASSETS: {
      fetch: async (peticion: Request) => {
        const ruta = new URL(peticion.url).pathname;
        if (ruta === '/inicio.html') {
          return new Response('inicio', { headers: { 'content-type': 'text/html' } });
        }
        if (ruta === '/no-existe.html') {
          return new Response(PAGINA, { headers: { 'content-type': 'text/html', 'cache-control': 'public' } });
        }
        return new Response(null, { status: NO_ENCONTRADO });
      },
    },
  };
}

/** La cookie de una sesión abierta con la contraseña general. */
async function abrirSesion(env: ReturnType<typeof entorno>): Promise<string> {
  const entrada = await worker.fetch(
    new Request(`${ORIGEN}/acceso-web/entrar`, {
      method: 'POST',
      headers: {
        origin: ORIGEN,
        'sec-fetch-site': 'same-origin',
        'cf-connecting-ip': '192.0.2.10',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ usuario: 'Faro', clave: CLAVE }),
    }),
    env,
  );
  assert.equal(entrada.status, OK);
  const cookie = entrada.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  return cookie;
}

test('con sesión, una navegación a una dirección que no existe recibe 404 con la página de Faro', async () => {
  const env = entorno();
  const cookie = await abrirSesion(env);
  for (const ruta of ['/cursoss.html', '/una/direccion/anidada', '/no-existe.html', '/%E0%A4%A']) {
    const respuesta = await worker.fetch(new Request(ORIGEN + ruta, { headers: { ...NAVEGACION, cookie } }), env);
    assert.equal(respuesta.status, NO_ENCONTRADO, ruta);
    assert.equal(await respuesta.text(), PAGINA, ruta);
    assert.equal(respuesta.headers.get('content-type'), 'text/html; charset=utf-8', ruta);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', ruta);
    assert.equal(respuesta.headers.get('strict-transport-security'), VALOR_HSTS, ruta);
    for (const [nombre, valor] of Object.entries(cabecerasParaRuta('/no-existe.html'))) {
      if (nombre !== 'referrer-policy') {
        assert.equal(respuesta.headers.get(nombre), valor, `${ruta}: ${nombre}`);
      }
    }
  }
});

test('con sesión, lo que no es una navegación sigue recibiendo el 404 sin cuerpo', async () => {
  const env = entorno();
  const cookie = await abrirSesion(env);
  const peticiones = [
    new Request(`${ORIGEN}/scripts/no-esta.js`, { headers: { cookie, accept: '*/*', 'sec-fetch-dest': 'script' } }),
    new Request(`${ORIGEN}/datos/no-esta.json`, { headers: { cookie, accept: 'application/json' } }),
    new Request(`${ORIGEN}/no-existe.html`, { headers: { cookie, accept: '*/*', 'sec-fetch-mode': 'cors' } }),
    new Request(`${ORIGEN}/cursoss.html`, { method: 'HEAD', headers: { ...NAVEGACION, cookie } }),
  ];
  for (const peticion of peticiones) {
    const respuesta = await worker.fetch(peticion, env);
    assert.equal(respuesta.status, NO_ENCONTRADO, peticion.url);
    assert.equal(await respuesta.text(), '', peticion.url);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', peticion.url);
  }
});

test('sin sesión, una dirección que no existe lleva a la pantalla de acceso como cualquier otra', async () => {
  const env = entorno();
  for (const ruta of ['/cursoss.html', '/inicio.html', '/no-existe.html']) {
    const navegacion = await worker.fetch(new Request(ORIGEN + ruta, { headers: NAVEGACION }), env);
    assert.equal(navegacion.status, VER_OTRA, ruta);
    assert.equal(navegacion.headers.get('location'), `/acceso-web?volver=${encodeURIComponent(ruta)}`, ruta);
    assert.equal(await navegacion.text(), '', ruta);
    const recurso = await worker.fetch(new Request(ORIGEN + ruta, { headers: { accept: '*/*' } }), env);
    assert.equal(recurso.status, PROHIBIDO, ruta);
  }
});
