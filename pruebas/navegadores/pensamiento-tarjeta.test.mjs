// El pensamiento que empieza dentro del mensaje de espera (empezarAPensar) no esconde la tarjeta que había, ni le
// quita el foco a su botón, mientras se espera: así se veía con los tres puntos. Cuando el pensamiento entra en la
// respuesta, la tarjeta sí espera escondida hasta que se recoge. Chromium real, con conversacion.js y las hojas de
// estilo del recorrido servidas desde web/. Las esperas en la página tienen plazo y mensaje, y el navegador se cierra
// también si el caso vence (recursos-del-caso.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PLAZO_DE_ARRANQUE_MS } from './paquete-comun.mjs';
import { abrirNavegador, conPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const WEB = new URL('../../web/', import.meta.url);
const ORIGEN = 'http://faro.prueba';
/** Lo que puede tardar una espera en la página (cargar conversacion.js local y dos fotogramas), menor que el caso. */
const PLAZO_MS = 30_000;
const TIPOS = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="stylesheet" href="/estilos/tokens.css"><link rel="stylesheet" href="/estilos/base.css">
<link rel="stylesheet" href="/estilos/recorrido/pagina.css"><link rel="stylesheet" href="/estilos/recorrido/conversacion.css">
</head><body class="rc-cuerpo" data-paso="2"><main>
<div class="rc-log" id="conversacion" role="log"></div><div class="rc-sugerencias" id="sugerencias" hidden></div>
<section class="rc-tarjeta" id="tarjeta-ocupacion"><button type="button" id="continuar">Continuar</button></section>
</main></body></html>`;

/** Sirve la página de la prueba en ORIGEN y, desde web/, sus hojas de estilo y sus módulos. */
async function servirLaWeb(pagina) {
  await pagina.route(`${ORIGEN}/**`, async (ruta) => {
    const camino = new URL(ruta.request().url()).pathname;
    if (camino === '/') {
      await ruta.fulfill({ contentType: 'text/html', body: PAGINA });
      return;
    }
    try {
      const cuerpo = await readFile(fileURLToPath(new URL(`.${camino}`, WEB)));
      await ruta.fulfill({ contentType: TIPOS[extname(camino)] ?? 'application/octet-stream', body: cuerpo });
    } catch {
      await ruta.fulfill({ status: 404, body: '' });
    }
  });
}

/**
 * En la página: empieza el pensamiento dentro del mensaje de espera, lo pasa a la respuesta y anota, en cada momento,
 * si la tarjeta se ve y quién tiene el foco.
 */
async function observarElPensamiento() {
  const c = await import('/scripts/recorrido/conversacion.js');
  const tarjeta = document.getElementById('tarjeta-ocupacion');
  const boton = document.getElementById('continuar');
  const fotograma = () => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)));
  const ahora = () => ({
    tarjeta: getComputedStyle(tarjeta).display,
    foco: document.activeElement?.id ?? null,
  });
  boton.focus();
  const antes = ahora();
  // Como presentarEleccion: enEspera pone la espera y, dentro de su trabajo, empieza el pensamiento.
  c.mostrarEspera('Preparando tus tareas');
  const empezado = c.empezarAPensar('Busco las tareas de tu ocupación');
  await fotograma();
  const enLaEspera = empezado.closest('.rc-mensaje')?.dataset.tipo ?? null;
  const cargando = ahora();
  // Llegan las tareas: enEspera quita la espera y Faro dice el pensamiento en su respuesta.
  c.quitarEspera();
  const bloque = c.crearPensamientoEnCurso(['Busco las tareas de tu ocupación', 'Las ordeno'], { empezado });
  c.decirFaro([bloque, 'Estas son tus tareas']);
  const recogiendo = ahora();
  return { antes, enLaEspera, cargando, recogiendo };
}

test('mientras se cargan las tareas con el pensamiento empezado, la tarjeta se ve y su botón conserva el foco', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await abrirNavegador(recursos, 'el navegador Chromium', () =>
    conPlazo(
      chromium.launch({ headless: true, timeout: PLAZO_DE_ARRANQUE_MS }),
      PLAZO_DE_ARRANQUE_MS,
      'el navegador Chromium no llegó a arrancar',
    ),
  );
  const pagina = await conPlazo(
    navegador.newPage({ reducedMotion: 'reduce' }),
    PLAZO_MS,
    'no se pudo abrir una pestaña nueva',
  );
  await servirLaWeb(pagina);
  await pagina.goto(`${ORIGEN}/`);
  const visto = await conPlazo(
    pagina.evaluate(observarElPensamiento),
    PLAZO_MS,
    'la página no llegó a mostrar el pensamiento y las tareas (conversacion.js)',
  );
  assert.equal(visto.enLaEspera, 'espera', 'el pensamiento empieza dentro del mensaje de espera');
  assert.notEqual(visto.antes.tarjeta, 'none');
  assert.equal(visto.antes.foco, 'continuar');
  assert.notEqual(visto.cargando.tarjeta, 'none', 'la tarjeta sigue a la vista mientras se cargan las tareas');
  assert.equal(visto.cargando.foco, 'continuar', 'el botón conserva el foco');
  assert.equal(visto.recogiendo.tarjeta, 'none', 'con el pensamiento en la respuesta, la tarjeta espera escondida');
});
