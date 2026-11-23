// El primer paso del recorrido real cuando el motor del dispositivo no puede arrancar, en Chromium, Firefox y WebKit,
// con la web local construida (npm run web:preparar), su service worker y su copia del paquete. La página crea el
// Worker del motor de siempre, precedido por un parche que solo existe en esta prueba (/prueba/…):
// - «retener»: IndexedDB guarda la clave de firma, pero el Worker no se entera hasta que la prueba lo suelta, como un
//   almacenamiento que no contesta de forma asíncrona. A los 15 s, Faro dice «Faro no ha podido prepararse. Vuelve a
//   intentarlo.» con su botón; soltado el almacenamiento, «Volver a intentarlo» responde y la clave se ha guardado
//   una sola vez.
// - «mudo»: el Worker no atiende ninguna petición, sin gastar CPU. A los 120 s el cliente lo termina, Faro dice lo mismo
//   y «Volver a intentarlo» responde con un Worker nuevo.
// No prueba un bloqueo síncrono del hilo del Worker (el llavero de WebKit sin HOME): ahí no salta ningún temporizador
// del Worker, y lo que cuenta es el plazo de 120 s de la página. Solo 127.0.0.1, sin red.
// Es un ensayo con orden propia, fuera de la batería de navegador de `npm run verificar`, cuyo plazo total (600 s) no
// alcanza para sus esperas (scripts/pruebas-mjs.ts, ENSAYOS_CON_ORDEN). Con la web local preparada:
//   npm run probar:arranque-bloqueado                    (los tres motores)
//   npm run probar:arranque-bloqueado -- --motor chromium  (uno o varios, con --motor repetido)
// Dura unos 140 s por motor (medido en Chromium: 17,5 s el caso de la clave y 122 s el del Worker mudo), así que unos
// 7 minutos con los tres.
// En WebKit necesita el HOME habitual, con su llavero: con un HOME aislado sin llavero, el `put` real de la clave se
// bloquea en WebKit antes de que el parche pueda avisar, y el caso falla por el entorno, no por Faro. Si los demás
// motores corren con un HOME aislado, WebKit se ejecuta aparte, con el HOME de la sesión:
//   npm run probar:arranque-bloqueado -- --motor webkit
// Los tiempos se miden desde que la petición llega al Worker (el aviso «peticion» del parche): los plazos del producto
// empiezan después.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { test } from 'node:test';
import { politicaSeccionesInicial, VERSION_SECCIONES_PUBLICAS } from '../../src/administracion/secciones-web.js';
import { webConstruida } from '../ayudas/web-construida.ts';
import { argumentos, arrancar, contextoLimpio, PRIMER_MENSAJE, preferenciasDelRecorrido } from './paquete-comun.mjs';
import { cerrarServidor, recursosDelCaso } from './recursos-del-caso.mjs';

const WEB = webConstruida();
const TEXTO_DEL_BLOQUEO = 'Faro no ha podido prepararse. Vuelve a intentarlo.';
const REINTENTAR = 'Volver a intentarlo';
const CANAL = 'faro-prueba-arranque';
/** Los plazos del producto que se observan: la clave de firma (secreto-firma.js) y el Worker (cliente.js). */
const ESPERA_DEL_ALMACEN_MS = 15_000;
const PLAZO_DEL_WORKER_MS = 120_000;
/** Lo que se admite de más sobre cada plazo, por los relojes del navegador con taskpolicy -b. */
const HOLGURA_MS = 10_000;
/** Lo que puede tardar una petición en llegar al Worker desde que el cliente la manda y empieza su plazo. */
const ANTES_DE_LLEGAR_MS = 1000;
/** La copia del paquete y la respuesta del motor en un servidor local, sin red limitada. */
const PLAZO_DE_LA_COPIA_MS = 120_000;
const PLAZO_DE_LA_PRUEBA_MS = 600_000;
const HTTP_CORRECTO = 200;
const HTTP_NO_ENCONTRADO = 404;
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
// La política va en la versión que emite el servidor real (secciones-autoridad-sqlite.ts): incluye la Encuesta, que el
// lector rechaza en la versión anterior.
const SECCIONES = JSON.stringify({
  version: VERSION_SECCIONES_PUBLICAS,
  autoridad: '11111111-1111-4111-8111-111111111111',
  revision: 0,
  secciones: { ...politicaSeccionesInicial(), recorrido: true },
});
/** Lo que deja elegir el motor cuando responde (paquete-comun.mjs, RESPUESTA_DEL_MOTOR), sin las salidas del fallo. */
const RESPUESTA_DEL_MOTOR = [
  '.rc-eleccion-acciones > button.rc-boton-principal:not([disabled]):visible',
  '.rc-acciones > button.rc-boton-principal[type="submit"]:not([disabled]):visible',
  '#sugerencias:not([hidden]) .rc-sugerencia:not([disabled]):visible',
  '.rc-cuerpo[data-paso="3"]',
].join(', ');
const SALIDAS_DEL_FALLO = /Volver a intentarlo|Buscar en la clasificación oficial/u;

