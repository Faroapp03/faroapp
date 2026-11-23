// El service worker construido desde sus módulos en un solo guion clásico: esbuild lo empaqueta, la plantilla de lo
// generado se sustituye en memoria por los valores reales y el resultado pasa por la normalización del JS publicado.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type Node as NodoAcorn, parse } from 'acorn';
import { build, type Plugin, transform } from 'esbuild';
import { javascriptPublicado } from '../recursos-publicados.ts';
import { MODULO_DE_LA_POLITICA, moduloDeLaPolitica } from './politica-del-servicio.ts';

/** Los valores reales de la plantilla de lo generado: un valor por cada nombre que exporta. */
export interface Generado {
  /** La ruta de la plantilla: nunca se reescribe; la construcción la sustituye en memoria. */
  readonly plantilla: string;
  readonly valores: Readonly<Record<string, unknown>>;
}

/** Fallo de la construcción del service worker o de sus guardias. */
export class ServicioNoConstruible extends Error {}

/**
 * Las propiedades del ámbito global de un Worker de servicio con las que no puede chocar un nombre de nivel superior.
 * En un guion clásico, cada `var` o `function` de nivel superior es una propiedad del objeto global y un `const`,
 * `let` o `class` lo tapa: con uno de estos nombres, el service worker reescribiría o escondería lo que le da el
 * navegador. La lista es cerrada y se revisa a mano con las interfaces IDL de las especificaciones:
 * - WorkerGlobalScope y WindowOrWorkerGlobalScope: https://html.spec.whatwg.org/multipage/workers.html#the-workerglobalscope-common-interface
 *   y https://html.spec.whatwg.org/multipage/webappapis.html#windoworworkerglobalscope-mixin;
 * - ServiceWorkerGlobalScope: https://w3c.github.io/ServiceWorker/#serviceworkerglobalscope-interface, con los
 *   atributos de evento que le añaden Push (https://w3c.github.io/push-api/), Notifications
 *   (https://notifications.spec.whatwg.org/), Background Sync (https://wicg.github.io/background-sync/spec/), Periodic
 *   Background Sync (https://wicg.github.io/periodic-background-sync/), Background Fetch
 *   (https://wicg.github.io/background-fetch/), Payment Handler (https://w3c.github.io/payment-handler/), Content Index
 *   (https://wicg.github.io/content-index/spec/) y Cookie Store (https://cookiestore.spec.whatwg.org/).
 */
export const NOMBRES_DEL_AMBITO_GLOBAL: ReadonlySet<string> = new Set([
  // ECMAScript: propiedades del objeto global que no se pueden redefinir y el propio objeto global.
  'globalThis',
  'Infinity',
  'NaN',
  'undefined',
  'eval',
  // EventTarget, del que hereda WorkerGlobalScope.
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  // WorkerGlobalScope (HTML).
  'self',
  'location',
  'navigator',
  'importScripts',
  'fonts',
  'onerror',
  'onlanguagechange',
  'onoffline',
  'ononline',
  'onrejectionhandled',
  'onunhandledrejection',
  // WindowOrWorkerGlobalScope (HTML, Fetch, Service Workers, IndexedDB, Web Crypto, HR Time y Trusted Types).
  'origin',
  'isSecureContext',
  'crossOriginIsolated',
  'reportError',
  'btoa',
  'atob',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'queueMicrotask',
  'createImageBitmap',
  'structuredClone',
  'fetch',
  'caches',
  'indexedDB',
  'crypto',
  'performance',
  'scheduler',
  'trustedTypes',
  // ServiceWorkerGlobalScope (Service Workers, Push, Notifications, Background Sync, Cookie Store y Payment Handler).
  'clients',
  'registration',
  'serviceWorker',
  'cookieStore',
  'skipWaiting',
  'oninstall',
  'onactivate',
  'onfetch',
  'onmessage',
  'onmessageerror',
  'onnotificationclick',
  'onnotificationclose',
  'onpush',
  'onpushsubscriptionchange',
  'onsync',
  'onperiodicsync',
  'onbackgroundfetchsuccess',
  'onbackgroundfetchfail',
  'onbackgroundfetchabort',
  'onbackgroundfetchclick',
  'oncanmakepayment',
  'onpaymentrequest',
  'oncontentdelete',
  'oncookiechange',
  // Interfaces que usa un service worker: taparlas cambiaría lo que construyen sus oyentes.
  'Request',
  'Response',
  'Headers',
  'URL',
  'Cache',
  'CacheStorage',
  'Clients',
  'Client',
  'WindowClient',
  'ExtendableEvent',
  'ExtendableMessageEvent',
  'FetchEvent',
  'Event',
  'EventTarget',
  'AbortController',
  'AbortSignal',
  'Blob',
  'TextEncoder',
  'TextDecoder',
  'Promise',
  'Error',
  'TypeError',
  'Map',
  'Set',
  'Object',
  'Array',
  'JSON',
]);

