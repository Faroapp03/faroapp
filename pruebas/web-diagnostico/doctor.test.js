// Las comprobaciones de «Comprobación» (scripts/doctor/comprobaciones.js) con un navegador de mentira: cada semáforo y
// su qué hacer, con y sin conexión, con la copia al día o anterior, sin IA o con su tope; cada caso que pueden dar
// tiene sus textos en los dos idiomas, y ninguna comprobación lee lo que guarda el recorrido.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ca from '../../web/idiomas/ca.js';
import es from '../../web/idiomas/es.js';
import {
  comprobarCopia,
  comprobarEspacio,
  comprobarNavegador,
  comprobarServidor,
  comprobarTodo,
} from '../../web/scripts/doctor/comprobaciones.js';
import { servicioPublicado } from '../ayudas/web-construida.ts';

const TODAS = {
  fetch: true,
  AbortController: true,
  TextEncoder: true,
  URL: true,
  Intl: true,
  serviceWorker: true,
  caches: true,
  localStorage: true,
};
const SALUD = {
  estado: 'ok',
  version: '1.0.0',
  interruptores: { formacionAbierta: 'publica', sinConexion: true },
  soporte: 'soporte@faro.example',
};
const BASE = 'https://faroapp.org/';
/** Dos VERSION con la forma de la publicada: 16 cifras hexadecimales. */
const AAAA = 'aaaaaaaaaaaaaaaa';
const BBBB = 'bbbbbbbbbbbbbbbb';
const ENTRADA_DIAGNOSTICO = new URL('../../web/scripts/doctor/comprobaciones.js', import.meta.url).href;

/** Lo que el diagnóstico pide, cada cosa con su plazo: la salud del servidor y el service worker publicado. */
const PEDIDAS = Object.freeze(['/api/salud', 'service-worker.js']);
/**
 * El plazo de cada petición del diagnóstico, en milisegundos: copia de ESPERA_MS (scripts/doctor/comprobaciones.js),
 * que también exporta el módulo.
 */
const PLAZO_DEL_DIAGNOSTICO_MS = 6000;
/** Lo más que puede tardar el proceso aparte, en milisegundos: holgado, para que una máquina cargada no lo agote. */
const PLAZO_DEL_PROCESO_MS = 30_000;

/**
 * El navegador de mentira del proceso aparte: anota cada consulta en `consultas` y, en el modo «plazo», no responde
 * hasta que se corta su señal. Va en el texto del programa junto a diagnosticoEnOtroProceso.
 * @param {string} modo @param {object} salud @param {object} funciones
 * @param {{ direccion: string, opciones: any }[]} consultas
 */
function entornoDelProceso(modo, salud, funciones, consultas) {
  return {
    fetch: (/** @type {string} */ direccion, /** @type {any} */ opciones) => {
      consultas.push({ direccion, opciones });
      if (modo === 'plazo') {
        return new Promise((_, rechazar) => {
          opciones.signal.addEventListener('abort', () => rechazar(opciones.signal.reason), { once: true });
        });
      }
      const cuerpo = direccion === '/api/salud' ? JSON.stringify(salud) : 'var VERSION = "aaaaaaaaaaaaaaaa";';
      return Promise.resolve(new Response(cuerpo));
    },
    caches: undefined,
    location: { href: 'https://faro.example/doctor.html' },
    enLinea: true,
    idiomaNavegador: 'es',
    controlada: false,
    estimarEspacio: async () => null,
    funciones,
  };
}

/**
 * El diagnóstico en un proceso aparte, sin AbortSignal.timeout ni AbortSignal.any (y, en el modo «sin-senal», sin
 * AbortSignal): así se prueban funciones ausentes sin alterar la plataforma de las otras pruebas. Se ejecuta con su
 * texto (`node -e`), así que solo usa sus parámetros y lo que importa; Biome y tsc lo revisan aquí como al resto.
 * Lo que comprueba lo comprueba después de esperar al diagnóstico, para que un fallo no se confunda con un rechazo
 * de la red.
 * @param {{ modo: string, entrada: string, salud: typeof SALUD, funciones: object, pedidas: readonly string[],
 *   plazoMs: number }} parametros
 */
