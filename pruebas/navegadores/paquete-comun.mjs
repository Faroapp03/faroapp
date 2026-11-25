// Piezas comunes de los ensayos del paquete en navegador (descargas, módulo alterado, WebMCP y actualización del
// service worker): argumentos, arranque de cada motor con sus carpetas propias y contexto limpio con la identidad web.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, firefox, webkit } from 'playwright-core';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { versionDelServicio } from '../../web/scripts/version-del-servicio.js';
import { cargarArtefacto } from './artefacto.ts';
import { identidadAlArrancar } from './identidad-al-arrancar.ts';
import { CREDENCIALES_SINTETICAS } from './privado.ts';
import {
  abrirNavegador,
  arrancarConPlazo,
  avisarDelCierre,
  cerrarSinSustituir,
  conPlazo,
  conSusProcesos,
  forzarLosVistos,
  PLAZO_DE_ARRANQUE_MS,
} from './recursos-del-caso.mjs';

/** PLAZO_DE_ARRANQUE_MS (recursos-del-caso.mjs) es el plazo común de arranque de todos los ensayos. */
export { identidadAlArrancar, PLAZO_DE_ARRANQUE_MS };
export const MOTORES = { chromium, firefox, webkit };
/** Los motores que se prueban si no se indica ninguno. */
const MOTORES_PREDETERMINADOS = ['chromium', 'firefox', 'webkit'];
export const PLAZO_MS = 90_000;
/** Lo que se guarda de un texto de la consola o de la página en los registros. */
const CORTE_DE_TEXTO = 300;
/** Un texto recortado para los registros. */
export const recortar = (texto) => String(texto).slice(0, CORTE_DE_TEXTO);

/**
 * Los argumentos de un ensayo: `--artefacto <carpeta>` (repetible, con `nombre=carpeta` para darle nombre),
 * `--motor <nombre>` (repetible) y `--salida <carpeta>` para sus registros.
 */
export function argumentos(opcionesPropias = {}) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      artefacto: { type: 'string', multiple: true },
      motor: { type: 'string', multiple: true },
      salida: { type: 'string' },
      ...opcionesPropias,
    },
    strict: true,
  });
  const artefactos = (values.artefacto ?? ['dist']).map((valor) => {
    const [nombre, carpeta] = valor.includes('=') ? valor.split(/=(.*)/su) : [valor.split('/').at(-1), valor];
    return { nombre, carpeta: resolve(carpeta) };
  });
  const motores = values.motor ?? MOTORES_PREDETERMINADOS;
  for (const motor of motores) {
    if (!(motor in MOTORES)) {
      throw new Error(`Motor desconocido: ${motor}`);
    }
  }
  return { ...values, artefactos, motores };
}

/** Las variables de entorno que pasan al navegador. */
const ENTORNO_PERMITIDO = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];

/**
 * El entorno del navegador: el permitido de este proceso y, para Firefox, sus carpetas de datos en `carpeta` (app/ y
 * cache/, que tienen que existir): sin ellas no arranca en este equipo.
 */
export function entornoDelNavegador(carpeta) {
  const entorno = Object.fromEntries(
    ENTORNO_PERMITIDO.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  return { ...entorno, MOZ_APP_DATA: join(carpeta, 'app'), MOZ_LOCAL_APP_DATA: join(carpeta, 'cache') };
}

/**
 * Termina el árbol de procesos de un navegador cuyo cierre venció (forzarLosVistos, que falla si no se vio ninguno) y
 * anota los dos motivos sin lanzarlos.
 */
async function forzarYAvisar(error, procesos) {
  const motivo = error instanceof Error ? error.message : String(error);
  try {
    await forzarLosVistos(procesos);
    avisarDelCierre(`${motivo}; se ha terminado su árbol de procesos`);
  } catch (fallo) {
    avisarDelCierre(`${motivo}; ${fallo instanceof Error ? fallo.message : String(fallo)}`);
  }
}

/**
 * Cierra el navegador y retira sus carpetas. Se llama desde un `finally`: no lanza, para no sustituir el error del
 * cuerpo. Si el cierre vence, termina el árbol de procesos del navegador (forzarLosVistos) antes de retirar sus carpetas;
 * cualquier fallo se anota con avisarDelCierre (stderr y código de error), así que se ven los dos.
 */
async function cerrarYRetirar(navegador, procesos, temporal, motor) {
  try {
    await conPlazo(navegador.close(), PLAZO_MS, `el navegador ${motor} no se cerró`);
  } catch (error) {
    await forzarYAvisar(error, procesos);
  }
  await retirarCarpetas(temporal, motor);
}

/** Una carpeta temporal nueva para el navegador `motor`, con app/ y cache/ (las de Firefox, entornoDelNavegador). */
function carpetasDelNavegador(motor) {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), `faro-paquete-${motor}-`));
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  return temporal;
}