/** Las opciones de esbuild: un solo guion sin minificar, sin poda y sin comentarios legales añadidos. */
const OPCIONES = Object.freeze({
  bundle: true,
  // ESM sin exportaciones en la entrada: esbuild emite los nombres de nivel superior tal cual, sin envoltorio, y la
  // salida es un guion clásico. Con IIFE quedarían dentro de una función y dejarían de ser globales del Worker.
  format: 'esm',
  platform: 'browser',
  target: 'esnext',
  minify: false,
  // Sin poda: cada declaración de cada módulo llega a la salida.
  treeShaking: false,
  sourcemap: false,
  metafile: true,
  write: false,
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'silent',
} as const);

type Nodo = NodoAcorn & Record<string, unknown>;

function esNodo(valor: unknown): valor is Nodo {
  return typeof valor === 'object' && valor !== null && typeof (valor as { type?: unknown }).type === 'string';
}

/** Los hijos directos de un nodo, en orden de aparición. */
function hijosDe(nodo: Nodo): Nodo[] {
  return Object.values(nodo)
    .flatMap((valor: unknown) => (Array.isArray(valor) ? valor : [valor]))
    .filter(esNodo);
}

/** Todos los nodos del árbol, en orden de aparición. */
function* nodos(raiz: Nodo): Generator<Nodo> {
  const pendientes: Nodo[] = [raiz];
  for (let nodo = pendientes.pop(); nodo; nodo = pendientes.pop()) {
    yield nodo;
    pendientes.push(...hijosDe(nodo).reverse());
  }
}

/** Los identificadores que liga un patrón de declaración. */
function ligados(patron: Nodo): string[] {
  switch (patron.type) {
    case 'Identifier':
      return [patron.name as string];
    case 'ObjectPattern':
      return (patron.properties as Nodo[]).flatMap((propiedad) =>
        ligados((propiedad.type === 'RestElement' ? propiedad.argument : propiedad.value) as Nodo),
      );
    case 'ArrayPattern':
      return (patron.elements as (Nodo | null)[]).flatMap((elemento) => (elemento ? ligados(elemento) : []));
    case 'RestElement':
      return ligados(patron.argument as Nodo);
    case 'AssignmentPattern':
      return ligados(patron.left as Nodo);
    default:
      return [];
  }
}

/** Una declaración de nivel superior: su forma y los nombres que liga. */
export interface DeclaracionDeNivelSuperior {
  readonly nombre: string;
  readonly forma: 'var' | 'let' | 'const' | 'function' | 'class';
}

function declaracion(sentencia: Nodo): DeclaracionDeNivelSuperior[] {
  const propia =
    sentencia.type.startsWith('Export') && esNodo(sentencia.declaration) ? sentencia.declaration : sentencia;
  if (propia.type === 'VariableDeclaration') {
    const forma = propia.kind as 'var' | 'let' | 'const';
    return (propia.declarations as Nodo[]).flatMap((d) => ligados(d.id as Nodo).map((nombre) => ({ nombre, forma })));
  }
  if ((propia.type === 'FunctionDeclaration' || propia.type === 'ClassDeclaration') && esNodo(propia.id)) {
    return [{ nombre: propia.id.name as string, forma: propia.type === 'FunctionDeclaration' ? 'function' : 'class' }];
  }
  return [];
}

/** Las declaraciones de nivel superior de un guion o un módulo, en su orden. */
export function declaracionesDeNivelSuperior(texto: string, tipo: 'script' | 'module'): DeclaracionDeNivelSuperior[] {
  const programa = parse(texto, { ecmaVersion: 'latest', sourceType: tipo }) as unknown as { body: Nodo[] };
  return programa.body.flatMap(declaracion);
}

/** Los nombres que exporta la plantilla, en su orden. */
function exportacionesDeLaPlantilla(texto: string): string[] {
  const programa = parse(texto, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: Nodo[] };
  return programa.body.flatMap((sentencia) => {
    if (sentencia.type !== 'ExportNamedDeclaration' || !esNodo(sentencia.declaration)) {
      throw new ServicioNoConstruible('La plantilla de lo generado solo admite exportaciones con declaración');
    }
    return declaracion(sentencia).map(({ nombre }) => nombre);
  });
}

