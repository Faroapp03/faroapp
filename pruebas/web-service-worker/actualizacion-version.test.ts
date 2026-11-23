// La actualización de una versión de la web a la siguiente: la nueva prepara su copia sin tocar la de la versión que
// sirve, y al activarse borra solo las copias viejas de la web. Se conservan la copia del paquete de datos, la de la
// disponibilidad de las secciones y lo de otras webs; el service worker no toca IndexedDB, las cookies de la sesión
// ni las preferencias, que viven en la página, y deja pasar a la red las rutas de la sesión.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { servicioPublicado } from '../ayudas/web-construida.ts';
import { BASES, pedir, servicio } from './ayudas.ts';

/** La VERSION de una publicación anterior y la de la nueva. */
const ANTERIOR = '9d462eb8bdbb21a0';
const NUEVA = '0123456789abcdef';
const MOTOR = 'motor/src/plataforma/navegador/motor.js';
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');
const CODIGO = servicioPublicado();

/** Un IndexedDB y un almacén de cookies de prueba que apuntan cualquier uso. */
const DOBLES = `
globalThis.usosDelAlmacen = [];
const apuntar = (almacen) =>
  new Proxy({}, { get: (_o, nombre) => () => usosDelAlmacen.push(almacen + String(nombre)) });
globalThis.indexedDB = apuntar('indexedDB.');
globalThis.cookieStore = apuntar('cookieStore.');
`;

function version(base: string, numero: string, copias?: ReturnType<typeof servicio>['copias']) {
  const sw = servicio(
    base,
    {
      version: numero,
      archivos: ['inicio.html', 'sin-conexion.html', `js/pagina-${numero}.js`],
      bajoDemanda: numero === NUEVA ? [MOTOR] : [],
      comprobados: [[MOTOR, sha256(`MOTOR ${numero}`)]],
      cuerpoDe: (ruta) => (ruta === MOTOR ? `MOTOR ${numero}` : ruta),
    },
    copias,
  );
  sw.evaluar(DOBLES);
  sw.red.respuesta = (url) => {
    const ruta = new URL(url).pathname.slice(new URL(base).pathname.length);
    return new Response(ruta === MOTOR ? `MOTOR ${numero}` : ruta, {
      headers: { 'content-type': ruta.endsWith('.html') ? 'text/html' : 'text/javascript' },
    });
  };
  sw.conectar();
  return sw;
}

test('el service worker no usa IndexedDB, cookies, almacenamiento de la página ni Clear-Site-Data', () => {
  assert.doesNotMatch(CODIGO, /indexedDB|cookieStore|document\.cookie|localStorage|sessionStorage|Clear-Site-Data/u);
});

for (const base of BASES) {
  test(`de la versión anterior a la nueva se conservan datos, secciones, sesión e IndexedDB: ${base}`, async () => {
    const anterior = version(base, ANTERIOR);
    await anterior.instalar();
    await anterior.activar();
    assert.ok(anterior.guardadas.get(anterior.nombreCopia)?.has(anterior.urlDe(MOTOR)));
    const conservadas = ['faro-paquete-b1a5ce9ca7a9077c', `faro-secciones-v3:${base}`, 'faro:https://otra.invalid/:x'];
    for (const nombre of conservadas) {
      anterior.guardadas.set(nombre, new Map([[`${nombre}/dato`, new Response(nombre)]]));
    }
    const nueva = version(base, NUEVA, anterior.copias);
    assert.notEqual(nueva.nombreCopia, anterior.nombreCopia);
    nueva.registro.waiting = {};
    await nueva.instalar();
    // Mientras la nueva espera, la anterior sigue entera.
    assert.ok(nueva.guardadas.get(anterior.nombreCopia)?.has(anterior.urlDe(MOTOR)));
    nueva.registro.waiting = null;
    await nueva.activar();
    assert.equal(nueva.guardadas.has(anterior.nombreCopia), false);
    assert.ok(nueva.guardadas.has(nueva.nombreCopia));
    for (const nombre of conservadas) {
      assert.equal(await nueva.guardadas.get(nombre)?.get(`${nombre}/dato`)?.clone().text(), nombre, nombre);
    }
    assert.equal(anterior.evaluar('usosDelAlmacen.join()'), '');
    assert.equal(nueva.evaluar('usosDelAlmacen.join()'), '');
    for (const ruta of ['api/sesion', 'acceso-web/salir', 'administracion/']) {
      assert.equal((await pedir(nueva, ruta, { mode: 'cors', method: 'GET' })).interceptada, false, ruta);
    }
    // El motor de la nueva versión se baja comprobado al pedirlo; nunca se sirve el de la anterior.
    const motor = await pedir(nueva, MOTOR, { mode: 'cors', method: 'GET' });
    assert.equal(motor.cuerpo, `MOTOR ${NUEVA}`);
  });
}