/** Retira las carpetas del navegador `motor` sin lanzar: un fallo se anota con avisarDelCierre. */
function retirarCarpetas(temporal, motor) {
  return cerrarSinSustituir(
    () => rmSync(temporal, { recursive: true, force: true }),
    `las carpetas del navegador ${motor} no se pudieron retirar`,
  );
}

/**
 * Arranca un motor con carpetas temporales propias (Firefox guarda ahí su perfil y su caché) y las retira al cerrar.
 * `agente` y `otrosDeChromium` pasan a identidadAlArrancar (la identidad móvil y el certificado del presupuesto).
 * `recursos` son los del caso de node:test que arranca, si su caso tiene plazo y puede vencer (recursosDelCaso): con
 * ellos, las carpetas y el navegador son recursos del caso, que su after cierra aunque el caso venza; si vence mientras
 * arranca, su after lo dice, y solo se toman por del navegador los procesos que había al vencer, no los del caso
 * siguiente (conSusProcesos). La sesión los lleva consigo, para los perfiles que abra contextoConCache (cache-fiel.mjs).
 * Sin ellos, como en los ensayos que se ejecutan con su orden y sin plazo por caso, se supone que mientras arranca este
 * proceso no lanza otros hijos. Con ellos y sin ellos, el arranque es el de arrancarConPlazo: Playwright recibe el plazo
 * común y, si falla, su error queda como causa; si no responde ni con el margen de respaldo, se terminan los procesos que
 * dejó el arranque y el navegador que llegue después se cierra.
 */
export function arrancar(motor, { agente, otrosDeChromium, recursos } = {}) {
  const lanzar = (temporal) =>
    arrancarConPlazo(
      () =>
        MOTORES[motor].launch({
          headless: true,
          timeout: PLAZO_DE_ARRANQUE_MS,
          ...identidadAlArrancar(motor, otrosDeChromium, agente),
          env: entornoDelNavegador(temporal),
        }),
      `el navegador ${motor} no llegó a arrancar`,
      PLAZO_DE_ARRANQUE_MS,
      { recursos },
    );
  return recursos ? arrancarEnElCaso(motor, lanzar, recursos) : arrancarSinCaso(motor, lanzar);
}

/** El arranque de `arrancar` sin los recursos de un caso. */
async function arrancarSinCaso(motor, lanzar) {
  const temporal = carpetasDelNavegador(motor);
  try {
    const { recurso: navegador, procesos } = await conSusProcesos(() => lanzar(temporal));
    return {
      navegador,
      temporal,
      recursos: undefined,
      /**
       * Cierra el navegador y retira sus carpetas. Se llama desde un `finally`: no lanza, para no sustituir el error
       * del cuerpo. Si el cierre vence, termina el árbol de procesos del navegador (forzarLosVistos) antes de retirar sus
       * carpetas; cualquier fallo se anota con avisarDelCierre (stderr y código de error), así que se ven los dos.
       */
      cerrar: () => cerrarYRetirar(navegador, procesos, temporal, motor),
    };
  } catch (error) {
    // El fallo del arranque es el que se informa; uno al retirar las carpetas se anota aparte.
    await retirarCarpetas(temporal, motor);
    throw error;
  }
}

