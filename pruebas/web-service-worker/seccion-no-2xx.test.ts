// Una página propia de una sección que no está en la copia se pide a la red: lo que el servidor contesta sin un 200 (un
// error, un cierre o una redirección) llega tal cual, como con los alias. «Otra versión» queda para unos bytes que no
// cuadran con su huella o para lo que no es una página HTML.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { textoPoliticaCache } from '../../herramientas/web/politica-cache.ts';
import { paginasDelServicio } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

const HTML = '<!doctype html><h1>Biblioteca de esta versión</h1>';
const ERROR_INTERNO = 500;

/** Una instalación con la biblioteca abierta y sin su página en la copia; `red` da la respuesta de la página. */
async function preparar(base: string) {
  const sw = servicio(base, {
    politica: textoPoliticaCache(),
    archivos: ['inicio.html', 'sin-conexion.html', 'biblioteca.html'],
    paginasSecciones: [['biblioteca.html', createHash('sha256').update(HTML).digest('hex')]],
    cuerpoDe: (ruta) => (ruta === 'biblioteca.html' ? HTML : 'PÁGINA FIJA'),
  });
  const red = { pagina: () => new Response(HTML, { headers: { 'content-type': 'text/html' } }) };
  sw.conectar();
  sw.red.respuesta = (url) => {
    if (url === sw.urlDe('secciones-v3.json')) {
      return Response.json({
        version: VERSION_SECCIONES_PUBLICAS,
        autoridad: '11111111-1111-4111-8111-111111111111',
        revision: 0,
        secciones: { ...politicaSeccionesInicial(), biblioteca: true },
      });
    }
    if (url === sw.urlDe('biblioteca.html')) {
      return red.pagina();
    }
    return new Response('PÁGINA FIJA', {
      headers: {
        'content-type': 'text/html',
        ...(url === sw.urlDe('inicio.html') ? { 'x-faro-portal': 'publico' } : {}),
      },
    });
  };
  await sw.instalar();
  sw.guardadas.get(sw.nombreCopia)?.delete(sw.urlDe('biblioteca.html'));
  const otraVersion = paginasDelServicio()['otra-version']?.replaceAll('{{inicio}}', sw.urlDe('inicio.html'));
  return { sw, red, otraVersion };
}

for (const base of BASES) {
  for (const [caso, estado] of [
    ['un error del servidor', ERROR_INTERNO],
    ['un servicio no disponible', ESTADO_HTTP.noDisponible],
    ['un cierre (404)', ESTADO_HTTP.noEncontrado],
    ['una redirección', ESTADO_HTTP.encontradoEnOtraDireccion],
  ] as const) {
    test(`una página propia de sección con ${caso} llega tal cual, no como otra versión: ${base}`, async () => {
      const { sw, red } = await preparar(base);
      red.pagina = () => new Response(`SERVIDOR ${estado}`, { status: estado, headers: { location: '/otra' } });
      const respuesta = await pedir(sw, 'biblioteca.html');
      assert.equal(respuesta.estado, estado);
      assert.equal(respuesta.cuerpo, `SERVIDOR ${estado}`);
      assert.equal(sw.guardadas.get(sw.nombreCopia)?.has(sw.urlDe('biblioteca.html')), false);
    });
  }

  test(`la página propia se pide sin seguir redirecciones: ${base}`, async () => {
    const { sw } = await preparar(base);
    const modos: RequestRedirect[] = [];
    const pedirALaRed = sw.red.fetch.bind(sw.red);
    sw.red.fetch = async (pedido: Request | string, opciones?: RequestInit) => {
      if (typeof pedido !== 'string' && pedido.url === sw.urlDe('biblioteca.html')) {
        modos.push(pedido.redirect);
      }
      return pedirALaRed(pedido, opciones);
    };
    await pedir(sw, 'biblioteca.html');
    assert.deepEqual(modos, ['manual']);
  });

  for (const [caso, pagina] of [
    ['unos bytes que no cuadran', () => new Response('OTRA', { headers: { 'content-type': 'text/html' } })],
    ['algo que no es una página HTML', () => new Response(HTML, { headers: { 'content-type': 'text/plain' } })],
  ] as const) {
    test(`una página propia de sección con ${caso} es de otra versión: ${base}`, async () => {
      const { sw, red, otraVersion } = await preparar(base);
      red.pagina = pagina;
      const respuesta = await pedir(sw, 'biblioteca.html');
      assert.equal(respuesta.estado, ESTADO_HTTP.noDisponible);
      assert.equal(respuesta.cuerpo, otraVersion);
    });
  }
}
