/** Worker real con un doble del protocolo durable; no Access, proveedores ni red externa. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type DocumentoSecciones,
  politicaSeccionesInicial,
  SECCIONES_WEB,
} from '../../src/administracion/secciones-web.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';

const ORIGEN = 'https://faro.example';
const CORRECTO = 200;
const VERSION_PUBLICA = 4;
const AUSENTE = 404;
const PROHIBIDO = 403;
const METODO = 405;
const NO_DISPONIBLE = 503;
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
const RECURSOS = [
  '/scripts/recorrido.js',
  '/motor/prueba.js',
  '/paquete/0123456789abcdef/manifiesto.json',
  '/acceso-api.html',
];
const PAGINAS = SECCIONES_WEB.flatMap(({ rutas }) => rutas);
const PUBLICADOS = new Set([...FIJAS, ...RECURSOS, ...PAGINAS]);
const CONTROLES = {
  version: 2,
  revision: 0,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};

interface Estado {
  documento: DocumentoSecciones;
  fallo: boolean;
  lecturas: number;
  estaticos: string[];
}

function assets(estado: Estado) {
  return {
    fetch: async (peticion: Request) => {
      const ruta = new URL(peticion.url).pathname;
      estado.estaticos.push(ruta);
      return new Response(peticion.method === 'HEAD' ? null : `Contenido único ${ruta} — Año 2026`, {
        status: PUBLICADOS.has(ruta) ? CORRECTO : AUSENTE,
        headers: {
          'content-type': ruta.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
          'cache-control': 'no-cache',
          etag: '"sintetico"',
        },
      });
    },
  };
}

function respuestaAutoridad(estado: Estado) {
  estado.lecturas++;
  if (estado.fallo) {
    throw new Error('Autoridad sintética caída');
  }
  return Response.json({
    secciones: { ...estado.documento, version: VERSION_PUBLICA, autoridad: '11111111-1111-4111-8111-111111111111' },
  });
}

function registro(estado: Estado) {
  return {
    idFromName: (nombre: string) => nombre,
    get: () => ({
      fetch: async (peticion: Request) => {
        const ruta = new URL(peticion.url).pathname;
        if (ruta === '/secciones/autoridad') {
          return respuestaAutoridad(estado);
        }
        if (ruta === '/panel/preparar' || ruta === '/controles/leer') {
          return Response.json({ controles: CONTROLES });
        }
        assert.equal(ruta, '/secciones/leer');
        estado.lecturas++;
        if (estado.fallo) {
          throw new Error('Autoridad sintética caída');
        }
        return Response.json({ secciones: estado.documento });
      },
    }),
  };
}

test('apagar administración conserva la retirada durable de Biblioteca', async () => {
  const { estado, pedir } = fixture(false);
  estado.documento = { version: 3, revision: 1, secciones: { ...politicaSeccionesInicial(), biblioteca: false } };
  assert.equal((await pedir('/biblioteca.html')).status, AUSENTE);
  const respuesta = await pedir('/secciones.json');
  assert.equal(((await respuesta.json()) as DocumentoSecciones).secciones.biblioteca, false);
});

test('ocultar la Encuesta cierra su página como cualquier sección, pero no el inicio, donde llega la invitación', async () => {
  const { estado, pedir } = fixture(false);
  estado.documento = { version: 3, revision: 1, secciones: { ...politicaSeccionesInicial(), encuesta: false } };
  for (const ruta of ['/encuesta.html', '/encuesta', '/ENCUESTA.HTML']) {
    assert.equal((await pedir(ruta)).status, AUSENTE, ruta);
  }
  assert.equal((await pedir('/inicio.html')).status, CORRECTO);
  estado.documento = { version: 3, revision: 2, secciones: politicaSeccionesInicial() };
  assert.equal((await pedir('/encuesta.html')).status, CORRECTO);
});

function fixture(administrada = true) {
  const estado = {
    documento: { version: 3, revision: 0, secciones: politicaSeccionesInicial() } as DocumentoSecciones,
    fallo: false,
    lecturas: 0,
    estaticos: [] as string[],
  };
  const env = {
    FARO_ADMINISTRACION: administrada ? 'si' : 'no',
    FARO_ADMIN_ORIGEN: ORIGEN,
    FARO_ADMIN_ACCESS_EQUIPO: 'equipo-sintetico',
    FARO_ADMIN_ACCESS_AUD: 'panel',
    FARO_SECRETO_FIRMA: 'secreto sintetico exclusivo de esta prueba local',

    ASSETS: assets(estado),
    REGISTRO_SOCIOS: registro(estado),
  };
  const pedir = (ruta: string, method = 'GET') =>
    worker.fetch(
      new Request(`${ORIGEN}${ruta}`, {
        method,
        headers: {
          'User-Agent': IDENTIDAD_WEB['User-Agent'],
          [CABECERA_CONTRATO]: String(CONTRATO_API),
          'If-None-Match': '"sintetico"',
          Range: 'bytes=0-2',
        },
      }),
      env,
    );
  return { estado, env, pedir };
}

async function instantanea(respuesta: Response) {
  return { estado: respuesta.status, cabeceras: Object.fromEntries(respuesta.headers), cuerpo: await respuesta.text() };
}

test('Worker todo activo conserva exactamente respuestas de páginas, recursos, raíz y aliases', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No hay red externa'));
  const original = fixture(false);
  const administrada = fixture();
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
  ]) {
    for (const method of ['GET', 'HEAD']) {
      assert.deepEqual(
        await instantanea(await administrada.pedir(ruta, method)),
        await instantanea(await original.pedir(ruta, method)),
        `${method} ${ruta}`,
      );
    }
  }
  assert.ok(original.estado.lecturas > 0, 'También sin panel se consulta la autoridad durable');
  assert.equal((await original.pedir('/cursos.html')).status, CORRECTO);
  assert.equal((await administrada.pedir('/cursos.html')).status, CORRECTO);
  administrada.estado.documento = {
    version: 3,
    revision: 1,
    secciones: { ...politicaSeccionesInicial(), cursos: false },
  };
  assert.equal((await administrada.pedir('/cursos.html')).status, AUSENTE);
  administrada.estado.documento = {
    version: 3,
    revision: 2,
    secciones: { ...politicaSeccionesInicial(), cursos: true },
  };
  assert.equal((await administrada.pedir('/cursos.html')).status, CORRECTO);
  const declarada = await original.pedir('/secciones.json');
  assert.equal(declarada.status, CORRECTO);
  assert.deepEqual(await declarada.json(), original.estado.documento);
});

test('Worker consulta cada cierre y reapertura sin pasar documentos desactivados a ASSETS', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No hay red externa'));
  const f = fixture();
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
          const antes = f.estado.estaticos.length;
          const respuesta = await f.pedir(variante, method);
          assert.equal(respuesta.status, AUSENTE, `${id}: ${method} ${variante}`);
          assert.equal(await respuesta.text(), '');
          assert.equal(respuesta.headers.get('cache-control'), 'no-store');
          assert.equal(f.estado.estaticos.length, antes);
        }
      }
    }
    assert.deepEqual(await (await f.pedir('/secciones.json')).json(), f.estado.documento);
  }
  f.estado.documento = {
    ...f.estado.documento,
    secciones: Object.fromEntries(SECCIONES_WEB.map(({ id }) => [id, false])) as DocumentoSecciones['secciones'],
  };
  for (const ruta of PAGINAS) {
    assert.equal((await f.pedir(ruta)).status, AUSENTE, ruta);
  }
  assert.equal((await f.pedir('/como-funciona.html')).status, CORRECTO, 'el traslado no depende de ninguna clave');
  assert.equal((await f.pedir('/guias.html')).status, CORRECTO, 'el traslado no depende de ninguna clave');
  f.estado.documento = { version: 3, revision: f.estado.documento.revision + 1, secciones: politicaSeccionesInicial() };
  assert.equal((await f.pedir('/doctor.html')).status, CORRECTO);
  const head = await f.pedir('/secciones.json', 'HEAD');
  assert.equal(head.status, CORRECTO);
  assert.equal(head.headers.get('cache-control'), 'no-store');
  assert.equal(await head.text(), '');
});

test('Worker autoridad caída aísla secciones y proyección sin impedir páginas fijas, datos, API ni panel', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No hay red externa'));
  const f = fixture();
  await f.pedir('/secciones.json');
  f.estado.fallo = true;
  for (const ruta of ['/biblioteca.html', '/secciones.json']) {
    const antes = f.estado.estaticos.length;
    const respuesta = await f.pedir(ruta);
    assert.equal(respuesta.status, NO_DISPONIBLE);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    assert.equal(await respuesta.text(), '');
    assert.equal(f.estado.estaticos.length, antes);
  }
  const antes = f.estado.lecturas;
  for (const ruta of [...FIJAS, ...RECURSOS]) {
    assert.equal((await f.pedir(ruta)).status, CORRECTO, ruta);
  }
  assert.equal((await f.pedir('/api/grupos')).status, CORRECTO);
  assert.equal((await f.pedir('/administracion')).status, PROHIBIDO);
  assert.equal((await f.pedir('/mantenimiento/no-existe')).status, AUSENTE);
  assert.equal(f.estado.lecturas, antes);
  const metodo = await f.pedir('/secciones.json', 'OPTIONS');
  assert.equal(metodo.status, METODO);
  assert.equal(metodo.headers.get('allow'), 'GET, HEAD');
  assert.equal(f.estado.lecturas, antes);
});

test('Worker no ofrece la página retirada y conserva el recorrido en GET y HEAD', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No hay red externa'));
  const f = fixture();
  for (const metodo of ['GET', 'HEAD']) {
    assert.equal((await f.pedir('/chatbot.html', metodo)).status, AUSENTE);
    assert.equal((await f.pedir('/chatbot.html?idioma=ca', metodo)).status, AUSENTE);
    assert.equal((await f.pedir('/recorrido.html', metodo)).status, CORRECTO);
  }
});
