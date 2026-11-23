// Una actualización que se queda sin cuota al pasar los recursos a su copia definitiva, en un navegador real con su
// CacheStorage y su ciclo de service worker. El trabajador servido es el de la web; solo se le antepone una capa que
// observa sus escrituras y rechaza una de la copia definitiva con QuotaExceededError, como haría un disco lleno.
// Cada espera tiene un plazo menor que el del caso y dice en qué paso se quedó, y los recursos del caso (servidor,
// navegador y carpeta) se cierran también si el caso vence (recursos-del-caso.mjs).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { catalogoDeListas } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { webConstruida } from '../ayudas/web-construida.ts';
import { construccionEnsayada, instalarServiceWorker, PLAZO_DE_ARRANQUE_MS } from './paquete-comun.mjs';
import { abrirNavegador, cerrarServidor, conPlazo, recursosDelCaso } from './recursos-del-caso.mjs';

/**
 * La web cuyo service worker se ensaya: la de una construcción si se indica en FARO_ENSAYO_CONSTRUCCION (su carpeta,
 * con su línea «Construcción ensayada»), o la web local construida de esta copia (npm run web:preparar). Del resto
 * de la web no se usa nada: los catálogos los sirve este ensayo.
 */
const CONSTRUCCION = process.env.FARO_ENSAYO_CONSTRUCCION;
const WEB = CONSTRUCCION
  ? new URL(`${pathToFileURL(resolve(CONSTRUCCION)).href}/web/`)
  : new URL(`${pathToFileURL(webConstruida()).href}/`);
if (CONSTRUCCION) {
  construccionEnsayada(resolve(CONSTRUCCION));
} else {
  console.log(`Service worker ensayado: el de la web local construida (${fileURLToPath(WEB)})`);
}
const FUENTE = readFileSync(new URL('service-worker.js', WEB), 'utf8');
const ACTIVAR = /^var ACTIVAR_VERSION_NUEVA = "([A-Z_]+)";$/mu.exec(FUENTE)?.[1];
const ARCHIVOS = ['inicio.html', 'sin-conexion.html', 'estilos/base.css'];
/**
 * Una imagen: el service worker la guarda en la pasada de lo complementario, después de ARCHIVOS. El servidor la sirve
 * con otros bytes en cada VERSION, para que se vea si una instalación la reescribe; con la misma VERSION, con los mismos
 * bytes, porque la VERSION sale del CATALOGO y el CATALOGO lleva su huella.
 */
const IMAGEN = 'imagenes/foto.webp';
const VERSION_ANTERIOR = '1111111111111111';
const VERSION_NUEVA = '2222222222222222';
const INICIO = '<!doctype html><title>Instalación anterior</title>';
const PLAZO_MS = 30_000;
/** Una espera en la página, con el plazo del ensayo y lo que no llegó a pasar si vence. */
const enLaPagina = (promesa, paso) => conPlazo(promesa, PLAZO_MS, paso);
const HTTP_CORRECTO = 200;
const HTTP_NO_ENCONTRADO = 404;
const CANAL = 'faro-ensayo-cuota';
const BASES = ['/', '/Mis%20documentos/A%C3%B1o%202026/'];

