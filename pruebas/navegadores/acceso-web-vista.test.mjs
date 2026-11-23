import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright-core';
import { responderAccesoRecorrido } from '../../src/plataforma/cloudflare/acceso-recorrido.ts';
import { paginaAcceso } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { TEXTOS_ACCESO } from '../../src/plataforma/cloudflare/textos-acceso.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const ORIGEN = 'https://ejemplo.invalid';
const OK = 200;
const PROHIBIDO = 403;
const DEMASIADOS = 429;
const NO_DISPONIBLE = 503;
const RED_CORTADA = 'red cortada';
const ESPERA_NAVEGACION_MS = 100;
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Ensaya una única interacción de navegador completa.
test('el acceso abre en catalán y oscuro, permite cambiar el idioma y conserva el fragmento al entrar', async (t) => {
  const recursos = recursosDelCaso(t);
  const browser = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  const page = await browser.newPage({ locale: 'es-ES', colorScheme: 'light', reducedMotion: 'reduce' });
  let intentos = 0;
  try {
    await page.route(`${ORIGEN}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/acceso-web/entrar') {
        intentos++;
        const datos = new URLSearchParams(request.postData() ?? '');
        assert.equal(datos.get('usuario'), 'Faro');
        assert.equal(datos.get('clave'), intentos === 1 ? 'mala' : 'correcta');
        return route.fulfill({
          status: intentos === 1 ? PROHIBIDO : OK,
          contentType: 'application/json',
          body: '{"ok":true}',
        });
      }
      if (intentos >= 2) {
        return route.fulfill({ status: OK, body: 'contenido protegido' });
      }
      const respuesta = paginaAcceso(
        new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
      );
      return route.fulfill({
        status: respuesta.status,
        headers: Object.fromEntries(respuesta.headers),
        body: await respuesta.text(),
      });
    });
    // El idioma de la ruta protegida y su fragmento llegan al destino después de identificarse.
    await page.goto(`${ORIGEN}/acceso-web?volver=%2Frecorrido.html%3Fidioma%3Des#pasar=marcador`);
    assert.equal(await page.title(), TEXTOS_ACCESO.ca.pestana);
    assert.equal(await page.locator('h1').textContent(), TEXTOS_ACCESO.ca.titulo);
    assert.equal(await page.locator('#descripcion').textContent(), TEXTOS_ACCESO.ca.descripcion);
    await page.locator('#idioma-entrada').click();
    assert.equal(await page.title(), TEXTOS_ACCESO.es.pestana);
    assert.equal(await page.locator('h1').textContent(), TEXTOS_ACCESO.es.titulo);
    assert.equal(await page.locator('#tema-entrada').count(), 0);
    assert.equal(await page.locator('html').evaluate((nodo) => getComputedStyle(nodo).colorScheme), 'dark');
    assert.equal(await page.locator('#campo-clave').isVisible(), false);
    await page.locator('#campo-usuario').fill('Faro');
    await page.locator('#campo-usuario').press('Enter');
    assert.equal(intentos, 0);
    assert.equal(await page.locator('#campo-clave').isVisible(), true);
    assert.equal(await page.locator('#campo-clave').evaluate((campo) => campo === document.activeElement), true);
    await page.locator('#volver-usuario').click();
    assert.equal(await page.locator('#campo-usuario').evaluate((campo) => campo === document.activeElement), true);
    assert.equal(await page.locator('#campo-clave').isVisible(), false);
    await page.locator('#campo-usuario').press('Enter');
    await page.locator('#campo-clave').fill('mala');
    await page.locator('#campo-clave').press('Enter');
    await page.locator('#error-acceso').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#error-acceso').textContent(), TEXTOS_ACCESO.es['error-credenciales']);
    assert.equal(await page.locator('#entrar').isDisabled(), false);
    assert.equal(new URL(page.url()).hash, '#pasar=marcador');
    await page.locator('#campo-clave').fill('correcta');
    await Promise.all([
      page.waitForURL(`${ORIGEN}/recorrido.html?idioma=es#pasar=marcador`),
      page.locator('#entrar').click(),
    ]);
    await page.getByText('contenido protegido').waitFor();
    assert.equal(new URL(page.url()).hash, '#pasar=marcador');
    assert.equal(await page.evaluate(() => localStorage.getItem('faro-idioma')), 'es');
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(browser), 'el navegador no se cerró');
  }
});

