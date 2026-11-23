// Portal oficial en workerd local, con una sesión obtenida por el formulario y un perfil temporal de WebKit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { webkit } from 'playwright-core';
import { comprobarEntrega } from '../../herramientas/cloudflare/preparar-despliegue.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { entrarPortal } from './portal-ensayo.mjs';
import { crearPortalLocal, PORTAL } from './portal-fixture.mjs';

const MANIFIESTOS = [
  { ruta: '/manifest.webmanifest', idioma: 'es' },
  { ruta: '/manifest-ca.webmanifest', idioma: 'ca' },
];
const OK = 200;
const PROHIBIDO = 403;
const PLAZO_MANIFIESTO_MS = 30_000;
const [carpeta, ...sobrantes] = process.argv.slice(2);
assert.ok(carpeta && !sobrantes.length, 'Uso: node pruebas/navegadores/portal-manifiestos.mjs <entrega oficial>');
const directorio = resolve(carpeta);
const inicio = performance.now();
const huella = createHash('sha256')
  .update(await readFile(join(directorio, 'artefacto.json')))
  .digest('hex');
comprobarEntrega(directorio, huella, 'produccion', 'principal');

async function consultar(pagina) {
  return pagina.evaluate(async (manifiestos) => {
    const resultados = [];
    for (const { ruta } of manifiestos) {
      const respuesta = await fetch(ruta, { credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
      resultados.push({
        ruta,
        estado: respuesta.status,
        tipo: respuesta.headers.get('content-type'),
        cuerpo: respuesta.ok ? await respuesta.json() : null,
      });
    }
    return resultados;
  }, MANIFIESTOS);
}

function esperarManifiestoNativo(contexto, origen) {
  return contexto.waitForEvent('response', {
    predicate: async (respuesta) => {
      const url = new URL(respuesta.url());
      if (url.origin !== origen || !MANIFIESTOS.some(({ ruta }) => ruta === url.pathname)) {
        return false;
      }
      const peticion = respuesta.request();
      return peticion.method() === 'GET' && (await peticion.headerValue('sec-fetch-dest')) === 'manifest';
    },
    timeout: PLAZO_MANIFIESTO_MS,
  });
}

async function probar(contexto, origen) {
  let externas = 0;
  await contexto.route(/^https?:/, (ruta) => {
    if (new URL(ruta.request().url()).origin === origen) {
      return ruta.continue();
    }
    externas++;
    return ruta.abort();
  });
  const pagina = await contexto.newPage();
  await pagina.goto(new URL('/acceso-web', origen).href);
  const sinSesion = await consultar(pagina);
  for (const { ruta, estado } of sinSesion) {
    assert.equal(estado, PROHIBIDO, ruta);
  }

  const [nativo] = await Promise.all([esperarManifiestoNativo(contexto, origen), entrarPortal(pagina, PORTAL)]);
  const rutaNativa = new URL(nativo.url()).pathname;
  assert.equal(nativo.status(), OK, rutaNativa);
  assert.equal(nativo.fromServiceWorker(), false);
  assert.equal(await nativo.finished(), null, rutaNativa);
  const enlace = pagina.locator('link[rel~="manifest"]');
  assert.equal(await enlace.getAttribute('crossorigin'), 'use-credentials');
  const rutaEnlazada = new URL(await enlace.getAttribute('href'), pagina.url()).pathname;
  assert.ok(MANIFIESTOS.some(({ ruta }) => ruta === rutaEnlazada));
  assert.ok((await contexto.cookies(origen)).some((cookie) => cookie.name === '__Host-faro-portal' && cookie.httpOnly));

  const conSesion = await consultar(pagina);
  for (const [indice, { ruta, estado, tipo, cuerpo }] of conSesion.entries()) {
    assert.equal(estado, OK, ruta);
    assert.match(tipo ?? '', /^application\/manifest\+json(?:\s*;|$)/i, ruta);
    assert.equal(cuerpo.lang, MANIFIESTOS[indice].idioma, ruta);
    const original = JSON.parse(await readFile(join(directorio, 'web', ruta.slice(1)), 'utf8'));
    assert.deepEqual(cuerpo, original, ruta);
  }
  assert.equal(externas, 0, 'Todas las peticiones pertenecen al portal local');
  return {
    sinSesion: sinSesion.map(({ ruta, estado }) => ({ ruta, estado })),
    conSesion: conSesion.map(({ ruta, estado, tipo, cuerpo }) => ({ ruta, estado, tipo, idioma: cuerpo.lang })),
    nativo: { ruta: rutaNativa, estado: nativo.status(), destino: 'manifest', enlace: rutaEnlazada },
  };
}

const portal = await crearPortalLocal(directorio);
try {
  const navegador = await webkit.launch();
  try {
    const contexto = await navegador.newContext({
      userAgent: IDENTIDAD_WEB['User-Agent'],
      extraHTTPHeaders: IDENTIDAD_WEB,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    const resultado = await probar(contexto, portal.origen);
    console.log(JSON.stringify({ ...resultado, milisegundos: Math.round(performance.now() - inicio) }));
  } finally {
    await navegador.close();
  }
} finally {
  await portal.cerrar();
}