// Corre dentro del service worker antes que su código. Anuncia por el canal cada escritura en la copia definitiva de su
// versión y, al terminar cada intento de instalación, si quedan la provisional y la definitiva. En el modo «fallo», la
// copia definitiva tiene primero inicio.html (para que el fallo llegue con una escritura ya hecha) y la escritura de
// sin-conexion.html falla una sola vez por intento; en el modo «observar» no falla nada.
const preambulo = (version, modo) => `
  const canal = new BroadcastChannel('${CANAL}');
  const nombres = new WeakMap();
  const abrir = caches.open.bind(caches);
  caches.open = async (nombre) => {
    const copia = await abrir(nombre);
    nombres.set(copia, nombre);
    return copia;
  };
  // El mismo nombre que da service-worker.js a la copia de su versión: PREFIJO (faro:<web>:) y VERSION.
  const copiaDeLaVersion = 'faro:' + new URL('./', self.location.href).href + ':${version}';
  const provisional = copiaDeLaVersion + ':provisional';
  const fallar = '${modo}' === 'fallo';
  const guardar = Cache.prototype.put;
  let soltarResto;
  const primeraEscrita = new Promise((resolver) => { soltarResto = resolver; });
  let fallado = false;
  let provisionales = 0;
  Cache.prototype.put = async function (clave, respuesta) {
    const nombre = nombres.get(this);
    const ruta = new URL(typeof clave === 'string' ? clave : clave.url).pathname;
    if (nombre !== copiaDeLaVersion) {
      await guardar.call(this, clave, respuesta);
      if (nombre === provisional) provisionales++;
      return;
    }
    if (fallar && !ruta.endsWith('/inicio.html')) {
      // inicio.html tiene que estar ya en la copia: escrito en este intento o, si la copia ya lo tenía, desde antes
      // (entonces este intento no lo reescribe y no hay escritura que esperar).
      if (!(await this.match(new URL('inicio.html', new URL('./', self.location.href)).href))) {
        await primeraEscrita;
      }
      if (ruta.endsWith('/sin-conexion.html') && !fallado) {
        fallado = true;
        canal.postMessage({ tipo: 'cuota-definitiva', ruta, provisionales });
        throw new DOMException('cuota de ensayo', 'QuotaExceededError');
      }
    }
    await guardar.call(this, clave, respuesta);
    canal.postMessage({ tipo: 'escritura-definitiva', ruta });
    if (ruta.endsWith('/inicio.html')) soltarResto();
  };
  // Se registra antes que el del service worker: su waitUntil pasa por aquí. El anuncio de qué queda, visto desde el
  // propio service worker, va dentro de lo que espera el intento (si no, el navegador puede detenerlo antes de enviarlo),
  // y el resultado del intento no cambia.
  self.addEventListener('install', (evento) => {
    const esperar = evento.waitUntil.bind(evento);
    evento.waitUntil = (trabajo) => {
      const anunciar = async (resultado) => canal.postMessage({
        tipo: 'intento-terminado',
        resultado,
        provisional: await caches.has(provisional),
        definitiva: await caches.has(copiaDeLaVersion),
      });
      esperar(Promise.resolve(trabajo).then(
        async (valor) => { await anunciar('resuelto'); return valor; },
        async (error) => { await anunciar('rechazado'); throw error; },
      ));
    };
  });
  const saltar = self.skipWaiting.bind(self);
  self.skipWaiting = async () => { canal.postMessage({ tipo: 'skipWaiting' }); return saltar(); };
  const reclamar = self.clients.claim.bind(self.clients);
  self.clients.claim = async () => { canal.postMessage({ tipo: 'claim' }); return reclamar(); };
`;

/** Lo que sirve el servidor en cada fase: la VERSION del service worker y el modo de su preámbulo, si lleva. */
const FASES = {
  anterior: [VERSION_ANTERIOR, null],
  fallo: [VERSION_NUEVA, 'fallo'],
  reintento: [VERSION_NUEVA, null],
  // Un cambio solo del código del service worker: otros bytes con la misma VERSION y el mismo CATALOGO que la activa.
  'fallo-misma': [VERSION_ANTERIOR, 'fallo'],
  'reintento-misma': [VERSION_ANTERIOR, 'observar'],
};

/** Los datos que sirve cada fase: los de su VERSION, porque la misma VERSION es el mismo CATALOGO. */
function datosDeLaFase(fase) {
  return FASES[fase][0] === VERSION_ANTERIOR ? 'anterior' : 'nueva';
}

/** El service worker publicado con una línea generada (`var NOMBRE = <literal>;`) sustituida, que tiene que estar. */
function conValor(codigo, nombre, valor) {
  const linea = new RegExp(`^var ${nombre} = .*;$`, 'mu');
  assert.match(codigo, linea, `service-worker.js ya no declara ${nombre} como espera la prueba`);
  return codigo.replace(linea, () => `var ${nombre} = ${JSON.stringify(valor)};`);
}

/** El service worker de la fase, con su VERSION y el catálogo de esta web de ensayo, con la huella real de cada archivo. */
function trabajador(fase) {
  const [version, modo] = FASES[fase];
  const huellas = [...ARCHIVOS, IMAGEN].map((archivo) => [
    archivo,
    createHash('sha256').update(contenido(archivo, fase)[1]).digest('hex'),
  ]);
  const valores = {
    VERSION: version,
    CATALOGO: catalogoDeListas({
      ARCHIVOS: [...ARCHIVOS, IMAGEN],
      BAJO_DEMANDA: [],
      PAGINAS_DE_SECCIONES: [],
      HUELLAS_DE_ARCHIVOS: huellas,
      COMPROBADOS: [],
    }),
  };
  const propio = Object.entries(valores).reduce((codigo, [nombre, valor]) => conValor(codigo, nombre, valor), FUENTE);
  return modo ? `${preambulo(version, modo)}\n${propio}` : propio;
}