/** El arranque de `arrancar` con los recursos del caso: las carpetas y el navegador quedan registrados en él. */
async function arrancarEnElCaso(motor, lanzar, recursos) {
  const temporal = await recursos.abrir(
    `las carpetas del navegador ${motor}`,
    () => carpetasDelNavegador(motor),
    (ruta) => rmSync(ruta, { recursive: true, force: true }),
  );
  const navegador = await recursos.durante(`arrancando el navegador ${motor}`, () =>
    abrirNavegador(recursos, `el navegador ${motor}`, () => lanzar(temporal)),
  );
  return {
    navegador,
    temporal,
    recursos,
    /**
     * Cierra ya el navegador y retira sus carpetas, con el plazo y el forzado de los recursos del caso. No lanza, para
     * no sustituir el error del cuerpo: los fallos se anotan con avisarDelCierre y el after no los vuelve a intentar.
     */
    cerrar: async () => {
      await cerrarSinSustituir(() => recursos.cerrar(navegador), `el navegador ${motor} no se cerró`);
      await cerrarSinSustituir(
        () => recursos.cerrar(temporal),
        `las carpetas del navegador ${motor} no se pudieron retirar`,
      );
    },
  };
}

/**
 * El navegador `motor` con un perfil persistente en `carpeta` (perfil/; y app/ y cache/, que tienen que existir, para
 * Firefox), para la construcción privada servida en `origen` (su Basic sintético). Cerrarlo cierra el navegador entero;
 * volverlo a abrir con la misma carpeta recupera lo guardado (copias, service worker y datos de la página).
 */
export function abrirPerfil(motor, carpeta, origen) {
  return conPlazo(
    MOTORES[motor].launchPersistentContext(join(carpeta, 'perfil'), {
      headless: true,
      timeout: PLAZO_DE_ARRANQUE_MS,
      ...OPCIONES_DE_CONTEXTO,
      httpCredentials: { ...CREDENCIALES_SINTETICAS, origin: origen },
      ...identidadAlArrancar(motor),
      env: entornoDelNavegador(carpeta),
    }),
    PLAZO_DE_ARRANQUE_MS,
    `el navegador ${motor} no llegó a arrancar con su perfil`,
  );
}

/** Las opciones de un contexto con la identidad web del producto, en castellano y con el service worker permitido. */
export const OPCIONES_DE_CONTEXTO = Object.freeze({
  userAgent: IDENTIDAD_WEB['User-Agent'],
  viewport: { width: 1280, height: 900 },
  locale: 'es',
  timezoneId: 'Europe/Madrid',
  reducedMotion: 'reduce',
  colorScheme: 'light',
  serviceWorkers: 'allow',
  extraHTTPHeaders: { ...IDENTIDAD_WEB },
});

/** Un contexto nuevo, con perfil limpio: sin caché HTTP, almacenamiento ni service worker de otro escenario. */
export function contextoLimpio(navegador) {
  return navegador.newContext(OPCIONES_DE_CONTEXTO);
}

/**
 * Antes de cada carga: castellano y el recorrido sin IA. Lo que había antes de fijarlos queda en
 * `__faroPreferenciasAlCargar`: así un ensayo puede comprobar que una preferencia de la persona seguía al recargar,
 * aunque este guion la vuelva a fijar (modulo-alterado.mjs).
 */
export function preferenciasDelRecorrido() {
  const fijadas = { 'faro-idioma': 'es', 'faro-modo-elegido': 'ia-off' };
  globalThis.__faroPreferenciasAlCargar = {};
  for (const [clave, valor] of Object.entries(fijadas)) {
    globalThis.__faroPreferenciasAlCargar[clave] = localStorage.getItem(clave);
    localStorage.setItem(clave, valor);
  }
}

/**
 * Un contexto nuevo, con perfil limpio, para la construcción privada servida en `origen` (su Basic sintético), en
 * castellano y con el recorrido sin IA. `otras` son más opciones del contexto (ignoreHTTPSErrors, detrás del servidor
 * del ensayo con su certificado sintético).
 */
export async function contextoDelRecorrido(navegador, origen, otras = {}) {
  const contexto = await navegador.newContext({
    ...OPCIONES_DE_CONTEXTO,
    ...otras,
    httpCredentials: { ...CREDENCIALES_SINTETICAS, origin: origen },
  });
  await contexto.addInitScript(preferenciasDelRecorrido);
  return contexto;
}

