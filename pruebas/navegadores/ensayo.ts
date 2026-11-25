/** Control secuencial: cada motor tiene un proceso/grupo con plazo, y cada caso cierra su navegador y servidor. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Browser, type BrowserContext, chromium, firefox, webkit } from 'playwright-core';
import { comprobarControladorDeVideo } from '../../scripts/controlador-de-video.ts';
import { ejecutarPaso } from '../../scripts/verificar.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { type Artefacto, cargarArtefacto, destinoDeLaConstruccion, RAIZ } from './artefacto.ts';
import { probarCspDelPanel } from './csp-del-panel.ts';
import { probarTrabajadorDeCursos, violacionDeLaSonda } from './cursos.ts';
import { crearFixture, type Fixture } from './fixture.ts';
import {
  type CatalogoDelEnsayo,
  catalogoPublicado,
  comprobarConsolaDeFormacion,
  type MensajeDeConsola,
  probarFormacion,
} from './formacion.ts';
import { identidadAlArrancar } from './identidad-al-arrancar.ts';
import { atenderManifiestoPrivado, type BasicDeManifiesto, peticionesDeManifiesto } from './manifiesto-privado.ts';
import { type ModoDelEnsayo, modoDelEnsayo } from './modo-del-ensayo.ts';
import { ensayarEnOrden } from './motores-en-orden.ts';
import { comprobarObservacion, observar, prepararContexto } from './observacion.ts';
import { comprobarPuertaPrivada } from './privado.ts';
import { type Idioma, probarRecorrido } from './recorrido.ts';
import { cerrarSinSustituir, lanzarConPlazo } from './recursos-del-caso.mjs';

const MOTORES = { chromium, firefox, webkit };
type Motor = keyof typeof MOTORES;
/** Cada contexto del caso: el panel, el informe laboral y el recorrido completo de formación. */
type Contexto = 'panel' | 'recorrido' | 'formacion';
const PLAZO_MOTOR_MS = 300_000;
const PLAZO_ACCION_MS = 30_000;
const PLAZO_ARRANQUE_MS = 20_000;
const CODIGO_FALLO = 1;

function guardar(ruta: string, registro: unknown): void {
  writeFileSync(ruta, `${JSON.stringify(registro, null, 2)}\n`);
}

function entornoNavegador(temporal: string): NodeJS.ProcessEnv {
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];
  const entorno = Object.fromEntries(
    permitidas.flatMap((nombre) => (process.env[nombre] === undefined ? [] : [[nombre, process.env[nombre]]])),
  );
  return { ...entorno, MOZ_APP_DATA: join(temporal, 'app'), MOZ_LOCAL_APP_DATA: join(temporal, 'cache') };
}

function espacioDelMotor(motor: Motor): string {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), `faro-${motor}-`));
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  return temporal;
}

async function contexto(
  browser: Browser,
  fixture: Fixture,
  idioma: Idioma,
  opciones: { panel: boolean; modo: ModoDelEnsayo },
): Promise<BrowserContext> {
  const { panel, modo } = opciones;
  return browser.newContext({
    userAgent: IDENTIDAD_WEB['User-Agent'],
    viewport: { width: 1280, height: 900 },
    locale: idioma,
    timezoneId: 'Europe/Madrid',
    acceptDownloads: true,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    serviceWorkers: panel ? 'block' : 'allow',
    httpCredentials: { ...modo.credenciales, origin: fixture.origen },
    extraHTTPHeaders: { ...IDENTIDAD_WEB },
  });
}

