// Las comprobaciones de «Comprobar Faro» (doctor.html), en el propio dispositivo y en unos segundos: el navegador,
// la conexión, el servidor (GET /api/salud), la copia guardada para usar sin conexión, el espacio y el idioma.
// Cada una da un semáforo (bien, atención o fallo), lo que se ha visto y qué hacer, como claves del diccionario con sus
// valores: la página las escribe en el idioma en curso y las reescribe si cambia.
// Nada de la persona: no lee el relato, las tareas, el informe ni la ocupación, ni nada de lo que guarda el recorrido.
// Solo mira el navegador y pregunta al servidor lo que el servidor sabe de sí mismo.
// Lo que toca el navegador llega en `entorno` (entornoDelNavegador): así las pruebas lo sustituyen sin navegador.

import '../compatibilidad.js';
import { esObjeto } from '../json.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../protocolo-web.js';
import { MS_POR_SEGUNDO } from '../tiempo.js';
import { BYTES_POR_MIB } from '../unidades.js';
import { versionDelServicio } from '../version-del-servicio.js';

/** La salud del servidor: una de las dos únicas direcciones que se piden. */
const SALUD = '/api/salud';
/** El service worker que publica el servidor: la otra dirección que se pide. */
const TRABAJADOR = 'service-worker.js';
/** Segundos que espera como mucho cada pregunta a la red: la página contesta en segundos, también sin conexión. */
const SEGUNDOS_DE_ESPERA = 6;
/** Lo que tarda como mucho cada pregunta a la red, en milisegundos (el cuerpo de la respuesta incluido). */
export const ESPERA_MS = SEGUNDOS_DE_ESPERA * MS_POR_SEGUNDO;
/** MiB libres por debajo de los que la copia de Faro (unos 6 MB) puede no caber al actualizarse. */
const MIB_DE_ESPACIO_JUSTO = 50;
/** El espacio libre, en bytes, por debajo del cual se avisa. */
const ESPACIO_JUSTO = MIB_DE_ESPACIO_JUSTO * BYTES_POR_MIB;
/** MiB en un GiB: a partir de un GiB, el tamaño se escribe en gigabytes. */
const MIB_POR_GIB = 1024;

/**
 * Lo que se comprueba del navegador, en una sola tabla: el nombre (el que sale en «faltan»), si es imprescindible (sin
 * ello Faro no funciona) o conveniente (sin ello solo se pierde la copia sin conexión), y cómo se detecta. Las dos
 * listas y el `funciones` del entorno salen de aquí, así que no pueden desajustarse.
 * @type {ReadonlyArray<Readonly<{ nombre: string, imprescindible: boolean, detecta: (nav: Navigator) => boolean }>>}
 */
const FUNCIONES_DEL_NAVEGADOR = Object.freeze([
  Object.freeze({ nombre: 'fetch', imprescindible: true, detecta: () => typeof globalThis.fetch === 'function' }),
  Object.freeze({
    nombre: 'AbortController',
    imprescindible: true,
    detecta: () => typeof globalThis.AbortController === 'function',
  }),
  Object.freeze({
    nombre: 'TextEncoder',
    imprescindible: true,
    detecta: () => typeof globalThis.TextEncoder === 'function',
  }),
  Object.freeze({ nombre: 'URL', imprescindible: true, detecta: () => typeof globalThis.URL === 'function' }),
  Object.freeze({ nombre: 'Intl', imprescindible: true, detecta: () => typeof globalThis.Intl === 'object' }),
  Object.freeze({
    nombre: 'serviceWorker',
    imprescindible: false,
    detecta: (/** @type {Navigator} */ nav) => 'serviceWorker' in nav,
  }),
  Object.freeze({ nombre: 'caches', imprescindible: false, detecta: () => 'caches' in globalThis }),
  Object.freeze({ nombre: 'localStorage', imprescindible: false, detecta: hayAlmacenLocal }),
]);
/** Lo que Faro no puede dejar de tener. */
const IMPRESCINDIBLES = Object.freeze(
  FUNCIONES_DEL_NAVEGADOR.filter(({ imprescindible }) => imprescindible).map(({ nombre }) => nombre),
);
/** Lo que le falta a un navegador que solo pierde la copia sin conexión. */
const CONVENIENTES = Object.freeze(
  FUNCIONES_DEL_NAVEGADOR.filter(({ imprescindible }) => !imprescindible).map(({ nombre }) => nombre),
);

