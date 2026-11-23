// La página del recorrido en la copia sin conexión de una instalación pública, en un navegador real con su service
// worker y su CacheStorage. El servidor de ensayo sirve el service worker de la web local construida con un catálogo y
// un paquete propios, y la página pregunta por la copia con los módulos de la web (estadoDelPaquete y estadoDeLaCopia):
// «lista» es «La copia sin conexión está lista.».
// - Si la descarga de recorrido.html falla al instalar, la copia no se anuncia lista; una navegación con red al
//   recorrido la guarda, y entonces sin red el recorrido abre desde la copia y la copia está lista.
// - La página real entregada con la sesión temporal (x-faro-recorrido: temporal) no entra en la copia y deja el
//   recorrido real anotado como protegido: sin red se ve que hace falta conexión (acceso-sin-conexion), nunca la copia.
// Cada espera tiene un plazo menor que el del caso y dice en qué paso se quedó, y los recursos del caso (servidor,
// perfil y carpeta) se cierran también si el caso vence (recursos-del-caso.mjs).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { catalogoDeListas, lineaDelValor } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
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
/** Los módulos de la web con los que la página sabe cómo va la copia; no importan nada más. */
const MODULOS = {
  'paquete-sin-conexion.js': new URL('../../web/scripts/paquete-sin-conexion.js', import.meta.url),
  'avance-de-la-preparacion.js': new URL('../../web/scripts/recorrido/avance-de-la-preparacion.js', import.meta.url),
};
const html = (titulo) => `<!doctype html><html lang="es"><title>${titulo}</title><h1>${titulo}</h1></html>`;
const PAGINAS = {
  'inicio.html': html('Inicio público'),
  'sin-conexion.html': html('Sin conexión'),
  'recorrido.html': html('Tu recorrido'),
};
const sha256 = (texto) => createHash('sha256').update(texto).digest('hex');
const CIFRAS_DEL_PAQUETE = 16;
const DATOS = '{"datos":1}';
const MANIFIESTO = JSON.stringify({ 'datos.json': { sha256: sha256(DATOS) } });
const PAQUETE = sha256(MANIFIESTO).slice(0, CIFRAS_DEL_PAQUETE);
/**
 * La disponibilidad que sirve el servidor real, en la versión pública vigente, la 4, que lleva la Encuesta
 * (secciones-autoridad-sqlite.ts). La 3 es la de las copias anteriores, sin Encuesta: con ella esta política no se
 * admite, la instalación no puede comprobar las secciones y el service worker no llega a instalarse.
 */
const SECCIONES = JSON.stringify({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: '11111111-1111-4111-8111-111111111111',
  revision: 0,
  secciones: { ...politicaSeccionesInicial(), recorrido: true },
});
const PLAZO_MS = 30_000;
const HTTP_CORRECTO = 200;
const HTTP_NO_ENCONTRADO = 404;
const HTTP_NO_DISPONIBLE = 503;
const BASES = ['/', '/Mis%20documentos/A%C3%B1o%202026/'];

/** El service worker publicado con su catálogo y su paquete sustituidos. */
function trabajador() {
  const { 'recorrido.html': recorrido, ...fijas } = PAGINAS;
  const catalogo = catalogoDeListas({
    ARCHIVOS: Object.keys(PAGINAS),
    BAJO_DEMANDA: [],
    PAGINAS_DE_SECCIONES: [['recorrido.html', sha256(recorrido)]],
    HUELLAS_DE_ARCHIVOS: Object.entries(fijas).map(([ruta, cuerpo]) => [ruta, sha256(cuerpo)]),
    COMPROBADOS: [],
  });
  let codigo = FUENTE;
  for (const [nombre, valor] of [
    ['CATALOGO', catalogo],
    ['PAQUETE', PAQUETE],
  ]) {
    assert.equal(codigo.match(lineaDelValor(nombre))?.length, 1, `service-worker.js no declara ${nombre} una vez`);
    codigo = codigo.replace(lineaDelValor(nombre), () => `var ${nombre} = ${JSON.stringify(valor)};`);
  }
  return codigo;
}

/** Lo que entrega la web, salvo recorrido.html: la página, la política de las secciones o el paquete. */
function responderLaWeb(archivo, respuesta) {
  const fijas = {
    'secciones-v3.json': ['application/json', SECCIONES],
    [`paquete/${PAQUETE}/manifiesto.json`]: ['application/json', MANIFIESTO],
    [`paquete/${PAQUETE}/datos.json`]: ['application/json', DATOS],
  };
  const [tipo, cuerpo] = fijas[archivo] ?? (PAGINAS[archivo] ? ['text/html; charset=utf-8', PAGINAS[archivo]] : []);
  if (cuerpo === undefined) {
    respuesta.writeHead(HTTP_NO_ENCONTRADO).end();
    return;
  }
  respuesta.writeHead(HTTP_CORRECTO, {
    'content-type': tipo,
    'cache-control': 'no-store',
    ...(archivo === 'inicio.html' ? { 'x-faro-portal': 'publico' } : {}),
  });
  respuesta.end(cuerpo);
}

