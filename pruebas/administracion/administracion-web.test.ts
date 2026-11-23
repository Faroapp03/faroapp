/** HTML y assets privados: JWT RS256 sintético, socket Node y Worker real; sin SQL ni servicios externos. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../src/api/metadatos-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';
import {
  crearServidorWebAdministrativo,
  MAX_RECURSO_ADMINISTRATIVO_BYTES,
  POLITICA_WEB_ADMINISTRATIVA,
} from '../../src/plataforma/administracion-web.ts';
import { POLITICA_DE_LA_API } from '../../src/plataforma/cabeceras-web.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { montarAdministracionNode } from '../../src/plataforma/node/administracion.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const ORIGEN = 'https://panel.example';
const RSA_BITS = 2048;
const VIDA_JWT_S = 3600;
const MS_POR_SEGUNDO = 1000;
const EXITO = 200;
const AUSENTE = 404;
const PROHIBIDO = 403;
const METODO = 405;
const NO_DISPONIBLE = 503;
const VARIABLES = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: ORIGEN,
  FARO_ADMIN_ACCESS_EQUIPO: 'equipo',
  FARO_ADMIN_ACCESS_AUD: 'panel',
  FARO_SECRETO_FIRMA: 'firma sintetica estable de mas de treinta y dos caracteres',
};
/** La entrada construida del panel: su nombre lleva la huella de la página (16 cifras hexadecimales). */
const ENTRADA = 'js/pagina-administracion-index-0123456789abcdef.js';
/** Lo que la construcción emite para el panel: la página, su hoja de estilo, la entrada, un trozo y un diccionario. */
const ARCHIVOS = ['index.html', ENTRADA, 'js/chunk-C7IYRFA6.js', 'js/es-XA4L7B3V.js', 'panel.css'];
const MODULO = `/administracion/${ENTRADA}`;
const RUTAS = [
  '/administracion',
  '/administracion/',
  ...ARCHIVOS.slice(1).map((nombre) => `/administracion/${nombre}`),
];
const ALIAS = [
  '/administracion/index.html',
  '/Administracion',
  '/%61dministracion',
  '/administracion//panel.js',
  '/administracion/panel.js?x=1',
  '/administracion?',
  '/x/%2e%2e%2fadministracion/panel.js',
  '/administracion/no-existe',
  '/administracion/service-worker.js',
  // Los nombres de las fuentes ya no se publican: el panel construido no los tiene.
  '/administracion/panel.js',
  '/administracion/cliente.js',
  // Solo módulos con huella, de un solo nombre y en su zona.
  '/administracion/js/inventado.js',
  '/administracion/js/chunk-c7iyrfa6.js',
  '/administracion/js/sub/chunk-C7IYRFA6.js',
  '/administracion/js/%2e%2e/index.html',
  '/administracion/js/..%2fpanel.css',
  '/administracion/js/chunk-C7IYRFA6.js.map',
  '/administracion/chunk-C7IYRFA6.js',
];
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
let jwt: string;
let pedirCertificados: typeof fetch;
before(async () => {
  const par = await crypto.subtle.generateKey(
    { ...ALGORITMO, modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const publica = await crypto.subtle.exportKey('jwk', par.publicKey);
  const entrada = `${Buffer.from('{"alg":"RS256","kid":"prueba"}').toString('base64url')}.${Buffer.from(JSON.stringify({ iss: 'https://equipo.cloudflareaccess.com', aud: ['panel'], type: 'app', sub: 'administrador-sintetico', exp: Math.floor(Date.now() / MS_POR_SEGUNDO) + VIDA_JWT_S })).toString('base64url')}`;
  jwt = `${entrada}.${Buffer.from(await crypto.subtle.sign(ALGORITMO, par.privateKey, new TextEncoder().encode(entrada))).toString('base64url')}`;
  pedirCertificados = async (url, inicio) => {
    assert.equal(String(url), 'https://equipo.cloudflareaccess.com/cdn-cgi/access/certs');
    assert.equal(new Headers(inicio?.headers).get('user-agent'), IDENTIDAD_WEB['User-Agent']);
    return Response.json({ keys: [{ ...publica, kid: 'prueba' }] });
  };
});
function solicitud(ruta: string, token = jwt, method = 'GET', headers: Record<string, string> = {}) {
  return new Request(`${ORIGEN}${ruta}`, { method, headers: { 'cf-access-jwt-assertion': token, ...headers } });
}
function recurso(ruta: string): Response {
  const tipo = ruta.endsWith('.css') ? 'text/css' : 'text/javascript';
  return new Response(`privado:${ruta}`, {
    headers: {
      'content-type': ruta.endsWith('.html') ? 'text/html' : tipo,
      'set-cookie': 'NO-REENVIAR=secreto',
      'cache-control': 'public, max-age=3600',
      'service-worker-allowed': '/',
    },
  });
}
function comprobarCabeceras(respuesta: Response): void {
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.equal(respuesta.headers.get('content-security-policy'), POLITICA_WEB_ADMINISTRATIVA);
  assert.equal(respuesta.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  for (const cabecera of ['set-cookie', 'service-worker-allowed', 'location', 'access-control-allow-origin']) {
    assert.equal(respuesta.headers.get(cabecera), null);
  }
}
function servidorWeb() {
  return crearServidorWebAdministrativo({
    configuracion: { origen: ORIGEN, permitirHttpLocal: false },
    guardiaAdministrativa: guardiaAdministrativaDelEntorno(VARIABLES, pedirCertificados),
  });
}
test('la CSP del panel permite imágenes, fuentes y manifiesto locales y mantiene cerrado el resto por defecto', () => {
  const directivas = POLITICA_WEB_ADMINISTRATIVA.split('; ');
  assert.ok(directivas.includes("img-src 'self'"));
  assert.ok(directivas.includes("font-src 'self'"));
  assert.ok(directivas.includes("manifest-src 'self'"));
  assert.ok(directivas.includes("style-src 'self' 'report-sample'"));
  assert.ok(directivas.includes("default-src 'none'"));
  assert.doesNotMatch(POLITICA_WEB_ADMINISTRATIVA, /unsafe-inline|data:|https:/);
});

test('lista privada exige JWT firmado antes de lector; GET/HEAD sin credenciales hacia assets ni cookies hacia cliente', async () => {
  const responder = servidorWeb();
  let lecturas = 0;
  const leer = async (ruta: string, peticion: Request) => {
    lecturas++;
    assert.equal(peticion.url, `${ORIGEN}${ruta}`);
    assert.equal(peticion.redirect, 'manual');
    assert.deepEqual([...peticion.headers], [...new Headers(IDENTIDAD_WEB)]);
    return recurso(ruta);
  };
  for (const ruta of RUTAS) {
    for (const token of ['', 'jwt-invalido']) {
      const salida = await responder(solicitud(ruta, token), leer);
      assert.equal(salida.status, PROHIBIDO);
      comprobarCabeceras(salida);
    }
  }
  assert.equal(lecturas, 0);
  for (const ruta of RUTAS) {
    const salida = await responder(solicitud(ruta), leer);
    assert.equal(salida.status, EXITO);
    comprobarCabeceras(salida);
    assert.match(await salida.text(), /^privado:/);
    const head = await responder(solicitud(ruta, jwt, 'HEAD'), leer);
    assert.equal(head.status, EXITO);
    assert.equal(head.body, null);
    comprobarCabeceras(head);
  }
});
test('alias, query, origen ajeno, métodos y FetchMetadata no leen archivos; navegación directa permitida', async () => {
  const responder = servidorWeb();
  const noLeer = async () => assert.fail('No debe obtener asset');
  for (const ruta of ALIAS) {
    assert.equal((await responder(solicitud(ruta), noLeer)).status, AUSENTE, ruta);
  }
  assert.equal((await responder(new Request('https://otro.example/administracion'), noLeer)).status, AUSENTE);
  assert.equal((await responder(solicitud('/administracion', jwt, 'POST'), noLeer)).status, METODO);
  for (const headers of [
    { origin: 'https://otro.example' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ]) {
    assert.equal((await responder(solicitud('/administracion', jwt, 'GET', headers), noLeer)).status, PROHIBIDO);
  }
  assert.equal(
    (
      await responder(solicitud('/administracion', jwt, 'GET', { 'sec-fetch-site': 'none' }), async (ruta) =>
        recurso(ruta),
      )
    ).status,
    EXITO,
  );
});
test('backend de assets no puede redirigir, enviar HTML como JS ni filtrar errores; HEAD permanece vacío', async () => {
  const responder = servidorWeb();
  for (const respuesta of [
    Response.redirect('https://otro.example'),
    new Response('portal', { headers: { 'content-type': 'text/html' } }),
    new Response('no', { status: AUSENTE }),
  ]) {
    assert.equal((await responder(solicitud(MODULO), async () => respuesta)).status, AUSENTE);
  }
  const fallo = await responder(solicitud('/administracion', jwt, 'HEAD'), async () => {
    throw new Error('NO-EXPOSICION');
  });
  assert.equal(fallo.status, NO_DISPONIBLE);
  assert.equal(fallo.body, null);
  comprobarCabeceras(fallo);
});
async function conNode(accion: (origen: string, archivo: string) => Promise<void>, habilitado = true) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'panel-web-node-'));
  const web = join(dir, 'web');
  mkdirSync(join(web, 'administracion', 'js'), { recursive: true });
  for (const nombre of ARCHIVOS) {
    writeFileSync(join(web, 'administracion', nombre), `privado:${nombre}`);
  }
  const variables = { ...VARIABLES, FARO_ADMINISTRACION: habilitado ? 'si' : 'no' };
  const archivo = join(dir, 'panel.sqlite');
  const montaje = habilitado
    ? await montarAdministracionNode({
        perfil: { variables },
        datos: cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))),
        origenesPermitidos: [],
        archivo,
        pedir: pedirCertificados,
      })
    : null;
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(dir, 'autoridad-secciones.sqlite'),
    api: async () => new Response('API'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    ...(montaje ? { administracion: montaje.administracion } : {}),
  });
  try {
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    await accion(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, archivo);
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    montaje?.cerrar();
    rmSync(dir, { recursive: true });
  }
}
async function pedirNode(origen: string, ruta: string, token = jwt, method = 'GET') {
  return fetch(`${origen}${ruta}`, {
    method,
    headers: { 'user-agent': IDENTIDAD_WEB['User-Agent'], 'cf-access-jwt-assertion': token },
  });
}
test('Node sirve lista desde raízweb después de Access, sin crear SQL; OFF nunca cae a disco', async () => {
  await conNode(async (origen, archivo) => {
    for (const ruta of RUTAS) {
      assert.equal((await pedirNode(origen, ruta, '')).status, PROHIBIDO);
      const salida = await pedirNode(origen, ruta);
      assert.equal(salida.status, EXITO);
      comprobarCabeceras(salida);
      assert.match(await salida.text(), /privado:/);
      const head = await pedirNode(origen, ruta, jwt, 'HEAD');
      assert.equal(head.status, EXITO);
      assert.equal(await head.text(), '');
    }
    for (const ruta of ALIAS) {
      assert.equal((await pedirNode(origen, ruta)).status, AUSENTE, ruta);
    }
    assert.equal(existsSync(archivo), false);
    const guion = join(dirname(archivo), 'web', 'administracion', ENTRADA);
    rmSync(guion);
    writeFileSync(join(dirname(archivo), 'fuera.js'), 'no-publicar');
    symlinkSync(join(dirname(archivo), 'fuera.js'), guion);
    assert.equal((await pedirNode(origen, MODULO)).status, AUSENTE);
  });
  await conNode(async (origen) => {
    for (const ruta of RUTAS) {
      assert.equal((await pedirNode(origen, ruta)).status, AUSENTE);
    }
  }, false);
});
function entornoWorker(lector = async (peticion: Request) => recurso(new URL(peticion.url).pathname)) {
  const llamadas: string[] = [];
  return {
    llamadas,
    env: {
      ...VARIABLES,
      ASSETS: {
        fetch: async (peticion: Request) => {
          llamadas.push(new URL(peticion.url).pathname);
          assert.equal(peticion.headers.get('cf-access-jwt-assertion'), null);
          assert.equal(peticion.headers.get('cookie'), null);
          return lector(peticion);
        },
      },
      REGISTRO_SOCIOS: {
        idFromName: () => assert.fail('HTML no consulta SQL'),
        get: () => assert.fail('HTML no consulta SQL'),
      },
    },
  };
}
test('Worker sirve solo ASSETS exactos autenticados sin RPC SQL; OFF/configrota/alias no fallback', async (t) => {
  t.mock.method(globalThis, 'fetch', pedirCertificados);
  const f = entornoWorker();
  for (const ruta of RUTAS) {
    assert.equal((await worker.fetch(solicitud(ruta, ''), f.env)).status, PROHIBIDO);
    const salida = await worker.fetch(solicitud(ruta), f.env);
    assert.equal(salida.status, EXITO);
    comprobarCabeceras(salida);
    const head = await worker.fetch(solicitud(ruta, jwt, 'HEAD'), f.env);
    assert.equal(head.status, EXITO);
    assert.equal(head.body, null);
  }
  for (const ruta of ALIAS) {
    assert.equal((await worker.fetch(solicitud(ruta), f.env)).status, AUSENTE, ruta);
  }
  const anterior = f.llamadas.length;
  for (const cambios of [
    { FARO_ADMINISTRACION: 'no' },
    { FARO_ADMINISTRACION: 'rota' },
    { FARO_ADMIN_ACCESS_AUD: '' },
    { FARO_ADMIN_ORIGEN: 'https://otro.example' },
  ]) {
    const salida = await worker.fetch(solicitud('/administracion'), { ...f.env, ...cambios });
    assert.notEqual(salida.status, EXITO);
  }
  assert.equal(f.llamadas.length, anterior);
});

