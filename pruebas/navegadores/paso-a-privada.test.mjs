// Una instalación pública que pasa a privada, en un navegador real con su service worker, su CacheStorage y un perfil
// persistente. El servidor de ensayo sirve el service worker de la web local construida con un catálogo propio y cambia
// de modo durante la prueba: «publico» (inicio.html con x-faro-portal: publico), «privado» (cada página redirige al
// portal, que contesta con x-faro-portal: privado), «caido» (503) y «sin-red» (corta cada conexión). Se comprueba
// cuándo deja de servirse la copia pública: en la primera navegación con red tras el cambio, en las pestañas ya
// abiertas y al volver a abrir el navegador; un 503 o la red caída no la retiran, y sin conexión una instalación
// pública sigue como hasta ahora. Cada espera tiene un plazo menor que el del caso y dice en qué paso se quedó, y los
// recursos del caso (servidor, perfil y carpeta) se cierran también si el caso vence (recursos-del-caso.mjs).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { catalogoDeListas } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { webConstruida } from '../ayudas/web-construida.ts';
import {
  entornoDelNavegador,
  identidadAlArrancar,
  instalarServiceWorker,
  MOTORES,
  OPCIONES_DE_CONTEXTO,
  PLAZO_DE_ARRANQUE_MS,
} from './paquete-comun.mjs';
import { abrirNavegador, cerrarServidor, conPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

const WEB = new URL(`${pathToFileURL(webConstruida()).href}/`);
const FUENTE = readFileSync(new URL('service-worker.js', WEB), 'utf8');
const PAGINAS = {
  'inicio.html': 'Inicio público',
  'otra.html': 'Otra pública',
  'sin-conexion.html': 'Sin conexión',
};
const PORTAL = 'Portal de acceso';
const TEXTO_SIN_ACCESO = 'Para comprobar tu acceso hace falta conexión';
const PLAZO_MS = 30_000;
const HTTP_CORRECTO = 200;
const HTTP_REDIRECCION = 302;
const HTTP_NO_ENCONTRADO = 404;
const HTTP_NO_DISPONIBLE = 503;
const BASES = ['/', '/Mis%20documentos/A%C3%B1o%202026/'];
/** Retrasos de la sonda: dentro de su plazo y más allá. */
const DENTRO_DEL_PLAZO_MS = 300;
const MAS_ALLA_DEL_PLAZO_MS = 1500;
const RETRASOS_MS = [DENTRO_DEL_PLAZO_MS, MAS_ALLA_DEL_PLAZO_MS];
const PAUSA_MS = 100;

const html = (titulo) => `<!doctype html><html lang="es"><title>${titulo}</title><h1>${titulo}</h1></html>`;

/** El service worker publicado con su catálogo sustituido: las páginas de PAGINAS, con la huella de sus bytes. */
function trabajador() {
  const huellas = Object.entries(PAGINAS).map(([ruta, titulo]) => [
    ruta,
    createHash('sha256').update(html(titulo)).digest('hex'),
  ]);
  const catalogo = catalogoDeListas({
    ARCHIVOS: Object.keys(PAGINAS),
    BAJO_DEMANDA: [],
    PAGINAS_DE_SECCIONES: [],
    HUELLAS_DE_ARCHIVOS: huellas,
    COMPROBADOS: [],
  });
  const linea = /^var CATALOGO = .*;$/mu;
  assert.match(FUENTE, linea, 'service-worker.js ya no declara CATALOGO como espera la prueba');
  return FUENTE.replace(linea, () => `var CATALOGO = ${JSON.stringify(catalogo)};`);
}

/** La respuesta de una instalación privada: el portal, o la redirección a él. */
function responderPrivado(archivo, base, respuesta) {
  if (archivo === 'acceso') {
    respuesta.writeHead(HTTP_CORRECTO, { 'content-type': 'text/html', 'x-faro-portal': 'privado' });
    respuesta.end(html(PORTAL));
    return;
  }
  respuesta.writeHead(HTTP_REDIRECCION, { location: `${base}acceso`, 'x-faro-portal': 'privado' }).end();
}

/** La respuesta de una instalación pública: la página, con x-faro-portal: publico en inicio.html, como el servidor. */
function responderPublico(archivo, respuesta) {
  const titulo = PAGINAS[archivo];
  if (!titulo) {
    respuesta.writeHead(HTTP_NO_ENCONTRADO).end();
    return;
  }
  respuesta.writeHead(HTTP_CORRECTO, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...(archivo === 'inicio.html' ? { 'x-faro-portal': 'publico' } : {}),
  });
  respuesta.end(html(titulo));
}