/**
 * Instala el service worker de `origen` desde inicio.html: lo registra, espera al evento real de su instalación
 * terminada (instalacionVigilada: `activated`, o `redundant` si falla, con TOPE_DE_INSTALACION_MS), recarga y espera a
 * que controle la página. Las demás esperas tienen `plazoMs` (menor que el del caso) y cada una un mensaje que dice en
 * qué paso se quedó; con `peticiones`, también lo que ha visto el servidor hasta entonces. Devuelve lo que tardó la
 * instalación, en ms.
 *
 * @param {import('playwright-core').Page} pagina - La página.
 * @param {string} origen - La base de la web servida, terminada en «/».
 * @param {number} plazoMs - El plazo de cada espera, salvo la de la instalación.
 * @param {() => string} [peticiones] - Las peticiones que ha recibido y respondido el servidor, en una línea.
 * @returns {Promise<number>} Lo que tardó la instalación, del registro al estado `activated`, en ms.
 */
export async function instalarServiceWorker(pagina, origen, plazoMs, peticiones) {
  try {
    await pagina.goto(`${origen}inicio.html`, { timeout: plazoMs });
    await conPlazo(pagina.evaluate(instalacionVigilada), plazoMs, 'el service worker no se pudo registrar');
    const instalacionMs = await esperarInstalacionTerminada(pagina);
    await pagina.reload({ timeout: plazoMs });
    await pagina.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: plazoMs });
    return instalacionMs;
  } catch (error) {
    if (!peticiones) {
      throw error;
    }
    const mensaje = error instanceof Error ? error.message : String(error);
    throw new Error(`${mensaje}; peticiones al servidor: ${peticiones()}`, { cause: error });
  }
}

/**
 * En la página: registra service-worker.js y, en el mismo evaluate, toma la versión que se instala del registro que
 * devuelve register() y anota cada `statechange` con su ms desde el registro. Deja en
 * `__faroInstalacionTerminada` una promesa que se cumple con el primer estado final (`activated` o `redundant`), sus ms
 * y el ciclo anotado. Si la versión ya no se está instalando al devolver register(), se toma su estado tal cual.
 */
async function instalacionVigilada() {
  const inicio = performance.now();
  const ciclo = [];
  globalThis.__faroCicloDelServiceWorker = ciclo;
  const registro = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
  const trabajador = registro.installing ?? registro.waiting ?? registro.active;
  const anotar = () => ciclo.push(`${trabajador.state} a los ${Math.round(performance.now() - inicio)} ms`);
  anotar();
  globalThis.__faroInstalacionTerminada = new Promise((terminar) => {
    const mirar = () => {
      if (trabajador.state === 'activated' || trabajador.state === 'redundant') {
        terminar({ estado: trabajador.state, ms: performance.now() - inicio, ciclo });
      }
    };
    trabajador.addEventListener('statechange', () => {
      anotar();
      mirar();
    });
    mirar();
  });
  return true;
}

/**
 * Espera la instalación que vigila instalacionVigilada como mucho TOPE_DE_INSTALACION_MS y devuelve lo que tardó en
 * ms. El error distingue la instalación fallida (`redundant`, en cuanto ocurre) del tope agotado, y lleva el ciclo
 * anotado y el estado del registro.
 *
 * @param {import('playwright-core').Page} pagina - La página que registró el service worker con instalacionVigilada.
 */
export async function esperarInstalacionTerminada(pagina) {
  let final;
  try {
    final = await conPlazo(
      pagina.evaluate(() => globalThis.__faroInstalacionTerminada),
      TOPE_DE_INSTALACION_MS,
      'tope agotado',
    );
  } catch (error) {
    const motivo = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(
      `la instalación del service worker no terminó: ${motivo} sin activated ni redundant; ` +
        `${await cicloYRegistro(pagina)}`,
      { cause: error },
    );
  }
  if (final.estado === 'redundant') {
    throw new Error(
      `la instalación del service worker falló: quedó redundant a los ${Math.round(final.ms)} ms, sin agotar el ` +
        `tope de ${TOPE_DE_INSTALACION_MS} ms; ciclo: ${final.ciclo.join(', ')}`,
    );
  }
  return final.ms;
}