async function diagnosticoEnOtroProceso({ modo, entrada, salud, funciones, pedidas, plazoMs }) {
  /** @type {typeof assert} */
  const afirmar = (await import('node:assert/strict')).default;
  Reflect.deleteProperty(AbortSignal, 'timeout');
  Reflect.deleteProperty(AbortSignal, 'any');
  if (modo === 'sin-senal') {
    Reflect.deleteProperty(globalThis, 'AbortSignal');
  }
  /** @type {{ cortar: () => void, milisegundos: number }[]} */
  const plazos = [];
  globalThis.setTimeout = /** @type {any} */ (
    (/** @type {() => void} */ cortar, /** @type {number} */ milisegundos) => plazos.push({ cortar, milisegundos })
  );
  const { comprobarTodo } = await import(entrada);
  /** @type {{ direccion: string, opciones: RequestInit & { signal: AbortSignal } }[]} */
  const consultas = [];
  const pendiente = comprobarTodo(entornoDelProceso(modo, salud, funciones, consultas), 'es');
  afirmar.deepEqual(
    plazos.map(({ milisegundos }) => milisegundos),
    modo === 'sin-senal' ? [] : pedidas.map(() => plazoMs),
  );
  if (modo === 'plazo') {
    for (const plazo of plazos) {
      plazo.cortar();
    }
  }
  const hecho = await pendiente;
  afirmar.deepEqual(consultas.map(({ direccion }) => direccion).sort(), modo === 'sin-senal' ? [] : [...pedidas]);
  for (const { opciones } of consultas) {
    afirmar.ok(opciones.signal instanceof AbortSignal);
    afirmar.equal(opciones.cache, 'no-store');
    afirmar.equal(opciones.signal.reason?.name, modo === 'plazo' ? 'TimeoutError' : undefined);
  }
  const conexion = hecho.resultados.find((/** @type {{ id: string }} */ { id }) => id === 'conexion');
  afirmar.equal(conexion.caso, modo === 'responde' ? 'con-red' : 'sin-servidor');
  afirmar.equal(hecho.version, modo === 'responde' ? salud.version : null);
}

/** Un navegador de mentira: lo que responde cada dirección (o null, sin red) y las copias guardadas.
 * @param {{ enLinea?: boolean, salud?: typeof SALUD, publicada?: string, instaladas?: string[], espacio?: { usage?: number, quota?: number } | null }} [opciones]
 */
function entorno({ enLinea = true, salud = SALUD, publicada = AAAA, instaladas = [AAAA], espacio = null } = {}) {
  /** @type {string[]} */
  const pedidas = [];
  /** @type {RequestInit[]} */
  const opcionesPedidas = [];
  return {
    pedidas,
    opcionesPedidas,
    fetch: async (/** @type {string} */ direccion, /** @type {RequestInit} */ opciones) => {
      pedidas.push(direccion);
      opcionesPedidas.push(opciones);
      if (!enLinea) {
        throw new TypeError('Failed to fetch');
      }
      if (direccion === '/api/salud') {
        return new Response(JSON.stringify(salud), { status: 200 });
      }
      return new Response(`// …\nvar VERSION = "${publicada}";\n`, { status: 200 });
    },
    caches: { keys: async () => [...instaladas.map((version) => `faro:${BASE}:${version}`), 'otra-web'] },
    location: { href: `${BASE}doctor.html` },
    enLinea,
    idiomaNavegador: 'ca-ES',
    controlada: instaladas.length > 0,
    estimarEspacio: async () => espacio,
    funciones: TODAS,
  };
}

/** @param {import('../../web/scripts/doctor/comprobaciones.js').Resultado[]} resultados */
function porId(resultados) {
  return Object.fromEntries(resultados.map((comprobado) => [comprobado.id, comprobado]));
}

test('«Comprobación»: todo bien: seis comprobaciones en verde, con la versión del servidor y sin segunda fuente de contacto', async () => {
  const hecho = await comprobarTodo(entorno(), 'es');
  assert.equal(hecho.version, '1.0.0');
  assert.equal(Object.hasOwn(hecho, 'soporte'), false, 'el contacto no procede de salud');
  assert.deepEqual(
    hecho.resultados.map((comprobado) => [comprobado.id, comprobado.semaforo]),
    ['navegador', 'conexion', 'servidor', 'copia', 'espacio', 'idioma'].map((id) => [id, 'bien']),
  );
});

