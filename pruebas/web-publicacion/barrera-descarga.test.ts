// Si el guion de la barrera de versión no llega a ejecutarse (falla la red o su integridad), las entradas del recorrido
// no pueden quedarse inertes y mudas: la persona ve qué ha pasado y qué hacer, sin que se active ningún módulo. El aviso
// pide recargar con el botón del navegador y no lleva enlaces: sin JavaScript, un enlace perdería el fragmento #pasar= con
// el que llega quien escanea un QR, y la recarga del navegador lo conserva. Con la barrera cargada, ese aviso no se ve
// nunca. Se sirve la web construida (.web-local/web) con su CSP.

import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { type TestContext, test } from 'node:test';
import { type Browser, type BrowserContext, chromium, type Page, webkit } from 'playwright-core';
import { cabecerasDeLaWeb } from '../../src/plataforma/cabeceras-web.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';
import { huellaDeLaWebConstruida, webConstruida } from '../ayudas/web-construida.ts';
import { cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from '../navegadores/recursos-del-caso.mjs';

const WEB = `${webConstruida()}${sep}`;
const CABECERAS = cabecerasDeLaWeb(huellaDeLaWebConstruida());
const ORIGEN = 'http://localhost:4173';
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
/** Lo que se espera tras activar la página para comprobar que el aviso no aparece más tarde. */
const ESPERA_POSTERIOR_MS = 3000;
const PLAZO_ACTIVACION_MS = 30_000;
const TEXTO_ES =
  'No se ha podido comprobar la versión de Faro. Recarga la página con el botón de tu navegador; si sigue igual, revisa la conexión.';
const TEXTO_CA =
  'No s’ha pogut comprovar la versió de Faro. Torna a carregar la pàgina amb el botó del navegador; si continua igual, revisa la connexió.';
/** El fragmento con el que llega quien escanea un QR: la recarga no puede perderlo. */
const FRAGMENTO_QR = '#pasar=prueba-qr';
const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
/** El recorrido real y la entrada de cada extensión del registro. */
const PAGINAS = ['/recorrido.html', ...EXTENSIONES.map(({ entrada }) => `/${entrada}`)];
const MOTORES = [
  ['Chromium', chromium],
  ['WebKit', webkit],
] as const;

type Fallo = 'red' | 'integridad' | null;

/** La ruta pública de la barrera que nombra la página. */
async function rutaDeLaBarrera(pagina: string): Promise<string> {
  const html = await readFile(join(WEB, pagina), 'utf8');
  const src = /\ssrc="([^"]*scripts\/barrera-[a-f0-9]{64}\.js)"/u.exec(html)?.[1];
  assert.ok(src, `${pagina}: sin guion de barrera`);
  return new URL(src, `${ORIGEN}${pagina}`).pathname;
}

/** Los bytes de un archivo de la web construida, o null si no existe o queda fuera; la barrera llega alterada o no. */
async function bytesDe(url: URL, alterada: boolean): Promise<Buffer | null> {
  const archivo = resolve(WEB, `.${decodeURIComponent(url.pathname)}`);
  if (!archivo.startsWith(WEB.endsWith(sep) ? WEB : `${WEB}${sep}`)) {
    return null;
  }
  try {
    const cuerpo = await readFile(archivo);
    return alterada ? Buffer.concat([cuerpo, Buffer.from('\n')]) : cuerpo;
  } catch {
    return null;
  }
}

