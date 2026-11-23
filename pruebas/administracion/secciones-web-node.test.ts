/** HTTP crudo para conservar aliases que un cliente Fetch normaliza antes de enviarlos. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  type DocumentoSecciones,
  politicaSeccionesInicial,
  SECCIONES_WEB,
} from '../../src/administracion/secciones-web.js';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import type { AdministracionMontada } from '../../src/plataforma/administracion.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const CORRECTO = 200;
const AUSENTE = 404;
const METODO = 405;
const NO_DISPONIBLE = 503;
const PLAZO_HTTP_MS = 5_000;
const BASE_HEXADECIMAL = 16;
const EXTENSION_HTML = '.html';
const FIJAS = [
  '/inicio.html',
  '/creditos.html',
  '/informacion-y-creditos.html',
  '/accesibilidad.html',
  '/verificable.html',
  '/sin-conexion.html',
  // «Instalar Faro»: página fija, sin interruptor en el panel; la enlazan la portada y el menú.
  '/instalar.html',
  // Páginas de traslado de «Cómo funciona», hoy etapa de que-es-faro.html, y de «Guías», hoy segmentos de
  // biblioteca.html: no son secciones.
  '/como-funciona.html',
  '/guias.html',
];
const RECURSOS = ['/scripts/recorrido.js', '/motor/prueba.js', '/paquete/prueba.json', '/acceso-api.html'];
const PAGINAS = SECCIONES_WEB.flatMap(({ rutas }) => rutas);

interface Estado {
  documento: DocumentoSecciones;
  fallo: boolean;
  lecturas: number;
}

function crearWeb(): string {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'secciones-web-'));
  const web = join(carpeta, 'web');
  mkdirSync(web);
  for (const ruta of [...FIJAS, ...RECURSOS, ...PAGINAS]) {
    const archivo = join(web, ruta.slice(1));
    mkdirSync(dirname(archivo), { recursive: true });
    writeFileSync(archivo, `Contenido único ${ruta} — Año 2026`);
  }
  writeFileSync(join(web, '.assetsignore'), '.assetsignore\n');
  return web;
}

function crearAdministracion(estado: Estado): AdministracionMontada {
  return {
    configuracion: { origen: 'https://panel.example', permitirHttpLocal: false },
    responder: async () => new Response('PANEL', { status: AUSENTE }),
    responderRecurso: async () => new Response('PANEL', { status: AUSENTE }),
    leerControles: async () => ({
      version: 2,
      revision: 0,
      api: 'deshabilitada',
      mcp: false,
      a2a: false,
    }),
    leerSecciones: async () => {
      estado.lecturas++;
      if (estado.fallo) {
        throw new Error('Fallo sintético');
      }
      return estado.documento;
    },
    catalogo: async () => Response.json({ catalogo: true }),
    registrarAcceso: async () => assert.fail('La prueba de secciones no registra consultas'),
  };
}

async function fixture(t: TestContext, administrada: boolean) {
  const web = crearWeb();
  const estado: Estado = {
    documento: { version: 3, revision: 0, secciones: politicaSeccionesInicial() },
    fallo: false,
    lecturas: 0,
  };
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(dirname(web), 'privado', 'clientes.sqlite'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async () => new Response('API', { headers: { 'cache-control': 'no-store' } }),
    ...(administrada ? { administracion: crearAdministracion(estado) } : {}),
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  const puerto = direccion.port;
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise<void>((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    rmSync(dirname(web), { recursive: true });
  });
  return { estado, pedir: (ruta: string, method = 'GET') => pedirHttp(puerto, ruta, method) };
}

function pedirHttp(puerto: number, ruta: string, method: string) {
  return new Promise<{ estado: number; cuerpo: string; cabeceras: Record<string, string | string[] | undefined> }>(
    (resolve, reject) => {
      const peticion = request(
        {
          host: '127.0.0.1',
          port: puerto,
          path: ruta,
          method,
          headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'], 'If-None-Match': '"anterior"', Range: 'bytes=0-2' },
        },
        (respuesta) => {
          let cuerpo = '';
          respuesta.setEncoding('utf8');
          respuesta.on('data', (parte: string) => {
            cuerpo += parte;
          });
          respuesta.on('end', () => {
            const { date: _fecha, ...cabeceras } = respuesta.headers;
            resolve({ estado: respuesta.statusCode ?? 0, cuerpo, cabeceras });
          });
        },
      );
      peticion.setTimeout(PLAZO_HTTP_MS, () => peticion.destroy(new Error('Plazo HTTP')));
      peticion.on('error', reject);
      peticion.end();
    },
  );
}

test('todo activo conserva exactamente cuerpos, estados y cabeceras de documentos y aliases en Node', async (t) => {
  const original = await fixture(t, false);
  const administrada = await fixture(t, true);
  for (const ruta of [
    ...FIJAS,
    ...RECURSOS,
    ...PAGINAS,
    '/',
    '/%62iblioteca.html',
    '//biblioteca.html',
    '/x/%2f../biblioteca.html',
    '/biblioteca',
    '/BIBLIOTECA.HTML',
    '/biblioteca.html/',
    '/%E0%A4%A',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      assert.deepEqual(await administrada.pedir(ruta, method), await original.pedir(ruta, method), `${method} ${ruta}`);
    }
  }
  assert.equal((await original.pedir('/cursos.html')).estado, CORRECTO);
  assert.equal((await administrada.pedir('/cursos.html')).estado, CORRECTO);
  administrada.estado.documento = {
    version: 3,
    revision: 1,
    secciones: { ...politicaSeccionesInicial(), cursos: false },
  };
  assert.equal((await administrada.pedir('/cursos.html')).estado, AUSENTE);
  administrada.estado.documento = {
    version: 3,
    revision: 2,
    secciones: { ...politicaSeccionesInicial(), cursos: true },
  };
  assert.equal((await administrada.pedir('/cursos.html')).estado, CORRECTO);
  const declarada = await original.pedir('/secciones.json');
  assert.equal(declarada.estado, CORRECTO);
  assert.equal(declarada.cabeceras['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(declarada.cuerpo), original.estado.documento);
});

test('cada cierre Node cubre páginas, consultas y aliases, incluidas todas apagadas', async (t) => {
  const f = await fixture(t, true);
  for (const { id, rutas } of SECCIONES_WEB) {
    f.estado.documento = {
      version: 3,
      revision: f.estado.documento.revision + 1,
      secciones: { ...politicaSeccionesInicial(), [id]: false },
    };
    for (const ruta of rutas) {
      const primera = ruta.charCodeAt(1).toString(BASE_HEXADECIMAL);
      for (const variante of [
        ruta,
        `${ruta}?idioma=ca`,
        `/%${primera}${ruta.slice(2)}`,
        `/${ruta}`,
        `/x/%2f..${ruta}`,
        `${ruta}/`,
        ruta.slice(0, -EXTENSION_HTML.length),
        ruta.toUpperCase(),
      ]) {
        for (const method of ['GET', 'HEAD', 'POST']) {
          const respuesta = await f.pedir(variante, method);
          assert.equal(respuesta.estado, AUSENTE, `${id}: ${method} ${variante}`);
          assert.equal(respuesta.cuerpo, '');
          assert.equal(respuesta.cabeceras['cache-control'], 'no-store');
        }
      }
    }
  }
  f.estado.documento = {
    ...f.estado.documento,
    secciones: Object.fromEntries(SECCIONES_WEB.map(({ id }) => [id, false])) as DocumentoSecciones['secciones'],
  };
  for (const ruta of PAGINAS) {
    assert.equal((await f.pedir(ruta)).estado, AUSENTE, ruta);
  }
  assert.ok(PAGINAS.includes('/que-es-faro.html') && !PAGINAS.includes('/como-funciona.html'));
  assert.ok(PAGINAS.includes('/biblioteca.html'));
  assert.ok(!PAGINAS.includes('/guias.html'));
  assert.equal((await f.pedir('/como-funciona.html')).estado, CORRECTO, 'el traslado no depende de ninguna clave');
  assert.equal((await f.pedir('/guias.html')).estado, CORRECTO, 'el traslado no depende de ninguna clave');
});

test('autoridad caída en Node aísla secciones y permite reabrir sin reiniciar', async (t) => {
  const f = await fixture(t, true);
  f.estado.documento = { ...f.estado.documento, secciones: { ...politicaSeccionesInicial(), doctor: false } };
  assert.equal((await f.pedir('/doctor.html')).estado, AUSENTE);
  const antes = f.estado.lecturas;
  f.estado.fallo = true;
  for (const ruta of [...FIJAS, ...RECURSOS, '/api/salud', '/administracion', '/mantenimiento/prueba']) {
    const respuesta = await f.pedir(ruta);
    assert.notEqual(respuesta.estado, NO_DISPONIBLE, ruta);
  }
  assert.equal(f.estado.lecturas, antes);
  assert.equal((await f.pedir('/biblioteca.html')).estado, NO_DISPONIBLE);
  assert.equal((await f.pedir('/secciones.json')).estado, NO_DISPONIBLE);
  assert.equal((await f.pedir('/secciones.json', 'HEAD')).cuerpo, '');
  const metodo = await f.pedir('/secciones.json', 'POST');
  assert.equal(metodo.estado, METODO);
  assert.equal(metodo.cabeceras.allow, 'GET, HEAD');
  f.estado.fallo = false;
  f.estado.documento = { version: 3, revision: f.estado.documento.revision + 1, secciones: politicaSeccionesInicial() };
  assert.equal((await f.pedir('/doctor.html')).estado, CORRECTO);
  assert.deepEqual(JSON.parse((await f.pedir('/secciones.json?idioma=ca')).cuerpo), f.estado.documento);
});

test('Node no ofrece la página retirada y conserva el recorrido en GET y HEAD', async (t) => {
  const f = await fixture(t, true);
  for (const metodo of ['GET', 'HEAD']) {
    assert.equal((await f.pedir('/chatbot.html', metodo)).estado, AUSENTE);
    assert.equal((await f.pedir('/chatbot.html?idioma=ca', metodo)).estado, AUSENTE);
    assert.equal((await f.pedir('/recorrido.html', metodo)).estado, CORRECTO);
  }
});
