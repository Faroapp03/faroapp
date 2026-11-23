// El trabajador de cursos en el navegador, en Chromium, Firefox y WebKit, con sus dos entradas empaquetadas por el
// mismo empaquetador que el motor publicado (empaquetarEntradasDelMotor) en una web temporal:
// la puerta (plataforma/navegador/puerta-de-cursos.js) dentro de un Worker de módulo, como
// el del motor local, y el trabajador de cursos anidado en él (plataforma/trabajador-de-cursos.js) con un motor de
// prueba. Comprueba que cada consulta se calcula en el trabajador anidado, no en el Worker de fuera, y cuenta desde la
// página cada arranque del trabajador. Un cálculo sin fin con límite de 10 ms da «bloqueado» sin depender de
// relojes: no termina nunca, así que solo el corte puede responder; mientras sigue en marcha, una petición al Worker
// de fuera, la del recorrido, responde sin esperarlo, y la siguiente operación funciona con un trabajador nuevo. Un
// error sin atender en el trabajador da «averiado»; una
// referencia a datos de otro trabajador o a un archivo indicado en los argumentos se rechaza («averiado») sin tocar el
// trabajador. Solo 127.0.0.1, sin red. Lo ejecuta la batería de navegador (trabajador-de-cursos.test.mjs).
// Es la prueba aislada, sin CSP ni service worker; el ensayo oficial (ensayo.ts, con cursos.ts) prueba Cursos por el
// Worker publicado del motor, con el motor real, la CSP y el service worker reales.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { type BrowserType, chromium, firefox, webkit } from 'playwright-core';
import { empaquetarEntradasDelMotor } from '../../herramientas/web/empaquetado/construccion.ts';
import { FORMA_DEL_PAQUETE } from '../../herramientas/web/empaquetado.ts';

/** Las dos entradas que carga la prueba, desde la raíz: la puerta y el trabajador de cursos. */
export const ENTRADAS_DEL_TRABAJADOR = [
  'src/plataforma/navegador/puerta-de-cursos.ts',
  'src/plataforma/trabajador-de-cursos.ts',
];

/**
 * Empaqueta las dos entradas con las opciones del motor publicado y las escribe en `web`/motor/.
 *
 * @param web - La web temporal que sirve la prueba.
 * @returns Las rutas escritas, desde `web`.
 */
export async function prepararMotorDelTrabajador(web: string): Promise<string[]> {
  const { archivos } = await empaquetarEntradasDelMotor(web, FORMA_DEL_PAQUETE, ENTRADAS_DEL_TRABAJADOR);
  for (const [ruta, bytes] of archivos) {
    mkdirSync(dirname(join(web, ruta)), { recursive: true });
    writeFileSync(join(web, ruta), bytes);
  }
  return [...archivos.keys()];
}
const MOTORES: Record<string, BrowserType> = { chromium, firefox, webkit };
const TIPOS: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const LIMITE_MS = 10;
/**
 * Cota superior del corte: amplia, porque con taskpolicy -b los relojes se agrupan (el máximo medido en las 10
 * pasadas de la fase 3 fue 214 ms, en Firefox), pero un corte que tarde segundos ya no protege el recorrido.
 */
const CORTE_MAXIMO_MS = 2000;
/**
 * Cuánto espera la página una respuesta antes de darla por perdida: solo para que una puerta que no corta falle en vez
 * de colgar la prueba. No mide el corte, que no depende de relojes (el cálculo no termina nunca).
 */
const SIN_RESPUESTA_MS = 15_000;
/**
 * El plazo del arranque del navegador, que recibe Playwright: si vence, Playwright falla con su registro de fases. Es
 * menor que el de un caso de la verificación (120 s).
 */
const PLAZO_MS = 60_000;
const CORRECTO = 200;
const NO_ENCONTRADO = 404;
/** El primero, el que sustituye al cortado y el que sustituye al que murió. */
const TRABAJADORES_ARRANCADOS = 3;
/** El nombre del trabajador anidado y el canal por el que cuenta a la página que arranca y que calcula. */
const NOMBRE_DEL_TRABAJADOR = 'trabajador-de-cursos';
const CANAL = 'faro-prueba-cursos';
const LARGO_HUELLA = 64;
/** El rechazo de una referencia en los argumentos, antes de llegar al trabajador (motor-de-cursos.ts). */
const RECHAZO_DE_REFERENCIAS = {
  disponible: false,
  motivo: 'averiado',
  detalle: 'Error: Las consultas factuales no aceptan referencias de recursos o archivos',
};

