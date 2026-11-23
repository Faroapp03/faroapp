// La candidata oficial y las credenciales sintéticas se usan solo en un servidor local aislado por motor.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { entornoParaLanzar } from '../../scripts/entorno-firefox.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { comprobarEntregaOficial } from '../ayudas/comprobar-oficial.ts';
import { entrarPortal, probarPortal } from './portal-ensayo.mjs';
import { CLAVE_RECORRIDO, crearPortalLocal, PORTAL } from './portal-fixture.mjs';
import { probarQrIntegral } from './qr-integral.mjs';
import { informe, prepararCopia } from './recorrido.ts';
import { lanzarConPlazo } from './recursos-del-caso.mjs';
import { errorSinSecretos } from './remoto-ayudas.mjs';

const ARGUMENTOS_ESPERADOS = 5;
const PLAZO_CONTROL = 120_000;
/**
 * El certificado del proxy HTTPS es efímero y no es de confianza. Los contextos ya ignoran sus errores
 * (ignoreHTTPSErrors), pero Chromium no registra un service worker con un certificado no válido y la copia no se
 * prepara (visto el 02/11/2026: contexto seguro y ningún registro); la opción extiende al service worker lo que ya
 * se acepta en las páginas.
 */
const ARGUMENTOS_DEL_MOTOR = { chromium: ['--ignore-certificate-errors'] };
/** Observar el service worker tras un fallo de la copia es diagnóstico: no puede dejar el ensayo esperando. */
const PLAZO_OBSERVACION_MS = 10_000;
const raiz = fileURLToPath(new URL('../../', import.meta.url));
const [carpeta, huella, destino] = process.argv.slice(2);
assert.ok(carpeta && huella && destino && process.argv.length === ARGUMENTOS_ESPERADOS);
assert.match(huella, /^[a-f0-9]{64}$/);
const directorio = resolve(carpeta);
const salida = resolve(destino);
comprobarEntregaOficial(raiz, directorio, huella);
await mkdir(salida);

async function autorizar(pagina) {
  await pagina.locator('#formulario-acceso').waitFor({ state: 'visible' });
  await entrarPortal(pagina, PORTAL);
  const listo = pagina.locator('#acceso-recorrido, .rc-cuerpo').first();
  await listo.waitFor({ state: 'attached', timeout: PLAZO_CONTROL });
  if (await pagina.locator('#acceso-recorrido').count()) {
    await pagina.locator('#acceso-recorrido input[name="clave"]').fill(CLAVE_RECORRIDO);
    await pagina.locator('#acceso-recorrido button[type="submit"]').click();
    await pagina.locator('#acceso-recorrido').waitFor({ state: 'detached', timeout: PLAZO_CONTROL });
  }
}

