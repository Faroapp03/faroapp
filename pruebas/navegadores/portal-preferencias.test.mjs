import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { paginaAcceso } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { BANDERA_CA, BANDERA_ES, PORTADA_PUBLICA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const ORIGEN = 'https://ejemplo.invalid';
const OK = 200;
const PROHIBIDO = 403;
/** Las dos páginas abren con el idioma y los controles accesibles de su cabecera. */
async function comprobarCabecera(pagina, idioma) {
  assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
  assert.equal(await pagina.locator('html').evaluate((nodo) => getComputedStyle(nodo).colorScheme), 'dark');
  assert.equal(await pagina.locator('#tema-entrada').count(), 0);
  const selector = pagina.locator('#idioma-entrada');
  assert.equal(await selector.locator('img').getAttribute('src'), idioma === 'ca' ? BANDERA_CA : BANDERA_ES);
  assert.equal((await selector.textContent())?.trim(), '');
  assert.ok(await selector.getAttribute('aria-label'));
}

test('ambas pantallas abren en catalán y oscuro con el castellano y el tema claro guardados para la aplicación', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  const pagina = await navegador.newPage({ locale: 'es-ES', colorScheme: 'light', reducedMotion: 'reduce' });
  try {
    await servirPortal(pagina);
    await pagina.goto(`${ORIGEN}/`);
    await pagina.evaluate(() => {
      localStorage.setItem('faro-tema', 'claro');
      localStorage.setItem('faro-idioma', 'es');
    });
    for (const ruta of ['/acceso-web', '/']) {
      await pagina.goto(ORIGEN + ruta);
      await comprobarCabecera(pagina, 'ca');
      assert.deepEqual(
        await pagina.evaluate(() => [localStorage.getItem('faro-tema'), localStorage.getItem('faro-idioma')]),
        ['claro', 'es'],
      );
    }
    assert.equal(await pagina.locator('.acceso a').getAttribute('href'), '/acceso-web');
    await pagina.locator('#idioma-entrada').click();
    await comprobarCabecera(pagina, 'es');
    await pagina.locator('.acceso a').click();
    await comprobarCabecera(pagina, 'es');
    assert.equal(pagina.url(), `${ORIGEN}/acceso-web`);
    await pagina.locator('#campo-usuario').fill('Faro');
    await pagina.locator('#continuar').click();
    await pagina.locator('#campo-clave').fill('incorrecta');
    await pagina.locator('#entrar').click();
    await pagina.locator('#error-acceso').waitFor({ state: 'visible' });
    assert.equal(await pagina.locator('#error-acceso').textContent(), TEXTOS_ACCESO.es['error-credenciales']);
    await pagina.locator('#idioma-entrada').click();
    assert.equal(await pagina.locator('#error-acceso').textContent(), TEXTOS_ACCESO.ca['error-credenciales']);
    await pagina.locator('#entrar').hover();
    assert.equal(
      await pagina.locator('#entrar').evaluate((nodo) => getComputedStyle(nodo).backgroundColor),
      'rgb(236, 232, 224)',
    );
    assert.equal(await pagina.evaluate(() => localStorage.getItem('faro-tema')), 'claro');
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('una elección de idioma viaja entre portada y acceso aunque el navegador bloquee el almacenamiento', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const pagina = await navegador.newPage({ locale: 'es-ES', colorScheme: 'light' });
    await pagina.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Bloqueado', 'SecurityError');
        },
      }),
    );
    await servirPortal(pagina);
    await pagina.goto(`${ORIGEN}/acceso-web?idioma=es#pie`);
    await comprobarCabecera(pagina, 'es');
    assert.equal(pagina.url(), `${ORIGEN}/acceso-web#pie`);
    await pagina.locator('#volver-portada').click();
    await comprobarCabecera(pagina, 'es');
    assert.equal(pagina.url(), `${ORIGEN}/`);
    await pagina.locator('#idioma-entrada').click();
    assert.equal(await pagina.locator('.acceso a').getAttribute('href'), '/acceso-web?idioma=ca');
    await pagina.locator('.acceso a').click();
    await comprobarCabecera(pagina, 'ca');
    await pagina.locator('#idioma-entrada').click();
    await pagina.locator('#volver-portada').click();
    await comprobarCabecera(pagina, 'es');
    await pagina.reload();
    await comprobarCabecera(pagina, 'ca');
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

/** Sirve las dos páginas y reproduce un rechazo de credenciales en el envío, sin red. */
async function servirPortal(pagina) {
  await pagina.route(`${ORIGEN}/**`, async (ruta) => {
    const request = ruta.request();
    const camino = new URL(request.url()).pathname;
    if (camino === '/acceso-web/entrar') {
      return ruta.fulfill({ status: PROHIBIDO, body: '' });
    }
    if (camino === '/') {
      return ruta.fulfill({ status: OK, contentType: 'text/html', body: PORTADA_PUBLICA });
    }
    const respuesta = paginaAcceso(
      new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
    );
    return ruta.fulfill({
      status: respuesta.status,
      headers: Object.fromEntries(respuesta.headers),
      body: await respuesta.text(),
    });
  });
}

test('la primera visita a ambas pantallas abre en catalán sin guardar un idioma', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    for (const locale of ['es-ES', 'en-US', 'ca-ES']) {
      const pagina = await navegador.newPage({ locale });
      await servirPortal(pagina);
      await pagina.goto(`${ORIGEN}/`);
      assert.equal(await pagina.locator('html').getAttribute('lang'), 'ca', locale);
      await pagina.locator('.acceso a').click();
      assert.equal(await pagina.locator('html').getAttribute('lang'), 'ca', locale);
      assert.equal(await pagina.evaluate(() => localStorage.getItem('faro-idioma')), null, locale);
      await pagina.close();
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

test('los enlaces de idioma aplican ambos idiomas, se limpian y dejan la elección disponible en el acceso', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const pagina = await navegador.newPage({ locale: 'es-ES' });
    await servirPortal(pagina);
    for (const idioma of ['ca', 'es']) {
      await pagina.goto(`${ORIGEN}/?idioma=${idioma}&otro=1#pie`);
      assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
      assert.equal(pagina.url(), `${ORIGEN}/?otro=1#pie`);
      assert.equal(await pagina.evaluate(() => localStorage.getItem('faro-idioma')), idioma);
      assert.equal(await pagina.locator('.acceso a').getAttribute('href'), `/acceso-web?idioma=${idioma}`);
      await pagina.locator('.acceso a').click();
      assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
      assert.equal(pagina.url(), `${ORIGEN}/acceso-web`);
      await pagina.reload();
      await comprobarCabecera(pagina, 'ca');
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});