/**
 * Lo que sirve la prueba además de la web temporal: la página, el Worker de fuera, el de cursos y su motor de
 * prueba.
 */
const VIRTUALES: Record<string, string> = {
  '/prueba/pagina.html': '<!doctype html><meta charset="utf-8"><title>Trabajador de cursos</title>',
  '/prueba/externo.js': `
import { crearPuertaDeCursosWeb } from '/motor/src/plataforma/navegador/puerta-de-cursos.js';
let lanzados = 0;
const puerta = crearPuertaDeCursosWeb(() => {
  lanzados += 1;
  return new Worker('/prueba/cursos.js', { type: 'module', name: '${NOMBRE_DEL_TRABAJADOR}' });
});
const DATOS = { marca: 'datos de prueba' };
self.addEventListener('message', async ({ data }) => {
  if (data.tipo === 'recorrido') {
    self.postMessage({ id: data.id, hecho: true });
    return;
  }
  const empieza = performance.now();
  const argumentos = data.argumentos ?? [{ filtros: { texto: data.texto } }];
  const r = await puerta.operar('catalogoDeCursos', argumentos, {
    datos: DATOS,
    ...(data.limite ? { limiteMs: data.limite } : {}),
  });
  self.postMessage({ id: data.id, resultado: r, ms: performance.now() - empieza, lanzados });
});
`,
  '/prueba/cursos.js': `
new BroadcastChannel('${CANAL}').postMessage({ tipo: 'arranque', hilo: self.name });
import { iniciarTrabajadorDeCursos } from '/motor/src/plataforma/trabajador-de-cursos.js';
const atender = iniciarTrabajadorDeCursos({
  importar: () => import('/prueba/motor.js'),
  enviar: (mensaje) => self.postMessage(mensaje),
});
let cola = Promise.resolve();
self.addEventListener('message', ({ data }) => { cola = cola.then(() => atender(data)); });
`,
  '/prueba/motor.js': `
export const FUENTES_DE_CURSOS = [];
export const OPCIONES_DE_CURSOS = {};
export function catalogoDeCursos(datos, { filtros }) {
  const texto = filtros.texto;
  if (texto === 'sin-fin') {
    new BroadcastChannel('${CANAL}').postMessage({ tipo: 'en-marcha', hilo: self.name });
    for (;;) {}
  }
  if (texto === 'lanza') throw new Error('fallo de prueba dentro del trabajador');
  if (texto === 'muere') setTimeout(() => { throw new Error('error sin atender en el trabajador'); });
  if (texto === 'muere') return new Promise(() => {});
  return { texto, marca: datos.marca, hilo: self.name };
}
export const formacionDeLaOcupacion = () => null;
export const formacionDelInforme = () => null;
`,
};