/**
 * El valor de una promesa que falla sin importar por qué: para las preguntas cuya ausencia no es un fallo.
 * @returns {null}
 */
function nada() {
  return null;
}

/** Si el navegador deja leer el almacenamiento local: uno que lo bloquea lanza al leerlo. @returns {boolean} */
function hayAlmacenLocal() {
  try {
    return Boolean(globalThis.localStorage);
  } catch {
    return false;
  }
}

/**
 * Los casos que puede dar cada comprobación: cada uno tiene en el diccionario `doctor.<id>.<caso>.detalle` y
 * `doctor.<id>.<caso>.accion`. `resultado` no admite otro.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const CASOS_POR_COMPROBACION = Object.freeze({
  navegador: Object.freeze(['completo', 'sin-copia', 'viejo']),
  conexion: Object.freeze(['con-red', 'sin-red', 'sin-servidor']),
  servidor: Object.freeze(['responde', 'sin-respuesta', 'error']),
  copia: Object.freeze(['no-admite', 'sin-copia', 'anterior', 'al-dia', 'sin-comparar']),
  espacio: Object.freeze(['holgado', 'justo', 'sin-dato']),
  idioma: Object.freeze(['castellano', 'catalan']),
});

/** Lo que se escribe cuando el servidor no indica su versión. */
const SIN_DATO = '?';

/**
 * @typedef {'bien' | 'atencion' | 'fallo'} Semaforo
 * @typedef {Object} Resultado
 * @property {string} id la comprobación: navegador, conexion, servidor, copia, espacio o idioma
 * @property {Semaforo} semaforo
 * @property {string} caso la clave del caso: doctor.<id>.<caso>.detalle y doctor.<id>.<caso>.accion
 * @property {Record<string, string>} valores lo que llevan esos textos entre llaves
 * @typedef {Object} Entorno lo que las comprobaciones necesitan del navegador (entornoDelNavegador)
 * @property {(direccion: string, opciones: RequestInit) => Promise<Response>} fetch
 * @property {{ keys(): Promise<string[]> } | undefined} caches
 * @property {{ href: string }} location
 * @property {boolean} enLinea
 * @property {string} idiomaNavegador
 * @property {boolean} controlada si un service worker controla la página
 * @property {() => Promise<{ usage?: number, quota?: number } | null>} estimarEspacio
 * @property {Record<string, boolean>} funciones
 */

/**
 * Un resultado, con un caso del catálogo.
 * @param {string} id @param {Semaforo} semaforo @param {string} caso @param {Record<string, string>} [valores]
 * @returns {Resultado}
 * @throws {Error} Si el caso no está en CASOS_POR_COMPROBACION: no tendría textos en el diccionario.
 */
function resultado(id, semaforo, caso, valores = {}) {
  if (!CASOS_POR_COMPROBACION[id]?.includes(caso)) {
    throw new Error(`Caso sin textos en el diagnóstico: ${id}.${caso}`);
  }
  return { id, semaforo, caso, valores };
}

/** Un campo de texto de un objeto JSON, o null si no lo es.
 * @param {unknown} objeto @param {string} campo @returns {string | null}
 */
function textoOpcionalDe(objeto, campo) {
  const valor = esObjeto(objeto) ? objeto[campo] : null;
  return typeof valor === 'string' ? valor : null;
}

/** Una petición con su plazo; null si no llega (sin red, cortada o fuera de plazo).
 * @param {Entorno} entorno @param {string} direccion @returns {Promise<Response | null>}
 */
async function pedir(entorno, direccion) {
  try {
    return await entorno.fetch(direccion, {
      cache: 'no-store',
      signal: AbortSignal.timeout(ESPERA_MS),
      ...(direccion === SALUD ? { headers: { [CABECERA_CONTRATO]: String(CONTRATO_API) } } : {}),
    });
  } catch {
    return null;
  }
}

/** Lo que respondió /api/salud: su cuerpo si es JSON, y su estado.
 * @param {Entorno} entorno @returns {Promise<{ estado: number, cuerpo: unknown } | null>}
 */