/** Sirve la web construida con su CSP; la barrera falla por red, llega alterada o llega bien. */
async function servir(contexto: BrowserContext, barrera: string, fallo: Fallo, navegaciones: string[]): Promise<void> {
  await contexto.route('**/*', async (ruta) => {
    const url = new URL(ruta.request().url());
    if (url.origin !== ORIGEN) {
      return ruta.abort('blockedbyclient');
    }
    if (ruta.request().isNavigationRequest()) {
      navegaciones.push(url.href);
    }
    const esBarrera = url.pathname === barrera;
    if (esBarrera && fallo === 'red') {
      return ruta.abort('failed');
    }
    const cuerpo = await bytesDe(url, esBarrera && fallo === 'integridad');
    if (cuerpo === null) {
      return ruta.fulfill({ status: NO_ENCONTRADO, body: '' });
    }
    return ruta.fulfill({
      status: CORRECTO,
      contentType: TIPOS[extname(url.pathname)] ?? 'application/octet-stream',
      headers: { ...CABECERAS.paraRuta(url.pathname) },
      body: cuerpo,
    });
  });
}

/** El estado visible de la página: aviso de descarga, aviso de versión, inercia y módulos activos. */
function estado(pagina: Page) {
  return pagina.evaluate(() => {
    const aviso = document.getElementById('faro-aviso-descarga');
    const resto = [...document.body.children].filter((hijo) => hijo !== aviso);
    return {
      avisoVisible: !!aviso && aviso.getClientRects().length > 0 && !aviso.closest('[hidden]'),
      avisoInerte: !!aviso?.closest('[inert]'),
      avisoArriba: document.body.firstElementChild?.matches('a.salto') === true && document.body.children[1] === aviso,
      textos: [...(aviso?.querySelectorAll('p') ?? [])].map((p) => ({
        lang: p.closest('[lang]')?.getAttribute('lang') ?? null,
        texto: p.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      })),
      enlacesEnElAviso: aviso?.querySelectorAll('a').length ?? null,
      restoInerte:
        resto.length > 0 && resto.every((hijo) => !!hijo.closest('[inert]') || hijo.id === 'faro-version-aviso'),
      algoActivo: resto.some((hijo) => hijo.id !== 'faro-version-aviso' && !hijo.closest('[inert]')),
      versionOculto: document.getElementById('faro-version-aviso')?.hidden ?? null,
      raizOculta: document.documentElement.hidden,
      plantillasPendientes: document.querySelectorAll('template[data-faro-carga]').length,
      modulosActivos: document.querySelectorAll('script[type="module"]').length,
    };
  });
}

/** El navegador del caso `t`, con plazo de arranque y cerrado aunque el caso venza (recursos-del-caso.mjs). */
async function conNavegador(
  t: TestContext,
  motor: (typeof MOTORES)[number][1],
  uso: (navegador: Browser) => Promise<void>,
) {
  const recursos = recursosDelCaso(t);
  const navegador = await lanzarConPlazo(motor, { headless: true }, t.name, { recursos });
  try {
    await uso(navegador);
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(navegador), 'el navegador no se cerró');
  }
}

/** Un caso sin barrera: el aviso se ve, no lleva enlaces y la recarga conserva el fragmento; nada se activa. */
async function comprobarSinBarrera(navegador: Browser, pagina: string, fallo: Exclude<Fallo, null>, idioma: string) {
  const caso = `${pagina} (${fallo}, ${idioma})`;
  const barrera = await rutaDeLaBarrera(pagina);
  const plantillas = (await readFile(join(WEB, pagina), 'utf8')).match(/<template data-faro-carga/gu)?.length;
  const contexto = await navegador.newContext({ serviceWorkers: 'block', locale: idioma, reducedMotion: 'reduce' });
  try {
    const navegaciones: string[] = [];
    await servir(contexto, barrera, fallo, navegaciones);
    const p = await contexto.newPage();
    await p.goto(`${ORIGEN}${pagina}${FRAGMENTO_QR}`, { waitUntil: 'load' });
    const r = await estado(p);
    assert.equal(r.avisoVisible, true, `${caso}: el aviso se ve`);
    assert.equal(r.avisoArriba, true, `${caso}: el aviso va arriba, tras el enlace de salto`);
    assert.equal(r.avisoInerte, false, `${caso}: el aviso se puede usar`);
    const textos = [
      { lang: 'es', texto: TEXTO_ES },
      { lang: 'ca', texto: TEXTO_CA },
    ];
    assert.deepEqual(r.textos, textos, caso);
    assert.equal(r.enlacesEnElAviso, 0, `${caso}: el aviso no lleva ningún enlace que pierda el fragmento del QR`);
    assert.equal(r.restoInerte, true, `${caso}: el resto sigue inerte`);
    assert.equal(r.algoActivo, false, caso);
    assert.equal(r.versionOculto, true, caso);
    assert.equal(r.raizOculta, false, caso);
    assert.equal(r.plantillasPendientes, plantillas, `${caso}: ninguna hoja ni guion se activa`);
    assert.equal(r.modulosActivos, 0, `${caso}: ningún módulo se activa`);
    await p.reload({ waitUntil: 'load' });
    assert.deepEqual(navegaciones, [`${ORIGEN}${pagina}`, `${ORIGEN}${pagina}`], `${caso}: el navegador recarga`);
    assert.equal(new URL(p.url()).hash, FRAGMENTO_QR, `${caso}: tras recargar, el fragmento del QR sigue`);
    assert.equal((await estado(p)).avisoVisible, true, `${caso}: tras recargar, sigue el aviso`);
  } finally {
    await contexto.close();
  }
}

