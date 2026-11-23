import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const FOTO = 'imagenes/fotografias/prueba.webp';
const REDUCIDA = 'imagenes/fotografias/prueba-800.webp';
const SCRIPT = 'scripts/prueba.js';
const OK = 200;
const ERROR_SERVIDOR = 500;
const NO_DISPONIBLE = 503;
const NO_AUTENTICADO = 401;
const PROHIBIDO = 403;
const AUSENTE = 404;
const RECURSO = { mode: 'cors', method: 'GET' };
/** Lo que entrega la red de esta versión: la foto reducida guardada es la suya (se comprueba con su huella al servirla). */
const fotoReducida = (ruta: string) => (ruta === REDUCIDA ? 'FOTO REDUCIDA' : ruta);
for (const base of BASES) {
  for (const estado of [ERROR_SERVIDOR, NO_DISPONIBLE]) {
    test(`foto pública: ${estado} usa la copia reducida de esta versión: ${base}`, async () => {
      const sw = servicio(base, { archivos: [REDUCIDA, SCRIPT], bajoDemanda: [FOTO], cuerpoDe: fotoReducida });
      sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(REDUCIDA), new Response('FOTO REDUCIDA')]]));
      sw.conectar();
      sw.red.respuesta = async () => new Response('FALLO DE ORIGEN', { status: estado });
      const respuesta = await pedir(sw, FOTO, RECURSO);
      assert.equal(respuesta.interceptada, true);
      assert.equal(respuesta.estado, OK);
      assert.equal(respuesta.cuerpo, 'FOTO REDUCIDA');
      assert.deepEqual(sw.peticiones, [sw.urlDe(FOTO)]);
    });
  }
  for (const estado of [NO_AUTENTICADO, PROHIBIDO, AUSENTE]) {
    test(`foto pública: HTTP ${estado} conserva el rechazo del origen: ${base}`, async () => {
      const sw = servicio(base, { archivos: [REDUCIDA], bajoDemanda: [FOTO] });
      sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(REDUCIDA), new Response('FOTO REDUCIDA')]]));
      sw.conectar();
      sw.red.respuesta = async () => new Response('RECHAZO', { status: estado });
      const respuesta = await pedir(sw, FOTO, RECURSO);
      assert.equal(respuesta.estado, estado);
      assert.equal(respuesta.cuerpo, 'RECHAZO');
    });
  }
  test(`rutas privadas no reciben respaldo de fotografía: ${base}`, async () => {
    const sw = servicio(base, { archivos: [REDUCIDA], bajoDemanda: [FOTO] });
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(REDUCIDA), new Response('FOTO REDUCIDA')]]));
    for (const ruta of ['api/informe', 'administracion/privado']) {
      const respuesta = await pedir(sw, ruta, RECURSO);
      assert.equal(respuesta.interceptada, false, ruta);
    }
  });
  test(`sin reducida o fuera del mapa no se convierte 503 en éxito: ${base}`, async () => {
    const sw = servicio(base, { archivos: [REDUCIDA, SCRIPT], bajoDemanda: [FOTO] });
    sw.conectar();
    sw.red.respuesta = async () => new Response('ORIGEN 503', { status: NO_DISPONIBLE });
    assert.equal((await pedir(sw, FOTO, RECURSO)).estado, NO_DISPONIBLE);
    sw.guardadas.set(sw.nombreCopia, new Map([[sw.urlDe(REDUCIDA), new Response('FOTO REDUCIDA')]]));
    const script = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(script.estado, NO_DISPONIBLE);
    assert.equal(script.cuerpo, 'ORIGEN 503');
  });
}

for (const base of BASES) {
  test(`lo que se va a guardar en la copia se pide sin la caché HTTP, que podría ser de otra versión: ${base}`, async () => {
    const sw = servicio(base, { archivos: [SCRIPT], bajoDemanda: [] });
    sw.conectar();
    const modos: (RequestCache | undefined)[] = [];
    sw.red.respuesta = async (_url, opciones) => {
      modos.push(opciones?.cache);
      return new Response('GUION', { headers: { 'content-type': 'text/javascript' } });
    };
    const respuesta = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(respuesta.cuerpo, 'GUION');
    assert.deepEqual(modos, ['reload']);
  });
}
