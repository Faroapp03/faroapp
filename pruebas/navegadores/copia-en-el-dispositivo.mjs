// Ensayo: lo guardado en la copia sin conexión del dispositivo solo se sirve si sus bytes son los de esta versión, y
// el service worker que la guarda y la sirve cumple sus garantías. Sobre la construcción servida por fixture.ts, como
// la instalación pública (comoInstalacionPublica), se alteran o retiran entradas de la copia `faro:<base>:<VERSION>`
// desde la página y se comprueba lo que entrega el service worker. Los casos:
// - entrada: un script y un estilo alterados. Con red, la página arranca y la copia queda reparada; sin red, 503, nunca
//   los bytes alterados.
// - seccion: lo mismo con la página de una sección (biblioteca.html); sin red, la página de sin conexión de la copia
//   (sin-conexion.html con los bytes de su huella, paginaSinConexion), nunca los bytes alterados.
// - sin-conexion: sin-conexion.html alterada y una navegación sin red a una página descartada: el 503 con la página de
//   estado «sin-conexion» del service worker (paginasDelServicio), exactamente, nunca la sin-conexion.html alterada.
// - foto-y-seccion: a 1280 px la página pide la grande con red. Cuando la copia ya la tiene con su huella, se retira sin
//   red; la sección ya vista y la fotografía de 800 px salen de la copia con los bytes de su huella, la grande se
//   sustituye por la de 800 px y la fotografía se pinta.
// - foto-no-pedida: sin red y sin ninguna de las dos fotografías en la copia, cada una da el 503 de texto fijo y la
//   página se abre igual.
// - paquete-dos-servicios: el service worker activo y el que espera, con el mismo paquete, lo preparan a la vez: cada
//   archivo se pide una sola vez (el cerrojo del origen) y la página no navega.
// - paquete-pestana-cerrada: la pestaña se cierra con el paquete a medias y su descarga se corta; el intento que falla
//   suelta el cerrojo y la preparación siguiente termina.
// - fallo-del-programa: un fallo del programa en responder (FALLO_PROVOCADO) llega como error de red, no como el 503
//   de sin conexión.
// Con --mutante (repetible), el service worker servido lleva un cambio mínimo (MUTANTES), solo en memoria: el caso que
// cubre esa garantía tiene que fallar.
//
//   node pruebas/navegadores/copia-en-el-dispositivo.mjs --artefacto <dist> [--motor …] [--caso …] [--mutante …]
//     [--salida <carpeta>]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { MARCADOR_DEL_INICIO, paginasDelServicio } from '../../herramientas/web/servicio/politica-del-servicio.ts';
import { listasDelCatalogo, valoresDelServicio } from '../../herramientas/web/servicio/servicio-publicado.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { TEXTOS_INSTALACION as INSTALACION_CA } from '../../web/idiomas/ca/instalacion.js';
import { TEXTOS_INSTALACION as INSTALACION_ES } from '../../web/idiomas/es/instalacion.js';
import { crearFixture } from './fixture.ts';
import {
  argumentos,
  arrancar,
  construccionEnsayada,
  contextoDelRecorrido,
  esperarServiceWorkerActivado,
  PLAZO_MS,
  recortar,
  servible,
} from './paquete-comun.mjs';

const PREFIJO_DE_LAS_COPIAS = 'faro:';
const ALTERACION = '\n/* faro-ensayo-alterado */\n';
const ENTRADAS = ['estilos/base.css'];
const SECCION = 'biblioteca.html';
const DESCARTADA = 'accesibilidad.html';
const SIN_CONEXION = 'sin-conexion.html';
const TEXTO_SIN_CONEXION = 'Recurso no disponible sin conexión.';
const HUELLA_SIN_CONEXION = createHash('sha256').update(TEXTO_SIN_CONEXION).digest('hex');
const FOTO = 'imagenes/fotografias/faro-penmon-800.webp';
const FOTO_GRANDE = 'imagenes/fotografias/faro-penmon.webp';
const SERVICIO = 'web/service-worker.js';
const NO_DISPONIBLE = 503;
/** Los diccionarios publicados de las páginas de estado, por idioma, en el orden de la página. */
const TEXTOS_DEL_ESTADO = { es: INSTALACION_ES, ca: INSTALACION_CA };
/** El texto de la página de estado de una sección retirada en la versión anterior a la restauración (IMP). */
const TEXTO_ANTERIOR_DE_LA_SECCION = 'Sección no disponible';
/**
 * La pantalla de foto-no-pedida: más ancha que 700 px y no más que 800, para que inicio.html, con
 * `sizes="(max-width: 700px) 1400px, 100vw"`, elija la de 800 px (srcset) y la página no pida nunca la grande.
 * foto-y-seccion usa la de siempre (1280 px), en la que la página pide la grande.
 */
const VISTA_DE_LA_FOTO = { width: 760, height: 900 };
/** Las opciones del contexto de cada caso: la pantalla estrecha en foto-no-pedida. */
const opcionesDelContexto = (caso) => (caso === 'foto-no-pedida' ? { viewport: VISTA_DE_LA_FOTO } : {});
const INTERVALO_MS = 100;

