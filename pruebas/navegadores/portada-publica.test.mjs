import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, firefox, webkit } from 'playwright-core';
import { PAGINA_ACCESO_WEB } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { PORTADA_PUBLICA, TEXTOS_PORTADA } from '../../src/plataforma/cloudflare/portada-publica.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const ANCHO = 1280;
const ALTO = 900;
const ANCHO_MOVIL = 320;
const ALTO_MOVIL = 568;
const MITAD = 2;
const MARGEN_MAXIMO = 0.15;

async function comprobarMarca(pagina) {
  assert.deepEqual(
    await pagina.evaluate(() => [
      getComputedStyle(document.querySelector('.nombre')).color,
      getComputedStyle(document.querySelector('.luz')).stroke,
      getComputedStyle(document.body).backgroundColor,
      getComputedStyle(document.documentElement).backgroundColor,
    ]),
    ['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'],
  );
  const titulo = await pagina.locator('.nombre').boundingBox();
  assert.ok(titulo && titulo.x < ANCHO * MARGEN_MAXIMO && titulo.x + titulo.width < ANCHO / MITAD);
}

test('portada: marca blanca y entrada accesible en catalán y castellano con el sistema en claro', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const pagina = await navegador.newPage({
      locale: 'es-ES',
      colorScheme: 'light',
      viewport: { width: ANCHO, height: ALTO },
      reducedMotion: 'reduce',
    });
    await servirPortada(pagina);
    await pagina.goto(`${ORIGEN_PORTADA}/`);
    assert.equal(await pagina.locator('#tema-entrada').count(), 0);
    for (const idioma of ['ca', 'es']) {
      assert.equal(await pagina.locator('html').getAttribute('lang'), idioma);
      await comprobarMarca(pagina);
      const selector = pagina.locator('#idioma-entrada');
      const textos = TEXTOS_PORTADA[idioma];
      assert.equal((await selector.textContent())?.trim(), '');
      assert.equal(await selector.getAttribute('aria-label'), textos.idioma);
      assert.equal(await selector.getAttribute('title'), textos.idioma);
      assert.equal(await pagina.locator('.imagen img').getAttribute('alt'), textos.foto);
      const enlace = pagina.locator('.acceso a');
      assert.equal(await enlace.getAttribute('href'), idioma === 'ca' ? '/acceso-web' : '/acceso-web?idioma=es');
      assert.equal(await enlace.locator('.etiqueta').textContent(), textos.entrar);
      assert.equal(await enlace.locator('.flecha').getAttribute('aria-hidden'), 'true');
      await enlace.hover();
      assert.equal(await enlace.evaluate((nodo) => getComputedStyle(nodo).backgroundColor), 'rgb(236, 232, 224)');
      assert.equal(await enlace.evaluate((nodo) => getComputedStyle(nodo).color), 'rgb(27, 29, 27)');
      await selector.focus();
      await pagina.keyboard.press('Tab');
      assert.equal(await enlace.evaluate((nodo) => nodo === document.activeElement), true);
      assert.notEqual(await enlace.evaluate((nodo) => getComputedStyle(nodo).outlineStyle), 'none');
      await selector.click();
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

/** Constantes de luminancia relativa y contraste de WCAG 2.2 (definición de «relative luminance»). */
const WCAG = {
  maximoDeCanal: 255,
  umbralLineal: 0.039_28,
  divisorLineal: 12.92,
  desplazamiento: 0.055,
  escala: 1.055,
  exponente: 2.4,
  pesoRojo: 0.2126,
  pesoVerde: 0.7152,
  pesoAzul: 0.0722,
  reflejo: 0.05,
  contrasteMinimo: 4.5,
};
const CANALES = 3;

/** Contraste WCAG entre dos colores rgb() del navegador. */
function contraste(primero, segundo) {
  const luminancia = (color) =>
    (color.match(/\d+(?:\.\d+)?/g) ?? [])
      .slice(0, CANALES)
      .map((canal) => {
        const valor = Number(canal) / WCAG.maximoDeCanal;
        return valor <= WCAG.umbralLineal
          ? valor / WCAG.divisorLineal
          : ((valor + WCAG.desplazamiento) / WCAG.escala) ** WCAG.exponente;
      })
      .reduce(
        (suma, lineal, indice) => suma + lineal * ([WCAG.pesoRojo, WCAG.pesoVerde, WCAG.pesoAzul][indice] ?? 0),
        0,
      );
  const [clara, oscura] = [luminancia(primero), luminancia(segundo)].sort((a, b) => b - a);
  return (clara + WCAG.reflejo) / (oscura + WCAG.reflejo);
}

/** Si dos cajas del navegador se solapan. */
function seSolapan(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * El pie de la página: un único punto de referencia contentinfo fuera de main, con la línea de derechos, sin tapar la
 * entrada, dentro de la ventana y con contraste suficiente sobre el fondo de la portada.
 */
async function comprobarPie(pagina, viewport, enlace) {
  const caso = `${viewport.width}px`;
  const pie = pagina.getByRole('contentinfo');
  assert.equal(await pie.count(), 1, `${caso}: un solo pie de página`);
  assert.equal((await pie.textContent())?.trim(), '© 2026 Faro');
  assert.equal(await pagina.locator('main footer').count(), 0, `${caso}: el pie va fuera de main`);
  const derechos = await pagina.locator('.derechos').boundingBox();
  assert.ok(derechos && !seSolapan(enlace, derechos), caso);
  assert.ok(derechos.y + derechos.height <= viewport.height, caso);
  const colores = await pagina.evaluate(() => ({
    texto: getComputedStyle(document.querySelector('.derechos')).color,
    fondo: getComputedStyle(document.body).backgroundColor,
  }));
  assert.equal(colores.fondo, 'rgb(0, 0, 0)', caso);
  assert.ok(contraste(colores.texto, colores.fondo) >= WCAG.contrasteMinimo, `${caso}: ${JSON.stringify(colores)}`);
}

test('portada: con movimiento reducido la entrada se ve y se puede usar desde el primer pintado', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    for (const viewport of [
      { width: ANCHO, height: ALTO },
      { width: ANCHO_MOVIL, height: ALTO_MOVIL },
    ]) {
      const pagina = await navegador.newPage({ locale: 'ca-ES', viewport, reducedMotion: 'reduce' });
      await pagina.setContent(PORTADA_PUBLICA, { waitUntil: 'commit' });
      await pagina.locator('.acceso a').waitFor({ state: 'attached' });
      const acceso = await pagina.locator('.acceso').evaluate((nodo) => ({
        opacidad: getComputedStyle(nodo).opacity,
        enlace: getComputedStyle(nodo.querySelector('a')).opacity,
        animaciones: nodo.getAnimations({ subtree: true }).length,
      }));
      assert.deepEqual(acceso, { opacidad: '1', enlace: '1', animaciones: 0 }, `${viewport.width}px`);
      const enlace = await pagina.locator('.acceso a').boundingBox();
      assert.ok(enlace && enlace.y >= 0 && enlace.y + enlace.height <= viewport.height, `${viewport.width}px`);
      const centro = { x: enlace.x + enlace.width / 2, y: enlace.y + enlace.height / 2 };
      assert.equal(
        await pagina.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'),
          centro,
        ),
        '/acceso-web',
      );
      await comprobarPie(pagina, viewport, enlace);
      await pagina.locator('.acceso a').click({ noWaitAfter: true, trial: true });
      await pagina.close();
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

const ORIGEN_PORTADA = 'https://ejemplo.invalid';

/** Propósito y entrada en cuanto llega el documento, y sus cajas antes y después de terminar cualquier animación. */
async function propositoYEntradaAlPintar(pagina) {
  await pagina.locator('.acceso a').waitFor({ state: 'attached' });
  return pagina.evaluate(() => {
    const caja = (selector) => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    const estado = (selector) => {
      const nodo = document.querySelector(selector);
      return { opacidad: getComputedStyle(nodo).opacity, animaciones: nodo.getAnimations().length };
    };
    const inicio = {
      intro: estado('.intro'),
      acceso: estado('.acceso'),
      enlace: estado('.acceso a'),
      cajas: [caja('.intro'), caja('.acceso a')],
    };
    for (const animacion of document.getAnimations()) {
      animacion.finish();
    }
    return { ...inicio, cajasAlTerminar: [caja('.intro'), caja('.acceso a')], ancho: innerWidth };
  });
}

test('portada: con movimiento reducido el propósito y la entrada se ven sin moverse', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    for (const viewport of [
      { width: ANCHO, height: ALTO },
      { width: ANCHO_MOVIL, height: ALTO_MOVIL },
    ]) {
      const pagina = await navegador.newPage({ locale: 'ca-ES', viewport, reducedMotion: 'reduce' });
      await pagina.route(`${ORIGEN_PORTADA}/**`, (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: new URL(route.request().url()).pathname === '/' ? PORTADA_PUBLICA : '<!doctype html><p>otra</p>',
        }),
      );
      const momentos = [
        ['al cargar', () => pagina.goto(`${ORIGEN_PORTADA}/`, { waitUntil: 'commit' })],
        [
          'al volver',
          async () => {
            await pagina.goto(`${ORIGEN_PORTADA}/otra`);
            await pagina.goBack({ waitUntil: 'commit' });
          },
        ],
        ['al recargar', () => pagina.reload({ waitUntil: 'commit' })],
      ];
      for (const [momento, llegar] of momentos) {
        await llegar();
        const caso = `${viewport.width}px ${momento}`;
        const { cajas, cajasAlTerminar, ancho, ...estados } = await propositoYEntradaAlPintar(pagina);
        const visible = { opacidad: '1', animaciones: 0 };
        assert.deepEqual(estados, { intro: visible, acceso: visible, enlace: visible }, caso);
        assert.deepEqual(cajasAlTerminar, cajas, caso);
        assert.ok(
          cajas.every(({ x, width }) => x >= 0 && x + width <= ancho),
          caso,
        );
      }
      await pagina.close();
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});

/**
 * Cada motor con su carpeta temporal propia, como en ensayo.ts: Firefox no arranca sin MOZ_APP_DATA y
 * MOZ_LOCAL_APP_DATA propios. Solo pasan las variables de entorno imprescindibles. La carpeta y el navegador son
 * recursos del caso `t`: se cierran aunque venza.
 */
async function lanzar(motor, t) {
  const recursos = recursosDelCaso(t);
  const temporal = await recursos.abrir(
    'la carpeta del navegador',
    () => mkdtempSync(join(realpathSync(tmpdir()), 'faro-portada-')),
    (carpeta) => rmSync(carpeta, { recursive: true, force: true }),
  );
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH'];
  const entorno = Object.fromEntries(
    permitidas.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  const env = { ...entorno, MOZ_APP_DATA: join(temporal, 'app'), MOZ_LOCAL_APP_DATA: join(temporal, 'cache') };
  return { navegador: await lanzarConPlazo(motor, { headless: true, env }, t.name, { recursos }), temporal, recursos };
}

/** La portada y el acceso se sirven desde el mismo origen simulado. */
async function servirPortada(pagina) {
  await pagina.route(`${ORIGEN_PORTADA}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: new URL(route.request().url()).pathname === '/' ? PORTADA_PUBLICA : PAGINA_ACCESO_WEB,
    }),
  );
}

/** Pulsa un punto como una persona, sin esperas de Playwright, y espera a llegar a /acceso-web. */
async function pulsarYLlegarAlAcceso(pagina, { x, y }) {
  await Promise.all([pagina.waitForURL(`${ORIGEN_PORTADA}/acceso-web`), pagina.mouse.click(x, y)]);
}

/**
 * En el acto, sin esperar a ninguna animación: «Entra» se ve (opacidad 1, también la de sus contenedores), nada lo
 * tapa y pulsarlo lleva a /acceso-web.
 */
async function entraSeVeYFunciona(pagina, caso) {
  const estado = await pagina.evaluate(() => {
    const enlace = document.querySelector('.acceso a');
    let opacidad = 1;
    for (let nodo = enlace; nodo; nodo = nodo.parentElement) {
      opacidad *= Number(getComputedStyle(nodo).opacity);
    }
    const { x, y, width, height } = enlace.getBoundingClientRect();
    const centro = { x: x + width / 2, y: y + height / 2 };
    const encima = document.elementFromPoint(centro.x, centro.y)?.closest('a')?.getAttribute('href') ?? null;
    return { opacidad, encima, centro };
  });
  assert.deepEqual({ opacidad: estado.opacidad, encima: estado.encima }, { opacidad: 1, encima: '/acceso-web' }, caso);
  await pulsarYLlegarAlAcceso(pagina, estado.centro);
}

/** Vuelve atrás a la portada y espera solo a que exista la entrada, no a que se pinte ni a que termine nada. */
async function volverALaPortada(pagina) {
  await pagina.goBack({ waitUntil: 'commit' });
  await pagina.locator('.acceso a').waitFor({ state: 'attached' });
}

/** Un punto del fondo que pertenece al contenedor indicado, fuera de sus controles y textos. */
async function puntoDelFondo(pagina, selector) {
  const punto = await pagina.evaluate((destino) => {
    const fondo = new Set(document.querySelectorAll(destino));
    const paso = 16;
    for (let y = paso; y < innerHeight; y += paso) {
      for (let x = paso; x < innerWidth; x += paso) {
        if (fondo.has(document.elementFromPoint(x, y))) {
          return { x, y };
        }
      }
    }
    return null;
  }, selector);
  assert.ok(punto, `la portada debe tener fondo visible en ${selector}`);
  return punto;
}

/**
 * Pulsa el fondo y comprueba el destino real y el primer color opaco entre ese elemento y sus contenedores.
 */
async function pulsarElFondo(pagina, selector) {
  const { x, y } = await puntoDelFondo(pagina, selector);
  await pagina.evaluate((destino) => {
    document.addEventListener(
      'click',
      (evento) => {
        let color = 'rgba(0, 0, 0, 0)';
        for (
          let nodo = evento.target;
          nodo instanceof Element && color === 'rgba(0, 0, 0, 0)';
          nodo = nodo.parentElement
        ) {
          color = getComputedStyle(nodo).backgroundColor;
        }
        document.documentElement.dataset.pulsado = evento.target.matches(destino) ? color : evento.target.localName;
      },
      { capture: true, once: true },
    );
  }, selector);
  await pagina.mouse.click(x, y);
  const pulsado = await pagina.evaluate(() => document.documentElement.dataset.pulsado ?? null);
  assert.equal(pulsado, 'rgb(0, 0, 0)', `pulsación en ${selector} (${x}, ${y}): ${pulsado}`);
  await pagina.evaluate(() => delete document.documentElement.dataset.pulsado);
}

for (const motor of [chromium, firefox, webkit]) {
  test(`portada (${motor.name()}): con movimiento reducido «Entra» se ve y funciona al volver y tras pulsar el fondo`, async (t) => {
    const { navegador, temporal, recursos } = await lanzar(motor, t);
    try {
      for (const viewport of [
        { width: ANCHO, height: ALTO },
        { width: ANCHO_MOVIL, height: ALTO_MOVIL },
      ]) {
        const pagina = await navegador.newPage({
          locale: 'es-ES',
          colorScheme: 'light',
          viewport,
          reducedMotion: 'reduce',
        });
        await servirPortada(pagina);
        await pagina.goto(`${ORIGEN_PORTADA}/acceso-web`);
        await pagina.evaluate(() => {
          localStorage.setItem('faro-tema', 'claro');
          localStorage.setItem('faro-idioma', 'es');
        });
        await pagina.goto(`${ORIGEN_PORTADA}/`);
        assert.equal(await pagina.locator('html').getAttribute('lang'), 'ca');
        assert.equal(await pagina.locator('#tema-entrada').count(), 0);
        const enlace = await pagina.locator('.acceso a').boundingBox();
        assert.ok(enlace);
        await pulsarYLlegarAlAcceso(pagina, { x: enlace.x + enlace.width / 2, y: enlace.y + enlace.height / 2 });
        assert.equal(await pagina.locator('html').getAttribute('lang'), 'ca');
        assert.equal(await pagina.locator('html').evaluate((nodo) => getComputedStyle(nodo).colorScheme), 'dark');
        assert.equal(await pagina.locator('#tema-entrada').count(), 0);
        await volverALaPortada(pagina);
        await entraSeVeYFunciona(pagina, 'al volver');
        await volverALaPortada(pagina);
        await pulsarElFondo(pagina, viewport.width === ANCHO_MOVIL ? 'div.acceso' : 'html, body, main');
        await entraSeVeYFunciona(pagina, 'al volver y pulsar el fondo');
        await pagina.close();
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
      await cerrarSinSustituir(() => recursos.cerrar(temporal), 'la carpeta del navegador no se retiró');
    }
  });
}

test('portada: la marca precede al texto y a la entrada', async (t) => {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(chromium, { headless: true }, t.name, { recursos });
  try {
    const pagina = await navegador.newPage({ locale: 'ca-ES', reducedMotion: 'no-preference' });
    await pagina.setContent(PORTADA_PUBLICA);
    const estados = await pagina.evaluate(() => {
      const nodos = ['.marca', '.intro', '.acceso'].map((selector) => document.querySelector(selector));
      const animaciones = nodos.map((nodo) => nodo.getAnimations()[0]);
      for (const animacion of animaciones) {
        animacion.pause();
      }
      const marcaEnCurso = 2500;
      const textoEnCurso = 3500;
      const entradaEnCurso = 5000;
      const terminado = 6500;
      return [0, marcaEnCurso, textoEnCurso, entradaEnCurso, terminado].map((tiempo) => {
        for (const animacion of animaciones) {
          animacion.currentTime = tiempo;
        }
        return nodos.map((nodo) => Number(getComputedStyle(nodo).opacity));
      });
    });
    assert.deepEqual(estados[0], [0, 0, 0]);
    assert.ok(estados[1][0] > 0 && estados[1][1] === 0 && estados[1][2] === 0);
    assert.ok(estados[2][0] === 1 && estados[2][1] > 0 && estados[2][2] === 0);
    assert.ok(estados[3][1] === 1 && estados[3][2] > 0);
    assert.deepEqual(estados[4], [1, 1, 1]);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
});