/** El módulo de lo generado con los valores reales, en el orden de la plantilla. */
function moduloGenerado({ plantilla, valores }: Generado): string {
  const nombres = exportacionesDeLaPlantilla(readFileSync(plantilla, 'utf8'));
  const sobran = Object.keys(valores).filter((nombre) => !nombres.includes(nombre));
  const faltan = nombres.filter((nombre) => !Object.hasOwn(valores, nombre));
  if (sobran.length || faltan.length) {
    throw new ServicioNoConstruible(
      `Los valores no coinciden con la plantilla de lo generado: faltan [${faltan.join(', ')}], sobran [${sobran.join(', ')}]`,
    );
  }
  return nombres.map((nombre) => `export const ${nombre} = ${JSON.stringify(valores[nombre])};\n`).join('');
}

/**
 * El complemento que sirve en memoria la plantilla de lo generado con los valores reales y, junto a ella, la política
 * desde su fuente única (politica-del-servicio.ts), sin escribir nada en el disco.
 */
function complementoGenerado(generado: Generado, leidos: Map<string, string>): Plugin {
  const plantilla = resolve(generado.plantilla);
  const politica = join(dirname(plantilla), MODULO_DE_LA_POLITICA);
  return {
    name: 'servicio-generado',
    setup(compilacion) {
      compilacion.onResolve({ filter: /politica\.js$/ }, ({ path, resolveDir }) =>
        resolve(resolveDir, path) === politica ? { path: politica } : undefined,
      );
      const contenidoDe = (path: string): string => {
        if (path === plantilla) {
          return moduloGenerado(generado);
        }
        return path === politica ? moduloDeLaPolitica() : readFileSync(path, 'utf8');
      };
      compilacion.onLoad({ filter: /\.js$/ }, ({ path }) => {
        const contents = contenidoDe(path);
        leidos.set(path, contents);
        return { contents, loader: 'js' };
      });
    },
  };
}

/**
 * La forma con la que esbuild emite una declaración de nivel superior al empaquetar: `const`, `let` y `class` pasan a
 * `var` (también con IIFE y sin opción que lo evite); `function` y `var` se quedan como están.
 */
function formaEmpaquetada({ nombre, forma }: DeclaracionDeNivelSuperior): string {
  return `${forma === 'function' ? 'function' : 'var'} ${nombre}`;
}

/** Exige que cada declaración de los módulos llegue con su nombre y su forma empaquetada: ni renombres ni pérdidas. */
function conservaLasDeclaraciones(leidos: ReadonlyMap<string, string>, salida: string): void {
  const esperadas = [...leidos.values()].flatMap((texto) =>
    declaracionesDeNivelSuperior(texto, 'module').map(formaEmpaquetada),
  );
  const emitidas = declaracionesDeNivelSuperior(salida, 'script').map(({ nombre, forma }) => `${forma} ${nombre}`);
  const repetidas = esperadas.filter((d, i) => esperadas.indexOf(d) !== i);
  const ausentes = esperadas.filter((d) => !emitidas.includes(d));
  const nuevas = emitidas.filter((d) => !esperadas.includes(d));
  if (repetidas.length || ausentes.length || nuevas.length) {
    throw new ServicioNoConstruible(
      `La construcción del service worker cambia sus declaraciones de nivel superior: repetidas entre módulos [${repetidas.join(', ')}], ausentes [${ausentes.join(', ')}], nuevas [${nuevas.join(', ')}]`,
    );
  }
}

/** Una línea con solo espacios: la deja javascriptPublicado donde un comentario ocupaba su propia línea. */
const LINEA_CON_SOLO_ESPACIOS = /^[ \t]+\n/gmu;

/**
 * El texto sin sus líneas con solo espacios, siempre las mismas para el mismo texto. Si quitarlas cambiara el código
 * (una cadena de plantilla con una línea así), lo daría el mismo código sin espacios con esbuild: entonces no se toca.
 */
async function sinLineasConSoloEspacios(texto: string): Promise<string> {
  const limpio = texto.replace(LINEA_CON_SOLO_ESPACIOS, '');
  const [antes, despues] = await Promise.all(
    [texto, limpio].map((codigo) => transform(codigo, { loader: 'js', minifyWhitespace: true })),
  );
  if (antes?.code !== despues?.code) {
    throw new ServicioNoConstruible('Quitar las líneas con solo espacios cambiaría el código del service worker');
  }
  return limpio;
}

/**
 * El texto del service worker construido desde su entrada, con la plantilla de lo generado sustituida.
 *
 * @param entrada - La ruta del módulo de entrada (oyentes y encaminamiento).
 * @param generado - La plantilla de lo generado y sus valores reales.
 * @returns El guion clásico, normalizado como el resto del JS publicado y ya comprobado por sus guardias.
 */