/** Cambios mínimos del service worker publicado, cada uno contra una garantía: [texto exacto, sustituto]. */
const MUTANTES = {
  'sin-comprobar': [
    'const huella = HUELLAS_DE_LA_COPIA.get(clave);\n  if (!guardada || huella === void 0) {',
    'const huella = HUELLAS_DE_LA_COPIA.get(clave);\n  if (!guardada || huella === void 0 || true) {',
  ],
  'sin-reducida': ['const reducida = REDUCIDAS.get(clave);', 'const reducida = void 0;'],
  // El paquete se llena fuera del cerrojo del origen (navigator.locks): el activo y el que espera bajan a la vez.
  'paquete-sin-cerrojo': [
    'completo = await navigator.locks.request(COPIA_DEL_PAQUETE, () => llenarCopiaDelPaquete(revisarAhora)).catch(',
    'completo = await llenarCopiaDelPaquete(revisarAhora).catch(',
  ],
  // El cerrojo no se suelta nunca: tras el primer intento, ninguna preparación termina.
  'paquete-sin-soltar': [
    'completo = await navigator.locks.request(COPIA_DEL_PAQUETE, () => llenarCopiaDelPaquete(revisarAhora)).catch(',
    'completo = await navigator.locks.request(COPIA_DEL_PAQUETE, () => llenarCopiaDelPaquete(revisarAhora).then(() => new Promise(() => {}))).catch(',
  ],
  // No es un rojo: es el fallo de programa que provoca el caso fallo-del-programa, siempre, en todo lo que llega a la red.
  'fallo-provocado': [
    'respuesta = await pedirALaRed(evento.request, modo ? { cache: modo } : void 0);',
    'respuesta = await pedirALaRed(evento.request, modo ? { cache: modo } : void 0).then(() => {\n      throw new TypeError("Fallo del programa provocado por el ensayo");\n    });',
  ],
  // Lo que no está en la copia, sin red, llega como si existiera: un 200 con el texto en lugar del 503.
  'sin-conexion-200': [
    'return new Response("Recurso no disponible sin conexión.", {\n    status: 503,',
    'return new Response("Recurso no disponible sin conexión.", {\n    status: 200,',
  ],
  // El esFalloDeLaRed de antes de VQ1jb (D2): cualquier TypeError pasaba por falta de conexión.
  'cualquier-typeerror': [
    'return typeof error === "object" && error !== null && FALLOS_ESPERADOS.has(nombreDelError(error));',
    'return typeof error === "object" && error !== null && (FALLOS_ESPERADOS.has(nombreDelError(error)) || nombreDelError(error) === "TypeError");',
  ],
};
/** Lo que el caso fallo-del-programa añade siempre al service worker servido. */
const FALLO_PROVOCADO = 'fallo-provocado';
/** Los datos del paquete (sin su manifiesto), como en modulo-alterado.mjs, y cuántos pasan antes de retenerlos. */
const DATOS_DEL_PAQUETE = /^web\/paquete\/[0-9a-f]{16}\/(?!manifiesto\.json$)[a-z0-9-]+\.json$/u;
const DEJA_PASAR_DEL_PAQUETE = 10;
/** Lo que se añade al service worker servido para que el navegador instale otro, que espera, con el mismo paquete. */
const OTRO_SERVICIO = '\n// faro-ensayo-servicio-que-espera\n';
/** Lo que se espera a que la siguiente preparación termine, tras cerrar la pestaña. */
const TERMINA_MS = 30_000;
const CASOS_DEL_PAQUETE = new Set(['paquete-dos-servicios', 'paquete-pestana-cerrada']);

const CASOS = [
  'entrada',
  'seccion',
  'sin-conexion',
  'foto-y-seccion',
  'foto-no-pedida',
  'paquete-dos-servicios',
  'paquete-pestana-cerrada',
  'fallo-del-programa',
];

/**
 * La construcción privada servida como la instalación pública: su Worker, con inicio.html marcado como en worker.ts
 * (`x-faro-portal: publico`). Es la marca con que el service worker sirve sin red las navegaciones desde la copia
 * (portal.js); sin ella, toda navegación sin red da el 503 de la comprobación de acceso, antes de la copia.
 */
function comoInstalacionPublica(artefacto) {
  const servir = artefacto.worker.default.fetch.bind(artefacto.worker.default);
  const fetch = async (peticion, entorno) => {
    const respuesta = await servir(peticion, entorno);
    if (!respuesta.ok || new URL(peticion.url).pathname !== '/inicio.html') {
      return respuesta;
    }
    const cabeceras = new Headers(respuesta.headers);
    cabeceras.set('x-faro-portal', 'publico');
    return new Response(respuesta.body, { status: respuesta.status, headers: cabeceras });
  };
  return { ...artefacto, worker: { ...artefacto.worker, default: { ...artefacto.worker.default, fetch } } };
}

function conMutantes(artefacto, nombres) {
  return nombres.reduce(conMutante, artefacto);
}

/**
 * El paquete retenido: el servidor entrega DEJA_PASAR_DEL_PAQUETE datos y deja los siguientes sin cuerpo hasta
 * soltarlos (soltar) o cortarlos (cortar). Con `estado.otro`, el service worker servido es otro (OTRO_SERVICIO).
 */
function conElPaqueteRetenido(artefacto, estado) {
  const leer = (pedida) => {
    const bytes = artefacto.leer(pedida);
    if (pedida === SERVICIO && estado.otro) {
      return Buffer.concat([bytes, Buffer.from(OTRO_SERVICIO)]);
    }
    if (!estado.retener || !DATOS_DEL_PAQUETE.test(pedida)) {
      return bytes;
    }
    if (estado.servidos.length < DEJA_PASAR_DEL_PAQUETE) {
      estado.servidos.push(pedida);
      return bytes;
    }
    estado.retenidos.push(pedida);
    estado.alRetener();
    return new ReadableStream({ start: (controlador) => void estado.controladores.push({ controlador, bytes }) });
  };
  return { ...artefacto, leer };
}