for (const [nombre, motor] of MOTORES) {
  test(`${nombre}: sin el guion de la barrera, el recorrido avisa en castellano y catalán, sin enlaces, y no activa nada`, async (t) => {
    await conNavegador(t, motor, async (navegador) => {
      for (const pagina of PAGINAS) {
        for (const [fallo, idioma] of [
          ['red', 'es-ES'],
          ['red', 'ca-ES'],
          ['integridad', 'es-ES'],
        ] as const) {
          await comprobarSinBarrera(navegador, pagina, fallo, idioma);
        }
      }
    });
  });

  test(`${nombre}: con la barrera cargada, el aviso de descarga no aparece ni antes ni después de activar`, async (t) => {
    await conNavegador(t, motor, async (navegador) => {
      for (const pagina of PAGINAS) {
        const barrera = await rutaDeLaBarrera(pagina);
        const contexto = await navegador.newContext({ serviceWorkers: 'block', locale: 'es-ES' });
        try {
          await servir(contexto, barrera, null, []);
          // Mira cada fotograma desde antes del primer pintado: el aviso no puede llegar a verse ni un instante.
          await contexto.addInitScript(() => {
            const mirar = () => {
              const aviso = document.getElementById('faro-aviso-descarga');
              if (aviso && aviso.getClientRects().length > 0) {
                document.documentElement.dataset.avisoDescargaVisto = '';
              }
              requestAnimationFrame(mirar);
            };
            requestAnimationFrame(mirar);
          });
          const errores: string[] = [];
          const p = await contexto.newPage();
          p.on('pageerror', (error) => errores.push(error.message));
          await p.goto(`${ORIGEN}${pagina}`, { waitUntil: 'load' });
          await p.waitForFunction(
            () =>
              document.querySelectorAll('template[data-faro-carga]').length === 0 &&
              !document.getElementById('contenido')?.closest('[inert]'),
            undefined,
            { timeout: PLAZO_ACTIVACION_MS },
          );
          await p.waitForTimeout(ESPERA_POSTERIOR_MS);
          const r = await estado(p);
          const visto = await p.evaluate(() => 'avisoDescargaVisto' in document.documentElement.dataset);
          assert.equal(visto, false, `${pagina}: el aviso no se ha pintado en ningún fotograma`);
          assert.equal(r.avisoVisible, false, pagina);
          assert.equal(r.algoActivo, true, `${pagina}: la página se puede usar`);
          assert.equal(r.restoInerte, false, pagina);
          assert.equal(r.versionOculto, true, pagina);
          assert.equal(r.raizOculta, false, pagina);
          assert.ok(r.modulosActivos > 0, `${pagina}: los módulos se activan`);
          assert.deepEqual(errores, [], pagina);
        } finally {
          await contexto.close();
        }
      }
    });
  });
}
