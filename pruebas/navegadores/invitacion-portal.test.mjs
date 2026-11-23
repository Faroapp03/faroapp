/**
 * La invitación del piloto en los tres navegadores aislados, con las páginas reales de la web preparada
 * (`npm run web:preparar`, en .web-local/web): el enlace /inicio.html#invitacion=<código> pasa por la contraseña general
 * del portal (la puerta real, responderAccesoPortal), vuelve con el fragmento intacto, y la página real, con su sitio.js
 * y su invitacion.js, lo retira de la dirección, lo guarda solo en la pestaña y pone el enlace del pie. El código no
 * llega nunca al servidor: ni en las rutas, ni en las cabeceras, ni en los cuerpos. Además, en activar-acceso.html, un
 * enlace de socio pegado en la pestaña abierta (#invitacion=<id>.<secreto>) llega a su activación: la invitación del
 * piloto no lo toca.
 * Orden: npm run web:preparar && node --test pruebas/navegadores/invitacion-portal.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { entornoParaLanzar } from '../../scripts/entorno-firefox.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { responderAccesoPortal } from '../../src/plataforma/cloudflare/acceso-portal.ts';
import { paginaAcceso } from '../../src/plataforma/cloudflare/acceso-web-pagina.ts';
import { cerrarServidor, cerrarSinSustituir, lanzarConPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const CODIGO = 'PART-0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV';
const CLAVE = 'clave-general-sintetica';
const FIRMA = 'firma-sintetica-independiente-de-mas-de-32-bytes';
const LIMITE = 'limite-sintetico-independiente-de-mas-de-32-bytes';
const NAVEGADORES = [chromium, firefox, webkit];
const WEB = fileURLToPath(new URL('../../.web-local/web/', import.meta.url));
/** El estado que trae activar-acceso.html en su HTML: lo que se lee hasta que arranca el módulo de la página. */
const ESTADO_SIN_ARRANCAR = /id="activacion-estado"[^>]*>([^<]*)</u
  .exec(readFileSync(join(WEB, 'activar-acceso.html'), 'utf8'))?.[1]
  ?.trim();
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
/**
 * La disponibilidad de las secciones que el Worker sirve delante de la web (worker.ts, /secciones-v3.json), en la
 * versión pública vigente, la 4, la que lleva la Encuesta: la de una instalación nueva, con la Encuesta visible. Sin
 * ella, la página de la encuesta no sabe si está abierta y no se muestra.
 */
const SECCIONES = JSON.stringify({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: '11111111-1111-4111-8111-111111111111',
  revision: 0,
  secciones: { ...politicaSeccionesInicial(), encuesta: true },
});
/** Los caracteres del secreto de una invitación de socio (43 en base64url). */
const LONGITUD_SECRETO_SOCIO = 43;
/** Las últimas rutas que se citan si la página no vuelve del portal. */
const RUTAS_EN_EL_DIAGNOSTICO = 5;
/** Lo que se espera a cada paso de la página real. */
const PLAZO_MS = 20_000;
/** Una invitación de socio sintética: identificador y secreto, con la misma marca que la del piloto. */
const SOCIO = `11111111-1111-4111-8111-111111111111.${'A'.repeat(LONGITUD_SECRETO_SOCIO)}`;
function certificados(carpeta) {
  const clave = join(carpeta, 'clave.pem');
  const certificado = join(carpeta, 'certificado.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      clave,
      '-out',
      certificado,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(clave), cert: readFileSync(certificado) };
}

/**
 * Lo que hay tras la puerta: la disponibilidad de las secciones y la web preparada, archivo por archivo. La API no
 * está: responde 404.
 */
