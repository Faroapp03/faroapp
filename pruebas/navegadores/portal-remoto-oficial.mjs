// Solo el destino autorizado; contraseñas y cookies se reciben y conservan exclusivamente en memoria.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from 'playwright-core';
import { origenDeEnsayoAutorizado } from '../../herramientas/cloudflare/preparar-despliegue.ts';
import { entornoParaLanzar } from '../../scripts/entorno-firefox.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { entrarPortal, probarPortal } from './portal-ensayo.mjs';
import { validarCredenciales } from './portal-remoto-utilidades.mjs';
import { probarQrIntegral } from './qr-integral.mjs';
import { informe, prepararCopia } from './recorrido.ts';
import { lanzarConPlazo } from './recursos-del-caso.mjs';
import { errorSinSecretos } from './remoto-ayudas.mjs';

const MOTORES = { chromium, firefox, webkit };
const INTERVALO_SONDA_MS = 2000;
const PLAZO_MS = 120_000;
const MAX_ENTRADA = 16_384;
const HTTP_NO_ENCONTRADO = 404;
const HTTP_REDIRECCION = 302;
const VENTANA_MS = 900_000;
const intentos = [];
const opciones = parseArgs({
  options: {
    salida: { type: 'string' },
    origen: { type: 'string' },
    instalacion: { type: 'string' },
    huella: { type: 'string' },
    'solo-qr': { type: 'string' },
  },
}).values;
// Antes de leer credenciales: perfil completo y separado de producción, y el origen exacto del registro de ensayo.
assert.ok(
  opciones.origen && opciones.instalacion,
  'Se requieren --origen y --instalacion con el registro de la instalación de ensayo autorizada',
);
let registro;
try {
  registro = JSON.parse(readFileSync(opciones.instalacion, 'utf8'));
} catch {
  throw new Error('No se pudo leer el registro de la instalación de ensayo como JSON');
}
const ORIGEN = origenDeEnsayoAutorizado(fileURLToPath(new URL('../../', import.meta.url)), registro, opciones.origen);
assert.ok(opciones.huella && /^[a-f0-9]{64}$/.test(opciones.huella), 'Se requiere la huella SHA-256 local');
if (opciones['solo-qr'] !== undefined) {
  assert.ok(Object.hasOwn(MOTORES, opciones['solo-qr']), 'Motor QR no admitido');
}
assert.ok(!process.stdin.isTTY, 'Se necesita un conducto privado de entrada');
let entrada = '';
for await (const trozo of process.stdin) {
  entrada += trozo;
  assert.ok(entrada.length <= MAX_ENTRADA, 'Entrada demasiado grande');
}
let datos;
try {
  datos = validarCredenciales(JSON.parse(entrada));
} catch {
  throw new Error('La entrada de credenciales no es válida');
} finally {
  entrada = '';
}
const secretos = Object.values(datos);
const salida = opciones.salida ? resolve(opciones.salida) : await mkdtemp(join(tmpdir(), 'faro-portal-remoto-'));
if (opciones.salida) {
  await mkdir(salida);
}