/**
 * El parche del Worker para `modo`. Se ejecuta antes que worker.js (lo importa primero /prueba/worker.js) y cuenta por
 * CANAL lo que pasa.
 */
const parche = (modo) => `
const canal = new BroadcastChannel('${CANAL}');
const modo = '${modo}';
// Cada escritura de la clave se cuenta en todos los modos; en «retener», su aviso al Worker espera a que se suelte.
let retener = modo === 'retener';
const retenidas = [];
canal.addEventListener('message', ({ data }) => {
  if (data === 'soltar') {
    retener = false;
    for (const avisar of retenidas.splice(0)) avisar();
  }
});
const guardar = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function (...argumentos) {
  const real = guardar.apply(this, argumentos);
  canal.postMessage({ tipo: 'put', retenida: retener, en: Date.now() });
  if (!retener) return real;
  // La escritura sigue su curso en IndexedDB; lo que se retiene es el aviso al Worker.
  const vista = { result: undefined, error: null, onsuccess: null, onerror: null };
  real.onsuccess = () => retenidas.push(() => { vista.result = real.result; vista.onsuccess?.(); });
  real.onerror = (evento) => retenidas.push(() => { vista.error = real.error; vista.onerror?.(evento); });
  return vista;
};
// Cada petición que llega al Worker se cuenta antes de atenderla; en «mudo», no se atiende.
const escuchar = globalThis.addEventListener.bind(globalThis);
globalThis.addEventListener = (tipo, oyente, opciones) => {
  if (tipo !== 'message') return escuchar(tipo, oyente, opciones);
  escuchar('message', () => canal.postMessage({ tipo: 'peticion', en: Date.now() }));
  if (modo !== 'mudo') escuchar('message', oyente, opciones);
};
`;

