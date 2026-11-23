import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type DocumentoSecciones,
  politicaSeccionesInicial,
  SECCIONES_WEB,
  seccionDeLaRuta,
} from '../../src/administracion/secciones-web.js';
import { comprobarSeccionWeb, PLAZO_SECCIONES_MS, respuestaDeSecciones } from '../../src/plataforma/secciones-web.ts';

const CORRECTO = 200;
const AUSENTE = 404;
const METODO = 405;
const NO_DISPONIBLE = 503;
/** La versión del contrato de secciones con la Encuesta: la que sale de leer cualquier documento anterior. */
const VERSION_SECCIONES = 3;
const documento = (): DocumentoSecciones => ({ version: 3, revision: 0, secciones: politicaSeccionesInicial() });
const peticion = (method = 'GET') => ({ method, signal: new AbortController().signal });

test('proyección sin panel declara explícitamente todo activo; HEAD y métodos no leen autoridad', async () => {
  const respuesta = await respuestaDeSecciones(peticion());
  assert.equal(respuesta.status, CORRECTO);
  assert.equal(respuesta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await respuesta.json(), documento());
  assert.equal(await (await respuestaDeSecciones(peticion('HEAD'))).text(), '');
  const invalida = await respuestaDeSecciones(peticion('POST'), async () => assert.fail('No debe leer'));
  assert.equal(invalida.status, METODO);
  assert.equal(invalida.headers.get('allow'), 'GET, HEAD');
  assert.equal(invalida.headers.get('cache-control'), 'no-store');
});

test('cada petición lee la política actual y solo una página de sección depende de ella', async () => {
  let actual = documento();
  let lecturas = 0;
  const leer = async () => {
    lecturas++;
    return actual;
  };
  const senal = peticion().signal;
  assert.equal(await comprobarSeccionWeb('/recorrido.html', senal, leer), undefined);
  actual = { ...actual, revision: 1, secciones: { ...actual.secciones, recorrido: false } };
  for (const ruta of ['/recorrido.html', '/informe-ejemplo.html', '/%72ecorrido.html', '/x/%2f../recorrido.html']) {
    const respuesta = await comprobarSeccionWeb(ruta, senal, leer);
    assert.equal(respuesta?.status, AUSENTE, ruta);
    assert.equal(respuesta?.headers.get('cache-control'), 'no-store');
    assert.equal(await respuesta?.text(), '');
  }
  const anteriores = lecturas;
  for (const ruta of ['/inicio.html', '/api/salud', '/motor/x.js', '/scripts/recorrido.js', '/creditos.html']) {
    assert.equal(await comprobarSeccionWeb(ruta, senal, leer), undefined, ruta);
  }
  assert.equal(lecturas, anteriores);
  actual = { ...documento(), revision: 2 };
  assert.equal(await comprobarSeccionWeb('/recorrido.html', senal, leer), undefined);
  assert.deepEqual(await (await respuestaDeSecciones(peticion(), leer)).json(), actual);
});

test('la fusión de «Cómo funciona» con Faro conserva las ocho claves guardadas y deja la antigua sin páginas', async () => {
  // Las políticas guardadas antes de la fusión (SQLite, Durable, copia del navegador) llevan estas ocho claves en este
  // orden, que forma también la clave de la copia del navegador: deben seguir siendo válidas sin migrarlas.
  assert.deepEqual(
    SECCIONES_WEB.filter(({ id }) => id !== 'cursos' && id !== 'encuesta').map(({ id }) => id),
    ['entender-ia', 'que-es-faro', 'como-funciona', 'recorrido', 'guias', 'biblioteca', 'datos-globales', 'doctor'],
  );
  const guardada = JSON.parse(
    '{"version":1,"revision":7,"secciones":{"entender-ia":true,"que-es-faro":true,"como-funciona":false,' +
      '"recorrido":true,"guias":true,"biblioteca":true,"datos-globales":true,"doctor":true}}',
  );
  let lecturas = 0;
  const leer = async () => {
    lecturas++;
    return guardada;
  };
  const respuesta = await respuestaDeSecciones(peticion(), leer);
  assert.equal(respuesta.status, CORRECTO);
  assert.deepEqual(await respuesta.json(), {
    ...guardada,
    version: VERSION_SECCIONES,
    secciones: { ...guardada.secciones, cursos: false, encuesta: true },
  });
  assert.equal(guardada.version, 1);
  assert.ok(!Object.hasOwn(guardada.secciones, 'cursos'));
  assert.equal(seccionDeLaRuta('/como-funciona.html'), undefined);
  assert.equal(seccionDeLaRuta('/que-es-faro.html'), 'que-es-faro');
  const antes = lecturas;
  assert.equal(await comprobarSeccionWeb('/como-funciona.html', peticion().signal, leer), undefined);
  assert.equal(lecturas, antes, 'la página de traslado no consulta la política');
  assert.equal(await comprobarSeccionWeb('/que-es-faro.html', peticion().signal, leer), undefined);
  const sinFaro = async () => ({ ...guardada, secciones: { ...guardada.secciones, 'que-es-faro': false } });
  assert.equal((await comprobarSeccionWeb('/que-es-faro.html', peticion().signal, sinFaro))?.status, AUSENTE);
});