/** La respuesta de la web en el modo del servidor: «caido», «privado» o «publico». */
function responderSegunElModo(modo, archivo, base, respuesta) {
  if (modo === 'caido') {
    respuesta.writeHead(HTTP_NO_DISPONIBLE, { 'content-type': 'text/plain' }).end('caído');
  } else if (modo === 'privado') {
    responderPrivado(archivo, base, respuesta);
  } else {
    responderPublico(archivo, respuesta);
  }
}

/**
 * Lo que ha visto el servidor de cada archivo: las peticiones recibidas y las respondidas enteras, en una línea. Si la
 * instalación no termina, dice si las peticiones no llegaron o si llegaron, se respondieron y no se guardaron.
 *
 * @param {Map<string, { recibidas: number, respondidas: number }>} peticiones - Lo anotado por archivo.
 * @returns {string}
 */
function lasPeticiones(peticiones) {
  if (peticiones.size === 0) {
    return 'el servidor no ha recibido ninguna';
  }
  return [...peticiones]
    .map(([archivo, { recibidas, respondidas }]) => `${archivo}: ${recibidas} recibidas, ${respondidas} respondidas`)
    .join('; ');
}

/**
 * Un servidor propio en un puerto efímero, con su modo cambiable; anota cada petición de inicio.html que no es una
 * navegación (la sonda del service worker), a la que puede retrasar como una red lenta, y, por archivo, cada petición
 * recibida y respondida (lasPeticiones).
 */