/** Responde a cada envío con la causa siguiente de la lista: un estado HTTP o la red cortada. */
async function servirConCausas(page, causas) {
  let envio = 0;
  await page.route(`${ORIGEN}/**`, async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/acceso-web/entrar') {
      const causa = causas[envio++];
      return causa === RED_CORTADA ? route.abort('internetdisconnected') : route.fulfill({ status: causa, body: '' });
    }
    const respuesta = paginaAcceso(
      new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
    );
    return route.fulfill({
      status: respuesta.status,
      headers: Object.fromEntries(respuesta.headers),
      body: await respuesta.text(),
    });
  });
}

test('cada rechazo (403, 429, 503 y red cortada) dice su causa en los dos idiomas y reactiva el botón', async (t) => {
  const recursos = recursosDelCaso(t);
  const browser = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  const page = await browser.newPage({ locale: 'ca-ES', reducedMotion: 'reduce' });
  const casos = [
    [PROHIBIDO, 'error-credenciales'],
    [DEMASIADOS, 'error-intentos'],
    [NO_DISPONIBLE, 'error-servicio'],
    [RED_CORTADA, 'error-servicio'],
  ];
  try {
    await servirConCausas(
      page,
      casos.map(([causa]) => causa),
    );
    await page.goto(`${ORIGEN}/acceso-web`);
    await page.locator('#campo-usuario').fill('Faro');
    await page.locator('#campo-usuario').press('Enter');
    for (const [causa, clave] of casos) {
      await page.locator('#campo-clave').fill('clave-sintetica');
      await page.locator('#campo-clave').press('Enter');
      await page.waitForFunction(
        () => !document.getElementById('error-acceso').hidden && !document.getElementById('entrar').disabled,
      );
      assert.equal(await page.locator('#error-acceso').textContent(), TEXTOS_ACCESO.ca[clave], String(causa));
      assert.equal(await page.locator('#volver-usuario').isDisabled(), false, String(causa));
      await page.locator('#idioma-entrada').click();
      assert.equal(await page.locator('#error-acceso').textContent(), TEXTOS_ACCESO.es[clave], String(causa));
      await page.locator('#idioma-entrada').click();
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(browser), 'el navegador no se cerró');
  }
});