async function leerSalud(entorno) {
  const respuesta = await pedir(entorno, SALUD);
  if (!respuesta) {
    return null;
  }
  /** @type {unknown} */
  const cuerpo = await respuesta.json().catch(nada);
  return { estado: respuesta.status, cuerpo: respuesta.ok ? cuerpo : null };
}

/** La VERSION del service worker que publica el servidor, o null si no se ha podido leer.
 * @param {Entorno} entorno @returns {Promise<string | null>}
 */
async function versionPublicada(entorno) {
  const respuesta = await pedir(entorno, TRABAJADOR);
  if (!respuesta?.ok) {
    return null;
  }
  // El plazo de la petición también corta la lectura del cuerpo: un cuerpo cortado es «sin comparar», no un fallo.
  const cuerpo = await respuesta.text().catch(nada);
  return cuerpo === null ? null : versionDelServicio(cuerpo);
}

/** Las versiones de las copias de esta web que guarda el navegador (src/service-worker/catalogo.js, COPIA: «faro:<web>:<VERSION>»).
 * @param {Entorno} entorno @returns {Promise<string[]>}
 */
async function versionesInstaladas(entorno) {
  if (!entorno.caches) {
    return [];
  }
  const prefijo = `faro:${new URL('./', entorno.location.href).href}:`;
  // Sin acceso a la caché (navegación privada estricta), ninguna copia guardada.
  const nombres = await entorno.caches.keys().catch(() => /** @type {string[]} */ ([]));
  // COPIA añade «+<16 cifras de la firma>» al renovar la firma sin cambiar VERSION. Se compara la versión de la
  // web, no ese identificador de la firma; los nombres sin firma conservan su valor.
  return nombres
    .filter((nombre) => nombre.startsWith(prefijo))
    .map((nombre) => nombre.slice(prefijo.length).replace(/\+[0-9a-f]{16}$/, ''));
}

/**
 * Un tamaño redondeado: para la persona basta el orden de magnitud. Divide por 1024 × 1024 (MiB) y, a partir de
 * MIB_POR_GIB, por 1024 más (GiB), y los rotula «MB» y «GB», como los muestra la mayoría de los sistemas.
 * @param {number} bytes
 * @returns {string}
 */
export function tamano(bytes) {
  const megas = bytes / BYTES_POR_MIB;
  return megas >= MIB_POR_GIB ? `${(megas / MIB_POR_GIB).toFixed(1).replace('.', ',')} GB` : `${Math.round(megas)} MB`;
}

/** Lo que el navegador tiene y lo que no.
 * @param {Record<string, boolean>} funciones @returns {Resultado}
 */
export function comprobarNavegador(funciones) {
  const faltan = (/** @type {readonly string[]} */ lista) => lista.filter((nombre) => !funciones[nombre]);
  const imprescindibles = faltan(IMPRESCINDIBLES);
  if (imprescindibles.length) {
    return resultado('navegador', 'fallo', 'viejo', { faltan: imprescindibles.join(', ') });
  }
  const convenientes = faltan(CONVENIENTES);
  if (convenientes.length) {
    return resultado('navegador', 'atencion', 'sin-copia', { faltan: convenientes.join(', ') });
  }
  return resultado('navegador', 'bien', 'completo');
}

/**
 * La conexión y el servidor, con lo que respondió /api/salud: su cuerpo, o el estado HTTP con que falló, o null si no
 * llegó (sin red).
 * @param {boolean} enLinea @param {{ cuerpo?: unknown, estado?: number } | null} salud
 * @returns {Resultado[]}
 */
export function comprobarServidor(enLinea, salud) {
  if (!salud) {
    const conexion = resultado('conexion', 'fallo', enLinea ? 'sin-servidor' : 'sin-red');
    return [conexion, resultado('servidor', 'fallo', 'sin-respuesta')];
  }
  const conexion = resultado('conexion', 'bien', 'con-red');
  if (!esObjeto(salud.cuerpo) || salud.cuerpo.estado !== 'ok') {
    return [conexion, resultado('servidor', 'fallo', 'error', { estado: String(salud.estado ?? '?') })];
  }
  const version = textoOpcionalDe(salud.cuerpo, 'version') ?? SIN_DATO;
  return [conexion, resultado('servidor', 'bien', 'responde', { version })];
}