/** La ruta pedida desde `base`; vacía si es de fuera. */
function archivoDe(peticion, base) {
  const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
  return ruta.startsWith(base) ? ruta.slice(base.length) : '';
}

/** Un guion, sin la caché HTTP. */
function responderGuion(respuesta, cuerpo) {
  respuesta.writeHead(HTTP_CORRECTO, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
  respuesta.end(cuerpo);
}

/** recorrido.html según `recorrido`: «caido» (503), «real» o «temporal» (con x-faro-recorrido: temporal). */
function responderElRecorrido(recorrido, respuesta) {
  if (recorrido === 'caido') {
    respuesta.writeHead(HTTP_NO_DISPONIBLE, { 'content-type': 'text/plain' }).end('caído');
    return;
  }
  respuesta.writeHead(HTTP_CORRECTO, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...(recorrido === 'temporal' ? { 'x-faro-recorrido': 'temporal' } : {}),
  });
  respuesta.end(PAGINAS['recorrido.html']);
}

/**
 * Un servidor propio en un puerto efímero. `estado.recorrido` es lo que da recorrido.html (responderElRecorrido);
 * con `estado.sinRed`, corta cada conexión a la web. Los módulos de la página se sirven siempre: no son de la web, sino
 * de la prueba.
 */
async function abrirServidor(base, recorrido) {
  const estado = { recorrido, sinRed: false, peticionesDelRecorrido: 0 };
  const codigo = trabajador();
  const servidor = createServer((peticion, respuesta) => {
    const archivo = archivoDe(peticion, base);
    const modulo = MODULOS[archivo.slice('modulos/'.length)];
    if (archivo.startsWith('modulos/') && modulo) {
      responderGuion(respuesta, readFileSync(modulo));
    } else if (estado.sinRed) {
      respuesta.destroy();
    } else if (archivo === 'service-worker.js') {
      responderGuion(respuesta, codigo);
    } else if (archivo === 'recorrido.html') {
      estado.peticionesDelRecorrido++;
      responderElRecorrido(estado.recorrido, respuesta);
    } else {
      responderLaWeb(archivo, respuesta);
    }
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  return { servidor, estado, origen: `http://127.0.0.1:${servidor.address().port}${base}` };
}

/** El perfil persistente de `motor` en `carpeta`, registrado en los recursos del caso. */
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

/**
 * Lo que la página del recorrido dice de la copia con el motor ya listo (preparacion.js): la pide
 * (prepararPaqueteSinConexion), escucha cómo ha quedado (escucharLaCopia) y la lee con estadoDeLaCopia: «lista» o
 * «empezar».
 */
const estadoDeLaCopia = (pagina, origen) =>
  conPlazo(
    pagina.evaluate(async (modulos) => {
      const { escucharLaCopia, prepararPaqueteSinConexion } = await import(`${modulos}paquete-sin-conexion.js`);
      const { estadoDeLaCopia: estado } = await import(`${modulos}avance-de-la-preparacion.js`);
      const copia = await new Promise((resolver) => {
        // Solo ESTADO_DEL_PAQUETE, sin cifras, cuenta cómo ha quedado.
        const dejar = escucharLaCopia((avance) => {
          if (avance.archivos === null) {
            dejar();
            resolver(avance);
          }
        });
        void prepararPaqueteSinConexion();
      });
      return estado({ copia, listo: true });
    }, `${origen}modulos/`),
    PLAZO_MS,
    'la página no llegó a saber cómo ha quedado la copia sin conexión (escucharLaCopia)',
  );

/** En la página: si la copia de la web tiene recorrido.html. */
async function tieneElRecorrido() {
  const base = new URL('./', location.href).href;
  const nombre = (await caches.keys()).find((copia) => copia.startsWith(`faro:${base}:`));
  return Boolean(nombre && (await (await caches.open(nombre)).match(new URL('recorrido.html', base).href)));
}
const enLaCopia = (pagina) =>
  conPlazo(pagina.evaluate(tieneElRecorrido), PLAZO_MS, 'no se pudo leer si recorrido.html está en la copia');

/** Navega y devuelve el título y el estado de la página que ve la persona. */
async function navegar(pagina, url) {
  const estado = (await pagina.goto(url, { waitUntil: 'load', timeout: PLAZO_MS }))?.status();
  return { titulo: await conPlazo(pagina.title(), PLAZO_MS, `el título de ${url} no se pudo leer`), estado };
}

/** Espera a que recorrido.html esté en la copia: la guarda en segundo plano la navegación (evento.waitUntil). */
async function esperarEnLaCopia(pagina) {
  await pagina.waitForFunction(tieneElRecorrido, null, { timeout: PLAZO_MS });
}

/** A-1: sin recorrido.html al instalar, la copia no está lista hasta que una navegación con red la guarda. */
async function sinElRecorridoAlInstalar({ motor, base, estado, origen }, pagina) {
  assert.equal(await enLaCopia(pagina), false, 'la instalación sigue sin recorrido.html');
  assert.equal(await estadoDeLaCopia(pagina, origen), 'empezar', 'sin recorrido.html, la copia no está lista');
  estado.recorrido = 'real';
  const conRed = await navegar(pagina, `${origen}recorrido.html`);
  assert.equal(conRed.titulo, 'Tu recorrido');
  await esperarEnLaCopia(pagina);
  estado.sinRed = true;
  const peticiones = estado.peticionesDelRecorrido;
  const sinRed = await navegar(pagina, `${origen}recorrido.html`);
  assert.equal(sinRed.titulo, 'Tu recorrido', 'sin red, el recorrido abre desde la copia');
  assert.equal(estado.peticionesDelRecorrido, peticiones, 'sin llegar al servidor');
  assert.equal(await estadoDeLaCopia(pagina, origen), 'lista');
  console.log(
    `${motor} ${base}: sin recorrido.html al instalar, «empezar»; tras navegar con red, sin red abre y «lista»`,
  );
}

/**
 * La sesión temporal: la página real con su marca se ve con red, pero no entra en la copia; el recorrido real queda
 * protegido y sin red se ve la página de estado de acceso sin conexión del service worker (503), no la copia.
 */
async function conLaSesionTemporal({ motor, base, estado, origen }, pagina) {
  const conRed = await navegar(pagina, `${origen}recorrido.html`);
  assert.equal(conRed.titulo, 'Tu recorrido', 'con red, la página real');
  assert.equal(await enLaCopia(pagina), false, 'la página de la sesión temporal no entra en la copia');
  const anunciada = await estadoDeLaCopia(pagina, origen);
  estado.sinRed = true;
  const sinRed = await navegar(pagina, `${origen}recorrido.html`);
  assert.equal(sinRed.estado, HTTP_NO_DISPONIBLE, 'sin red, la página de estado del service worker');
  assert.match(
    (await pagina.textContent('main')) ?? '',
    /Para comprobar tu acceso hace falta conexión\./,
    'sin red, hace falta conexión para el acceso: ni el recorrido ni la página de sin conexión de la copia',
  );
  assert.equal(await enLaCopia(pagina), false);
  console.log(`${motor} ${base}: sesión temporal, la copia dice «${anunciada}»; sin red, «${sinRed.titulo}»`);
}

/**
 * El ensayo de `motor` en `base`, con lo que da recorrido.html y la `fase` indicada. El servidor, la carpeta y el perfil se registran en los
 * recursos del caso `t`: se cierran al terminar, también si el caso vence con el cuerpo colgado.
 */
async function ensayo(t, { motor, base, recorrido }, fase) {
  const recursos = recursosDelCaso(t);
  const { estado, origen } = await recursos.abrir(
    'el servidor de ensayo',
    () => abrirServidor(base, recorrido),
    ({ servidor }) => cerrarServidor(servidor),
  );
  const carpeta = await recursos.abrir(
    'la carpeta del perfil',
    () => mkdtempSync(join(realpathSync(tmpdir()), `faro-recorrido-${motor}-`)),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  mkdirSync(join(carpeta, 'app'));
  mkdirSync(join(carpeta, 'cache'));
  const perfil = await abrirPerfil(recursos, motor, carpeta);
  const pagina =
    perfil.pages()[0] ?? (await conPlazo(perfil.newPage(), PLAZO_MS, 'no se pudo abrir una pestaña nueva'));
  await instalarServiceWorker(pagina, origen, PLAZO_MS);
  await fase({ motor, base, estado, origen }, pagina);
}

for (const [nombre, motor] of [
  ['Chromium', 'chromium'],
  ['Firefox', 'firefox'],
  ['WebKit', 'webkit'],
]) {
  for (const base of BASES) {
    test(`${nombre}: sin recorrido.html al instalar, la copia no está lista hasta guardarla con red (${base})`, (t) =>
      ensayo(t, { motor, base, recorrido: 'caido' }, sinElRecorridoAlInstalar));
    test(`${nombre}: la página de la sesión temporal no entra en la copia (${base})`, (t) =>
      ensayo(t, { motor, base, recorrido: 'temporal' }, conLaSesionTemporal));
  }
}