/** Lo que se espera, como mucho, a leer el estado del registro para el mensaje de una instalación que no terminó. */
const PLAZO_DEL_DIAGNOSTICO_MS = 2_000;

/**
 * El ciclo anotado por instalacionVigilada (si lo hay) y el estado del registro del service worker de la página, en
 * una línea: el de la versión que se instala, la que espera y la activa. Si no se puede leer, lo dice.
 *
 * @param {import('playwright-core').Page} pagina - La página.
 */
async function cicloYRegistro(pagina) {
  try {
    return await conPlazo(
      pagina.evaluate(async () => {
        const ciclo = globalThis.__faroCicloDelServiceWorker;
        const anotado = ciclo ? `ciclo: ${ciclo.join(', ')}; ` : '';
        const registro = await navigator.serviceWorker.getRegistration();
        if (!registro) {
          return `${anotado}registro: ninguno`;
        }
        const { installing, waiting, active } = registro;
        return `${anotado}registro: instalándose ${installing?.state ?? 'ninguno'}, en espera ${waiting?.state ?? 'ninguno'}, activo ${active?.state ?? 'ninguno'}`;
      }),
      PLAZO_DEL_DIAGNOSTICO_MS,
      'el estado del registro no se pudo leer',
    );
  } catch (error) {
    return error instanceof Error ? error.message.split('\n')[0] : String(error);
  }
}

/**
 * Lo más que tardó la instalación de instalarServiceWorker (catálogos de unas pocas páginas), del registro al estado
 * `activated`, medido el 2026-11-25 en el Mac de desarrollo (10 núcleos) con recorrido-en-la-copia, instalacion-cuota y
 * paso-a-privada en los tres motores: en reposo, 165 ms (Chromium); con 3, 10 y 20 procesos al 100 % de CPU, y con 10
 * más dos de esas pruebas a la vez, 354 ms (WebKit, con 10 procesos). Es una medida con carga artificial, no del
 * escenario que falló (la verificación completa), que no se ha podido medir. instalacion-con-carga.test.mjs la repite.
 */
export const PEOR_INSTALACION_MEDIDA_MS = 354;
/**
 * El tope de la espera de la instalación: los 30 s que tenía antes. No se baja: en dos verificaciones completas de
 * 2026-11-25 la instalación de Firefox no terminó en 30 s y la causa no se conoce; las medidas con carga artificial
 * (PEOR_INSTALACION_MEDIDA_MS) no reproducen ese escenario, así que no sirven para acotarlo. Si vence, el error dice
 * el ciclo anotado y el estado del registro (esperarInstalacionTerminada), para conocer la causa.
 */
export const TOPE_DE_INSTALACION_MS = 30_000;

/**
 * En la página: espera al evento real de un service worker activado, el `statechange` del activo del registro hasta
 * `activated`, para una página que lo registra ella misma.
 */
async function servicioActivado() {
  for (;;) {
    const { active } = await navigator.serviceWorker.ready;
    if (active?.state === 'activated') {
      return true;
    }
    await new Promise((seguir) => active?.addEventListener('statechange', seguir, { once: true }));
  }
}

/**
 * Espera a que la página tenga un service worker activado, por el evento real (servicioActivado), y devuelve su
 * estado. waitForFunction la vuelve a esperar si la página se recarga mientras (instalacion.js recarga al tomar el
 * control una versión nueva). El tope es PLAZO_MS, el común de los ensayos del paquete: la web que instalan es la
 * construcción entera.
 */
export async function esperarServiceWorkerActivado(pagina) {
  try {
    await pagina.waitForFunction(servicioActivado, undefined, { timeout: PLAZO_MS, polling: 100 });
  } catch (error) {
    const motivo = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(
      `el service worker no llegó a activarse: tope agotado (${PLAZO_MS} ms); ${await cicloYRegistro(pagina)}: ${motivo}`,
      { cause: error },
    );
  }
  return 'activated';
}

/**
 * La construcción que se ensaya: su carpeta, la VERSION de su service worker y la huella SHA-256 de su descriptor
 * (artefacto.json: la que da `artefacto.ts exportar` como sha256Artefacto). La escriben los ensayos en su registro (la
 * consola) y en su JSON, para que cada resultado diga sobre qué construcción se midió.
 */