async function formacionDelContexto(
  ctx: BrowserContext,
  opciones: Omit<Parameters<typeof probarFormacion>[0], 'pagina'> & { motor: Motor; modo: ModoDelEnsayo },
) {
  const { fixture, idioma, salida, enElCatalogo, motor, modo } = opciones;
  const basicAnticipado: BasicDeManifiesto[] = [];
  if (motor === 'webkit' && process.platform === 'linux') {
    await ctx.route('**/*.webmanifest', (ruta) =>
      atenderManifiestoPrivado(ruta, fixture.origen, modo.credenciales, basicAnticipado),
    );
  }
  const pagina = await ctx.newPage();
  const formacion = await probarFormacion({ pagina, fixture, idioma, salida, enElCatalogo });
  return { ...formacion, manifiestos: { basicAnticipado, peticiones: peticionesDeManifiesto(fixture.peticiones) } };
}

async function conContexto(opciones: {
  browser: Browser;
  motor: Motor;
  fixture: Fixture;
  idioma: Idioma;
  tipo: Contexto;
  salida: string;
  fallosGuardia: string[];
  enElCatalogo: CatalogoDelEnsayo;
  modo: ModoDelEnsayo;
  /** La versión del paquete de la construcción (su huellaPaquete), la carpeta /paquete/<versión>/ que publica. */
  paquete: string;
}): Promise<unknown> {
  const { browser, fixture, idioma, tipo, salida, modo } = opciones;
  const panel = tipo === 'panel';
  const ctx = await contexto(browser, fixture, idioma, { panel, modo });
  ctx.setDefaultTimeout(PLAZO_ACCION_MS);
  const observacion = observar(ctx, fixture, { motor: opciones.motor, contexto: panel ? 'panel' : 'recorrido' });
  let resultado: unknown;
  let consolaDeFormacion: MensajeDeConsola[] | undefined;
  try {
    await prepararContexto(ctx, fixture, observacion);
    if (panel) {
      resultado = await comprobarPuertaPrivada(fixture.origen);
    } else if (tipo === 'formacion') {
      const formacion = await formacionDelContexto(ctx, opciones);
      consolaDeFormacion = formacion.consola;
      resultado = formacion;
      if (!formacion.seleccionMaxima.correcto) {
        opciones.fallosGuardia.push(`${idioma}/formacion-seleccion-maxima: ${formacion.seleccionMaxima.fallo}`);
      }
    } else {
      const pagina = await ctx.newPage();
      // Con la página del recorrido ya abierta y sin servidor, antes de recargarla: Cursos por el Worker publicado, con
      // la CSP y el service worker reales.
      const recorrido = await probarRecorrido({
        pagina,
        fixture,
        idioma,
        salida,
        sinServidor: (abierta) => probarTrabajadorDeCursos(abierta, fixture, opciones.paquete),
      });
      resultado = { ...recorrido, cursos: recorrido.sinServidor };
    }
    try {
      // El recorrido lleva la sonda de Trusted Types de cursos.ts: su violación, y solo ella, es esperada.
      comprobarObservacion(observacion, fixture, tipo === 'recorrido' ? [violacionDeLaSonda(fixture.origen)] : []);
      if (consolaDeFormacion) {
        comprobarConsolaDeFormacion(consolaDeFormacion, fixture.origen, opciones.motor);
      }
    } catch (error) {
      opciones.fallosGuardia.push(`${idioma}/${tipo}: ${String(error)}`);
    }
    return resultado;
  } finally {
    // Ni el cierre ni el registro sustituyen el error del cuerpo: si fallan, se anotan aparte (cerrarSinSustituir).
    await cerrarSinSustituir(() => ctx.close(), `el contexto ${idioma}/${tipo} no se cerró`);
    await cerrarSinSustituir(
      () =>
        guardar(join(salida, `${idioma}-${tipo}-observacion.json`), {
          observacion,
          peticiones: fixture.peticiones,
          erroresServidor: fixture.errores,
        }),
      `la observación ${idioma}/${tipo} no se pudo guardar`,
    );
  }
}