test('API administrativa conserva CSP JSON y el contrato público sigue separado', async (t) => {
  t.mock.method(globalThis, 'fetch', pedirCertificados);
  t.mock.method(console, 'error', () => {});
  const f = entornoWorker();
  const respuesta = await worker.fetch(
    new Request(`${ORIGEN}/administracion/api/sesion/abrir`, {
      method: 'POST',
      body: '{}',
      headers: { 'cf-access-jwt-assertion': jwt, [CABECERA_CONTRATO]: String(CONTRATO_API) },
    }),
    f.env,
  );
  assert.equal(respuesta.headers.get('content-security-policy'), POLITICA_DE_LA_API);
  assert.equal(respuesta.status, NO_DISPONIBLE);
});

test('cuerpo privado tiene límite y cancelación efectiva durante lectura bloqueada', async () => {
  const responder = servidorWeb();
  const grande = await responder(
    solicitud(MODULO),
    async () =>
      new Response(new Uint8Array(MAX_RECURSO_ADMINISTRATIVO_BYTES + 1), {
        headers: { 'content-type': 'text/javascript' },
      }),
  );
  assert.equal(grande.status, NO_DISPONIBLE);
  const retirada = new AbortController();
  let cancelar = false;
  const resultado = responder(
    new Request(solicitud('/administracion'), { signal: retirada.signal }),
    async () =>
      new Response(
        new ReadableStream({
          start() {
            setTimeout(() => retirada.abort(), 0);
          },
          cancel() {
            cancelar = true;
          },
        }),
        { headers: { 'content-type': 'text/html' } },
      ),
  );
  assert.equal((await resultado).status, NO_DISPONIBLE);
  assert.equal(cancelar, true);
});

test('navegación HTML autenticada admite enlace externo; iframe y subrecursos externos siguen rechazados', async () => {
  const responder = servidorWeb();
  const navegar = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  for (const sitio of ['cross-site', 'same-site']) {
    const headers = { ...navegar, 'sec-fetch-site': sitio };
    assert.equal(
      (await responder(solicitud('/administracion', jwt, 'GET', headers), async (ruta) => recurso(ruta))).status,
      EXITO,
    );
    assert.equal(
      (
        await responder(solicitud('/administracion', '', 'GET', headers), async () =>
          assert.fail('Sin JWT no hay lector'),
        )
      ).status,
      PROHIBIDO,
    );
    assert.equal(
      (
        await responder(solicitud(MODULO, jwt, 'GET', headers), async () =>
          assert.fail('Navegación no autoriza script externo'),
        )
      ).status,
      PROHIBIDO,
    );
  }
  for (const headers of [
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
    { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' },
    { ...navegar, 'sec-fetch-site': 'cross-site', origin: 'https://otro.example' },
  ]) {
    assert.equal(
      (await responder(solicitud('/administracion', jwt, 'GET', headers), async () => assert.fail('No hay lector')))
        .status,
      PROHIBIDO,
    );
  }
});