export function construccionEnsayada(carpeta) {
  const fuente = readFileSync(join(carpeta, 'web/service-worker.js'), 'utf8');
  const version = versionDelServicio(fuente);
  const sha256Artefacto = createHash('sha256')
    .update(readFileSync(join(carpeta, 'artefacto.json')))
    .digest('hex');
  const construccion = { carpeta, version, sha256Artefacto };
  console.log(`Construcción ensayada: ${JSON.stringify(construccion)}`);
  return construccion;
}

/** El Worker de una construcción cargada: su ruta, la huella de sus bytes y la de su descriptor (artefacto.json). */
function workerDe(artefacto) {
  const ruta = join(artefacto.directorio, 'worker/worker.mjs');
  return {
    destino: artefacto.destino ?? 'privado',
    carpeta: artefacto.directorio,
    ruta,
    sha256: createHash('sha256').update(readFileSync(ruta)).digest('hex'),
    sha256Artefacto: createHash('sha256')
      .update(readFileSync(join(artefacto.directorio, 'artefacto.json')))
      .digest('hex'),
  };
}

/** La VERSION del service worker de una construcción cargada (su web/service-worker.js), o null si no la declara. */
const versionDe = (artefacto) => versionDelServicio(artefacto.leer('web/service-worker.js').toString('utf8'));

/**
 * Una construcción lista para fixture.ts. La de destino «oficial» lleva el Worker de la puerta del portal, que el
 * fixture no emula: se sirve su web (sus mismos bytes) con el Worker privado de otra construcción, que se indica, y
 * su propio Worker oficial queda en `oficial` (con su web, para la portada y el acceso). Con `mismaRevision` (el
 * presupuesto de rendimiento), el privado tiene que ser de la misma revisión del código y la misma VERSION; sin ella
 * no se exige, porque actualizacion-sw.mjs sirve la construcción anterior y la nueva con el mismo. `privado` y
 * `oficial` dicen qué Worker sirve cada parte: su ruta, su huella y la del artefacto.json de la construcción a la que
 * pertenece, y el módulo cargado, con el que se comprueba lo servido (presupuesto-servidor.mjs); el privado, también
 * su revisión y su VERSION. `cargar` sustituye a cargarArtefacto() en las pruebas sin construcción.
 */
export async function servible(carpeta, conWorkerPrivado, { mismaRevision = false, cargar = cargarArtefacto } = {}) {
  const artefacto = await cargar(carpeta);
  if (artefacto.destino !== 'oficial') {
    const privado = {
      ...workerDe(artefacto),
      worker: artefacto.worker,
      revisionCodigo: artefacto.resumen.revisionCodigo,
      version: versionDe(artefacto),
    };
    return { artefacto, servidor: `Worker ${artefacto.destino ?? 'privado'} propio`, privado, oficial: null };
  }
  if (!conWorkerPrivado) {
    throw new Error(`${carpeta} es una construcción oficial: indica --worker-privado <dist> para servir su web`);
  }
  const carpetaPrivada = resolve(conWorkerPrivado);
  const privado = await cargar(carpetaPrivada);
  const [revision, revisionPrivada] = [artefacto, privado].map((a) => a.resumen.revisionCodigo);
  const [version, versionPrivada] = [artefacto, privado].map(versionDe);
  if (mismaRevision && revisionPrivada !== revision) {
    throw new Error(
      `El Worker privado de ${carpetaPrivada} es de otra revisión (${revisionPrivada}) que ${carpeta} (${revision})`,
    );
  }
  if (mismaRevision && (version === null || versionPrivada !== version)) {
    throw new Error(
      `El Worker privado de ${carpetaPrivada} es de otra VERSION (${versionPrivada}) que ${carpeta} (${version})`,
    );
  }
  return {
    artefacto: { ...artefacto, worker: privado.worker },
    servidor: `su web con el Worker privado de ${carpetaPrivada}`,
    privado: { ...workerDe(privado), worker: privado.worker, revisionCodigo: revisionPrivada, version: versionPrivada },
    oficial: { ...workerDe(artefacto), worker: artefacto.worker, fichas: artefacto.fichas, leer: artefacto.leer },
  };
}