/** El cuerpo y el tipo de cada ruta de la web de ensayo, o null si no existe. */
function contenido(ruta, fase) {
  if (ruta === 'service-worker.js') {
    return ['text/javascript', trabajador(fase)];
  }
  if (ruta === IMAGEN) {
    return ['image/webp', `imagen ${datosDeLaFase(fase)}`];
  }
  if (ARCHIVOS.includes(ruta)) {
    return [
      ruta.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8',
      ruta === 'inicio.html' ? INICIO : `contenido ${ruta}`,
    ];
  }
  return null;
}

/** Un servidor propio en un puerto efímero; «sin-red» corta cada conexión como una red caída. */
async function abrirServidor(base) {
  let fase = 'anterior';
  const servidor = createServer((peticion, respuesta) => {
    const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
    if (fase === 'sin-red') {
      respuesta.destroy();
      return;
    }
    const encontrado = ruta.startsWith(base) ? contenido(ruta.slice(base.length), fase) : null;
    if (!encontrado) {
      respuesta.writeHead(HTTP_NO_ENCONTRADO).end();
      return;
    }
    respuesta.writeHead(HTTP_CORRECTO, {
      'content-type': encontrado[0],
      'cache-control': 'no-store',
      'x-faro-portal': 'publico',
    });
    respuesta.end(encontrado[1]);
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const origen = `http://127.0.0.1:${servidor.address().port}${base}`;
  return { servidor, origen, cambiar: (valor) => (fase = valor) };
}

/** La versión anterior instalada y controlando la página, con la escucha del canal y del ciclo ya puesta. */
async function instalarAnterior(pagina, origen) {
  await instalarServiceWorker(pagina, origen, PLAZO_MS);
  await enLaPagina(
    pagina.evaluate(async (canal) => {
      window.registro = await navigator.serviceWorker.getRegistration();
      window.controlAnterior = navigator.serviceWorker.controller;
      window.eventos = [];
      window.estados = [];
      window.canal = new BroadcastChannel(canal);
      window.canal.onmessage = (evento) => window.eventos.push(evento.data);
      navigator.serviceWorker.addEventListener('controllerchange', () => window.estados.push('controllerchange'));
    }, CANAL),
    'la escucha del canal y del ciclo del service worker no quedó puesta',
  );
}

/** Pide la versión que falla y espera a que el navegador la descarte. */
async function provocarFallo(pagina) {
  await enLaPagina(
    pagina.evaluate(async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing;
        nuevo?.addEventListener('statechange', () => window.estados.push(nuevo.state));
      });
      await registro.update();
    }),
    'la actualización del service worker que falla no se pudo pedir (registration.update)',
  );
  // El navegador puede lanzar más de una instalación de la versión que falla (por ejemplo, una actualización pendiente
  // de la recarga anterior): se espera a que cada rechazo tenga su anuncio de fin de intento y no quede ninguna en curso.
  await pagina.waitForFunction(
    () => {
      const rechazos = window.eventos.filter((evento) => evento.tipo === 'cuota-definitiva').length;
      const terminados = window.eventos.filter((evento) => evento.tipo === 'intento-terminado').length;
      return rechazos > 0 && terminados === rechazos && !window.registro.installing;
    },
    null,
    { timeout: PLAZO_MS },
  );
  return enLaPagina(
    pagina.evaluate(async () => ({
      mismoControlador: navigator.serviceWorker.controller === window.controlAnterior,
      estados: window.estados,
      eventos: [...window.eventos],
      nombres: await caches.keys(),
    })),
    'no se pudo leer cómo quedó el intento fallido',
  );
}

/**
 * Lo que tiene que quedar tras cada intento fallido, según lo anuncia el propio service worker al terminar: sin
 * provisional, y la copia definitiva borrada si la creó el intento o conservada si ya era la de la versión activa.
 */