async function contexto(browser) {
  const ctx = await browser.newContext({
    userAgent: IDENTIDAD_WEB['User-Agent'],
    extraHTTPHeaders: {
      'sec-ch-ua': IDENTIDAD_WEB['sec-ch-ua'],
      'sec-ch-ua-mobile': IDENTIDAD_WEB['sec-ch-ua-mobile'],
      'sec-ch-ua-platform': IDENTIDAD_WEB['sec-ch-ua-platform'],
    },
    locale: 'es',
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  ctx.on('request', (peticion) => {
    const ruta = new URL(peticion.url()).pathname;
    if (peticion.method() === 'POST' && ['/acceso-web/entrar', '/recorrido.html'].includes(ruta)) {
      intentos.push({ puerta: ruta === '/recorrido.html' ? 'recorrido' : 'portal', instante: Date.now() });
    }
  });
  await ctx.route('**/*', (ruta) =>
    new URL(ruta.request().url()).origin === ORIGEN.origin ? ruta.continue() : ruta.abort(),
  );
  return ctx;
}

async function autorizar(pagina) {
  await pagina.locator('#formulario-acceso').waitFor({ state: 'visible', timeout: PLAZO_MS });
  await entrarPortal(pagina, datos);
  await pagina.locator('#acceso-recorrido, .rc-cuerpo').first().waitFor({ state: 'attached', timeout: PLAZO_MS });
  if (await pagina.locator('#acceso-recorrido').count()) {
    await pagina.locator('#acceso-recorrido input[name="clave"]').fill(datos.claveRecorrido);
    await pagina.locator('#acceso-recorrido button[type="submit"]').click();
    await pagina.locator('#acceso-recorrido').waitFor({ state: 'detached', timeout: PLAZO_MS });
  }
}

async function sondas(ctx) {
  const resultados = {};
  const rutas = [
    { ruta: '/mcp', metodo: 'POST' },
    { ruta: '/a2a', metodo: 'POST' },
    { ruta: '/.well-known/agent-card.json', metodo: 'GET' },
    { ruta: '/api/socios/v1/token', metodo: 'POST' },
  ];
  for (const { ruta, metodo } of rutas) {
    await new Promise((resolver) => setTimeout(resolver, INTERVALO_SONDA_MS));
    const respuesta = await ctx.request.fetch(new URL(ruta, ORIGEN).href, {
      method: metodo,
      maxRedirects: 0,
      ...(metodo === 'POST' ? { data: '{}', headers: { 'content-type': 'application/json' } } : {}),
    });
    assert.equal(respuesta.status(), HTTP_NO_ENCONTRADO, `El canal ${ruta} debe estar apagado`);
    resultados[`${metodo} ${ruta}`] = respuesta.status();
  }
  await new Promise((resolver) => setTimeout(resolver, INTERVALO_SONDA_MS));
  const panel = await ctx.request.get(new URL('/administracion/', ORIGEN).href, { maxRedirects: 0 });
  assert.equal(panel.status(), HTTP_REDIRECCION, 'El panel debe redirigir a Access');
  const ubicacion = panel.headers().location;
  assert.ok(ubicacion, 'La redirección de Access debe tener destino');
  const destino = new URL(ubicacion, ORIGEN);
  assert.equal(destino.protocol, 'https:');
  assert.ok(destino.hostname.endsWith('.cloudflareaccess.com'), 'Access debe usar su dominio HTTPS');
  return { canales: resultados, panel: HTTP_REDIRECCION, access: true };
}

async function probarRecorridoYQr(browser, informarPuertas) {
  const emisor = await contexto(browser);
  const receptor = await contexto(browser);
  try {
    const pagina = await emisor.newPage();
    const inesperadas = [];
    emisor.on('request', (peticion) => {
      const u = new URL(peticion.url());
      if (
        u.origin !== ORIGEN.origin ||
        (peticion.method() === 'POST' && !['/acceso-web/entrar', '/recorrido.html'].includes(u.pathname))
      ) {
        inesperadas.push('solicitud no admitida');
      }
    });
    await pagina.addInitScript(() => {
      localStorage.setItem('faro-idioma', 'es');
      localStorage.setItem('faro-modo-elegido', 'ia-off');
    });
    await pagina.goto(new URL('/recorrido.html', ORIGEN).href);
    await autorizar(pagina);
    try {
      informarPuertas({ estado: 'correcto', datos: await sondas(emisor) });
    } catch (error) {
      informarPuertas({ estado: 'fallo', diagnostico: errorSinSecretos(error, secretos) });
    }
    await prepararCopia(pagina);
    await informe(pagina, 'es');
    const qr = await probarQrIntegral({ emisora: pagina, receptor, origen: ORIGEN, autenticar: autorizar });
    assert.deepEqual(inesperadas, [], 'El emisor no transmite datos del recorrido');
    return qr;
  } finally {
    await emisor.close();
    await receptor.close();
  }
}

async function lanzar(nombre, tipo) {
  const previo = process.env.TMPDIR;
  try {
    if (nombre === 'firefox') {
      process.env.TMPDIR = '/private/tmp';
    }
    return await lanzarConPlazo(tipo, { headless: true, env: entornoParaLanzar() }, 'portal-remoto-oficial.mjs');
  } finally {
    if (previo === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = previo;
    }
  }
}

async function caso(nombre, tipo, ejecutarPortal, ejecutarQr) {
  const resultado = {
    motor: nombre,
    portal: { estado: 'pendiente' },
    qr: { estado: 'pendiente' },
    puertas: { estado: 'pendiente' },
  };
  let browser;
  try {
    browser = await lanzar(nombre, tipo);
    if (ejecutarPortal) {
      const ctx = await contexto(browser);
      try {
        resultado.portal = {
          estado: 'correcto',
          datos: await probarPortal({ contexto: ctx, origen: ORIGEN, credenciales: datos, salida, nombre }),
        };
      } catch (error) {
        resultado.portal = { estado: 'fallo', diagnostico: errorSinSecretos(error, secretos) };
      } finally {
        await ctx.close();
      }
    }
    if (ejecutarQr) {
      try {
        const qr = await probarRecorridoYQr(browser, (estado) => {
          resultado.puertas = estado;
        });
        resultado.qr = { estado: 'correcto', datos: qr };
      } catch (error) {
        resultado.qr = { estado: 'fallo', diagnostico: errorSinSecretos(error, secretos) };
      }
    }
  } catch (error) {
    resultado.arranque = { estado: 'fallo', diagnostico: errorSinSecretos(error, secretos) };
  } finally {
    await browser?.close();
  }
  return resultado;
}

const resultados = [];
for (const [nombre, tipo] of Object.entries(MOTORES)) {
  if (opciones['solo-qr'] && opciones['solo-qr'] !== nombre) {
    continue;
  }
  resultados.push(await caso(nombre, tipo, !opciones['solo-qr'], opciones['solo-qr'] ? true : nombre === 'chromium'));
}
await writeFile(
  join(salida, 'resultado.json'),
  JSON.stringify(
    {
      huellaLocalEsperada: opciones.huella,
      huellaRemotaAcreditada: false,
      alcance: opciones['solo-qr']
        ? 'QR de un motor; portal visual no repetido'
        : 'Portal tres motores; QR Chromium; otros QR pendientes por cuota',
      intentos: intentos.map(({ puerta, instante }) => ({ puerta, instante: new Date(instante).toISOString() })),
      noReintentarAntesDe: intentos.length
        ? new Date(Math.max(...intentos.map((i) => i.instante)) + VENTANA_MS).toISOString()
        : null,
      resultados,
    },
    null,
    2,
  ),
  { flag: 'wx' },
);
if (
  resultados.some(
    (r) => r.arranque || r.portal.estado === 'fallo' || r.qr.estado === 'fallo' || r.puertas.estado === 'fallo',
  )
) {
  process.exitCode = 1;
}
