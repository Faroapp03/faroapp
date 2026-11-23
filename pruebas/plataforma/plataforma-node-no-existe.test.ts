// El servidor local ante una dirección que no existe, como el Worker: la carga de una página recibe 404 con la página
// de Faro que lo explica; lo demás, el 404 de siempre.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, type OutgoingHttpHeaders, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { cabecerasDeLaWeb } from '../../src/plataforma/cabeceras-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const PLAZO_MS = 2000;
const INICIO = '<h1>Inicio de prueba</h1>';
const PAGINA = '<h1>Esta página no existe</h1>';
/** Lo que manda el navegador al cargar una página escrita en la barra de direcciones. */
const NAVEGACION = {
  accept: 'text/html,application/xhtml+xml',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
};

interface Lectura {
  estado: number;
  texto: string;
  cabeceras: IncomingHttpHeaders;
}

const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'node-no-existe-'));
const web = join(raiz, 'web');
const paquete = join(raiz, 'datos');
mkdirSync(web);
mkdirSync(paquete);
writeFileSync(join(web, '.assetsignore'), '.assetsignore\noculto.html\n');
writeFileSync(join(web, 'inicio.html'), INICIO);
writeFileSync(join(web, 'oculto.html'), INICIO);
writeFileSync(join(web, 'no-existe.html'), PAGINA);
writeFileSync(join(paquete, 'manifiesto.json'), '{}');

let servidor: Server;
let puerto = 0;

before(async () => {
  servidor = crearServidor({
    web,
    paquete,
    archivoAutoridadSecciones: join(raiz, 'autoridad-secciones.sqlite'),
    api: async () => new Response('API sintética'),
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  puerto = direccion.port;
});

after(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((resolver, rechazar) => servidor.close((e) => (e ? rechazar(e) : resolver())));
  rmSync(raiz, { recursive: true, force: true });
});

function pedir(metodo: string, ruta: string, cabeceras: OutgoingHttpHeaders = {}): Promise<Lectura> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: puerto,
        method: metodo,
        path: ruta,
        headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'], ...cabeceras },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => {
          texto += trozo;
        });
        res.on('end', () => resolver({ estado: res.statusCode ?? 0, texto, cabeceras: res.headers }));
      },
    );
    req.setTimeout(PLAZO_MS, () => req.destroy(new Error('plazo de prueba')));
    req.on('error', rechazar);
    req.end();
  });
}

test('una navegación a una dirección que no existe recibe 404 con la página, sin guardar y con sus cabeceras', async () => {
  const esperadas = cabecerasDeLaWeb('').paraRuta('/no-existe.html');
  for (const ruta of ['/cursoss.html', '/una/direccion/anidada', '/no-existe.html', '/oculto.html']) {
    const respuesta = await pedir('GET', ruta, NAVEGACION);
    assert.equal(respuesta.estado, ESTADO_HTTP.noEncontrado, ruta);
    assert.equal(respuesta.texto, PAGINA, ruta);
    assert.equal(respuesta.cabeceras['content-type'], 'text/html; charset=utf-8', ruta);
    assert.equal(respuesta.cabeceras['cache-control'], 'no-store', ruta);
    for (const [nombre, valor] of Object.entries(esperadas)) {
      assert.equal(respuesta.cabeceras[nombre], valor, `${ruta}: ${nombre}`);
    }
  }
});

test('lo que no es una navegación recibe el 404 de siempre, también la página por su nombre', async () => {
  const peticiones: [string, string, OutgoingHttpHeaders][] = [
    ['GET', '/scripts/no-esta.js', { accept: '*/*', 'sec-fetch-dest': 'script' }],
    ['GET', '/cursoss.html', { accept: '*/*', 'sec-fetch-mode': 'cors' }],
    ['GET', '/no-existe.html', { accept: '*/*', 'sec-fetch-mode': 'cors' }],
    ['HEAD', '/cursoss.html', NAVEGACION],
    ['HEAD', '/no-existe.html', NAVEGACION],
  ];
  for (const [metodo, ruta, cabeceras] of peticiones) {
    const respuesta = await pedir(metodo, ruta, cabeceras);
    assert.equal(respuesta.estado, ESTADO_HTTP.noEncontrado, `${metodo} ${ruta}`);
    assert.notEqual(respuesta.texto, PAGINA, `${metodo} ${ruta}`);
    assert.equal(respuesta.cabeceras['content-type'], 'text/plain; charset=utf-8', `${metodo} ${ruta}`);
  }
});

test('las páginas que existen se siguen sirviendo igual', async () => {
  const respuesta = await pedir('GET', '/inicio.html', NAVEGACION);
  assert.equal(respuesta.estado, ESTADO_HTTP.correcto);
  assert.equal(respuesta.texto, INICIO);
});