/** Lo que se sirve: la web local, la política de secciones con el recorrido y, en /prueba/, el Worker con su parche. */
async function responder(peticion, respuesta) {
  const direccion = new URL(peticion.url, 'http://127.0.0.1');
  const ruta = decodeURIComponent(direccion.pathname);
  if (ruta === '/prueba/worker.js') {
    const modo = direccion.searchParams.get('modo') ?? '';
    const codigo = `import '/prueba/parche.js?modo=${encodeURIComponent(modo)}';\nimport '/scripts/motor-local/worker.js';\n`;
    respuesta.writeHead(HTTP_CORRECTO, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' }).end(codigo);
    return;
  }
  if (ruta === '/prueba/parche.js') {
    const modo = direccion.searchParams.get('modo') ?? '';
    respuesta.writeHead(HTTP_CORRECTO, { 'content-type': TIPOS['.js'], 'cache-control': 'no-store' }).end(parche(modo));
    return;
  }
  if (ruta === '/secciones-v3.json') {
    respuesta.writeHead(HTTP_CORRECTO, { 'content-type': TIPOS['.json'], 'cache-control': 'no-store' }).end(SECCIONES);
    return;
  }
  const archivo = normalize(join(WEB, ruta === '/' ? 'inicio.html' : ruta));
  if (!archivo.startsWith(WEB)) {
    respuesta.writeHead(HTTP_NO_ENCONTRADO).end();
    return;
  }
  try {
    const cuerpo = await readFile(archivo);
    respuesta
      .writeHead(HTTP_CORRECTO, { 'content-type': TIPOS[extname(archivo)] ?? 'application/octet-stream' })
      .end(cuerpo);
  } catch {
    respuesta.writeHead(HTTP_NO_ENCONTRADO).end();
  }
}

/**
 * Antes de cada carga: la página crea el Worker del motor con el parche del modo que diga `__faroModoDelWorker`, y
 * apunta lo que cuenta el parche por el canal.
 */
function conElParche(canal) {
  globalThis.__faroModoDelWorker = sessionStorage.getItem('faro-prueba-modo') ?? '';
  globalThis.__faroAvisos = [];
  new BroadcastChannel(canal).addEventListener('message', ({ data }) => globalThis.__faroAvisos.push(data));
  const Original = globalThis.Worker;
  globalThis.Worker = class extends Original {
    constructor(url, opciones) {
      const delMotor = String(url).includes('/scripts/motor-local/worker.js');
      super(delMotor ? `/prueba/worker.js?modo=${globalThis.__faroModoDelWorker}` : url, opciones);
    }
  };
}

/** El servidor local del caso, registrado en sus recursos (cerrarServidor), y su origen. */
async function servidorDelCaso(recursos) {
  const servidor = await recursos.abrir(
    'el servidor de ensayo',
    async () => {
      const nuevo = createServer((peticion, respuesta) => {
        responder(peticion, respuesta).catch(() => respuesta.destroy());
      });
      nuevo.listen(0, '127.0.0.1');
      await once(nuevo, 'listening');
      return nuevo;
    },
    cerrarServidor,
  );
  return `http://127.0.0.1:${servidor.address().port}`;
}

/**
 * El caso de `motor` con sus recursos (recursosDelCaso): el servidor, las carpetas y el navegador se cierran en su after,
 * también si vence, sin sustituir el error del cuerpo.
 */
async function prepararElCaso(t, motor) {
  const recursos = recursosDelCaso(t);
  const origen = await servidorDelCaso(recursos);
  const { navegador } = await arrancar(motor, { recursos });
  return { navegador, origen };
}

/** El recorrido de `origen`, con el Worker del motor en `modo`, hasta el primer mensaje de la persona. */
async function abrirElRecorrido(navegador, origen, modo) {
  const contexto = await contextoLimpio(navegador);
  await contexto.addInitScript(preferenciasDelRecorrido);
  await contexto.addInitScript((modoInicial) => sessionStorage.setItem('faro-prueba-modo', modoInicial), modo);
  await contexto.addInitScript(conElParche, CANAL);
  const pagina = await contexto.newPage();
  await pagina.goto(`${origen}/recorrido.html`);
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_DE_LA_COPIA_MS });
  await pagina.locator('#mensaje').fill(PRIMER_MENSAJE);
  await pagina.locator('#mensaje').press('Enter');
  return { contexto, pagina };
}

/** Espera el texto del bloqueo y su «Volver a intentarlo», y devuelve cuándo apareció (Date.now de la página). */
async function esperarElBloqueo(pagina, plazo) {
  await pagina.getByText(TEXTO_DEL_BLOQUEO, { exact: true }).waitFor({ state: 'visible', timeout: plazo });
  await pagina.locator('#sugerencias .rc-sugerencia', { hasText: REINTENTAR }).waitFor({ state: 'visible' });
  return pagina.evaluate(() => Date.now());
}

/** Espera a que el motor responda: algo que elegir que no es una salida del fallo. */
function respondeElMotor(pagina) {
  return pagina
    .locator(RESPUESTA_DEL_MOTOR)
    .filter({ hasNotText: SALIDAS_DEL_FALLO })
    .first()
    .waitFor({ state: 'visible', timeout: PLAZO_DE_LA_COPIA_MS });
}

/** La clave de firma guardada en IndexedDB es una CryptoKey. */
function hayClaveGuardada(pagina) {
  return pagina.evaluate(
    () =>
      new Promise((listo) => {
        const apertura = indexedDB.open('faro-motor-local', 1);
        apertura.onsuccess = () => {
          const lectura = apertura.result.transaction('claves', 'readonly').objectStore('claves').get('secreto-firma');
          lectura.onsuccess = () => {
            listo(lectura.result instanceof CryptoKey);
            apertura.result.close();
          };
          lectura.onerror = () => listo(false);
        };
        apertura.onerror = () => listo(false);
      }),
  );
}