async function caso(
  browser: Browser,
  artefacto: Artefacto,
  idioma: Idioma,
  seguimiento: {
    motor: Motor;
    salida: string;
    fallosGuardia: string[];
    enElCatalogo: CatalogoDelEnsayo;
    modo: ModoDelEnsayo;
    paquete: string;
  },
): Promise<unknown> {
  const fixture = await crearFixture(artefacto);
  let panel: unknown;
  let recorrido: unknown;
  try {
    panel =
      idioma === 'es' ? await conContexto({ browser, fixture, idioma, tipo: 'panel', ...seguimiento }) : undefined;
    recorrido = await conContexto({ browser, fixture, idioma, tipo: 'recorrido', ...seguimiento });
  } finally {
    await cerrarSinSustituir(() => fixture.cerrar(), 'el servidor de ensayo no se cerró');
  }
  // La formación instala su propia copia y apaga su propio servidor: un servidor nuevo, sin estado del anterior.
  const servidorDeFormacion = await crearFixture(artefacto);
  try {
    const formacion = await conContexto({
      browser,
      fixture: servidorDeFormacion,
      idioma,
      tipo: 'formacion',
      ...seguimiento,
    });
    return { panel, recorrido, formacion };
  } finally {
    await cerrarSinSustituir(() => servidorDeFormacion.cerrar(), 'el servidor de ensayo de la formación no se cerró');
  }
}

function registroDelMotor(motor: Motor, artefacto: Artefacto, modo: ModoDelEnsayo) {
  return {
    motor,
    modo: modo.destino,
    transporte: 'HTTP loopback; Request al Worker simula HTTPS, sin acreditar TLS ni Cloudflare',
    panelPrevisto: 'Basic anónimo rechazado; panel y recursos rechazados tras Basic',
    versionMotor: '',
    playwright: versionPlaywright(),
    node: process.versions.node,
    plataforma: process.platform,
    arquitectura: process.arch,
    artefacto: artefacto.resumen,
    correcto: false,
    funcionalCorrecto: false,
    cspDelPanel: null as unknown,
    guardiasCorrectas: false,
    fallosGuardia: [] as string[],
    casos: [] as unknown[],
    fallo: '',
  };
}

async function ejecutarMotor(motor: Motor, salida: string, directorio: string): Promise<void> {
  // Los casos guardan en la carpeta del motor su observación, sus PDF y el resultado: se crea si no existe.
  mkdirSync(salida, { recursive: true });
  const artefacto = await cargarArtefacto(directorio);
  const modo = modoDelEnsayo(artefacto.destino);
  const registro = registroDelMotor(motor, artefacto, modo);
  const paquete = artefacto.resumen.huellaPaquete;
  const { casos, fallosGuardia } = registro;
  let browser: Browser | undefined;
  const temporal = espacioDelMotor(motor);
  const restablecerFetch = limitarFetchAlEquipo();
  try {
    browser = await lanzarMotor(motor, temporal);
    registro.versionMotor = browser.version();
    if (motor === 'webkit') {
      registro.cspDelPanel = await probarCspDelPanel(browser);
    }
    const enElCatalogo = catalogoPublicado(artefacto);
    for (const idioma of ['es', 'ca'] as const) {
      casos.push(await caso(browser, artefacto, idioma, { motor, salida, fallosGuardia, enElCatalogo, modo, paquete }));
    }
    registro.funcionalCorrecto = true;
    registro.guardiasCorrectas = fallosGuardia.length === 0;
    assert(
      registro.guardiasCorrectas,
      'Los flujos terminaron, pero falló al menos una guardia estricta; ver observaciones crudas',
    );
    registro.correcto = true;
  } catch (error) {
    registro.fallo = String(error);
    throw error;
  } finally {
    // Nada de la limpieza sustituye el error del motor: cada fallo se anota aparte (cerrarSinSustituir).
    await cerrarSinSustituir(() => browser?.close(), `el navegador ${motor} no se cerró`);
    restablecerFetch();
    await cerrarSinSustituir(
      () => rmSync(temporal, { recursive: true, force: true }),
      `la carpeta temporal de ${motor} no se pudo retirar`,
    );
    await cerrarSinSustituir(
      () => guardar(join(salida, 'resultado.json'), registro),
      `el resultado de ${motor} no se pudo guardar`,
    );
    console.log(JSON.stringify(registro));
  }
}

