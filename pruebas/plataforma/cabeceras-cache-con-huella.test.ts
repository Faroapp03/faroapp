// Los guiones con la huella de su contenido en el nombre se publican inmutables solo en las carpetas públicas; las
// zonas de las extensiones y del panel, lo privado y lo demás no cambian (src/plataforma/cabeceras-web.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zonaDe } from '../../herramientas/web/empaquetado/zonas.ts';
import { archivosPublicados } from '../../herramientas/web/publicados.ts';
import {
  CARPETAS_PUBLICAS_CON_HUELLA,
  cabecerasParaRuta,
  conCabecerasWeb,
} from '../../src/plataforma/cabeceras-web.ts';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';

const INMUTABLE = 'public, max-age=31536000, immutable';
const CORRECTO = 200;
/** Nombres como los que emite la construcción (empaquetado/construccion.ts): de página y de esbuild. */
const NOMBRES_CON_HUELLA = ['pagina-inicio-34d05dad5dabef57.js', 'chunk-RZSIKJMV.js', 'etapas-KMJLTM7O.js'];
const SIN_HUELLA = [
  '/inicio.html',
  '/recorrido.html',
  '/js/scripts-recorrido-paso-informe.js',
  '/motor/src/plataforma/navegador/motor.js',
  '/scripts/motor-local/worker.js',
  '/js/pagina-inicio-34d05dad5dabef57.js.map',
  '/js/sub/chunk-RZSIKJMV.js',
  '/scripts/recorrido/pagina-x-34d05dad5dabef57.js',
];

test('los guiones con huella de las carpetas públicas se guardan un año sin volver a preguntar', () => {
  assert.equal(zonaDe('inicio.html').carpeta, 'js', 'la zona pública del paquete es la primera carpeta pública');
  assert.deepEqual(CARPETAS_PUBLICAS_CON_HUELLA, ['js/', 'motor/trozos/']);
  for (const carpeta of CARPETAS_PUBLICAS_CON_HUELLA) {
    for (const nombre of NOMBRES_CON_HUELLA) {
      const ruta = `/${carpeta}${nombre}`;
      assert.equal(cabecerasParaRuta(ruta)['cache-control'], INMUTABLE, ruta);
      const alojamiento = new Response('', { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } });
      assert.equal(conCabecerasWeb(alojamiento, ruta).headers.get('cache-control'), INMUTABLE, ruta);
      assert.ok(cabecerasParaRuta(ruta)['content-security-policy'], ruta);
    }
  }
});

test('ninguna zona de una extensión ni la del panel privado recibe la caché inmutable', () => {
  const zonasNoPublicas = new Set(
    archivosPublicados()
      .filter((ruta) => ruta.endsWith('.html'))
      .map((ruta) => `${zonaDe(ruta).carpeta}/`)
      .filter((carpeta) => carpeta !== 'js/'),
  );
  zonasNoPublicas.add(`${zonaDe('administracion/index.html').carpeta}/`);
  assert.ok(zonasNoPublicas.size >= 1);
  for (const carpeta of zonasNoPublicas) {
    for (const nombre of NOMBRES_CON_HUELLA) {
      assert.equal(cabecerasParaRuta(`/${carpeta}${nombre}`)['cache-control'], undefined, `${carpeta}${nombre}`);
    }
  }
  for (const ruta of SIN_HUELLA) {
    assert.equal(cabecerasParaRuta(ruta)['cache-control'], undefined, ruta);
  }
  assert.equal(cabecerasParaRuta('/activar-acceso.html')['cache-control'], 'no-store');
});

test('en el acceso privado un guion con huella sigue sin guardarse (no-store)', async () => {
  const clave = 'clave-sintetica-de-prueba-con-al-menos-32-bytes';
  const registro = {
    idFromName: () => 'id',
    get: () => ({
      fetch: async (peticion: Request) =>
        new URL(peticion.url).pathname === '/privado/intento'
          ? Response.json({ permitido: true })
          : Response.json({ controles: null }),
    }),
  };
  const ruta = `/js/${NOMBRES_CON_HUELLA[1]}`;
  const respuesta = await responderAccesoPrivado(
    new Request(`https://ejemplo.test${ruta}`, {
      headers: {
        'cf-connecting-ip': '127.0.0.1',
        authorization: `Basic ${Buffer.from(`Faro:${clave}`).toString('base64')}`,
      },
    }),
    {
      ASSETS: { fetch: async () => new Response('x') },
      FARO_PRUEBAS_CLAVE: clave,
      FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
      REGISTRO_SOCIOS: registro,
    },
    async () => conCabecerasWeb(new Response('guion'), ruta),
  );
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
});