test('la fusión de «Guías» con la Biblioteca conserva la clave guardada y deja la antigua sin páginas', async () => {
  // Una política guardada con «Guías» cerrada sigue siendo válida; la Biblioteca, que ahora la contiene, la gobierna.
  const guardada = JSON.parse(
    '{"version":1,"revision":8,"secciones":{"entender-ia":true,"que-es-faro":true,"como-funciona":true,' +
      '"recorrido":true,"guias":false,"biblioteca":true,"datos-globales":true,"doctor":true}}',
  );
  let lecturas = 0;
  const leer = async () => {
    lecturas++;
    return guardada;
  };
  const respuesta = await respuestaDeSecciones(peticion(), leer);
  assert.equal(respuesta.status, CORRECTO);
  assert.deepEqual(await respuesta.json(), {
    ...guardada,
    version: VERSION_SECCIONES,
    secciones: { ...guardada.secciones, cursos: false, encuesta: true },
  });
  assert.equal(guardada.version, 1);
  assert.ok(!Object.hasOwn(guardada.secciones, 'cursos'));
  assert.deepEqual(SECCIONES_WEB.find(({ id }) => id === 'guias')?.rutas, []);
  assert.equal(seccionDeLaRuta('/guias.html'), undefined);
  assert.equal(seccionDeLaRuta('/biblioteca.html'), 'biblioteca');
  const antes = lecturas;
  assert.equal(await comprobarSeccionWeb('/guias.html', peticion().signal, leer), undefined);
  assert.equal(lecturas, antes, 'la página de traslado no consulta la política');
  assert.equal(await comprobarSeccionWeb('/biblioteca.html', peticion().signal, leer), undefined);
  const sinBiblioteca = async () => ({ ...guardada, secciones: { ...guardada.secciones, biblioteca: false } });
  assert.equal((await comprobarSeccionWeb('/biblioteca.html', peticion().signal, sinBiblioteca))?.status, AUSENTE);
});

test('autoridad ilegible o defectuosa nunca reabre ni completa una política', async () => {
  for (const leer of [
    async () => {
      throw new Error('Fallo sintético');
    },
    async () => ({ ...documento(), revision: -1 }),
    async () => ({ ...documento(), extra: 'privado' }),
    async () => JSON.parse('{"version":1,"revision":0,"secciones":{}}'),
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const respuesta = await respuestaDeSecciones(peticion(method), leer);
      assert.equal(respuesta.status, NO_DISPONIBLE);
      assert.equal(respuesta.headers.get('cache-control'), 'no-store');
      assert.equal(await respuesta.text(), '');
    }
    assert.equal((await comprobarSeccionWeb('/biblioteca.html', peticion().signal, leer))?.status, NO_DISPONIBLE);
  }
});

test('el plazo y la retirada abortan la lectura sin entregar resultados tardíos', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cancelar of [false, true]) {
    const iniciada = Promise.withResolvers<AbortSignal>();
    const trabajo = Promise.withResolvers<DocumentoSecciones>();
    const retirada = new AbortController();
    const pendiente = comprobarSeccionWeb('/biblioteca.html', retirada.signal, (senal) => {
      iniciada.resolve(senal);
      return trabajo.promise;
    });
    const senal = await iniciada.promise;
    if (cancelar) {
      retirada.abort();
    } else {
      t.mock.timers.tick(PLAZO_SECCIONES_MS);
    }
    const respuesta = await pendiente;
    assert.equal(respuesta?.status, NO_DISPONIBLE);
    assert.equal(senal.aborted, true);
    trabajo.resolve(documento());
    await Promise.resolve();
  }
});