function limitarFetchAlEquipo(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (entrada, opciones) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    assert.equal(url.hostname, '127.0.0.1', 'El ensayo no permite fetch externo');
    for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB)) {
      assert.equal(new Headers(opciones?.headers).get(nombre), valor);
    }
    return original(entrada, opciones);
  };
  return () => {
    globalThis.fetch = original;
  };
}

/**
 * Arranca el motor con su plazo propio (menor que el del proceso del motor): si vence, el fallo dice qué motor no
 * arrancó y trae el error de Playwright, con su registro de fases, como causa (lanzarConPlazo).
 */
function lanzarMotor(motor: Motor, temporal: string): Promise<Browser> {
  return lanzarConPlazo(
    MOTORES[motor],
    {
      headless: true,
      env: entornoNavegador(temporal),
      ...identidadAlArrancar(motor, [
        '--disable-background-networking',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      ]),
    },
    'el ensayo oficial',
    { plazoMs: PLAZO_ARRANQUE_MS },
  );
}

function argumentosDelMotor(motor: Motor, destino: string, directorio: string): string[] {
  return [
    fileURLToPath(new URL('./ensayo.ts', import.meta.url)),
    '--motor',
    motor,
    '--salida',
    destino,
    '--artefacto',
    directorio,
  ];
}

async function principal(): Promise<void> {
  const { values } = parseArgs({
    options: {
      salida: { type: 'string' },
      motor: { type: 'string' },
      artefacto: { type: 'string' },
    },
  });
  comprobarControladorDeVideo();
  const directorio = values.artefacto ? resolve(values.artefacto) : join(RAIZ, 'dist');
  // El modo sale del destino de la construcción: la que no se ensaya aquí se rechaza antes de lanzar nada.
  modoDelEnsayo(destinoDeLaConstruccion(directorio));
  const salida = values.salida ? resolve(values.salida) : mkdtempSync(join(tmpdir(), 'faro-navegadores-'));
  if (values.motor) {
    assert(Object.hasOwn(MOTORES, values.motor), 'Motor desconocido');
    await ejecutarMotor(values.motor as Motor, salida, directorio);
    return;
  }
  if (values.salida) {
    mkdirSync(salida);
  } // Nunca sustituye resultados anteriores.
  console.log(`Resultados de navegadores: ${salida}`);
  const resultados = await ensayarEnOrden(Object.keys(MOTORES) as Motor[], {
    // Como antes: si la carpeta de un motor no se puede crear, el ensayo se detiene; no es un fallo del motor.
    preparar: (motor) => mkdirSync(join(salida, motor)),
    ejecutar: (motor) =>
      ejecutarPaso(
        {
          nombre: `Navegador ${motor}`,
          comando: process.execPath,
          argumentos: argumentosDelMotor(motor, join(salida, motor), directorio),
        },
        RAIZ,
        PLAZO_MOTOR_MS,
      ),
    guardarResumen: (hastaAhora) => guardar(join(salida, 'resumen.json'), hastaAhora),
  });
  assert(
    resultados.every((resultado) => resultado.correcto),
    'Falló al menos un motor; consultar resumen.json y sus observaciones',
  );
}

function versionPlaywright(): string {
  const metadatos: unknown = createRequire(import.meta.url)('playwright-core/package.json');
  assert(metadatos && typeof metadatos === 'object' && 'version' in metadatos && typeof metadatos.version === 'string');
  return metadatos.version;
}

if (import.meta.main) {
  void principal().catch((error: unknown) => {
    console.error(String(error));
    process.exitCode = CODIGO_FALLO;
  });
}