function comprobarFallo(fallo, { definitivaQueda }) {
  assert.equal(fallo.mismoControlador, true, 'la página sigue con el trabajador anterior');
  assert.ok(fallo.eventos.some((evento) => evento.tipo === 'escritura-definitiva'));
  const rechazos = fallo.eventos.filter((evento) => evento.tipo === 'cuota-definitiva');
  const terminados = fallo.eventos.filter((evento) => evento.tipo === 'intento-terminado');
  // Cada intento fallido se rechaza una sola vez, y siempre con la copia provisional ya entera: el fallo es de la
  // copia definitiva, no de la descarga.
  assert.ok(rechazos.length > 0);
  assert.ok(rechazos.every((rechazo) => rechazo.provisionales === ARCHIVOS.length));
  const esperado = {
    tipo: 'intento-terminado',
    resultado: 'rechazado',
    provisional: false,
    definitiva: definitivaQueda,
  };
  assert.deepEqual(
    terminados,
    rechazos.map(() => esperado),
  );
  assert.ok(!fallo.eventos.some((evento) => evento.tipo === 'claim' || evento.tipo === 'skipWaiting'));
  assert.ok(!fallo.estados.includes('activated') && !fallo.estados.includes('controllerchange'));
  assert.ok(fallo.nombres.some((nombre) => nombre.endsWith(`:${VERSION_ANTERIOR}`)));
}

/** Las rutas y los cuerpos de la copia de una versión, leídos desde la página. */
function leerCopia(pagina, version) {
  return enLaPagina(
    pagina.evaluate(
      async ({ version, archivos }) => {
        const copia = await caches.open(`faro:${new URL('./', location.href).href}:${version}`);
        const claves = (await copia.keys()).map((peticion) => new URL(peticion.url).pathname).sort();
        const cuerpos = await Promise.all(archivos.map(async (ruta) => (await copia.match(ruta))?.text() ?? null));
        return { claves, cuerpos };
      },
      { version, archivos: [...ARCHIVOS, IMAGEN] },
    ),
    `la copia de la versión ${version} no se pudo leer`,
  );
}

/** Un nuevo intento sin fallo deja la versión esperando; devuelve su copia. */
async function reintentar(pagina, version) {
  await enLaPagina(
    pagina.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration()).update();
    }),
    'el nuevo intento de actualización no se pudo pedir (registration.update)',
  );
  // waitForFunction necesita una condición síncrona: una función async devuelve una promesa, que siempre es verdadera.
  await pagina.waitForFunction(() => Boolean(window.registro.waiting), null, { timeout: PLAZO_MS });
  return leerCopia(pagina, version);
}

async function activarNueva(pagina, activar) {
  await enLaPagina(
    pagina.evaluate(async (tipo) => {
      (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: tipo });
    }, activar),
    'no se pudo pedir que se active la versión que espera',
  );
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== window.controlAnterior, null, {
    timeout: PLAZO_MS,
  });
}

/**
 * Cada motor con su carpeta temporal propia, como en ensayo.ts: Firefox no arranca sin MOZ_APP_DATA y
 * MOZ_LOCAL_APP_DATA propios. Solo pasan las variables de entorno imprescindibles. La carpeta y el navegador se
 * registran en los recursos del caso; devuelve una página de un contexto nuevo.
 */
