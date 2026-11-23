// Las condiciones del ensayo del presupuesto de rendimiento (presupuesto-rendimiento.mjs): escritorio sin limitar y
// móvil con la conexión limitada en el servidor del ensayo, igual para los tres motores. Aquí están los perfiles, la
// identidad móvil que se deriva de la del proyecto, el arranque de cada motor con esa identidad y el contexto limpio.
import assert from 'node:assert/strict';
import { devices } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { CERTIFICADO_DEL_ENSAYO_EN_CHROMIUM, contextoConCache, credencialesDelContexto } from './cache-fiel.mjs';
import { arrancar, OPCIONES_DE_CONTEXTO } from './paquete-comun.mjs';

const MS_POR_MINUTO = 60_000;
const BITS_POR_BYTE = 8;
/** La CPU del teléfono: cuatro veces más lenta, como el perfil móvil de Lighthouse. Solo Chromium la emula. */
const CPU_MOVIL = 4;
/** El techo de cada espera (un hito, la copia), en minutos: holgado para que la red limitada no corte la medida. */
const PLAZO_ESCRITORIO_MIN = 2;
const PLAZO_4G_MIN = 20;
const PLAZO_3G_MIN = 45;
/**
 * El límite total de cada escenario, en minutos, para todas sus esperas juntas (presupuesto-plazo.mjs): el mismo para
 * todas las construcciones. Sin red limitada la copia completa se guarda en segundos: 2 minutos, y 4 en la segunda
 * visita, que son dos visitas. En 4G lenta (200 kB/s) una copia completa de 25,09 MB en 287 peticiones no puede bajar
 * de 125 s y se midió en 131,5 s (Firefox) y 138,5 s (Chromium): 10 minutos son 4,3 veces esa medida y dejan ver si
 * una construcción que pide hasta unas cuatro veces más llega a completarla. La 3G baja a la cuarta parte (50 kB/s, al
 * menos 502 s para la misma copia): el límite se escala igual, a 40 minutos.
 */
const LIMITE_ESCRITORIO_MIN = 2;
const LIMITE_SEGUNDA_VISITA_MIN = 4;
const LIMITE_4G_MIN = 10;
const LIMITE_3G_MIN = 40;
/** El teléfono emulado: su pantalla, densidad y pantalla táctil; el agente de usuario es el del proyecto. */
export const DISPOSITIVO = 'Pixel 7';

/**
 * Los perfiles. `bajada` en bits por segundo y `latenciaMs` añadida a cada respuesta, aplicadas por el servidor del
 * ensayo. 4G lenta: 1,6 Mbps y 150 ms de ida y vuelta, con la CPU 4× más lenta (el perfil móvil predeterminado de
 * Lighthouse, «Slow 4G»). 3G: 400 kbps y 400 ms (el perfil «3G Slow» de WebPageTest). La subida no se limita: las
 * peticiones de estos escenarios son GET sin cuerpo. `plazoMs` es el techo de cada espera (un hito, la copia, la
 * calma del tráfico) y `limiteTotalMs`, el de todas las esperas del escenario juntas, que es el que manda.
 * `segunda-visita`: escritorio, pero lo que se mide es la recarga de la página en el mismo contexto, después de una
 * primera visita con la copia completa: lo que se vuelve a pedir cuando ya está todo guardado.
 */
const ESCRITORIO = {
  movil: false,
  bajada: null,
  latenciaMs: 0,
  cpu: null,
  plazoMs: PLAZO_ESCRITORIO_MIN * MS_POR_MINUTO,
  limiteTotalMs: LIMITE_ESCRITORIO_MIN * MS_POR_MINUTO,
};
export const CONDICIONES = Object.freeze({
  escritorio: ESCRITORIO,
  'segunda-visita': { ...ESCRITORIO, segundaVisita: true, limiteTotalMs: LIMITE_SEGUNDA_VISITA_MIN * MS_POR_MINUTO },
  'movil-4g-lenta': {
    movil: true,
    bajada: 1_600_000,
    latenciaMs: 150,
    cpu: CPU_MOVIL,
    plazoMs: PLAZO_4G_MIN * MS_POR_MINUTO,
    limiteTotalMs: LIMITE_4G_MIN * MS_POR_MINUTO,
  },
  'movil-3g': {
    movil: true,
    bajada: 400_000,
    latenciaMs: 400,
    cpu: CPU_MOVIL,
    plazoMs: PLAZO_3G_MIN * MS_POR_MINUTO,
    limiteTotalMs: LIMITE_3G_MIN * MS_POR_MINUTO,
  },
});

/** Bytes por segundo de bajada de una condición, o null si no se limita. */
export const bytesPorSegundo = (condicion) => (condicion.bajada ? condicion.bajada / BITS_POR_BYTE : null);

const SISTEMA_DE_ESCRITORIO = /\(Windows NT 10\.0; Win64; x64\)/u;
const FINAL_DE_ESCRITORIO = / Safari\/537\.36$/u;

/**
 * La identidad móvil del proyecto: la misma versión de Chrome que la de escritorio, con el sistema genérico que Chrome
 * da en Android con el agente de usuario reducido («Linux; Android 10; K»: ningún modelo de teléfono) y sus pistas.
 */
export function identidadMovil() {
  const agente = IDENTIDAD_WEB['User-Agent'];
  assert.match(agente, SISTEMA_DE_ESCRITORIO, 'La identidad web ya no es la de Chrome en Windows');
  assert.match(agente, FINAL_DE_ESCRITORIO, 'La identidad web ya no es la de Chrome en Windows');
  return Object.freeze({
    ...IDENTIDAD_WEB,
    'User-Agent': agente
      .replace(SISTEMA_DE_ESCRITORIO, '(Linux; Android 10; K)')
      .replace(FINAL_DE_ESCRITORIO, ' Mobile Safari/537.36'),
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
  });
}

