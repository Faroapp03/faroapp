import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, pedir, servicio } from './ayudas.ts';

const FOTO = 'imagenes/fotografias/prueba.webp';
const REDUCIDA = 'imagenes/fotografias/prueba-800.webp';
const SCRIPT = 'scripts/prueba.js';
const PAGINA = 'creditos.html';
const OK = 200;
const NO_DISPONIBLE = 503;
const RECURSO = { mode: 'cors', method: 'GET' };
const NAVEGACION = { mode: 'navigate', method: 'GET' };
/** La página de inicio de una instalación pública (modoDeLaInstalacion, la sonda de la navegación). */
const PUBLICA = { 'content-type': 'text/html', 'x-faro-portal': 'publico' };
/** Lo que entrega la red de esta versión: así cuadran con su huella la foto reducida guardada y la grande que llega. */
const cuerpoDe = (ruta: string) => {
  const cuerpos: Record<string, string> = {
    [REDUCIDA]: 'FOTO REDUCIDA',
    [FOTO]: 'FOTO GRANDE',
    [SCRIPT]: 'GUION',
    'sin-conexion.html': 'SIN CONEXION',
  };
  return cuerpos[ruta] ?? ruta;
};

/**
 * El service worker con la foto reducida y la página de sin conexión en la copia, la foto grande, el guion y una página
 * fuera de ella, en una instalación pública, y una red que contesta como la caché HTTP de Firefox en su modo sin conexión: entrega lo que tiene.
 */
function conLaCopiaSinLaFotoGrande(base: string, enLinea: boolean | undefined) {
  const sw = servicio(base, {
    archivos: ['inicio.html', 'sin-conexion.html', REDUCIDA, SCRIPT, PAGINA],
    bajoDemanda: [FOTO],
    cuerpoDe,
  });
  sw.guardadas.set(
    sw.nombreCopia,
    new Map([
      [sw.urlDe('inicio.html'), new Response('INICIO', { headers: PUBLICA })],
      [sw.urlDe(REDUCIDA), new Response('FOTO REDUCIDA')],
      [sw.urlDe('sin-conexion.html'), new Response('SIN CONEXION', { headers: { 'content-type': 'text/html' } })],
    ]),
  );
  if (enLinea !== undefined) {
    sw.evaluar(`self.navigator.onLine = ${enLinea};`);
  }
  sw.conectar();
  sw.red.respuesta = async (url) => {
    const ruta = url.slice(base.length);
    const portal = ruta === 'inicio.html' ? PUBLICA : {};
    return new Response(cuerpoDe(ruta), {
      headers: { 'content-type': ruta.endsWith('.html') ? 'text/html' : 'application/octet-stream', ...portal },
    });
  };
  return sw;
}

for (const base of BASES) {
  test(`sin conexión declarada, la foto grande que falta en la copia sale de la de 800 px, sin pedirla: ${base}`, async () => {
    const sw = conLaCopiaSinLaFotoGrande(base, false);
    const respuesta = await pedir(sw, FOTO, RECURSO);
    assert.equal(respuesta.interceptada, true);
    assert.equal(respuesta.estado, OK);
    assert.equal(respuesta.cuerpo, 'FOTO REDUCIDA');
    assert.deepEqual(sw.peticiones, []);
  });

  test(`sin conexión declarada, un guion que falta en la copia no se pide y responde como sin red: ${base}`, async () => {
    const sw = conLaCopiaSinLaFotoGrande(base, false);
    const respuesta = await pedir(sw, SCRIPT, RECURSO);
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.equal(respuesta.cuerpo, 'Recurso no disponible sin conexión.');
    assert.deepEqual(sw.peticiones, []);
  });

  test(`sin conexión declarada, una página de la copia que falta no se pide: sale la de sin conexión: ${base}`, async () => {
    const sw = conLaCopiaSinLaFotoGrande(base, false);
    const respuesta = await pedir(sw, PAGINA, NAVEGACION);
    assert.equal(respuesta.estado, OK);
    assert.equal(respuesta.cuerpo, 'SIN CONEXION');
    assert.equal(sw.peticiones.includes(sw.urlDe(PAGINA)), false);
  });

  test(`sin conexión declarada, una foto reducida alterada en la copia no se sustituye por la red: ${base}`, async () => {
    const sw = conLaCopiaSinLaFotoGrande(base, false);
    sw.guardadas.get(sw.nombreCopia)?.set(sw.urlDe(REDUCIDA), new Response('OTRA FOTO'));
    const respuesta = await pedir(sw, FOTO, RECURSO);
    assert.equal(respuesta.estado, NO_DISPONIBLE);
    assert.deepEqual(sw.peticiones, []);
  });

  for (const enLinea of [true, undefined]) {
    test(`con conexión (onLine ${enLinea}), la foto grande que falta se pide a la red y se entrega y se guarda: ${base}`, async () => {
      const sw = conLaCopiaSinLaFotoGrande(base, enLinea);
      const respuesta = await pedir(sw, FOTO, RECURSO);
      assert.equal(respuesta.estado, OK);
      assert.equal(respuesta.cuerpo, 'FOTO GRANDE');
      assert.deepEqual(sw.peticiones, [sw.urlDe(FOTO)]);
      assert.equal(await sw.guardadas.get(sw.nombreCopia)?.get(sw.urlDe(FOTO))?.clone().text(), 'FOTO GRANDE');
    });

    test(`con conexión (onLine ${enLinea}), el guion que falta se pide a la red y se entrega: ${base}`, async () => {
      const sw = conLaCopiaSinLaFotoGrande(base, enLinea);
      const respuesta = await pedir(sw, SCRIPT, RECURSO);
      assert.equal(respuesta.estado, OK);
      assert.equal(respuesta.cuerpo, 'GUION');
      assert.deepEqual(sw.peticiones, [sw.urlDe(SCRIPT)]);
    });
  }
}