/**
 * El Worker privado que acompaña a la construcción `nombre`, de las `nombres` que se miden: `--worker-privado
 * nombre=<dist>` (uno por construcción) o, con una sola construcción, `--worker-privado <dist>`. Con varias, cada uno
 * lleva el nombre de la suya, para que ninguna se sirva con el de otra; con y sin nombre no se mezclan, para que
 * ninguno se descarte. Sin ninguno, undefined.
 */
export function workerPrivadoDe(valores, nombre, nombres) {
  const lista = [valores ?? []].flat();
  const conNombre = lista.filter((valor) => /^[\w-]+=/u.test(valor));
  for (const valor of conNombre) {
    const suyo = valor.slice(0, valor.indexOf('='));
    if (!nombres.includes(suyo)) {
      throw new Error(`--worker-privado ${valor}: ninguna construcción se llama ${suyo}`);
    }
  }
  const comunes = lista.filter((valor) => !conNombre.includes(valor));
  if (comunes.length > 0 && conNombre.length > 0) {
    throw new Error('En --worker-privado no se mezclan valores con nombre y sin nombre');
  }
  if (comunes.length > 0 && (nombres.length > 1 || comunes.length > 1)) {
    throw new Error('Con varias construcciones, cada --worker-privado lleva el nombre de la suya: nombre=<dist>');
  }
  const propio = conNombre.find((valor) => valor.startsWith(`${nombre}=`));
  return propio ? propio.slice(nombre.length + 1) : comunes[0];
}

/** Espera el primer mensaje de Faro posterior a los `antes` que ya había, entero (sin pensamiento pendiente). */
export async function respuestaDeFaro(pagina, antes, plazo = PLAZO_MS) {
  await pagina.waitForFunction(
    (previos) => {
      const deFaro = document.querySelectorAll('#conversacion .rc-mensaje[data-autor="faro"]');
      const ultimo = deFaro[deFaro.length - 1];
      return (
        deFaro.length > previos &&
        [...ultimo.querySelectorAll('[data-estado]')].every((bloque) => bloque.dataset.estado === 'hecho')
      );
    },
    antes,
    { timeout: plazo },
  );
  return pagina.locator('#conversacion .rc-mensaje[data-autor="faro"]').last().innerText();
}

/** El primer mensaje de la persona en el recorrido real. */
export const PRIMER_MENSAJE = 'Soy conductor de autobús urbano';

/**
 * Lo que el motor del dispositivo deja para elegir en su primera respuesta: una pregunta con respuestas rápidas, una
 * propuesta de ocupaciones o las tareas.
 */
export const RESPUESTA_DEL_MOTOR = [
  '.rc-eleccion-acciones > button.rc-boton-principal:not([disabled]):visible',
  '.rc-acciones > button.rc-boton-principal[type="submit"]:not([disabled]):visible',
  '#sugerencias:not([hidden]) .rc-sugerencia:not([disabled]):visible',
  '.rc-cuerpo[data-paso="3"]',
].join(', ');

/**
 * La persona escribe su primer mensaje en el recorrido real y se espera la respuesta del motor del dispositivo, entera.
 * Devuelve el texto del último mensaje de Faro; si el motor no responde en el plazo, rechaza.
 */
export async function primerMensaje(pagina, plazo = PLAZO_MS) {
  await pagina.locator('#conversacion .rc-mensaje').first().waitFor({ timeout: PLAZO_MS });
  const antes = await pagina.locator('#conversacion .rc-mensaje[data-autor="faro"]').count();
  await pagina.locator('#mensaje').fill(PRIMER_MENSAJE);
  await pagina.locator('#mensaje').press('Enter');
  await pagina.locator(RESPUESTA_DEL_MOTOR).first().waitFor({ state: 'visible', timeout: plazo });
  return respuestaDeFaro(pagina, antes, plazo);
}

/** El último mensaje de Faro en la conversación, o null si no hay ninguno. */
export async function ultimoDeFaro(pagina) {
  const mensajes = pagina.locator('#conversacion .rc-mensaje[data-autor="faro"]');
  return (await mensajes.count()) ? mensajes.last().innerText() : null;
}