async function lanzar(recursos, motor) {
  const temporal = await recursos.abrir(
    'la carpeta del navegador',
    () => mkdtempSync(join(realpathSync(tmpdir()), 'faro-cuota-')),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH'];
  const entorno = Object.fromEntries(
    permitidas.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  const env = { ...entorno, MOZ_APP_DATA: join(temporal, 'app'), MOZ_LOCAL_APP_DATA: join(temporal, 'cache') };
  const navegador = await abrirNavegador(recursos, `el navegador ${motor.name()}`, () =>
    conPlazo(
      motor.launch({ headless: true, env, timeout: PLAZO_DE_ARRANQUE_MS }),
      PLAZO_DE_ARRANQUE_MS,
      `el navegador ${motor.name()} no llegó a arrancar`,
    ),
  );
  const contexto = await enLaPagina(navegador.newContext(), 'no se pudo abrir un contexto del navegador');
  return enLaPagina(contexto.newPage(), 'no se pudo abrir una pestaña nueva');
}

/** El servidor de ensayo de `base`, registrado en los recursos del caso. */
function servidorDelCaso(recursos, base) {
  return recursos.abrir(
    'el servidor de ensayo',
    () => abrirServidor(base),
    ({ servidor }) => cerrarServidor(servidor),
  );
}

async function ensayo(t, motor, base) {
  assert.ok(ACTIVAR, 'service-worker.js ya no declara ACTIVAR_VERSION_NUEVA como espera la prueba');
  const recursos = recursosDelCaso(t);
  const { origen, cambiar } = await servidorDelCaso(recursos, base);
  const pagina = await lanzar(recursos, motor);
  await instalarAnterior(pagina, origen);
  cambiar('fallo');
  comprobarFallo(await provocarFallo(pagina), { definitivaQueda: false });
  cambiar('sin-red');
  const sinRed = await enLaPagina(
    pagina.evaluate(async () => (await fetch('inicio.html')).text()),
    'inicio.html no se pudo pedir sin red',
  );
  assert.equal(sinRed, INICIO);
  cambiar('reintento');
  const copia = await reintentar(pagina, VERSION_NUEVA);
  assert.deepEqual(copia.claves, [...ARCHIVOS, IMAGEN].map((ruta) => new URL(ruta, origen).pathname).sort());
  assert.deepEqual(copia.cuerpos, [
    INICIO,
    'contenido sin-conexion.html',
    'contenido estilos/base.css',
    'imagen nueva',
  ]);
  await activarNueva(pagina, ACTIVAR);
  cambiar('sin-red');
  const respuesta = await pagina.goto(`${origen}inicio.html`);
  assert.equal(respuesta?.status(), HTTP_CORRECTO);
  assert.equal(await enLaPagina(pagina.title(), 'el título de inicio.html no se pudo leer'), 'Instalación anterior');
}

/** Las rutas escritas en la copia definitiva según los anuncios del preámbulo. */
const escritas = (eventos) =>
  eventos.filter((evento) => evento.tipo === 'escritura-definitiva').map((evento) => evento.ruta);

/**
 * Una instalación que solo cambia el código del service worker comparte VERSION y nombre de copia con la versión activa.
 * A esa copia le faltan dos recursos (como si el almacenamiento los hubiera perdido): la instalación falla a mitad sin
 * borrarla ni reescribir lo que tiene, y un nuevo intento solo añade lo que sigue faltando. Su imagen, que el servidor
 * sirve con los mismos bytes, no se escribe en ningún intento (escritas).
 */
async function ensayoMismaVersion(t, motor, base) {
  const recursos = recursosDelCaso(t);
  const { origen, cambiar } = await servidorDelCaso(recursos, base);
  const pagina = await lanzar(recursos, motor);
  await instalarAnterior(pagina, origen);
  const ruta = (archivo) => new URL(archivo, origen).pathname;
  await enLaPagina(
    pagina.evaluate(async (version) => {
      const copia = await caches.open(`faro:${new URL('./', location.href).href}:${version}`);
      await copia.delete('inicio.html');
      await copia.delete('sin-conexion.html');
    }, VERSION_ANTERIOR),
    'no se pudieron quitar dos recursos de la copia activa',
  );
  cambiar('fallo-misma');
  const fallo = await provocarFallo(pagina);
  comprobarFallo(fallo, { definitivaQueda: true });
  assert.deepEqual([...new Set(escritas(fallo.eventos))], [ruta('inicio.html')]);
  const tras = await leerCopia(pagina, VERSION_ANTERIOR);
  assert.deepEqual(tras.claves, [ruta('estilos/base.css'), ruta('inicio.html'), ruta(IMAGEN)].sort());
  assert.deepEqual(tras.cuerpos, [INICIO, null, 'contenido estilos/base.css', 'imagen anterior']);
  const antes = fallo.eventos.length;
  cambiar('reintento-misma');
  const copia = await reintentar(pagina, VERSION_ANTERIOR);
  const eventos = await enLaPagina(
    pagina.evaluate(() => window.eventos),
    'no se pudieron leer los anuncios del service worker',
  );
  assert.deepEqual(escritas(eventos.slice(antes)), [ruta('sin-conexion.html')]);
  assert.deepEqual(copia.claves, [...ARCHIVOS, IMAGEN].map(ruta).sort());
  assert.deepEqual(copia.cuerpos, [
    INICIO,
    'contenido sin-conexion.html',
    'contenido estilos/base.css',
    'imagen anterior',
  ]);
}

for (const [nombre, motor] of [
  ['Chromium', chromium],
  ['Firefox', firefox],
  ['WebKit', webkit],
]) {
  for (const base of BASES) {
    test(`${nombre}: sin cuota en la copia definitiva, sigue la versión anterior y el reintento la completa (${base})`, (t) =>
      ensayo(t, motor, base));
    test(`${nombre}: misma VERSION que la activa, un fallo no borra ni reescribe su copia y el reintento la completa (${base})`, (t) =>
      ensayoMismaVersion(t, motor, base));
  }
}