function retenido() {
  const pausado = Promise.withResolvers();
  return { retener: true, servidos: [], retenidos: [], controladores: [], alRetener: pausado.resolve, pausado };
}

/** Entrega lo retenido y deja de retener. */
function soltar(estado) {
  estado.retener = false;
  for (const { controlador, bytes } of estado.controladores.splice(0)) {
    controlador.enqueue(new Uint8Array(bytes));
    controlador.close();
  }
}

/** Corta lo retenido, como una conexión que se pierde, y deja de retener. */
function cortar(estado) {
  estado.retener = false;
  for (const { controlador } of estado.controladores.splice(0)) {
    controlador.error(new Error('Conexión cortada por el ensayo'));
  }
}

/** La construcción de cada caso: los mutantes pedidos y, según el caso, el fallo provocado o el paquete retenido. */
function artefactoDelCaso(original, caso, mutantes, estado) {
  const nombres = caso === 'fallo-del-programa' ? [FALLO_PROVOCADO, ...mutantes] : mutantes;
  const mutado = conMutantes(original, nombres);
  return comoInstalacionPublica(CASOS_DEL_PAQUETE.has(caso) ? conElPaqueteRetenido(mutado, estado) : mutado);
}

/** La construcción con el service worker mutado en memoria; el cambio tiene que aparecer una sola vez. */
function conMutante(artefacto, nombre) {
  const [original, sustituto] = MUTANTES[nombre] ?? [];
  assert.ok(original, `Mutantes: ${Object.keys(MUTANTES).join(', ')}`);
  const fuente = artefacto.leer(SERVICIO).toString('utf8');
  assert.equal(fuente.split(original).length - 1, 1, `${nombre}: el texto aparece una sola vez en el service worker`);
  const mutado = Buffer.from(fuente.replace(original, sustituto));
  return { ...artefacto, leer: (ruta) => (ruta === SERVICIO ? mutado : artefacto.leer(ruta)) };
}

/** Altera en la copia de esta versión cada uno de `archivos` (añade ALTERACION) y devuelve los que estaban. */
function alterarEnLaCopia(pagina, archivos) {
  return pagina.evaluate(
    async ({ prefijo, archivos, texto }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const copia = await caches.open(nombre);
      const alterados = [];
      for (const archivo of archivos) {
        const direccion = new URL(archivo, base).href;
        const guardada = await copia.match(direccion);
        if (guardada) {
          await copia.put(direccion, new Response(`${await guardada.text()}${texto}`, { headers: guardada.headers }));
          alterados.push(archivo);
        }
      }
      return alterados;
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, archivos, texto: ALTERACION },
  );
}

/** La huella de lo guardado en la copia para cada uno de `archivos` (null si no está). */
function huellasEnLaCopia(pagina, archivos) {
  return pagina.evaluate(
    async ({ prefijo, archivos }) => {
      const HEXADECIMAL = 16;
      const DIGITOS = 2;
      const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(HEXADECIMAL).padStart(DIGITOS, '0')).join('');
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const copia = await caches.open(nombre);
      const salida = {};
      for (const archivo of archivos) {
        const guardada = await copia.match(new URL(archivo, base).href);
        salida[archivo] = guardada ? hex(await crypto.subtle.digest('SHA-256', await guardada.arrayBuffer())) : null;
      }
      return salida;
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, archivos },
  );
}

/** Lo que entrega el service worker a un fetch de la página para cada uno de `archivos`: estado, huella y alteración. */
function pedir(pagina, archivos) {
  return pagina.evaluate(
    async ({ archivos, texto }) => {
      const HEXADECIMAL = 16;
      const DIGITOS = 2;
      const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(HEXADECIMAL).padStart(DIGITOS, '0')).join('');
      const salida = {};
      for (const archivo of archivos) {
        try {
          const r = await fetch(archivo);
          const bytes = await r.arrayBuffer();
          salida[archivo] = {
            estado: r.status,
            huella: hex(await crypto.subtle.digest('SHA-256', bytes)),
            alterado: new TextDecoder().decode(bytes).includes(texto.trim()),
          };
        } catch (error) {
          salida[archivo] = { estado: 'error', error: String(error) };
        }
      }
      return salida;
    },
    { archivos, texto: ALTERACION },
  );
}

/** Una navegación: estado, si el cuerpo trae la alteración y su huella. */
async function navegar(pagina, url) {
  const respuesta = await pagina.goto(url).catch((error) => ({ error: String(error) }));
  if (respuesta?.error) {
    return { estado: 'error', error: recortar(respuesta.error) };
  }
  const cuerpo = await respuesta.body();
  return {
    estado: respuesta.status(),
    huella: createHash('sha256').update(cuerpo).digest('hex'),
    alterado: cuerpo.toString('utf8').includes(ALTERACION.trim()),
    texto: recortar(cuerpo.toString('utf8')),
  };
}