export async function construirServicio(entrada: string, generado: Generado): Promise<string> {
  const leidos = new Map<string, string>();
  const plantilla = resolve(generado.plantilla);
  const resultado = await build({
    ...OPCIONES,
    entryPoints: [resolve(entrada)],
    outfile: 'service-worker.js',
    plugins: [complementoGenerado(generado, leidos)],
  });
  if (resultado.warnings.length) {
    throw new ServicioNoConstruible(
      `esbuild avisa al construir el service worker: ${resultado.warnings.map(({ text }) => text).join('; ')}`,
    );
  }
  if (!leidos.has(plantilla)) {
    throw new ServicioNoConstruible('La entrada del service worker no importa la plantilla de lo generado');
  }
  const [archivo, ...otros] = resultado.outputFiles;
  if (!archivo || otros.length) {
    throw new ServicioNoConstruible('La construcción del service worker debe dar un solo archivo');
  }
  const texto = await sinLineasConSoloEspacios(javascriptPublicado(archivo.text, 'script'));
  conservaLasDeclaraciones(leidos, texto);
  comprobarServicio(texto);
  return texto;
}

function nombreDePropiedad(nodo: Nodo): string | undefined {
  const propiedad = (nodo.type === 'MemberExpression' ? nodo.property : nodo.key) as Nodo | undefined;
  if (!propiedad) {
    return undefined;
  }
  if (propiedad.type === 'Identifier' && !nodo.computed) {
    return propiedad.name as string;
  }
  return propiedad.type === 'Literal' && typeof propiedad.value === 'string' ? propiedad.value : undefined;
}

/** Los nombres prohibidos en el service worker, como identificador o como propiedad, y su motivo. */
const NOMBRES_PROHIBIDOS: ReadonlyMap<string, string> = new Map([
  ['importScripts', 'carga guiones con importScripts'],
  ['eval', 'evalúa texto con eval'],
  ['createPolicy', 'crea una política de Trusted Types'],
]);

/** El nombre que usa un identificador, un acceso a propiedad o una propiedad de objeto. */
function nombreDelNodo(nodo: Nodo): string | undefined {
  if (nodo.type === 'Identifier') {
    return nodo.name as string;
  }
  return nodo.type === 'MemberExpression' || nodo.type === 'Property' ? nombreDePropiedad(nodo) : undefined;
}

/** Si el nodo construye código con `Function`, llamada o con `new`. */
function construyeConFunction(nodo: Nodo): boolean {
  if ((nodo.type !== 'NewExpression' && nodo.type !== 'CallExpression') || !esNodo(nodo.callee)) {
    return false;
  }
  return nombreDelNodo(nodo.callee) === 'Function';
}

/** Los motivos por los que un nodo no puede estar en el service worker. */
function prohibido(nodo: Nodo): string | undefined {
  if (nodo.type === 'ImportDeclaration' || nodo.type === 'ImportExpression' || nodo.type === 'MetaProperty') {
    return 'importa un módulo';
  }
  if (nodo.type.startsWith('Export')) {
    return 'exporta un nombre';
  }
  const nombre = nombreDelNodo(nodo);
  const motivo = nombre === undefined ? undefined : NOMBRES_PROHIBIDOS.get(nombre);
  return motivo ?? (construyeConFunction(nodo) ? 'construye código con Function' : undefined);
}

/** Lo que el texto carga, evalúa o exporta; se lee como módulo para encontrar también import y export. */
function codigoProhibido(texto: string): string[] {
  let programa: Nodo;
  try {
    programa = parse(texto, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Nodo;
  } catch {
    programa = parse(texto, { ecmaVersion: 'latest', sourceType: 'script' }) as unknown as Nodo;
  }
  return [...nodos(programa)].flatMap((nodo) => {
    const motivo = prohibido(nodo);
    return motivo ? [`${motivo} (posición ${nodo.start})`] : [];
  });
}

/** Los nombres de nivel superior del guion que ya son del ámbito global del Worker. */
function choquesConElAmbitoGlobal(texto: string): string[] {
  try {
    return declaracionesDeNivelSuperior(texto, 'script')
      .filter(({ nombre }) => NOMBRES_DEL_AMBITO_GLOBAL.has(nombre))
      .map(({ nombre }) => `declara «${nombre}», que ya es del ámbito global del Worker`);
  } catch (error) {
    return [`no es un guion clásico: ${(error as Error).message}`];
  }
}

/**
 * Las guardias del service worker construido: un guion clásico sin cargar ni evaluar código, sin políticas de Trusted
 * Types y sin nombres de nivel superior que choquen con el ámbito global del Worker.
 *
 * @param texto - El service worker tal como se publica.
 * @throws {ServicioNoConstruible} Con cada motivo encontrado y su posición.
 */
export function comprobarServicio(texto: string): void {
  const motivos = codigoProhibido(texto);
  if (!motivos.length) {
    motivos.push(...choquesConElAmbitoGlobal(texto));
  }
  if (motivos.length) {
    throw new ServicioNoConstruible(`El service worker no se puede publicar: ${[...new Set(motivos)].join('; ')}`);
  }
}