test('«Comprobación»: sin conexión: la conexión y el servidor fallan, la copia no se compara', async () => {
  const vistos = porId((await comprobarTodo(entorno({ enLinea: false }), 'es')).resultados);
  assert.ok(vistos.conexion && vistos.servidor && vistos.copia);
  assert.equal(vistos.conexion.caso, 'sin-red');
  assert.equal(vistos.conexion.semaforo, 'fallo');
  assert.equal(vistos.servidor.semaforo, 'fallo');
  assert.deepEqual([vistos.copia.semaforo, vistos.copia.caso], ['bien', 'sin-comparar']);
});

test('«Comprobación»: la copia anterior a la publicada pide reabrir Faro; sin copia, recargar', () => {
  const anterior = comprobarCopia({ admite: true, controlada: true, instaladas: ['viej'], publicada: 'nuev' });
  assert.deepEqual([anterior.semaforo, anterior.caso], ['atencion', 'anterior']);
  assert.deepEqual(anterior.valores, { instalada: 'viej', publicada: 'nuev' });
  assert.equal(comprobarCopia({ admite: true, controlada: false, instaladas: [], publicada: 'n' }).caso, 'sin-copia');
  assert.equal(comprobarCopia({ admite: false, controlada: false, instaladas: [], publicada: 'n' }).caso, 'no-admite');
});

test('«Comprobación»: el servidor sano, con un error o sin respuesta', () => {
  const [, sano] = comprobarServidor(true, { estado: 200, cuerpo: SALUD });
  assert.ok(sano);
  assert.equal(sano.caso, 'responde');
  const [, conError] = comprobarServidor(true, { estado: 503, cuerpo: null });
  assert.ok(conError);
  assert.equal(conError.caso, 'error');
  const [conexion] = comprobarServidor(true, null);
  assert.ok(conexion);
  assert.equal(conexion.caso, 'sin-servidor');
});

test('«Comprobación»: el navegador al que le falta fetch falla; sin service worker, atención', () => {
  assert.equal(comprobarNavegador({ ...TODAS, fetch: false }).semaforo, 'fallo');
  assert.equal(comprobarNavegador({ ...TODAS, serviceWorker: false }).semaforo, 'atencion');
});

test('«Comprobación»: el espacio justo y el sin dato', () => {
  assert.equal(comprobarEspacio({ usage: 10, quota: 1024 }).caso, 'justo');
  assert.equal(comprobarEspacio(null).caso, 'sin-dato');
});

test('«Comprobación»: solo pide /api/salud y service-worker.js, sin caché', async () => {
  const navegador = entorno();
  await comprobarTodo(navegador, 'es');
  assert.deepEqual(navegador.pedidas.sort(), [...PEDIDAS]);
  assert.deepEqual(
    navegador.opcionesPedidas.map((opciones) => opciones.cache),
    PEDIDAS.map(() => 'no-store'),
  );
});

test('«Comprobación»: cada caso tiene nombre, detalle y qué hacer en castellano y en catalán', () => {
  const casos = {
    navegador: ['completo', 'sin-copia', 'viejo'],
    conexion: ['con-red', 'sin-red', 'sin-servidor'],
    servidor: ['responde', 'sin-respuesta', 'error'],
    copia: ['no-admite', 'sin-copia', 'anterior', 'al-dia', 'sin-comparar'],
    espacio: ['holgado', 'justo', 'sin-dato'],
    idioma: ['castellano', 'catalan'],
  };
  const todos = Object.entries(casos).flatMap(([id, deLaComprobacion]) => deLaComprobacion.map((caso) => [id, caso]));
  for (const diccionario of [es, ca]) {
    for (const [id, caso] of todos) {
      for (const clave of [`doctor.${id}.nombre`, `doctor.${id}.${caso}.detalle`, `doctor.${id}.${caso}.accion`]) {
        assert.ok(typeof diccionario[clave] === 'string' && diccionario[clave].trim() !== '', `falta ${clave}`);
      }
    }
  }
});