test('al entrar sin haber elegido idioma no se guarda ninguno: la aplicación aplica la misma regla que el portal', async (t) => {
  const recursos = recursosDelCaso(t);
  const browser = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  const page = await browser.newPage({ locale: 'ca-ES' });
  try {
    await page.route(`${ORIGEN}/**`, async (route) => {
      const request = route.request();
      const ruta = new URL(request.url()).pathname;
      if (ruta === '/acceso-web/entrar') {
        return route.fulfill({ status: OK, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (ruta === '/inicio.html') {
        return route.fulfill({ status: OK, body: 'aplicacion' });
      }
      const respuesta = paginaAcceso(
        new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
      );
      return route.fulfill({
        status: respuesta.status,
        headers: Object.fromEntries(respuesta.headers),
        body: await respuesta.text(),
      });
    });
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.equal(await page.locator('html').getAttribute('lang'), 'ca');
    await page.locator('#campo-usuario').fill('Faro');
    await page.locator('#campo-usuario').press('Enter');
    await page.locator('#campo-clave').fill('clave-sintetica');
    await Promise.all([page.waitForURL('**/inicio.html'), page.locator('#entrar').click()]);
    assert.equal(await page.evaluate(() => localStorage.getItem('faro-idioma')), null);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(browser), 'el navegador no se cerró');
  }
});

test('sin JavaScript, la primera etapa no envía datos ni incorpora contraseñas a la URL', async (t) => {
  const recursos = recursosDelCaso(t);
  const browser = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const urls = [];
  const documentos = [];
  try {
    await page.route(`${ORIGEN}/**`, async (route) => {
      urls.push(route.request().url());
      const request = route.request();
      // Solo un documento puede llevar datos del formulario; la fotografía compartida es otra petición, sin ellos.
      if (request.resourceType() === 'document') {
        documentos.push(request.url());
      }
      const respuesta = paginaAcceso(
        new Request(request.url(), { method: request.method(), headers: await request.allHeaders() }),
      );
      return route.fulfill({
        status: respuesta.status,
        headers: Object.fromEntries(respuesta.headers),
        body: await respuesta.text(),
      });
    });
    await page.goto(`${ORIGEN}/acceso-web`);
    assert.equal(await page.locator('#continuar').isDisabled(), true);
    assert.equal(await page.locator('#formulario-acceso').getAttribute('method'), 'post');
    assert.equal(await page.locator('#formulario-acceso').getAttribute('action'), '/acceso-web/entrar');
    await page.locator('#campo-usuario').fill('Faro');
    await page.locator('#campo-clave').evaluate((campo) => {
      campo.value = 'clave-sintetica';
    });
    await page.locator('#campo-usuario').press('Enter');
    await page.waitForTimeout(ESPERA_NAVEGACION_MS);
    assert.deepEqual(documentos, [`${ORIGEN}/acceso-web`]);
    assert.equal(page.url(), `${ORIGEN}/acceso-web`);
    assert.ok(urls.every((url) => !url.includes('clave-sintetica')));
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(browser), 'el navegador no se cerró');
  }
});

/**
 * La primera extensión del registro hace de variante inactiva del recorrido, que pide su contraseña. Sin extensiones
 * instaladas no hay otra variante que proteger y sus casos no se declaran: la batería de navegador no admite omisiones.
 */
const [EXTENSION] = EXTENSIONES;
const PLAZO_AVISO_MS = 5000;

/**
 * El acceso al recorrido de la variante inactiva; la autoridad de intentos dice que no (429) o no responde (503). La
 * interceptación de WebKit en Playwright no deja ver Accept-Language, que WebKit sí envía por la red con el idioma del
 * contexto: si falta, se completa con ese idioma.
 */
async function servirRecorrido(page, causa, locale) {
  await page.route(`${ORIGEN}/**`, async (route) => {
    const request = route.request();
    const cuerpo = request.postDataBuffer();
    const cabeceras = { 'accept-language': locale, ...(await request.allHeaders()) };
    const respuesta = await responderAccesoRecorrido(
      new Request(request.url(), {
        method: request.method(),
        headers: cabeceras,
        ...(cuerpo ? { body: cuerpo } : {}),
      }),
      {
        variante: EXTENSION.id,
        clave: 'clave-sintetica-para-el-recorrido',
        firma: 'firma-sintetica-independiente-de-32-caracteres',
        leerModo: async () => ({ version: 1, revision: 1, modo: 'real' }),
        consumirIntento: async () => {
          if (causa === NO_DISPONIBLE) {
            throw new Error('autoridad de intentos caída');
          }
          return false;
        },
        delegar: async () => new Response('contenido protegido'),
      },
    );
    return route.fulfill({
      status: respuesta.status,
      headers: Object.fromEntries(respuesta.headers),
      body: Buffer.from(await respuesta.arrayBuffer()),
    });
  });
}

/**
 * Ejecuta una fase del envío y anota en el registro del caso su inicio y su fin o su error, en milisegundos desde el
 * principio del caso.
 */
async function fase(registro, nombre, accion) {
  const entrada = { fase: nombre, inicio: Math.round(performance.now() - registro.origen) };
  registro.fases.push(entrada);
  try {
    const resultado = await accion();
    entrada.fin = Math.round(performance.now() - registro.origen);
    return resultado;
  } catch (error) {
    entrada.fin = Math.round(performance.now() - registro.origen);
    entrada.error = error instanceof Error ? `${error.name}: ${error.message.split('\n')[0]}` : String(error);
    throw error;
  }
}

/** El registro legible del caso: cada fase con su inicio y su fin o su error, y la respuesta recibida. */
function describir(registro) {
  const fases = registro.fases.map(({ fase: nombre, inicio, fin, error }) => {
    const final = fin === undefined ? 'sin terminar' : `${error ? 'error' : 'fin'} a los ${fin} ms`;
    return `${nombre}: inicio a los ${inicio} ms, ${final}${error ? ` (${error})` : ''}`;
  });
  return `${registro.caso} — ${fases.join('; ')}; respuesta: ${JSON.stringify(registro.respuesta)}`;
}

/**
 * Envía el formulario del recorrido con un clic real y devuelve el aviso que ve la persona y el idioma de la página.
 * Un fallo lleva el registro del caso, que separa el clic, la navegación y la respuesta (estado y texto).
 */
async function avisoDelRecorrido(browser, { javaScriptEnabled, locale, causa }) {
  const registro = {
    caso: `${browser.browserType().name()} ${locale} ${causa}`,
    origen: performance.now(),
    fases: [],
    respuesta: {},
  };
  const contexto = await browser.newContext({ javaScriptEnabled, locale });
  try {
    const page = await contexto.newPage();
    await servirRecorrido(page, causa, locale);
    await page.goto(`${ORIGEN}/${EXTENSION.entrada}`);
    await page.locator('input[name="clave"]').fill('clave-sintetica');
    const boton = page.locator('button[type="submit"]');
    if (javaScriptEnabled) {
      await fase(registro, 'clic', () => boton.click()).catch((error) => {
        throw new Error(`El clic no se completa: ${describir(registro)}`, { cause: error });
      });
    } else {
      // El observador de la navegación se instala antes del clic; se esperan ambos para que un rechazo no oculte el otro.
      const navegacion = fase(registro, 'navegación', () => page.waitForNavigation());
      const clic = fase(registro, 'clic', () => boton.click());
      const [llegada, pulsacion] = await Promise.allSettled([navegacion, clic]);
      if (llegada.status === 'rejected' || pulsacion.status === 'rejected') {
        const causaDelFallo = pulsacion.status === 'rejected' ? pulsacion.reason : llegada.reason;
        throw new Error(`El envío nativo no se completa: ${describir(registro)}`, { cause: causaDelFallo });
      }
      registro.respuesta.estado = llegada.value?.status();
      assert.equal(registro.respuesta.estado, causa, `Estado de la respuesta: ${describir(registro)}`);
    }
    await fase(registro, 'respuesta', async () => {
      await page.locator('#acceso-error').waitFor({ state: 'visible', timeout: PLAZO_AVISO_MS });
      registro.respuesta.texto = await page.locator('#acceso-error').textContent();
      registro.respuesta.idioma = await page.locator('html').getAttribute('lang');
    }).catch((error) => {
      throw new Error(`El aviso de la respuesta no se ve: ${describir(registro)}`, { cause: error });
    });
    return { aviso: registro.respuesta.texto, idioma: registro.respuesta.idioma };
  } finally {
    await contexto.close();
  }
}

/**
 * Cada motor con su carpeta temporal propia, como en ensayo.ts: Firefox no arranca sin MOZ_APP_DATA y
 * MOZ_LOCAL_APP_DATA propios. Solo pasan las variables de entorno imprescindibles. La carpeta y el navegador son
 * recursos del caso `t`: se cierran aunque venza.
 */
async function lanzar(motor, t) {
  const recursos = recursosDelCaso(t);
  const temporal = await recursos.abrir(
    'la carpeta del navegador',
    () => mkdtempSync(join(realpathSync(tmpdir()), 'faro-acceso-')),
    (carpeta) => rmSync(carpeta, { recursive: true, force: true }),
  );
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH'];
  const entorno = Object.fromEntries(
    permitidas.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  const env = { ...entorno, MOZ_APP_DATA: join(temporal, 'app'), MOZ_LOCAL_APP_DATA: join(temporal, 'cache') };
  return { browser: await lanzarConPlazo(motor, { headless: true, env }, t.name, { recursos }), temporal, recursos };
}

// El envío nativo, sin JavaScript, depende de la política de referencia de la página (same-origin): se ensaya en los
// tres motores. Con JavaScript, el formulario lo recorren además los tres motores en recorrido-fragmento.test.mjs.
const MOTORES_DEL_RECORRIDO = [
  [false, chromium],
  [false, firefox],
  [false, webkit],
  [true, chromium],
];
for (const [javaScriptEnabled, motor] of EXTENSION === undefined ? [] : MOTORES_DEL_RECORRIDO) {
  const forma = javaScriptEnabled ? 'con JavaScript' : 'sin JavaScript, con el envío nativo';
  test(`el acceso al recorrido (${motor.name()}), ${forma}, dice el aviso de 429 y de 503 en los dos idiomas`, async (t) => {
    const { browser, temporal, recursos } = await lanzar(motor, t);
    const casos = [
      [DEMASIADOS, 'error-intentos'],
      [NO_DISPONIBLE, 'error-servicio'],
    ];
    const idiomas = [
      ['es', 'es-ES'],
      ['ca', 'ca-ES'],
    ];
    try {
      for (const [idioma, locale] of idiomas) {
        for (const [causa, clave] of casos) {
          const visto = await avisoDelRecorrido(browser, { javaScriptEnabled, locale, causa });
          assert.deepEqual(visto, { aviso: TEXTOS_ACCESO[idioma][clave], idioma }, `${causa} ${idioma}`);
        }
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(browser), 'el navegador no se cerró');
      await cerrarSinSustituir(() => recursos.cerrar(temporal), 'la carpeta del navegador no se retiró');
    }
  });
}