/** Un servidor de 127.0.0.1 con la web temporal y las rutas de la prueba. */
async function servir(web: string): Promise<{ origen: string; cerrar: () => Promise<void> }> {
  const servidor = createServer(async (peticion, respuesta) => {
    const ruta = new URL(peticion.url ?? '/', 'http://127.0.0.1').pathname;
    const virtual = VIRTUALES[ruta];
    try {
      const cuerpo = virtual ?? (await readFile(join(web, normalize(ruta).replace(/^([/\\])+/u, ''))));
      respuesta.writeHead(CORRECTO, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream' });
      respuesta.end(cuerpo);
    } catch {
      respuesta.writeHead(NO_ENCONTRADO).end();
    }
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const { port } = servidor.address() as AddressInfo;
  return {
    origen: `http://127.0.0.1:${port}`,
    cerrar: () => new Promise((hecho) => servidor.close(() => hecho())),
  };
}

type Respuesta = Record<string, unknown> & { ms: number; lanzados: number; resultado: Record<string, unknown> };

/**
 * Lo que hace la página: los casos, con lo que cuenta el trabajador por su canal (cada arranque y el cálculo sin fin en
 * marcha). Una respuesta que no llega en `sinRespuesta` ms se da por perdida: { perdida: true }. Cada respuesta lleva
 * `llegada`, su orden de llegada a la página.
 */
async function enLaPagina(opciones: { limite: number; huella: string; sinRespuesta: number; canal: string }) {
  const { limite, huella, sinRespuesta, canal } = opciones;
  const avisos: { tipo: string; hilo: string }[] = [];
  const escucha = new BroadcastChannel(canal);
  escucha.onmessage = ({ data }) => avisos.push(data);
  const externo = new Worker('/prueba/externo.js', { type: 'module', name: 'externo' });
  let id = 0;
  let llegadas = 0;
  const pedir = (mensaje: Record<string, unknown>) =>
    new Promise<Respuesta>((responder) => {
      id += 1;
      const esta = id;
      const perdida = setTimeout(() => responder({ perdida: true } as unknown as Respuesta), sinRespuesta);
      const escuchar = ({ data }: MessageEvent) => {
        if (data.id === esta) {
          clearTimeout(perdida);
          externo.removeEventListener('message', escuchar);
          llegadas += 1;
          responder({ ...data, llegada: llegadas });
        }
      };
      externo.addEventListener('message', escuchar);
      externo.postMessage({ ...mensaje, id: esta });
    });
  const calentar = await pedir({ tipo: 'cursos', texto: 'hola' });
  const cortada = pedir({ tipo: 'cursos', texto: 'sin-fin', limite });
  // El recorrido se pide con el cálculo sin fin en marcha; el orden de llegada dice si esperó al corte.
  const delRecorrido = await pedir({ tipo: 'recorrido' });
  const delMotor = await cortada;
  if (delMotor.perdida) {
    // Una puerta que no corta deja el trabajador calculando para siempre: lo que viene detrás tampoco respondería.
    externo.terminate();
    escucha.close();
    throw new Error(`La puerta no ha cortado el cálculo sin fin en ${sinRespuesta} ms`);
  }
  const despues = await pedir({ tipo: 'cursos', texto: 'hola' });
  const lanza = await pedir({ tipo: 'cursos', texto: 'lanza' });
  const muere = await pedir({ tipo: 'cursos', texto: 'muere' });
  const trasMorir = await pedir({ tipo: 'cursos', texto: 'hola' });
  const origenDeCursos = { paquete: new URL('/paquete/', location.href).href, archivo: 'ajeno.json', sha256: huella };
  const rechazos = {
    ajeno: await pedir({ tipo: 'cursos', argumentos: [{ guardadoDeCursos: 'de-otro-trabajador' }] }),
    archivo: await pedir({ tipo: 'cursos', argumentos: [{ origenDeCursos }] }),
    trasRechazar: await pedir({ tipo: 'cursos', texto: 'hola' }),
  };
  externo.terminate();
  escucha.close();
  return { calentar, delMotor, delRecorrido, despues, lanza, muere, trasMorir, rechazos, avisos };
}

/**
 * El entorno de un navegador, como en ensayo.ts: lo justo del de la prueba y, para Firefox, sus carpetas de aplicación
 * y caché en una carpeta temporal propia (sin ellas, no encuentra su perfil).
 */
function entornoNavegador(nombre: string): NodeJS.ProcessEnv {
  const temporal = mkdtempSync(join(realpathSync(tmpdir()), `faro-cursos-${nombre}-`));
  mkdirSync(join(temporal, 'app'));
  mkdirSync(join(temporal, 'cache'));
  const permitidas = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'PLAYWRIGHT_BROWSERS_PATH'];
  const entorno = Object.fromEntries(
    permitidas.flatMap((clave) => (process.env[clave] === undefined ? [] : [[clave, process.env[clave]]])),
  );
  return { ...entorno, MOZ_APP_DATA: join(temporal, 'app'), MOZ_LOCAL_APP_DATA: join(temporal, 'cache') };
}

/** Los motores de la prueba, en orden. */
export const NOMBRES_DE_MOTORES = Object.keys(MOTORES);

/**
 * La web temporal con las dos entradas empaquetadas, servida en 127.0.0.1; cerrar la deja de servir y la retira.
 *
 * @returns El origen y cómo cerrarla.
 */
export async function prepararServicio(): Promise<{ origen: string; cerrar: () => Promise<void> }> {
  const web = mkdtempSync(join(realpathSync(tmpdir()), 'faro-trabajador-web-'));
  try {
    await prepararMotorDelTrabajador(web);
    const { origen, cerrar } = await servir(web);
    return {
      origen,
      cerrar: async () => {
        try {
          await cerrar();
        } finally {
          rmSync(web, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(web, { recursive: true, force: true });
    throw error;
  }
}

type Visto = Awaited<ReturnType<typeof enLaPagina>>;

/**
 * El corte sin relojes: el cálculo no termina nunca, así que «bloqueado» solo puede venir del corte, y llega con el
 * cálculo en marcha en el trabajador anidado; nunca antes del límite. El Worker de fuera responde al recorrido mientras
 * tanto, y la siguiente consulta funciona con un trabajador nuevo.
 */
function comprobarElCorte(nombre: string, r: Visto): void {
  assert.equal(r.calentar.resultado.disponible, true);
  assert.equal(r.delMotor.resultado.motivo, 'bloqueado', `${nombre}: el cálculo sin fin se corta`);
  assert.ok(r.delMotor.ms >= LIMITE_MS, `${nombre}: el corte no llega antes de su límite (${r.delMotor.ms} ms)`);
  assert.ok(r.delMotor.ms < CORTE_MAXIMO_MS, `${nombre}: el corte llega a tiempo (${r.delMotor.ms} ms)`);
  assert.equal(r.delRecorrido.hecho, true, `${nombre}: el recorrido responde`);
  assert.ok(
    Number(r.delRecorrido.llegada) < Number(r.delMotor.llegada),
    `${nombre}: el recorrido llega antes que la respuesta cortada: no espera al corte`,
  );
  const enMarcha = r.avisos.filter(({ tipo }) => tipo === 'en-marcha');
  assert.deepEqual(enMarcha, [{ tipo: 'en-marcha', hilo: NOMBRE_DEL_TRABAJADOR }], `${nombre}: cortado en marcha`);
  assert.equal(r.despues.resultado.disponible, true, `${nombre}: tras el corte responde un trabajador nuevo`);
  assert.equal(r.despues.lanzados, 2, `${nombre}: el corte termina el trabajador y arranca otro`);
}

/**
 * Cada consulta se calcula en el trabajador anidado, no en el Worker de fuera, y la página cuenta sus arranques por el
 * canal del trabajador: los mismos que cuenta la puerta.
 */
function comprobarElTrabajadorAnidado(nombre: string, r: Visto): void {
  for (const respuesta of [r.calentar, r.despues, r.trasMorir, r.rechazos.trasRechazar]) {
    assert.equal(
      (respuesta.resultado.valor as { hilo?: unknown } | undefined)?.hilo,
      NOMBRE_DEL_TRABAJADOR,
      `${nombre}: calcula el trabajador anidado`,
    );
  }
  const arranques = r.avisos.filter(({ tipo }) => tipo === 'arranque');
  assert.equal(arranques.length, TRABAJADORES_ARRANCADOS, `${nombre}: la página ve cada arranque del trabajador`);
  assert.ok(arranques.every(({ hilo }) => hilo === NOMBRE_DEL_TRABAJADOR));
}

/**
 * Los casos en un navegador.
 *
 * @param nombre - chromium, firefox o webkit.
 * @param origen - El de prepararServicio.
 */
export async function probar(nombre: string, origen: string): Promise<void> {
  const motor = MOTORES[nombre];
  assert.ok(motor, `motor desconocido: ${nombre}`);
  const navegador = await motor.launch({ headless: true, timeout: PLAZO_MS, env: entornoNavegador(nombre) });
  try {
    const pagina = await navegador.newPage();
    await pagina.goto(`${origen}/prueba/pagina.html`);
    const r = await pagina.evaluate(enLaPagina, {
      limite: LIMITE_MS,
      huella: '0'.repeat(LARGO_HUELLA),
      sinRespuesta: SIN_RESPUESTA_MS,
      canal: CANAL,
    });
    console.log(`${nombre}: ${JSON.stringify({ corte: r.delMotor, recorrido: r.delRecorrido, avisos: r.avisos })}`);
    comprobarElCorte(nombre, r);
    assert.deepEqual(r.lanza.resultado, {
      disponible: false,
      motivo: 'averiado',
      detalle: 'Error: fallo de prueba dentro del trabajador',
    });
    assert.equal(r.muere.resultado.motivo, 'averiado');
    assert.equal(r.trasMorir.resultado.disponible, true);
    assert.equal(r.trasMorir.lanzados, TRABAJADORES_ARRANCADOS);
    comprobarElTrabajadorAnidado(nombre, r);
    const { ajeno, archivo, trasRechazar } = r.rechazos;
    assert.deepEqual(ajeno.resultado, RECHAZO_DE_REFERENCIAS, `${nombre}: no acepta datos de otro trabajador`);
    assert.deepEqual(archivo.resultado, RECHAZO_DE_REFERENCIAS, `${nombre}: no lee un archivo de los argumentos`);
    assert.equal(trasRechazar.resultado.disponible, true);
    assert.equal(trasRechazar.lanzados, TRABAJADORES_ARRANCADOS, `${nombre}: el rechazo no toca el trabajador`);
  } finally {
    await navegador.close();
  }
}