async function contexto(browser) {
  return browser.newContext({
    userAgent: IDENTIDAD_WEB['User-Agent'],
    extraHTTPHeaders: {
      'sec-ch-ua': IDENTIDAD_WEB['sec-ch-ua'],
      'sec-ch-ua-mobile': IDENTIDAD_WEB['sec-ch-ua-mobile'],
      'sec-ch-ua-platform': IDENTIDAD_WEB['sec-ch-ua-platform'],
    },
    locale: 'es',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
}

async function prepararCopiaObservada(pagina, observacion, fallos) {
  try {
    await prepararCopia(pagina);
    observacion.preparacion = 'completa';
  } catch (error) {
    observacion.preparacion = 'fallida';
    observacion.fallosTls = fallos.length;
    const sinObservacion = { observacionNoDisponible: true };
    let plazo;
    const limite = new Promise((resolver) => {
      plazo = setTimeout(() => resolver(sinObservacion), PLAZO_OBSERVACION_MS);
    });
    const consulta = pagina
      .evaluate(async () => {
        const sw = navigator.serviceWorker;
        const registros = await sw.getRegistrations();
        return {
          contextoSeguro: isSecureContext,
          controlador: sw.controller !== null,
          estados: registros.map((registro) => ({
            activo: registro.active?.state ?? null,
            instalando: registro.installing?.state ?? null,
            esperando: registro.waiting?.state ?? null,
          })),
        };
      })
      .catch(() => sinObservacion);
    observacion.serviceWorker = await Promise.race([consulta, limite]).finally(() => clearTimeout(plazo));
    throw error;
  }
}

async function probarTransferencia(browser, origen, observacion) {
  const emisor = await contexto(browser);
  const receptor = await contexto(browser);
  try {
    const inesperadas = [];
    emisor.on('request', (peticion) => {
      const ruta = new URL(peticion.url());
      if (
        ruta.origin !== origen.origin ||
        (peticion.method() === 'POST' && !['/acceso-web/entrar', '/recorrido.html'].includes(ruta.pathname))
      ) {
        inesperadas.push('solicitud no admitida');
      }
    });
    await emisor.route('**/*', (ruta) =>
      new URL(ruta.request().url()).origin === origen.origin ? ruta.continue() : ruta.abort(),
    );
    const pagina = await emisor.newPage();
    const fallos = [];
    pagina.on('requestfailed', (peticion) => {
      const codigo = peticion.failure()?.errorText ?? '';
      if (/CERT|SSL/i.test(codigo)) {
        fallos.push('error_certificado_o_tls');
      }
    });
    await pagina.addInitScript(() => {
      localStorage.setItem('faro-idioma', 'es');
      localStorage.setItem('faro-modo-elegido', 'ia-off');
    });
    await pagina.goto(new URL('/recorrido.html', origen).href);
    await autorizar(pagina);
    await prepararCopiaObservada(pagina, observacion, fallos);
    await informe(pagina, 'es');
    const qr = await probarQrIntegral({ emisora: pagina, receptor, origen, autenticar: autorizar });
    assert.deepEqual(inesperadas, [], 'El emisor no transmite datos del recorrido');
    return qr;
  } finally {
    await emisor.close();
    await receptor.close();
  }
}

async function fase(ejecutar) {
  try {
    return { correcto: true, resultado: await ejecutar() };
  } catch (error) {
    return { correcto: false, diagnostico: diagnostico(error) };
  }
}

function diagnostico(error) {
  return {
    ...errorSinSecretos(error, [PORTAL.usuario, PORTAL.clave, CLAVE_RECORRIDO]),
    ubicacion:
      error instanceof Error
        ? error.stack?.match(
            /(?:portal-ensayo|portal-oficial-miniflare|qr-integral|recorrido)\.(?:mjs|ts):\d+:\d+/,
          )?.[0]
        : undefined,
    ...(error instanceof assert.AssertionError && typeof error.actual === 'number'
      ? { estadoRecibido: error.actual }
      : {}),
  };
}

const resultados = [];
for (const [nombre, tipo] of Object.entries({ chromium, firefox, webkit })) {
  const fixture = await crearPortalLocal(directorio);
  let browser;
  try {
    const tmpAnterior = process.env.TMPDIR;
    try {
      if (nombre === 'firefox') {
        process.env.TMPDIR = '/private/tmp';
      }
      browser = await lanzarConPlazo(
        tipo,
        {
          headless: true,
          env: entornoParaLanzar(),
          args: ARGUMENTOS_DEL_MOTOR[nombre] ?? [],
        },
        'portal-oficial-miniflare.mjs',
      );
    } finally {
      if (tmpAnterior === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = tmpAnterior;
      }
    }
    const ctx = await contexto(browser);
    try {
      await ctx.route('**/*', (ruta) =>
        new URL(ruta.request().url()).origin === fixture.origen ? ruta.continue() : ruta.abort(),
      );
      const observacion = {};
      const teclado = [];
      const portal = await fase(() =>
        probarPortal({
          contexto: ctx,
          origen: new URL(fixture.origen),
          credenciales: PORTAL,
          salida,
          nombre,
          teclado,
        }),
      );
      const qr = await fase(() => probarTransferencia(browser, new URL(fixture.origen), observacion));
      resultados.push({ motor: nombre, correcto: portal.correcto && qr.correcto, portal, qr, teclado, observacion });
    } finally {
      await ctx.close();
    }
  } catch (error) {
    resultados.push({
      motor: nombre,
      correcto: false,
      diagnostico: diagnostico(error),
    });
  } finally {
    await browser?.close();
    await fixture.cerrar();
  }
}
comprobarEntregaOficial(raiz, directorio, huella);
await writeFile(
  `${salida}/resultado.json`,
  JSON.stringify(
    {
      huellaArtefacto: huella,
      transporte: 'Miniflare local y HTTPS real en loopback con certificado efímero',
      resultados,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
if (resultados.some((resultado) => !resultado.correcto)) {
  process.exitCode = 1;
}
