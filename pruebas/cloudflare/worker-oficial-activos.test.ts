import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { VALOR_HSTS } from '../../src/plataforma/cabeceras-web.ts';
import {
  ACTIVOS_PUBLICOS,
  activoDeRuta,
  FOTOGRAFIA_PORTADA,
  rutaDeActivo,
} from '../../src/plataforma/cloudflare/activos-publicos.ts';
import worker from '../../src/plataforma/cloudflare/worker-oficial.ts';

const OK = 200;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const NO_DISPONIBLE = 503;
const ORIGEN = 'https://ejemplo.invalid';
const INMUTABLE = 'public, max-age=31536000, immutable';
const WEB = new URL('../../web/', import.meta.url);

/** El enlace ASSETS de Cloudflare sobre la carpeta web/ del repositorio, o con los bytes que se le den. */
function assets(sustituto?: (ruta: string) => Response): { fetch(peticion: Request): Promise<Response> } {
  return {
    fetch: async (peticion) => {
      const ruta = new URL(peticion.url).pathname;
      if (sustituto) {
        return sustituto(ruta);
      }
      try {
        return new Response(readFileSync(new URL(ruta.slice(1), WEB)));
      } catch {
        return new Response(null, { status: NO_ENCONTRADO });
      }
    },
  };
}

/** Claves sintéticas del portal, para que lo que no es público reciba su rechazo y no un servicio no disponible. */
const CLAVES = {
  FARO_CLAVE_GENERAL: 'clave-general-sintetica',
  FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
  FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
};
/** Los activos se sirven antes de mirar sesiones o la autoridad durable, que este entorno no tiene. */
const entorno = (almacen = assets()) => ({ ...CLAVES, ASSETS: almacen });
const pedir = (ruta: string, init?: RequestInit, env: Record<string, unknown> = entorno()) =>
  worker.fetch(new Request(`${ORIGEN}${ruta}`, init), env as never);

test('cada activo público responde sin sesión, con su tipo, inmutable, sin cookies y con los bytes de la web', async () => {
  assert.ok(ACTIVOS_PUBLICOS.length > 0);
  for (const activo of ACTIVOS_PUBLICOS) {
    const ruta = rutaDeActivo(activo);
    assert.match(ruta, /^\/publico\/[a-z0-9-]+-[0-9a-f]{16}\.[a-z0-9]+$/);
    for (const cabeceras of [{}, { cookie: '__Host-faro-portal=cualquiera' }]) {
      const respuesta = await pedir(ruta, { headers: { 'sec-fetch-dest': 'image', ...cabeceras } });
      assert.equal(respuesta.status, OK, ruta);
      assert.equal(respuesta.headers.get('content-type'), activo.tipo);
      assert.equal(respuesta.headers.get('cache-control'), INMUTABLE);
      assert.equal(respuesta.headers.has('set-cookie'), false);
      assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(respuesta.headers.get('cross-origin-resource-policy'), 'same-origin');
      assert.ok(respuesta.headers.get('strict-transport-security'));
      assert.deepEqual(Buffer.from(await respuesta.arrayBuffer()), readFileSync(new URL(activo.archivo, WEB)));
    }
    const cabeza = await pedir(ruta, { method: 'HEAD' });
    assert.equal(cabeza.status, OK);
    assert.equal(cabeza.headers.get('cache-control'), INMUTABLE);
    assert.equal(await cabeza.text(), '');
  }
});

test('solo las rutas exactas de la lista son públicas: otra huella, otro método u otra carpeta no lo son', async () => {
  const ruta = rutaDeActivo(FOTOGRAFIA_PORTADA);
  const otraHuella = ruta.replace(/-[0-9a-f]{16}\./, '-0000000000000000.');
  assert.equal(activoDeRuta(otraHuella), undefined);
  for (const otra of [otraHuella, `/${FOTOGRAFIA_PORTADA.archivo}`, '/publico/', `${ruta}/`]) {
    const respuesta = await pedir(otra, { headers: { 'sec-fetch-dest': 'image' } });
    assert.equal(respuesta.status, PROHIBIDO, otra);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', otra);
  }
  assert.equal((await pedir(ruta, { method: 'POST' })).status, PROHIBIDO);
});