/** Los motores, con --motor como en los demás ensayos (paquete-comun.mjs, argumentos); sin él, los tres. */
const { motores } = argumentos();

for (const motor of motores) {
  test(`${motor}: la clave que no se puede guardar a tiempo da el texto aprobado a los 15 s, y al soltarla se recupera`, {
    timeout: PLAZO_DE_LA_PRUEBA_MS,
  }, async (t) => {
    const { navegador, origen } = await prepararElCaso(t, motor);
    const { pagina } = await abrirElRecorrido(navegador, origen, 'retener');
    const visto = await esperarElBloqueo(pagina, PLAZO_DE_LA_COPIA_MS + ESPERA_DEL_ALMACEN_MS + HOLGURA_MS);
    const avisos = await pagina.evaluate(() => globalThis.__faroAvisos);
    assert.ok(
      avisos.some((aviso) => aviso.tipo === 'put' && aviso.retenida),
      'el Worker ha intentado guardar la clave y el aviso se ha retenido',
    );
    const peticion = avisos.find((aviso) => aviso.tipo === 'peticion');
    assert.ok(peticion, 'la petición ha llegado al Worker');
    // La espera de la clave empieza después de que llegue la petición: el texto no puede salir antes de 15 s.
    const tras = visto - peticion.en;
    assert.ok(tras >= ESPERA_DEL_ALMACEN_MS, `el texto aparece a los 15 s, no antes: ${tras} ms`);
    assert.ok(tras < ESPERA_DEL_ALMACEN_MS + HOLGURA_MS, `y no mucho después: ${tras} ms`);
    // Se suelta el almacenamiento y la persona pulsa «Volver a intentarlo».
    await pagina.evaluate((canal) => {
      sessionStorage.setItem('faro-prueba-modo', '');
      new BroadcastChannel(canal).postMessage('soltar');
    }, CANAL);
    await pagina.locator('#sugerencias .rc-sugerencia', { hasText: REINTENTAR }).click();
    await respondeElMotor(pagina);
    const escrituras = (await pagina.evaluate(() => globalThis.__faroAvisos)).filter((aviso) => aviso.tipo === 'put');
    assert.equal(escrituras.length, 1, 'la clave se ha guardado una sola vez');
    assert.equal(await hayClaveGuardada(pagina), true);
  });

  test(`${motor}: el Worker que no atiende da el texto aprobado a los 120 s, y «Volver a intentarlo» responde con otro`, {
    timeout: PLAZO_DE_LA_PRUEBA_MS,
  }, async (t) => {
    const { navegador, origen } = await prepararElCaso(t, motor);
    const { pagina } = await abrirElRecorrido(navegador, origen, 'mudo');
    const visto = await esperarElBloqueo(pagina, PLAZO_DE_LA_COPIA_MS + PLAZO_DEL_WORKER_MS + HOLGURA_MS);
    const avisos = await pagina.evaluate(() => globalThis.__faroAvisos);
    const peticion = avisos.find((aviso) => aviso.tipo === 'peticion');
    assert.ok(peticion, 'la petición ha llegado al Worker, que no la atiende');
    const tras = visto - peticion.en;
    // El plazo del cliente empieza al mandar la petición, un poco antes de que llegue al Worker.
    assert.ok(
      tras >= PLAZO_DEL_WORKER_MS - ANTES_DE_LLEGAR_MS,
      `el texto aparece a los 120 s de la petición: ${tras} ms`,
    );
    assert.ok(tras < PLAZO_DEL_WORKER_MS + HOLGURA_MS, `y no mucho después: ${tras} ms`);
    await pagina.evaluate(() => sessionStorage.setItem('faro-prueba-modo', ''));
    await pagina.evaluate(() => {
      globalThis.__faroModoDelWorker = '';
    });
    await pagina.locator('#sugerencias .rc-sugerencia', { hasText: REINTENTAR }).click();
    await respondeElMotor(pagina);
    const escrituras = (await pagina.evaluate(() => globalThis.__faroAvisos)).filter((aviso) => aviso.tipo === 'put');
    assert.equal(escrituras.length, 1, 'el Worker nuevo guarda la clave una sola vez');
    assert.equal(await hayClaveGuardada(pagina), true);
  });
}