/**
 * La copia guardada para usar Faro sin conexión: si el navegador la admite, qué versiones tiene guardadas y cuál
 * publica el servidor (null si no se ha podido leer).
 * @param {{ admite: boolean, controlada: boolean, instaladas: string[], publicada: string | null }} copia
 * @returns {Resultado}
 */
export function comprobarCopia({ admite, controlada, instaladas, publicada }) {
  if (!admite) {
    return resultado('copia', 'atencion', 'no-admite');
  }
  if (!controlada || !instaladas.length) {
    return resultado('copia', 'atencion', 'sin-copia');
  }
  // Durante una actualización conviven dos copias: si una es la publicada, la página está al día.
  const ultimaGuardada = /** @type {string} */ (instaladas[instaladas.length - 1]);
  if (publicada === null) {
    return resultado('copia', 'bien', 'sin-comparar', { instalada: ultimaGuardada });
  }
  const instalada = instaladas.includes(publicada) ? publicada : ultimaGuardada;
  if (instalada !== publicada) {
    return resultado('copia', 'atencion', 'anterior', { instalada, publicada });
  }
  return resultado('copia', 'bien', 'al-dia', { instalada });
}

/** El espacio que el navegador deja a Faro, si lo dice.
 * @param {{ usage?: number, quota?: number } | null} estimacion @returns {Resultado}
 */
export function comprobarEspacio(estimacion) {
  if (!estimacion?.quota) {
    return resultado('espacio', 'bien', 'sin-dato');
  }
  const libre = estimacion.quota - (estimacion.usage ?? 0);
  const valores = { usado: tamano(estimacion.usage ?? 0), libre: tamano(libre) };
  const justo = libre < ESPACIO_JUSTO;
  return resultado('espacio', justo ? 'atencion' : 'bien', justo ? 'justo' : 'holgado', valores);
}

/** El idioma de la página y el que prefiere el navegador.
 * @param {string} pagina @param {string} navegador @returns {Resultado}
 */
export function comprobarIdioma(pagina, navegador) {
  return resultado('idioma', 'bien', pagina === 'ca' ? 'catalan' : 'castellano', { navegador: navegador || '?' });
}

/** Lo que estas comprobaciones necesitan del navegador. @returns {Entorno} */
export function entornoDelNavegador() {
  const { navigator: navegador } = globalThis;
  return {
    fetch: (/** @type {string} */ direccion, /** @type {RequestInit} */ opciones) =>
      globalThis.fetch(direccion, opciones),
    caches: globalThis.caches,
    location: globalThis.location,
    enLinea: navegador.onLine,
    idiomaNavegador: navegador.language,
    controlada: Boolean(navegador.serviceWorker?.controller),
    estimarEspacio: () => navegador.storage?.estimate?.() ?? Promise.resolve(null),
    funciones: Object.fromEntries(FUNCIONES_DEL_NAVEGADOR.map(({ nombre, detecta }) => [nombre, detecta(navegador)])),
  };
}

/** Todas las comprobaciones, a la vez, en el orden en que se enseñan.
 * @param {Entorno} entorno @param {string} idiomaPagina
 * @returns {Promise<{ version: string | null, resultados: Resultado[] }>}
 */
export async function comprobarTodo(entorno, idiomaPagina) {
  const [salud, publicada, instaladas, estimacion] = await Promise.all([
    leerSalud(entorno),
    versionPublicada(entorno),
    versionesInstaladas(entorno),
    entorno.estimarEspacio().catch(nada),
  ]);
  const copia = {
    admite: Boolean(entorno.funciones.serviceWorker),
    controlada: entorno.controlada,
    instaladas,
    publicada,
  };
  return {
    version: textoOpcionalDe(salud?.cuerpo, 'version'),
    resultados: [
      comprobarNavegador(entorno.funciones),
      ...comprobarServidor(entorno.enLinea, salud),
      comprobarCopia(copia),
      comprobarEspacio(estimacion),
      comprobarIdioma(idiomaPagina, entorno.idiomaNavegador),
    ],
  };
}