test('un archivo ausente, sin el enlace o con otros bytes que su huella no se sirve como inmutable', async () => {
  const ruta = rutaDeActivo(FOTOGRAFIA_PORTADA);
  const casos: Record<string, Record<string, unknown>> = {
    'sin ASSETS': CLAVES,
    ausente: entorno(assets(() => new Response(null, { status: NO_ENCONTRADO }))),
    'otros bytes': entorno(assets(() => new Response(new TextEncoder().encode('otros bytes')))),
    'una página en su lugar': entorno(assets(() => new Response('<!doctype html>', { status: OK }))),
  };
  for (const [caso, env] of Object.entries(casos)) {
    const respuesta = await pedir(ruta, undefined, env);
    assert.equal(respuesta.status, NO_DISPONIBLE, caso);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', caso);
    assert.equal(await respuesta.text(), '', caso);
  }
});

test('un fallo al leer o comprobar el archivo da el 503 con las cabeceras de la puerta, no un error sin ellas', async (t) => {
  const ruta = rutaDeActivo(FOTOGRAFIA_PORTADA);
  const cortado = () =>
    new Response(
      new ReadableStream({
        pull: (control) => control.error(new Error('Lectura cortada')),
      }),
    );
  const casos: Record<string, () => Record<string, unknown>> = {
    'el almacén falla': () =>
      entorno({
        fetch: async () => {
          throw new Error('Almacén caído');
        },
      }),
    'la lectura se corta': () => entorno(assets(cortado)),
    'la huella falla': () => {
      t.mock.method(crypto.subtle, 'digest', async () => {
        throw new Error('Huella no disponible');
      });
      return entorno();
    },
  };
  const registro = t.mock.method(console, 'error', () => undefined);
  for (const [caso, env] of Object.entries(casos)) {
    registro.mock.resetCalls();
    const respuesta = await pedir(ruta, undefined, env()).catch((error: unknown) =>
      assert.fail(`${caso}: la excepción sale del Worker sin cabeceras (${String(error)})`),
    );
    // Una línea con la ruta pública del activo, sin el mensaje del fallo ni nada de la petición.
    assert.deepEqual(
      registro.mock.calls.map((llamada) => llamada.arguments),
      [['Faro: el activo público no está disponible.', { activo: ruta }]],
      caso,
    );
    assert.equal(respuesta.status, NO_DISPONIBLE, caso);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', caso);
    assert.equal(respuesta.headers.get('strict-transport-security'), VALOR_HSTS, caso);
    assert.equal(respuesta.headers.get('cross-origin-opener-policy'), 'same-origin', caso);
    assert.equal(respuesta.headers.get('x-frame-options'), 'DENY', caso);
    assert.equal(await respuesta.text(), '', caso);
  }
});

test('la portada y el acceso siguen sin guardarse y su CSP solo admite imágenes propias o en línea', async () => {
  const portada = await pedir('/');
  const acceso = await pedir('/acceso-web', { headers: { accept: 'text/html' } });
  for (const [nombre, respuesta] of [
    ['portada', portada],
    ['acceso', acceso],
  ] as const) {
    assert.equal(respuesta.status, OK, nombre);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store', nombre);
    const csp = respuesta.headers.get('content-security-policy') ?? '';
    assert.match(csp, /^default-src 'none';/, nombre);
    assert.match(csp, /; img-src data: 'self';/, nombre);
    assert.match(csp, /; font-src data:;/, nombre);
    assert.doesNotMatch(csp, /https?:|\*|blob:/, nombre);
    assert.ok((await respuesta.text()).includes(`src="${rutaDeActivo(FOTOGRAFIA_PORTADA)}"`), nombre);
  }
});
