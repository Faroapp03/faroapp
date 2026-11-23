/**
 * Comprueba píxeles realmente pintados al tamaño móvil: el rasterizado del SVG varía entre motores. Las esperas en la
 * página tienen plazo y mensaje, y el navegador se cierra también si el caso vence (recursos-del-caso.mjs).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, webkit } from 'playwright-core';
import { PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { PLAZO_DE_ARRANQUE_MS } from './paquete-comun.mjs';
import { abrirNavegador, conPlazo, recursosDelCaso } from './recursos-del-caso.mjs';
import { analizarSenyera } from './senyera-pixeles.ts';

/** Lo que puede tardar una espera en la página (decodificar una imagen local), menor que el plazo del caso. */
const PLAZO_MS = 30_000;

/** Los píxeles de una captura PNG, leídos en la página con un canvas. */
function leerPixeles(pagina, captura) {
  return conPlazo(
    pagina.evaluate(async (base64) => {
      const imagen = new Image();
      imagen.src = `data:image/png;base64,${base64}`;
      await imagen.decode();
      const canvas = document.createElement('canvas');
      canvas.width = imagen.width;
      canvas.height = imagen.height;
      const contexto = canvas.getContext('2d');
      contexto.drawImage(imagen, 0, 0);
      const datos = contexto.getImageData(0, 0, imagen.width, imagen.height).data;
      return { ancho: imagen.width, alto: imagen.height, datos: Array.from(datos) };
    }, captura.toString('base64')),
    PLAZO_MS,
    'los píxeles de la captura no llegaron a leerse en la página',
  );
}

for (const [nombre, motor] of [
  ['Chromium', chromium],
  ['WebKit', webkit],
]) {
  test(`${nombre} pinta las cuatro franjas de la senyera a tamaño móvil`, async (t) => {
    const recursos = recursosDelCaso(t);
    const navegador = await abrirNavegador(recursos, `el navegador ${nombre}`, () =>
      conPlazo(
        motor.launch({ headless: true, timeout: PLAZO_DE_ARRANQUE_MS }),
        PLAZO_DE_ARRANQUE_MS,
        `el navegador ${nombre} no llegó a arrancar`,
      ),
    );
    const pagina = await conPlazo(
      navegador.newPage({
        locale: 'es-ES',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      }),
      PLAZO_MS,
      'no se pudo abrir una pestaña nueva',
    );
    await pagina.setContent(PORTADA_PUBLICA);
    const bandera = pagina.locator('#idioma-entrada img');
    await conPlazo(
      bandera.evaluate((imagen) => imagen.decode()),
      PLAZO_MS,
      'la imagen de la senyera no llegó a decodificarse',
    );
    const captura = await bandera.screenshot();
    const pixeles = await leerPixeles(pagina, captura);
    const analisis = analizarSenyera(pixeles);
    assert.ok(
      analisis.valida,
      `Deben verse cuatro franjas rojas separadas por amarillo: ${analisis.motivo} (${analisis.franjas})`,
    );
  });
}