async function listo(pagina, origen) {
  assert.equal((await pagina.goto(`${origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
  await esperarServiceWorkerActivado(pagina);
  await pagina.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: PLAZO_MS });
}

/**
 * Sin red: el contexto sin conexión y, además, el servidor del ensayo detenido, porque en Firefox setOffline no corta
 * las peticiones del service worker. Es el final de cada caso: el servidor no se vuelve a abrir.
 */
async function sinRed(pagina, apagar, accion) {
  await pagina.context().setOffline(true);
  await apagar();
  return accion();
}

/** Lo que hay en la copia del paquete: sus copias, sus archivos y si tiene el manifiesto (el último que se guarda). */
function laCopiaDelPaquete(pagina) {
  return pagina.evaluate(async () => {
    const copias = (await caches.keys()).filter((nombre) => nombre.startsWith('faro-paquete-'));
    const claves = copias.length === 1 ? await (await caches.open(copias[0])).keys() : [];
    const archivos = claves.map((clave) => new URL(clave.url).pathname.split('/').at(-1)).sort();
    return { copias, archivos, conManifiesto: archivos.includes('manifiesto.json') };
  });
}

/** Cuántas veces ha pedido el navegador cada archivo del paquete al servidor. */
function descargasDelPaquete(fixture) {
  const veces = {};
  for (const { ruta } of fixture.peticiones) {
    if (ruta.startsWith('/paquete/')) {
      veces[ruta] = (veces[ruta] ?? 0) + 1;
    }
  }
  return veces;
}

/** Antes de cada carga: los avisos del service worker a la página, con sus datos. */
function anotarLosAvisos() {
  globalThis.__avisos = [];
  navigator.serviceWorker?.addEventListener('message', ({ data }) => void globalThis.__avisos.push(data));
}

const avisosDelPaquete = (pagina) =>
  pagina.evaluate(() => globalThis.__avisos.filter((aviso) => aviso?.type === 'ESTADO_DEL_PAQUETE'));

async function hastaQue(leer, comprobar, plazo = PLAZO_MS) {
  const limite = Date.now() + plazo;
  let valor = await leer();
  while (!comprobar(valor) && Date.now() < limite) {
    await esperar(INTERVALO_MS);
    valor = await leer();
  }
  return valor;
}

/** Las navegaciones del marco principal de `pagina` desde ahora, por su dirección. */
function anotarLasNavegaciones(pagina) {
  const navegaciones = [];
  pagina.on('framenavigated', (marco) => {
    if (marco === pagina.mainFrame()) {
      navegaciones.push(marco.url());
    }
  });
  return navegaciones;
}

/** Retira de la copia de esta versión cada uno de `archivos` y dice si estaba y si ya no está. */
function retirarDeLaCopia(pagina, archivos) {
  return pagina.evaluate(
    async ({ prefijo, archivos }) => {
      const base = new URL('./', location.href).href;
      const nombre = (await caches.keys()).find(
        (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
      );
      const copia = await caches.open(nombre);
      const salida = {};
      for (const archivo of archivos) {
        const direccion = new URL(archivo, base).href;
        const estaba = await copia.delete(direccion);
        salida[archivo] = { estaba, ausente: (await copia.match(direccion)) === undefined };
      }
      return salida;
    },
    { prefijo: PREFIJO_DE_LAS_COPIAS, archivos },
  );
}

/** Lo que muestra la página de la fotografía de inicio.html: si se ha pintado, su ancho y de dónde salió. */
function laFotografia(pagina) {
  return pagina.evaluate(async () => {
    const img = document.querySelector('img[src*="faro-penmon"]');
    if (!img) {
      return null;
    }
    await img.decode().catch(() => undefined);
    return { completa: img.complete, ancho: img.naturalWidth, actual: img.currentSrc };
  });
}

/**
 * Antes de cada carga, en paquete-dos-servicios: la página no pide que se active el service worker que espera
 * (instalacion.js, atenderEnEspera, lo pide sola si no hay nada que perder, y al tomar el control recarga la página:
 * seguirAlControl). El caso es que los dos convivan; cada petición retenida queda anotada.
 */
function retenerLaActivacion() {
  globalThis.__activacionesRetenidas = 0;
  if (typeof ServiceWorker === 'undefined') {
    return;
  }
  const enviar = ServiceWorker.prototype.postMessage;
  ServiceWorker.prototype.postMessage = function (mensaje, ...resto) {
    if (mensaje?.type === 'ACTIVATE_UPDATE') {
      globalThis.__activacionesRetenidas += 1;
      return undefined;
    }
    return enviar.call(this, mensaje, ...resto);
  };
}

const OBSERVAR = {
  async entrada(pagina, origen, { piezas, apagar }) {
    const archivos = [...ENTRADAS, piezas.entrada];
    const alterados = await alterarEnLaCopia(pagina, archivos);
    const conRed = await pedir(pagina, archivos);
    // La página entera, con su SRI, desde la copia ya reparada.
    const recorrido = await navegar(pagina, `${origen}/recorrido.html`);
    await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
    const reparada = await huellasEnLaCopia(pagina, archivos);
    const otraVez = await alterarEnLaCopia(pagina, archivos);
    const sinConexion = await sinRed(pagina, apagar, () => pedir(pagina, archivos));
    return { archivos, alterados, conRed, recorrido: recorrido.estado, reparada, otraVez, sinConexion };
  },
  async seccion(pagina, origen, { apagar }) {
    const primera = await navegar(pagina, `${origen}/${SECCION}`);
    const alterados = await alterarEnLaCopia(pagina, [SECCION]);
    const conRed = await navegar(pagina, `${origen}/${SECCION}`);
    const reparada = await huellasEnLaCopia(pagina, [SECCION]);
    await navegar(pagina, `${origen}/inicio.html`);
    const otraVez = await alterarEnLaCopia(pagina, [SECCION]);
    const sinConexion = await sinRed(pagina, apagar, () => navegar(pagina, `${origen}/${SECCION}`));
    return {
      primera: primera.estado,
      alterados,
      conRed,
      reparada,
      otraVez,
      sinConexion,
      inicio: `${origen}/inicio.html`,
    };
  },
  async 'sin-conexion'(pagina, origen, { apagar }) {
    const alterados = await alterarEnLaCopia(pagina, [SIN_CONEXION, DESCARTADA]);
    const sinConexion = await sinRed(pagina, apagar, () => navegar(pagina, `${origen}/${DESCARTADA}`));
    return { alterados, sinConexion, inicio: `${origen}/inicio.html` };
  },
  async 'foto-y-seccion'(pagina, origen, { apagar }) {
    const seccion = await navegar(pagina, `${origen}/${SECCION}`);
    await navegar(pagina, `${origen}/inicio.html`);
    // El service worker guarda la grande en segundo plano, tras entregarla: hasta que esté en la copia, retirarla no
    // sirve, porque esa escritura la volvería a guardar después.
    await hastaQue(
      () => huellasEnLaCopia(pagina, [FOTO_GRANDE]),
      (huellas) => huellas[FOTO_GRANDE] !== null,
    );
    const enLaCopia = await huellasEnLaCopia(pagina, [FOTO, FOTO_GRANDE, SECCION]);
    const sinConexion = await sinRed(pagina, apagar, async () => {
      // La grande, como si nadie la hubiera visto: sin red se tiene que servir su versión de 800 px.
      const retirada = (await retirarDeLaCopia(pagina, [FOTO_GRANDE]))[FOTO_GRANDE];
      const deLaSeccion = await navegar(pagina, `${origen}/${SECCION}`);
      const inicio = await navegar(pagina, `${origen}/inicio.html`);
      const pedidas = await pedir(pagina, [FOTO, FOTO_GRANDE]);
      const imagen = await laFotografia(pagina);
      return { retirada, seccion: deLaSeccion, inicio: inicio.estado, pedidas, imagen };
    });
    return { seccion: seccion.estado, enLaCopia, sinConexion };
  },
  /** Sin red y sin las dos fotografías en la copia (nadie las pidió): el 503 de texto fijo, y la página se abre. */
  async 'foto-no-pedida'(pagina, origen, { apagar }) {
    return sinRed(pagina, apagar, async () => {
      const retiradas = await retirarDeLaCopia(pagina, [FOTO, FOTO_GRANDE]);
      const pedidas = await pedir(pagina, [FOTO, FOTO_GRANDE]);
      const inicio = await navegar(pagina, `${origen}/inicio.html`);
      return { retiradas, pedidas, inicio: inicio.estado, imagen: await laFotografia(pagina) };
    });
  },
  /**
   * El activo, con la copia del paquete a medias y retenida; otro service worker de la web, con el mismo paquete,
   * instalado y esperando; los dos reciben PREPARAR_PAQUETE a la vez. Al soltar el paquete, cada archivo se ha pedido
   * una sola vez.
   */
  async 'paquete-dos-servicios'(pagina, _origen, { estado, fixture }) {
    const navegaciones = anotarLasNavegaciones(pagina);
    const pausada = await Promise.race([
      estado.pausado.promise.then(() => true),
      esperar(PLAZO_MS, false, { ref: false }),
    ]);
    estado.otro = true;
    const servicios = await pagina.evaluate(
      async ({ plazo, intervalo }) => {
        const registro = await navigator.serviceWorker.getRegistration();
        await registro.update();
        const limite = Date.now() + plazo;
        while (!registro.waiting && Date.now() < limite) {
          await new Promise((ok) => setTimeout(ok, intervalo));
        }
        const antes = { activo: Boolean(registro.active), espera: Boolean(registro.waiting) };
        registro.active?.postMessage({ type: 'PREPARAR_PAQUETE' });
        registro.waiting?.postMessage({ type: 'PREPARAR_PAQUETE' });
        return antes;
      },
      { plazo: PLAZO_MS, intervalo: INTERVALO_MS },
    );
    const aMedias = await laCopiaDelPaquete(pagina);
    soltar(estado);
    // Si la página navegase, su contexto (y sus avisos) se pierde: se sigue leyendo, y la navegación queda anotada.
    const avisos = await hastaQue(
      () => avisosDelPaquete(pagina).catch(() => []),
      (lista) => lista.length >= 2,
    );
    const copia = await laCopiaDelPaquete(pagina);
    const sigueEsperando = await pagina.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration()).waiting),
    );
    const activacionesRetenidas = await pagina.evaluate(() => globalThis.__activacionesRetenidas);
    return {
      navegaciones,
      activacionesRetenidas,
      pausada,
      retenidos: estado.retenidos.length,
      servicios,
      sigueEsperando,
      aMedias,
      avisos,
      copia,
      descargas: descargasDelPaquete(fixture),
    };
  },
  /**
   * La pestaña que prepara el paquete se cierra a mitad y su conexión se pierde; la siguiente pestaña lo vuelve a pedir
   * y la preparación termina: el cerrojo se ha soltado.
   */
  async 'paquete-pestana-cerrada'(pagina, origen, { estado }) {
    const pausada = await Promise.race([
      estado.pausado.promise.then(() => true),
      esperar(PLAZO_MS, false, { ref: false }),
    ]);
    const contexto = pagina.context();
    const aMedias = await laCopiaDelPaquete(pagina);
    await pagina.close();
    cortar(estado);
    const siguiente = await contexto.newPage();
    assert.equal((await siguiente.goto(`${origen}/inicio.html`))?.status(), ESTADO_HTTP.correcto);
    const avisos = await hastaQue(
      () => avisosDelPaquete(siguiente),
      (lista) => lista.some((aviso) => aviso.completo === true),
      TERMINA_MS,
    );
    return { pausada, retenidos: estado.retenidos.length, aMedias, avisos, copia: await laCopiaDelPaquete(siguiente) };
  },
  /**
   * Un fallo del programa en responder (FALLO_PROVOCADO) para lo que no está en la copia: un recurso y una navegación.
   * Tiene que llegar a la página como un error de red, no como el 503 de sin conexión.
   */
  async 'fallo-del-programa'(pagina, origen) {
    await pagina.evaluate(
      async ({ prefijo, archivos }) => {
        const base = new URL('./', location.href).href;
        const nombre = (await caches.keys()).find(
          (n) => n.startsWith(`${prefijo}${base}:`) && !n.endsWith(':provisional') && !n.endsWith(':reparacion'),
        );
        const copia = await caches.open(nombre);
        await Promise.all(archivos.map((archivo) => copia.delete(new URL(archivo, base).href)));
      },
      { prefijo: PREFIJO_DE_LAS_COPIAS, archivos: [ENTRADAS[0], DESCARTADA] },
    );
    const recurso = await pedir(pagina, [ENTRADAS[0]]);
    const navegacion = await navegar(pagina, `${origen}/${DESCARTADA}`);
    return { recurso: recurso[ENTRADAS[0]], navegacion };
  },
};

/** Las veces que se pidió cada archivo del paquete: todas, una sola vez, con el manifiesto. */
function comprobarUnaDescarga(r) {
  const rutas = Object.keys(r.descargas);
  assert.ok(
    rutas.some((ruta) => ruta.endsWith('/manifiesto.json')),
    'Se pide el manifiesto',
  );
  const repetidos = Object.entries(r.descargas).filter(([, veces]) => veces !== 1);
  assert.deepEqual(repetidos, [], 'Cada archivo del paquete se pide al servidor una sola vez');
}

function comprobarDosServicios(r) {
  assert.deepEqual(r.navegaciones, [], 'La página no navega durante el caso');
  assert.ok(r.pausada && r.retenidos > 0, 'El paquete se para a mitad');
  assert.deepEqual(r.servicios, { activo: true, espera: true }, 'Hay un service worker activo y otro que espera');
  assert.equal(r.sigueEsperando, true, 'El que espera no se ha activado durante el ensayo');
  assert.equal(r.aMedias.conManifiesto, false, 'Los dos lo piden con la copia a medias');
  assert.ok(r.avisos.length >= 2, `Los dos contestan: ${JSON.stringify(r.avisos)}`);
  assert.ok(
    r.avisos.every((aviso) => aviso.completo === true),
    `Los dos ven la copia completa: ${JSON.stringify(r.avisos)}`,
  );
  assert.equal(r.copia.conManifiesto, true, 'La copia se completa');
  comprobarUnaDescarga(r);
}

function comprobarPestanaCerrada(r) {
  assert.ok(r.pausada && r.retenidos > 0, 'El paquete se para a mitad');
  assert.equal(r.aMedias.conManifiesto, false, 'La pestaña se cierra con la copia a medias');
  assert.ok(
    r.avisos.some((aviso) => aviso.completo === true),
    `La siguiente preparación termina: ${JSON.stringify(r.avisos)}`,
  );
  assert.equal(r.copia.conManifiesto, true, 'La copia se completa');
}

/**
 * El fallo del programa llega como un error de red, nunca como el 503 de sin conexión ni como la página de sin
 * conexión. Firefox, ante el fallo de un service worker en una navegación, la repite sin él (su mitigación
 * dom.serviceWorkers.mitigations.bypass_on_fault): la página llega de la red, con los bytes de su huella.
 */
function comprobarFalloDelPrograma(r, huellas, motor) {
  assert.equal(r.recurso.estado, 'error', `El recurso da un error de red: ${JSON.stringify(r.recurso)}`);
  if (motor === 'firefox') {
    assert.equal(r.navegacion.estado, ESTADO_HTTP.correcto, 'Firefox repite la navegación sin el service worker');
    assert.equal(r.navegacion.huella, huellas.get(DESCARTADA), 'La página llega de la red, no la de sin conexión');
    return;
  }
  assert.equal(r.navegacion.estado, 'error', `La navegación da un error de red: ${JSON.stringify(r.navegacion)}`);
}

function comprobarEntrada(r, huellas) {
  assert.deepEqual(r.alterados, r.archivos, 'Las entradas estaban en la copia y se alteraron');
  for (const archivo of r.archivos) {
    const ruta = archivo;
    assert.equal(r.conRed[ruta].estado, ESTADO_HTTP.correcto, `${ruta} con red: 200`);
    assert.equal(r.conRed[ruta].alterado, false, `${ruta} con red: nunca los bytes alterados`);
    assert.equal(r.conRed[ruta].huella, huellas.get(ruta), `${ruta} con red: los bytes de su huella`);
    assert.equal(r.reparada[ruta], huellas.get(ruta), `${ruta}: la copia queda reparada`);
    assert.notEqual(r.sinConexion[ruta].estado, ESTADO_HTTP.correcto, `${ruta} sin red: no se sirve lo alterado`);
    assert.equal(r.sinConexion[ruta].estado, NO_DISPONIBLE, `${ruta} sin red: 503`);
    assert.equal(r.sinConexion[ruta].alterado, false, `${ruta} sin red: nunca los bytes alterados`);
  }
  assert.equal(r.recorrido, ESTADO_HTTP.correcto, 'La página arranca');
}

function comprobarSeccion(r, huellas) {
  assert.equal(r.primera, ESTADO_HTTP.correcto, 'La sección se abre con red');
  assert.deepEqual(r.alterados, [SECCION], 'La sección estaba en la copia y se alteró');
  assert.equal(r.conRed.estado, ESTADO_HTTP.correcto, 'Con red, la sección se sirve');
  assert.equal(r.conRed.alterado, false, 'Con red, nunca los bytes alterados');
  assert.equal(r.conRed.huella, huellas.get(SECCION), 'Con red, los bytes de su huella');
  assert.equal(r.reparada[SECCION], huellas.get(SECCION), 'La copia de la sección queda reparada');
  assert.equal(r.sinConexion.alterado, false, 'Sin red, nunca los bytes alterados');
  assert.equal(r.sinConexion.estado, ESTADO_HTTP.correcto, 'Sin red, la sección alterada da la página de sin conexión');
  assert.ok(huellas.has(SIN_CONEXION), `${SIN_CONEXION} tiene huella en el catálogo`);
  assert.equal(
    r.sinConexion.huella,
    huellas.get(SIN_CONEXION),
    `Sin red, exactamente ${SIN_CONEXION} de la copia, con los bytes de su huella`,
  );
}

function comprobarSinConexion(r) {
  assert.deepEqual(r.alterados, [SIN_CONEXION, DESCARTADA], 'Las dos páginas estaban en la copia');
  assert.equal(r.sinConexion.estado, NO_DISPONIBLE, 'Sin red: 503');
  assert.equal(r.sinConexion.alterado, false, 'Sin red, nunca los bytes alterados de sin-conexion.html');
  comprobarPaginaDeEstado(r.sinConexion, r.inicio, 'sin-conexion');
}

/** El texto como lo escribe politica-del-servicio.ts dentro del HTML. */
const escaparComoLaPagina = (texto) => texto.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * La página de estado `estado` del service worker, tal como la genera la construcción (paginasDelServicio) con el
 * enlace al inicio de este origen: el título y el enlace aprobados de los diccionarios publicados, en castellano y en
 * catalán. La respuesta tiene que ser exactamente esa página (su huella), sin la alteración ni el texto anterior.
 */
function comprobarPaginaDeEstado(respuesta, inicio, estado) {
  const esperada = paginasDelServicio()[estado].replaceAll(MARCADOR_DEL_INICIO, inicio);
  for (const [idioma, textos] of Object.entries(TEXTOS_DEL_ESTADO)) {
    const titulo = escaparComoLaPagina(textos['sin-conexion.titulo-principal']);
    const volver = escaparComoLaPagina(textos['sin-conexion.volver']);
    assert.ok(
      esperada.includes(`<section lang="${idioma}"><h1>${titulo}</h1>`),
      `${estado}: el título aprobado en ${idioma}`,
    );
    assert.ok(esperada.includes(`<a href="${inicio}">${volver}</a>`), `${estado}: el enlace aprobado en ${idioma}`);
  }
  for (const anterior of [ALTERACION.trim(), TEXTO_SIN_CONEXION, TEXTO_ANTERIOR_DE_LA_SECCION]) {
    assert.ok(!esperada.includes(anterior), `${estado}: la página de estado no lleva «${anterior}»`);
  }
  assert.equal(respuesta.alterado, false, `${estado}: sin los bytes alterados`);
  assert.equal(
    respuesta.huella,
    createHash('sha256').update(esperada).digest('hex'),
    `Sin red, exactamente la página de estado «${estado}» de esta construcción: ${respuesta.texto}`,
  );
}

function comprobarFotoYSeccion(r, huellas) {
  assert.equal(r.seccion, ESTADO_HTTP.correcto, 'La sección se abre con red');
  assert.equal(r.enLaCopia[SECCION], huellas.get(SECCION), 'La sección vista queda en la copia');
  assert.equal(r.enLaCopia[FOTO], huellas.get(FOTO), 'La fotografía de 800 px está en la copia, íntegra');
  assert.equal(r.enLaCopia[FOTO_GRANDE], huellas.get(FOTO_GRANDE), 'La grande vista con red está en la copia, íntegra');
  const { retirada, seccion, pedidas, imagen } = r.sinConexion;
  assert.equal(
    retirada.estaba && retirada.ausente,
    true,
    `La grande se retira de la copia: ${JSON.stringify(retirada)}`,
  );
  assert.equal(seccion.estado, ESTADO_HTTP.correcto, 'Sin red, la sección sale de la copia');
  assert.equal(seccion.huella, huellas.get(SECCION), 'Sin red, la sección con los bytes de su huella');
  assert.equal(pedidas[FOTO].estado, ESTADO_HTTP.correcto, 'Sin red, la foto de 800 px sale de la copia');
  assert.equal(pedidas[FOTO].huella, huellas.get(FOTO), 'Sin red, la foto de 800 px con los bytes de su huella');
  assert.equal(pedidas[FOTO_GRANDE].estado, ESTADO_HTTP.correcto, 'Sin red, la grande se sustituye');
  assert.equal(pedidas[FOTO_GRANDE].huella, huellas.get(FOTO), 'El sustituto es la de 800 px, íntegra');
  assert.notEqual(imagen, null, 'inicio.html tiene la fotografía');
  assert.ok(imagen.completa && imagen.ancho > 0, `La fotografía se pinta: ${JSON.stringify(imagen)}`);
}

function comprobarFotoNoPedida(r) {
  for (const archivo of [FOTO, FOTO_GRANDE]) {
    assert.equal(r.retiradas[archivo].ausente, true, `${archivo} no está en la copia`);
    assert.equal(r.pedidas[archivo].estado, NO_DISPONIBLE, `${archivo} sin red y sin pedirla: 503`);
    assert.equal(r.pedidas[archivo].huella, HUELLA_SIN_CONEXION, `${archivo}: el texto fijo de sin conexión`);
  }
  assert.equal(r.inicio, ESTADO_HTTP.correcto, 'La página se abre sin red');
  assert.notEqual(r.imagen, null, 'inicio.html tiene la fotografía, sin pintar');
}

const COMPROBAR = {
  entrada: comprobarEntrada,
  seccion: comprobarSeccion,
  'sin-conexion': comprobarSinConexion,
  'foto-y-seccion': comprobarFotoYSeccion,
  'foto-no-pedida': comprobarFotoNoPedida,
  'paquete-dos-servicios': comprobarDosServicios,
  'paquete-pestana-cerrada': comprobarPestanaCerrada,
  'fallo-del-programa': comprobarFalloDelPrograma,
};

const opciones = argumentos({ caso: { type: 'string', multiple: true }, mutante: { type: 'string', multiple: true } });
const ELEGIDOS = CASOS.filter((caso) => !opciones.caso || opciones.caso.includes(caso));
assert.ok(ELEGIDOS.length, `Casos: ${CASOS.join(', ')}`);
const MUTANTES_PEDIDOS = opciones.mutante ?? [];
const registro = { mutantes: MUTANTES_PEDIDOS };
after(() => {
  if (opciones.salida) {
    mkdirSync(opciones.salida, { recursive: true });
    writeFileSync(join(opciones.salida, 'copia-en-el-dispositivo.json'), `${JSON.stringify(registro, null, 1)}\n`);
  }
});

for (const { nombre, carpeta } of opciones.artefactos) {
  registro.construcciones = { ...registro.construcciones, [nombre]: construccionEnsayada(carpeta) };
  const { artefacto: original } = await servible(carpeta);
  const html = original.leer('web/recorrido.html').toString('utf8');
  const entrada = /<script type="module" src="([^"]+)" integrity="/u.exec(html)?.[1];
  assert.ok(entrada, 'La página del recorrido declara su entrada');
  const piezas = { entrada };
  const catalogo = valoresDelServicio(readFileSync(join(carpeta, SERVICIO), 'utf8')).CATALOGO;
  const huellas = new Map(listasDelCatalogo(catalogo).HUELLAS_DE_ARCHIVOS);
  for (const motor of opciones.motores) {
    test(`copia en el dispositivo en ${nombre} con ${motor}`, async (t) => {
      const sesion = await arrancar(motor);
      registro[`${nombre} · ${motor}`] = {};
      try {
        for (const caso of ELEGIDOS) {
          await t.test(caso, async () => {
            const estado = retenido();
            const fixture = await crearFixture(artefactoDelCaso(original, caso, MUTANTES_PEDIDOS, estado));
            const contexto = await contextoDelRecorrido(sesion.navegador, fixture.origen, opcionesDelContexto(caso));
            await contexto.addInitScript(anotarLosAvisos);
            if (caso === 'paquete-dos-servicios') {
              await contexto.addInitScript(retenerLaActivacion);
            }
            if (!CASOS_DEL_PAQUETE.has(caso)) {
              soltar(estado);
            }
            const consola = [];
            try {
              const pagina = await contexto.newPage();
              pagina.on('console', (m) => consola.push(recortar(`${m.type()}: ${m.text()}`)));
              for (const trabajador of contexto.serviceWorkers?.() ?? []) {
                trabajador.on?.('console', (m) => consola.push(recortar(`sw ${m.type()}: ${m.text()}`)));
              }
              contexto.on('serviceworker', (w) =>
                w.on?.('console', (m) => consola.push(recortar(`sw ${m.type()}: ${m.text()}`))),
              );
              await listo(pagina, fixture.origen);
              const r = await OBSERVAR[caso](pagina, fixture.origen, {
                piezas,
                apagar: fixture.apagar,
                estado,
                fixture,
              });
              r.consola = consola.filter((l) => /Faro:/u.test(l));
              registro[`${nombre} · ${motor}`][caso] = r;
              COMPROBAR[caso](r, huellas, motor);
            } finally {
              soltar(estado);
              await contexto.close();
              // El servidor ya está detenido si el caso llegó a su parte sin red.
              await fixture.cerrar().catch(() => undefined);
            }
          });
        }
      } finally {
        await sesion.cerrar();
      }
    });
  }
}