test('«Comprobación»: ninguna comprobación toca el almacenamiento del navegador', async (contexto) => {
  /** @type {string[]} */
  const tocados = [];
  const prohibido = (/** @type {string} */ nombre) => ({
    configurable: true,
    get: () => {
      tocados.push(nombre);
      throw new Error(`el diagnóstico no puede leer ${nombre}`);
    },
  });
  /** @type {[string, PropertyDescriptor | undefined][]} */
  const originales = ['localStorage', 'sessionStorage', 'indexedDB'].map((nombre) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, nombre);
    Object.defineProperty(globalThis, nombre, prohibido(nombre));
    return [nombre, original];
  });
  contexto.after(() => {
    for (const [nombre, original] of originales) {
      if (original) {
        Object.defineProperty(globalThis, nombre, original);
      } else {
        Reflect.deleteProperty(globalThis, nombre);
      }
    }
  });
  // Las ramas con red y sin ella, con copia al día y anterior, y sin CacheStorage: ninguna lee el almacenamiento.
  for (const opciones of [
    {},
    { enLinea: false, instaladas: [] },
    { enLinea: true, instaladas: [BBBB], publicada: AAAA, espacio: { usage: 10, quota: 1024 } },
  ]) {
    await comprobarTodo(entorno(opciones), 'es');
    assert.deepEqual(tocados, []);
  }
  const sinCache = entorno();
  Object.assign(sinCache, { caches: undefined });
  await comprobarTodo(sinCache, 'ca');
  assert.deepEqual(tocados, []);
});

test('«Comprobación»: ninguna comprobación cita lo que guarda el recorrido (guarda estática del código)', () => {
  const fuente = readFileSync(new URL('../../web/scripts/doctor/comprobaciones.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /sessionStorage|localStorage\.getItem|indexedDB|recorrido\//);
});

test('el diagnóstico consulta y respeta su plazo aunque el navegador no tenga AbortSignal.timeout', () => {
  for (const modo of ['responde', 'plazo', 'sin-senal']) {
    const parametros = {
      modo,
      entrada: ENTRADA_DIAGNOSTICO,
      salud: SALUD,
      funciones: TODAS,
      pedidas: PEDIDAS,
      plazoMs: PLAZO_DEL_DIAGNOSTICO_MS,
    };
    const programa = `const entornoDelProceso = ${entornoDelProceso};\nawait (${diagnosticoEnOtroProceso})(${JSON.stringify(parametros)});`;
    const proceso = spawnSync(process.execPath, ['--input-type=module', '-e', programa], {
      encoding: 'utf8',
      timeout: PLAZO_DEL_PROCESO_MS,
    });
    assert.equal(
      proceso.error,
      undefined,
      `${modo}: el proceso no terminó en ${PLAZO_DEL_PROCESO_MS} ms: ${proceso.error}`,
    );
    assert.equal(proceso.status, 0, `${modo}: ${proceso.stderr}`);
  }
});

test('el prefijo de las copias que lee Comprobación es el mismo que escribe el service worker', () => {
  const trabajador = servicioPublicado();
  const doctor = readFileSync(new URL('../../web/scripts/doctor/comprobaciones.js', import.meta.url), 'utf8');
  assert.match(trabajador, /^var PREFIJO = `faro:\$\{BASE\.href\}:`;$/mu);
  assert.match(doctor, /const prefijo = `faro:\$\{new URL\('\.\/', entorno\.location\.href\)\.href\}:`;/);
});

// Dos instalaciones en el mismo origen (la raíz y una carpeta con espacios y tildes): cada una compara solo sus copias.
test('«Comprobación»: cada instalación solo reconoce las copias de su propia base', async () => {
  const raiz = 'https://ejemplo.invalid/';
  const interior = 'https://ejemplo.invalid/Mis%20documentos/A%C3%B1o%202026/';
  const nombres = [`faro:${raiz}:${BBBB}`, `faro:${interior}:${AAAA}`, `faro:https://otra.invalid/:${AAAA}`];
  /** @param {string} base */
  const diagnostico = async (base) => {
    const deLaBase = entorno({ publicada: AAAA });
    deLaBase.location.href = `${base}doctor.html`;
    deLaBase.caches = { keys: async () => nombres };
    return porId((await comprobarTodo(deLaBase, 'es')).resultados).copia;
  };
  const enRaiz = await diagnostico(raiz);
  const enInterior = await diagnostico(interior);
  assert.equal(enRaiz?.caso, 'anterior');
  assert.equal(enInterior?.caso, 'al-dia');
});
