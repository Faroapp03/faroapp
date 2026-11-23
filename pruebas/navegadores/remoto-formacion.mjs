// Receta de formación común al ensayo conectado, con el catálogo servido por la candidata.
import assert from 'node:assert/strict';
import { consultaDelCatalogo, recorrerFormacion } from './formacion.ts';
import { prepararCopia } from './recorrido.ts';
import { cerrarSinSustituir, conPlazo } from './recursos-del-caso.mjs';

/** Lo que puede tardar la búsqueda de actualización del service worker antes de darla por atascada. */
const PLAZO_DE_LA_ACTUALIZACION_MS = 30_000;

const HTTP_OK = 200;
const CURSOS_ELEGIDOS = 2;

async function comprobarBusquedaDeActualizacion(pagina) {
  const actualizacion = await conPlazo(
    pagina.evaluate(async () => {
      const registro = await navigator.serviceWorker.ready;
      const controlador = navigator.serviceWorker.controller;
      sessionStorage.setItem('faro-ensayo-actualizacion', 'datos-sinteticos');
      await registro.update();
      return {
        controladorConservado: controlador !== null && controlador === navigator.serviceWorker.controller,
        datosConservados: sessionStorage.getItem('faro-ensayo-actualizacion') === 'datos-sinteticos',
        versionEnEspera: registro.waiting !== null,
      };
    }),
    PLAZO_DE_LA_ACTUALIZACION_MS,
    'el service worker no llegó a estar listo o no terminó de buscar su actualización (registration.update)',
  );
  assert.ok(
    actualizacion.controladorConservado && actualizacion.datosConservados,
    'La búsqueda de actualización no interrumpe la página',
  );
  return actualizacion;
}

function observarPagina(pagina, origen) {
  const fallos = [];
  const terceros = [];
  pagina.on('pageerror', (error) => fallos.push(error.name));
  pagina.on('console', (mensaje) => {
    if (mensaje.type() === 'error') {
      fallos.push('console.error');
    }
  });
  pagina.on('request', (peticion) => {
    if (new URL(peticion.url()).origin !== origen.origin) {
      terceros.push('origen externo');
    }
  });
  return { fallos, terceros };
}

export async function probarFormacionUnificada({ contexto, origen, idioma, salida, nombre }) {
  const pagina = await contexto.newPage();
  const { fallos, terceros } = observarPagina(pagina, origen);
  try {
    await pagina.addInitScript((elegido) => {
      localStorage.setItem('faro-idioma', elegido);
      localStorage.setItem('faro-modo-elegido', 'ia-off');
    }, idioma);
    assert.equal((await pagina.goto(new URL('/recorrido.html', origen).href))?.status(), HTTP_OK);
    await pagina.waitForFunction((elegido) => document.documentElement.lang === elegido, idioma);
    await prepararCopia(pagina);
    const actualizacion = await comprobarBusquedaDeActualizacion(pagina);
    const ruta = await pagina.evaluate(
      async () => (await import('/scripts/catalogo-cursos/referencia.js')).REFERENCIA.ruta,
    );
    assert.match(ruta, /^datos\/catalogo-cursos\/[a-f0-9]{64}\.json$/);
    const catalogo = await contexto.request.get(new URL(ruta, origen).href);
    assert.equal(catalogo.status(), HTTP_OK);
    const texto = await catalogo.text();
    const resultado = await recorrerFormacion({
      pagina,
      idioma,
      salida,
      nombre,
      seleccion: 'maxima',
      enElCatalogo: consultaDelCatalogo(JSON.parse(texto)),
    });
    assert.equal(resultado.cursos.length, CURSOS_ELEGIDOS, 'El plan contiene las dos elecciones');
    assert.deepEqual(fallos, [], 'Formación no produce errores del navegador');
    assert.deepEqual(terceros, [], 'Formación no envía peticiones a terceros');
    return {
      cursos: resultado.cursos.length,
      hojas: resultado.documento.hojas,
      impresion: resultado.impresion,
      actualizacion,
    };
  } finally {
    await cerrarSinSustituir(() => pagina.close(), 'la pestaña del ensayo de formación no se cerró');
  }
}