async function abrirServidor(base) {
  const estado = { modo: 'publico', sondas: 0, retrasoDeLaSonda: 0, sondaPendiente: null, peticiones: new Map() };
  const codigo = trabajador();
  const servidor = createServer(async (peticion, respuesta) => {
    const modoAlRecibir = estado.modo;
    const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
    const archivo = ruta.startsWith(base) ? ruta.slice(base.length) : '';
    const anotada = estado.peticiones.get(ruta) ?? { recibidas: 0, respondidas: 0 };
    estado.peticiones.set(ruta, anotada);
    anotada.recibidas++;
    respuesta.on('finish', () => {
      anotada.respondidas++;
    });
    if (modoAlRecibir === 'sin-red') {
      respuesta.destroy();
      return;
    }
    if (archivo === 'service-worker.js') {
      respuesta.writeHead(HTTP_CORRECTO, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      respuesta.end(codigo);
      return;
    }
    if (archivo === 'inicio.html' && peticion.headers['sec-fetch-mode'] !== 'navigate') {
      estado.sondas++;
      await estado.sondaPendiente;
      await esperar(estado.retrasoDeLaSonda);
    }
    responderSegunElModo(modoAlRecibir, archivo, base, respuesta);
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  return { servidor, estado, origen: `http://127.0.0.1:${servidor.address().port}${base}` };
}

/**
 * El perfil persistente de `motor` en `carpeta`, registrado en los recursos del caso: al volver a abrirlo siguen el
 * service worker y las copias.
 */
function abrirPerfil(recursos, motor, carpeta) {
  return abrirNavegador(recursos, `el navegador ${motor} con su perfil`, () =>
    conPlazo(
      MOTORES[motor].launchPersistentContext(join(carpeta, 'perfil'), {
        headless: true,
        timeout: PLAZO_DE_ARRANQUE_MS,
        ...OPCIONES_DE_CONTEXTO,
        ...identidadAlArrancar(motor),
        env: entornoDelNavegador(carpeta),
      }),
      PLAZO_DE_ARRANQUE_MS,
      `el navegador ${motor} no llegó a arrancar con su perfil`,
    ),
  );
}

/** Una pestaña: la que abre el perfil o una nueva. */
const pestana = async (perfil) =>
  perfil.pages()[0] ?? (await conPlazo(perfil.newPage(), PLAZO_MS, 'no se pudo abrir una pestaña nueva'));

/** La marca del modo de la instalación, leída desde la página (modo.js). */
const marca = (pagina) =>
  conPlazo(
    pagina.evaluate(async () => {
      const almacen = await caches.open(`faro-modo:${new URL('./', location.href).href}`);
      return (await almacen.match(new URL('modo-de-la-instalacion', location.href).href))?.text() ?? null;
    }),
    PLAZO_MS,
    'la marca del modo de la instalación no se pudo leer en la página',
  );

/** Navega y devuelve el título, el estado y el tiempo que ha tardado. */
async function navegar(pagina, url) {
  const inicio = performance.now();
  /** @type {number | undefined} */
  let estado;
  try {
    estado = (await pagina.goto(url, { waitUntil: 'load', timeout: PLAZO_MS }))?.status();
  } catch (error) {
    // WebKit cuenta como otra navegación la redirección al portal, que el service worker entrega tal cual.
    if (!String(error).includes('interrupted by another navigation')) {
      throw error;
    }
    await pagina.waitForURL((destino) => destino.pathname.endsWith('/acceso'), { timeout: PLAZO_MS });
    await pagina.waitForLoadState('load');
  }
  const titulo = await conPlazo(pagina.title(), PLAZO_MS, `el título de ${url} no se pudo leer`);
  return { titulo, estado, ms: performance.now() - inicio };
}

/** Espera a que la marca sea `esperada` (la sonda en segundo plano puede llegar después de la página). */
async function esperarMarca(pagina, esperada) {
  const limite = performance.now() + PLAZO_MS;
  while ((await marca(pagina)) !== esperada) {
    assert.ok(performance.now() < limite, `la marca no llega a ser ${esperada}`);
    await esperar(PAUSA_MS);
  }
}

/** Pública y con red: la copia, con una sonda por navegación; (e) sin red y (d) con un 503, igual que ahora. */
async function fasePublica({ motor, base, estado, origen }, a) {
  const sondasAntes = estado.sondas;
  const publica = await navegar(a, `${origen}otra.html`);
  assert.equal(publica.titulo, PAGINAS['otra.html']);
  assert.notEqual(await marca(a), 'privada');
  const sondas = estado.sondas - sondasAntes;
  console.log(`${motor} ${base}: navegación pública con red, ${sondas} sonda(s), ${Math.round(publica.ms)} ms`);
  // Red lenta: la navegación espera a la sonda, como mucho su plazo (PLAZO_DE_LA_SONDA_MS, modo.js).
  for (const retraso of RETRASOS_MS) {
    estado.retrasoDeLaSonda = retraso;
    const lenta = await navegar(a, `${origen}otra.html`);
    assert.equal(lenta.titulo, PAGINAS['otra.html']);
    console.log(`${motor} ${base}: sonda retrasada ${retraso} ms, la navegación tarda ${Math.round(lenta.ms)} ms`);
  }
  estado.retrasoDeLaSonda = 0;
  estado.modo = 'sin-red';
  assert.equal((await navegar(a, `${origen}inicio.html`)).titulo, PAGINAS['inicio.html']);
  assert.equal((await navegar(a, `${origen}otra.html`)).titulo, PAGINAS['otra.html']);
  assert.notEqual(await marca(a), 'privada');
  estado.modo = 'caido';
  assert.equal((await navegar(a, `${origen}otra.html`)).titulo, PAGINAS['otra.html']);
  assert.notEqual(await marca(a), 'privada');
}

/** (a) La primera navegación con red tras el cambio va al portal; (b) la otra pestaña abierta, también. */
async function faseDelCambio({ motor, base, estado, origen }, a, b) {
  estado.modo = 'privado';
  const primera = await navegar(a, `${origen}otra.html`);
  assert.equal(primera.titulo, PORTAL, 'la primera navegación con red tras el cambio va al portal');
  assert.equal(await marca(a), 'privada');
  const antes = performance.now();
  await b.waitForFunction((titulo) => document.title === titulo, PORTAL, { timeout: PLAZO_MS });
  console.log(`${motor} ${base}: la otra pestaña llega al portal ${Math.round(performance.now() - antes)} ms después`);
  // Vuelve a pública solo con su evidencia, que llega en segundo plano.
  estado.modo = 'publico';
  assert.equal((await navegar(a, `${origen}inicio.html`)).titulo, PAGINAS['inicio.html']);
  await esperarMarca(a, 'publica');
  assert.equal((await navegar(a, `${origen}otra.html`)).titulo, PAGINAS['otra.html']);
}

/**
 * Pasa a privada con la sonda más lenta que su plazo: la pestaña que navega recibe primero la copia pública y después,
 * sola, acaba en el portal. Luego vuelve a pública con su evidencia.
 */
async function faseTardia({ motor, base, estado, origen }, a) {
  estado.modo = 'privado';
  const sonda = Promise.withResolvers();
  estado.sondaPendiente = sonda.promise;
  try {
    await navegar(a, `${origen}otra.html`);
    // En Firefox la navegación puede anunciar load mientras cambia el documento de la pestaña.
    // La sonda sigue retenida hasta ver el contenido completo de la copia en esa navegación.
    await a.waitForFunction(
      (titulo) => document.title === titulo && document.querySelector('h1')?.textContent === titulo,
      PAGINAS['otra.html'],
      { timeout: PLAZO_MS },
    );
  } finally {
    estado.sondaPendiente = null;
    sonda.resolve();
  }
  const antes = performance.now();
  await a.waitForFunction((titulo) => document.title === titulo, PORTAL, { timeout: PLAZO_MS });
  const ms = Math.round(performance.now() - antes);
  console.log(`${motor} ${base}: con la sonda tardía, la misma pestaña llega al portal ${ms} ms después de la copia`);
  estado.retrasoDeLaSonda = 0;
  estado.modo = 'publico';
  assert.equal((await navegar(a, `${origen}inicio.html`)).titulo, PAGINAS['inicio.html']);
  await esperarMarca(a, 'publica');
}

/**
 * (c) Pasa a privada con el navegador cerrado: al volver a abrirlo, la primera navegación va al portal; tras otra
 * reapertura, sin red, el acceso protegido necesita conexión.
 */
async function faseDeLaReapertura({ motor, estado, origen, carpeta, recursos }) {
  estado.modo = 'privado';
  // Sin finally: si falla una comprobación, el perfil lo cierra el after del caso y el fallo que se ve es el suyo.
  const perfil = await abrirPerfil(recursos, motor, carpeta);
  const c = await pestana(perfil);
  assert.equal((await navegar(c, `${origen}otra.html`)).titulo, PORTAL, 'tras reabrir, la primera navegación');
  assert.equal(await marca(c), 'privada');
  await recursos.cerrar(perfil);
  const otro = await abrirPerfil(recursos, motor, carpeta);
  const d = await pestana(otro);
  estado.modo = 'sin-red';
  const sinRed = await navegar(d, `${origen}otra.html`);
  assert.equal(sinRed.estado, HTTP_NO_DISPONIBLE);
  assert.match(await d.textContent('body'), new RegExp(TEXTO_SIN_ACCESO));
  await recursos.cerrar(otro);
}

/**
 * El ensayo de `motor` en `base`. El servidor, la carpeta y cada perfil se registran en los recursos del caso `t`:
 * se cierran al terminar, también si el caso vence con el cuerpo colgado.
 */
async function ensayo(t, motor, base) {
  const recursos = recursosDelCaso(t);
  const { estado, origen } = await recursos.abrir(
    'el servidor de ensayo',
    () => abrirServidor(base),
    ({ servidor }) => cerrarServidor(servidor),
  );
  const carpeta = await recursos.abrir(
    'la carpeta del perfil',
    () => mkdtempSync(join(realpathSync(tmpdir()), `faro-privada-${motor}-`)),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  mkdirSync(join(carpeta, 'app'));
  mkdirSync(join(carpeta, 'cache'));
  const contexto = { motor, base, estado, origen, carpeta, recursos };
  const perfil = await abrirPerfil(recursos, motor, carpeta);
  const a = await pestana(perfil);
  await instalarServiceWorker(a, origen, PLAZO_MS, () => lasPeticiones(estado.peticiones));
  const b = await conPlazo(perfil.newPage(), PLAZO_MS, 'no se pudo abrir la segunda pestaña');
  await b.goto(`${origen}otra.html`, { timeout: PLAZO_MS });
  await b.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: PLAZO_MS });
  await fasePublica(contexto, a);
  await faseDelCambio(contexto, a, b);
  await faseTardia(contexto, a);
  await recursos.cerrar(perfil);
  await faseDeLaReapertura(contexto);
}

for (const [nombre, motor] of [
  ['Chromium', 'chromium'],
  ['Firefox', 'firefox'],
  ['WebKit', 'webkit'],
]) {
  for (const base of BASES) {
    test(`${nombre}: de pública a privada, la copia deja de servirse en la primera navegación con red (${base})`, (t) =>
      ensayo(t, motor, base));
  }
}