/** La identidad con que el navegador se presenta en una condición. */
export const identidadDe = (condicion) => (condicion.movil ? identidadMovil() : IDENTIDAD_WEB);

/**
 * Arranca un motor con la identidad de la condición también en lo que pide por su cuenta (el service worker), con
 * `arrancar` de paquete-comun.mjs. Chromium arranca dando por válido, solo en su perfil, el certificado sintético del
 * ensayo (su SPKI, cache-fiel.mjs; el navegador lo exige junto a `--user-data-dir`, que Playwright pone siempre): la
 * conexión queda sin error de certificado, como contra el dominio real, sin tocar la confianza del sistema. Con
 * `--ignore-certificate-errors` el error solo se pasa por alto: el service worker se registra, pero Chromium no guarda
 * en su caché HTTP nada que llegue con error de certificado (net/http/http_cache_transaction.cc) y la segunda visita
 * no la mediría. WebKit y Firefox aceptan el certificado con `ignoreHTTPSErrors` del contexto y guardan en caché.
 * `recursos` son los del caso que arranca, si su caso tiene plazo (los pasa a `arrancar`).
 */
export const arrancarCon = (motor, condicion, recursos) =>
  arrancar(motor, {
    agente: identidadDe(condicion)['User-Agent'],
    otrosDeChromium: [CERTIFICADO_DEL_ENSAYO_EN_CHROMIUM],
    recursos,
  });

/**
 * La emulación del teléfono en cada motor: pantalla, densidad y pantalla táctil en los tres; `isMobile` (ventana
 * gráfica y eventos de un móvil) en Chromium y WebKit, porque Firefox no la admite.
 */
export function emulacionMovil(motor) {
  const { userAgent: _agente, defaultBrowserType: _motor, isMobile, ...pantalla } = devices[DISPOSITIVO];
  return motor === 'firefox' ? pantalla : { ...pantalla, isMobile };
}

/**
 * Las marcas que la página deja para el ensayo, desde antes de sus propios scripts: cuándo el service worker queda
 * activado y cuándo responde cómo ha quedado el paquete de datos (ESTADO_DEL_PAQUETE, el mensaje que la página recibe
 * tras pedir su copia; mismo valor que service-worker.js y scripts/paquete-sin-conexion.js). Tiempos en ms de época.
 */
function marcarCopia() {
  const marcas = { activado: null, paquete: null, progresos: 0 };
  Object.defineProperty(window, '__presupuesto', { value: marcas });
  const ahora = () => performance.timeOrigin + performance.now();
  localStorage.setItem('faro-idioma', 'es');
  localStorage.setItem('faro-modo-elegido', 'ia-off');
  if (!navigator.serviceWorker) {
    return;
  }
  navigator.serviceWorker.ready.then(({ active }) => {
    const ver = () => {
      marcas.activado ??= active?.state === 'activated' ? ahora() : null;
    };
    ver();
    active?.addEventListener('statechange', ver);
  });
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.type === 'PROGRESO_DEL_PAQUETE') {
      marcas.progresos += 1;
    }
    if (data?.type === 'ESTADO_DEL_PAQUETE' && marcas.paquete === null) {
      marcas.paquete = { t: ahora(), completo: data.completo === true, version: String(data.version) };
    }
  });
}

/**
 * Un contexto nuevo, con perfil limpio y la caché HTTP del navegador (contextoConCache de cache-fiel.mjs: en WebKit,
 * un perfil persistente nuevo), en la `sesion` de arrancarCon, para la construcción privada servida en `origen` (su
 * Basic sintético), con la identidad y la emulación de la condición, en castellano y con el recorrido sin IA. El
 * servidor del ensayo usa un certificado sintético de loopback: el contexto lo acepta. El Basic lo dan
 * `httpCredentials` en WebKit y Firefox y autenticarEnChromium() en Chromium, donde `httpCredentials` desactivaría la
 * caché HTTP de todo el contexto.
 */
export async function contextoDelEnsayo(sesion, { motor, condicion, origen }) {
  const identidad = identidadDe(condicion);
  const contexto = await contextoConCache(sesion, motor, {
    ...OPCIONES_DE_CONTEXTO,
    ...(condicion.movil ? emulacionMovil(motor) : {}),
    userAgent: identidad['User-Agent'],
    extraHTTPHeaders: { ...identidad },
    ignoreHTTPSErrors: true,
    ...credencialesDelContexto(motor, origen),
  });
  await contexto.addInitScript(marcarCopia);
  return contexto;
}

/**
 * En Chromium, la CPU de la página limitada por el protocolo de depuración (Emulation.setCPUThrottlingRate) antes de
 * navegar. Alcanza al hilo principal de la página; sus Workers y el service worker son otros destinos y no se limitan.
 * En WebKit y Firefox Playwright no ofrece ninguna limitación de CPU: se dice en el resultado.
 */
export async function limitarCpu(contexto, pagina, { motor, condicion }) {
  if (!condicion.cpu) {
    return 'sin limitar';
  }
  if (motor !== 'chromium') {
    return `sin limitar: ${motor} no ofrece limitación de CPU en Playwright`;
  }
  const sesion = await contexto.newCDPSession(pagina);
  await sesion.send('Emulation.setCPUThrottlingRate', { rate: condicion.cpu });
  return `${condicion.cpu}× en el hilo principal de la página (Workers y service worker sin limitar)`;
}
