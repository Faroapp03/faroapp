/**
 * Precarga de la batería Node: impide cualquier conexión, envío UDP o resolución de nombres fuera de este equipo. Una
 * prueba que olvide sustituir el transporte falla con un error claro en vez de consultar una fuente real. Los
 * servidores de prueba en el bucle local siguen funcionando.
 *
 * Cubre `net` (y con él http, https, tls, fetch y undici), `dns` (búsqueda, `resolve*`, `reverse` y `Resolver`, también
 * en promesas y en las exportaciones con nombre) y `dgram`. Los workers la reciben en su `execArgv`, y los procesos hijos
 * la heredan por `NODE_OPTIONS`, que pone `scripts/verificar.ts`.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net, { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

/** Error de una prueba que intentó salir de este equipo. */
export class ConexionExternaProhibida extends Error {
  readonly code = 'ECONEXIONEXTERNAPROHIBIDA';
}

/** Esta misma precarga, para inyectarla en los workers. */
export const PRECARGA_SIN_RED = import.meta.url;
const NOMBRES_LOCALES = new Set(['localhost', '']);
const IPV4 = 4;
const IPV6 = 6;

/** Si un anfitrión es de este equipo: «localhost», 127.0.0.0/8 o ::1. Un nombre sin resolver no lo es. */
export function esAnfitrionLocal(anfitrion: string | undefined): boolean {
  const limpio = (anfitrion ?? '').replace(/^\[|\]$/gu, '').split('%')[0] ?? '';
  if (NOMBRES_LOCALES.has(limpio)) {
    return true;
  }
  if (isIP(limpio) === IPV4) {
    return limpio.startsWith('127.');
  }
  return isIP(limpio) === IPV6 && (limpio === '::1' || limpio.startsWith('::ffff:127.'));
}

function error(que: string, destino: unknown): ConexionExternaProhibida {
  return new ConexionExternaProhibida(`${que} externa prohibida en las pruebas: ${String(destino)}`);
}

/** Extrae el anfitrión de los argumentos de `Socket.connect`; un socket de archivo (`path`) es local. */
function anfitrionDeConexion(argumentos: unknown[]): string | undefined {
  const [primero, segundo] = argumentos;
  if (Array.isArray(primero)) {
    return anfitrionDeConexion(primero);
  }
  if (typeof primero === 'object' && primero !== null) {
    const opciones = primero as { host?: string; path?: string };
    return opciones.path === undefined ? (opciones.host ?? 'localhost') : 'localhost';
  }
  if (typeof primero === 'string' && Number.isNaN(Number(primero))) {
    return 'localhost';
  }
  return typeof segundo === 'string' ? segundo : 'localhost';
}

type Funcion = (...argumentos: unknown[]) => unknown;

/** Sustituye un método por otro que antes comprueba sus argumentos. */
function envolver(objeto: object, nombre: string, comprobar: (argumentos: unknown[]) => void): void {
  const original = Reflect.get(objeto, nombre) as Funcion | undefined;
  if (typeof original !== 'function') {
    return;
  }
  Reflect.set(objeto, nombre, function soloLocal(this: unknown, ...argumentos: unknown[]) {
    comprobar(argumentos);
    return Reflect.apply(original, this, argumentos);
  });
}

/** Igual que `envolver`, pero devuelve una promesa rechazada en vez de lanzar (API de promesas). */
function envolverPromesa(objeto: object, nombre: string, comprobar: (argumentos: unknown[]) => void): void {
  const original = Reflect.get(objeto, nombre) as Funcion | undefined;
  if (typeof original !== 'function') {
    return;
  }
  Reflect.set(objeto, nombre, function soloLocal(this: unknown, ...argumentos: unknown[]) {
    try {
      comprobar(argumentos);
    } catch (fallo) {
      return Promise.reject(fallo);
    }
    return Reflect.apply(original, this, argumentos);
  });
}

function nombreLocal([anfitrion]: unknown[]): void {
  if (!esAnfitrionLocal(typeof anfitrion === 'string' ? anfitrion : undefined)) {
    throw error('Resolución', anfitrion);
  }
}

envolver(net.Socket.prototype, 'connect', (argumentos) => {
  const anfitrion = anfitrionDeConexion(argumentos);
  if (!esAnfitrionLocal(anfitrion)) {
    throw error('Conexión', anfitrion);
  }
});

const METODOS_DNS = Object.keys(dns).filter((nombre) => /^(lookup|lookupService|resolve\w*|reverse)$/u.test(nombre));
for (const nombre of METODOS_DNS) {
  envolver(dns, nombre, nombreLocal);
  envolverPromesa(dns.promises, nombre, nombreLocal);
  envolver(dns.Resolver.prototype, nombre, nombreLocal);
  envolverPromesa(dns.promises.Resolver.prototype, nombre, nombreLocal);
}

// UDP: cualquier dirección textual de `send` o `connect` debe ser local; sin dirección, Node usa el bucle local.
for (const nombre of ['send', 'connect']) {
  envolver(dgram.Socket.prototype, nombre, (argumentos) => {
    const direccion = argumentos.slice(1).find((valor) => typeof valor === 'string');
    if (typeof direccion === 'string' && !esAnfitrionLocal(direccion)) {
      throw error('Envío', direccion);
    }
  });
}

// Las exportaciones con nombre (`import { lookup } from 'node:dns'`) también reciben las versiones sustituidas.
syncBuiltinESMExports();

/**
 * Envuelve el código de un worker con `eval` (Node no le aplica `--import`) en un worker de módulo que primero carga
 * esta precarga y después ejecuta el mismo código CommonJS con su `require`.
 */
function envolverEval(codigo: string): URL {
  const base = pathToFileURL(`${process.cwd()}/`).href;
  const modulo = [
    "import { createRequire } from 'node:module';",
    `await import(${JSON.stringify(PRECARGA_SIN_RED)});`,
    `const require = createRequire(${JSON.stringify(base)});`,
    'const module = { exports: {} };',
    `new Function('require', 'module', 'exports', '__filename', '__dirname', ${JSON.stringify(codigo)})(require, module, module.exports, '[worker eval]', process.cwd());`,
  ].join('\n');
  return new URL(`data:text/javascript,${encodeURIComponent(modulo)}`);
}

const conPrecarga = (lista: readonly string[]): boolean => lista.some((opcion) => opcion.includes('sin-red'));

/**
 * Sin `execArgv` propio, el worker hereda las opciones del hilo padre: solo hace falta añadir la precarga si el padre
 * no la tiene (cuando llega por `NODE_OPTIONS`). Con `execArgv` propio, se añade si falta.
 */
function execArgvConPrecarga(propios: readonly string[] | undefined): string[] | undefined {
  const opcion = `--import=${PRECARGA_SIN_RED}`;
  if (propios !== undefined) {
    return conPrecarga(propios) ? [...propios] : [...propios, opcion];
  }
  return conPrecarga(process.execArgv) ? undefined : [opcion];
}

/** Un worker es otro entorno de módulos: se le añade esta precarga, también si se crea con `eval`. */
class WorkerSinRed extends Worker {
  constructor(
    archivo: ConstructorParameters<typeof Worker>[0],
    opciones: ConstructorParameters<typeof Worker>[1] = {},
  ) {
    if (opciones.eval === true && typeof archivo === 'string') {
      super(envolverEval(archivo), { ...opciones, eval: false });
      return;
    }
    super(archivo, { ...opciones, execArgv: execArgvConPrecarga(opciones.execArgv) });
  }
}
const hilos = await import('node:worker_threads');
Reflect.set(hilos.default, 'Worker', WorkerSinRed);
syncBuiltinESMExports();