async function delegar(peticion) {
  const ruta = new URL(peticion.url).pathname;
  if (ruta === '/secciones-v3.json') {
    return new Response(SECCIONES, { headers: { 'content-type': TIPOS['.json'], 'cache-control': 'no-store' } });
  }
  // El punto de la encuesta del servidor real responde así a una respuesta sumada (src/encuesta/punto-publico.ts).
  if (ruta === '/encuesta/responder' && peticion.method === 'POST') {
    return Response.json({ estado: 'registrada' }, { headers: { 'cache-control': 'no-store' } });
  }
  const archivo = normalize(join(WEB, ruta));
  if (!archivo.startsWith(WEB)) {
    return new Response(null, { status: 404 });
  }
  try {
    return new Response(readFileSync(archivo), {
      headers: { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function servidorDePrueba(carpeta, registro) {
  const sesiones = new Set();
  const servidor = createServer(certificados(carpeta), async (entrada, salida) => {
    const pedazos = [];
    for await (const pedazo of entrada) {
      pedazos.push(pedazo);
    }
    const cuerpo = Buffer.concat(pedazos);
    registro.push(
      `${entrada.url ?? ''} ${Object.values(entrada.headers).flat().join(' ')} ${cuerpo.toString('latin1')}`,
    );
    const peticion = new Request(`https://127.0.0.1:${servidor.address().port}${entrada.url}`, {
      method: entrada.method,
      // Cloudflare añade la IP de quien entra; el limitador de la puerta la necesita para contar intentos.
      headers: { ...entrada.headers, 'cf-connecting-ip': '192.0.2.1' },
      ...(cuerpo.length ? { body: cuerpo } : {}),
    });
    const respuesta = await responderAccesoPortal(peticion, {
      clave: CLAVE,
      firma: FIRMA,
      claveLimite: LIMITE,
      paginaAcceso,
      registrarSesion: async (huella) => void sesiones.add(huella),
      sesionActiva: async (huella) => sesiones.has(huella),
      revocarSesion: async (huella) => void sesiones.delete(huella),
      sesionesDisponibles: async () => true,
      consumirIntento: async () => true,
      delegar,
    });
    salida.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
    salida.end(Buffer.from(await respuesta.arrayBuffer()));
  });
  return servidor;
}

/** Las respuestas de participante que se marcan en la encuesta real. */
const RESPUESTAS = [
  ['informe', 'visto'],
  ['ocupacion', 'si'],
  ['comprension', '4'],
  ['formacion', '5'],
  ['dificultad', 'nada'],
];

/**
 * Responder la encuesta real desde el enlace del pie, que la abre en otra pestaña: al registrarse, la pestaña del
 * recorrido olvida la invitación y retira su enlace, por el aviso entre pestañas. El código solo viaja en ese envío.
 */
async function responderYOlvidar(contexto, pagina, origen, registro) {
  await pagina.goto(`${origen}/inicio.html`);
  const enlace = pagina.locator('footer nav a.pie-encuesta');
  await enlace.waitFor({ timeout: PLAZO_MS });
  const [encuesta] = await Promise.all([contexto.waitForEvent('page'), enlace.click()]);
  await encuesta.locator('#encuesta-participante').waitFor({ timeout: PLAZO_MS });
  for (const [nombre, valor] of RESPUESTAS) {
    await encuesta.locator(`#encuesta-participante input[name="${nombre}"][value="${valor}"]`).check();
  }
  const antes = registro.length;
  await encuesta.locator('#encuesta-participante button[type="submit"]').click();
  await encuesta.locator('#encuesta-gracias').waitFor({ state: 'visible', timeout: PLAZO_MS });
  const envios = registro.slice(antes).filter((linea) => linea.startsWith('/encuesta/responder'));
  assert.ok(
    envios.some((linea) => linea.includes(CODIGO)),
    'El código no viajó en el envío de la encuesta',
  );
  await pagina.waitForFunction(() => sessionStorage.getItem('faro-invitacion') === null, undefined, {
    timeout: PLAZO_MS,
  });
  assert.equal(await enlace.count(), 0, 'El enlace del pie sigue en la pestaña del recorrido');
  await encuesta.close();
}

/** La activación de socios con el enlace pegado en la pestaña abierta: solo cambia el fragmento. */
async function probarActivacionPegada(pagina, origen, registro) {
  await pagina.goto(`${origen}/activar-acceso.html`);
  // El módulo de la página atiende el cambio de fragmento desde que arranca, y su primera consulta, sin invitación,
  // sustituye el estado que trae el HTML. Antes de eso, un enlace pegado en la dirección se perdería.
  await pagina.waitForFunction(
    (sinArrancar) => document.querySelector('#activacion-estado')?.textContent?.trim() !== sinArrancar,
    ESTADO_SIN_ARRANCAR,
    { timeout: PLAZO_MS },
  );
  const antes = registro.length;
  await Promise.all([
    pagina.waitForResponse((respuesta) => new URL(respuesta.url()).pathname === '/api/socios/v1/invitacion/consultar', {
      timeout: PLAZO_MS,
    }),
    pagina.evaluate((socio) => {
      location.hash = `#invitacion=${socio}`;
    }, SOCIO),
  ]);
  await pagina.waitForFunction(() => location.hash === '', undefined, { timeout: PLAZO_MS });
  const consultas = registro.slice(antes).filter((linea) => linea.includes('/invitacion/consultar'));
  assert.ok(
    consultas.some((linea) => linea.includes(SOCIO)),
    'La activación no recibió su invitación',
  );
  assert.equal(await pagina.evaluate(() => sessionStorage.getItem('faro-invitacion')), CODIGO);
}

async function probarEn(navegador, origen, registro) {
  const contexto = await navegador.newContext({ ignoreHTTPSErrors: true, locale: 'es-ES', serviceWorkers: 'block' });
  try {
    const pagina = await contexto.newPage();
    // El registro es de todo el servidor: este navegador solo mira lo que ha pedido él.
    const desde = registro.length;
    await pagina.goto(`${origen}/inicio.html#invitacion=${CODIGO}`);
    // La puerta pide la contraseña general; al entrar, vuelve a la página pedida con el mismo fragmento.
    await pagina.locator('#campo-usuario').fill('Faro');
    await pagina.locator('#continuar').click();
    await pagina.locator('#campo-clave').fill(CLAVE);
    await Promise.all([
      pagina.waitForURL(/\/inicio\.html/u, { timeout: PLAZO_MS, waitUntil: 'commit' }),
      pagina.locator('#entrar').click(),
    ]).catch((error) => {
      throw new Error(
        `No volvió a inicio.html (${pagina.url()}); últimas rutas: ${registro.slice(-RUTAS_EN_EL_DIAGNOSTICO).map((l) => l.split(' ')[0])}`,
        {
          cause: error,
        },
      );
    });
    // La página real arranca su sitio.js, que trae la invitación y pone el enlace del pie.
    const enlace = pagina.locator('footer nav a.pie-encuesta');
    await enlace.waitFor({ timeout: PLAZO_MS });
    assert.equal(new URL(pagina.url()).hash, '', 'La invitación sigue en la dirección');
    assert.equal(await pagina.evaluate(() => sessionStorage.getItem('faro-invitacion')), CODIGO);
    assert.equal(await pagina.evaluate(() => localStorage.getItem('faro-invitacion')), null);
    assert.match((await enlace.getAttribute('href')) ?? '', /^encuesta\.html#codigo=PART-/u);
    assert.equal(await enlace.getAttribute('target'), '_blank');
    assert.match((await enlace.getAttribute('aria-label')) ?? '', /otra pestaña/u);
    assert.ok(
      registro.slice(desde).every((linea) => !linea.includes(CODIGO) && !linea.includes('invitacion=')),
      'El código llegó al servidor',
    );
    await probarActivacionPegada(pagina, origen, registro);
    await responderYOlvidar(contexto, pagina, origen, registro);
  } finally {
    await contexto.close();
  }
}

test('la invitación pasa la contraseña del portal y queda solo en la pestaña, en los tres navegadores', async (t) => {
  const recursos = recursosDelCaso(t);
  const carpeta = await recursos.abrir(
    'la carpeta de los certificados',
    () => mkdtempSync(join(tmpdir(), 'faro-invitacion-')),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  const registro = [];
  try {
    const servidor = await recursos.abrir(
      'el servidor de ensayo',
      () => servidorDePrueba(carpeta, registro),
      cerrarServidor,
    );
    try {
      await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
      const origen = `https://127.0.0.1:${servidor.address().port}`;
      for (const tipo of NAVEGADORES) {
        const navegador = await lanzarConPlazo(tipo, { headless: true, env: entornoParaLanzar() }, t.name, {
          recursos,
        });
        try {
          await probarEn(navegador, origen, registro);
        } finally {
          await cerrarSinSustituir(() => recursos.cerrar(navegador), `el navegador ${tipo.name()} no se cerró`);
        }
      }
    } finally {
      await cerrarSinSustituir(() => recursos.cerrar(servidor), 'el servidor de ensayo no se cerró');
    }
  } finally {
    await cerrarSinSustituir(() => recursos.cerrar(carpeta), 'la carpeta de los certificados no se retiró');
  }
});
