// Firefox necesita carpetas de datos propias: sin ellas no puede crear su perfil en este Mac y no arranca.
// La batería de navegador recibe carpetas nuevas y absolutas en cada ejecución (una vez por batería, no por caso),
// creadas antes de lanzar el paso y heredadas por todos los procesos hijos. Los módulos que lanzan navegadores por su
// cuenta preparan las suyas una vez por proceso con entornoParaLanzar. HOME se conserva.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';

/** Las dos variables que lee Firefox para ubicar sus datos y su caché. */
export interface EntornoFirefox {
  readonly MOZ_APP_DATA: string;
  readonly MOZ_LOCAL_APP_DATA: string;
}

/** Carpetas de una ejecución: la raíz se retira al terminar. */
export interface CarpetasFirefox {
  readonly raiz: string;
  readonly entorno: EntornoFirefox;
}

/**
 * Variables heredadas que no llegan a los navegadores. CFFIXED_USER_HOME cambia el hogar que ven las bibliotecas de
 * macOS de cada navegador; los controles de navegadores arrancan los tres motores sin ella, de modo que una heredada de
 * quien lanza haría depender la batería de su sesión. Se excluye; HOME sí se conserva.
 */
export const VARIABLES_EXCLUIDAS: readonly string[] = ['CFFIXED_USER_HOME'];

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Crea las carpetas de datos de Firefox de una ejecución. Si falla a medias, retira lo creado.
 *
 * @param base - Carpeta absoluta donde se crean (normalmente la temporal del sistema).
 * @param crearCarpeta - Creación de cada subcarpeta; solo se sustituye en las pruebas de los caminos de fallo.
 * @returns La raíz nueva y las variables que la señalan, con rutas absolutas ya resueltas.
 * @throws {FalloDeComprobacion} Si la base no es absoluta o no se pueden crear las carpetas.
 */
export function prepararFirefox(base: string, crearCarpeta: (ruta: string) => void = mkdirSync): CarpetasFirefox {
  if (!isAbsolute(base)) {
    throw new FalloDeComprobacion('La carpeta base de Firefox tiene que ser absoluta');
  }
  const raiz = mkdtempSync(join(realpathSync(base), 'faro-firefox-'));
  const entorno = { MOZ_APP_DATA: join(raiz, 'app'), MOZ_LOCAL_APP_DATA: join(raiz, 'cache') };
  try {
    crearCarpeta(entorno.MOZ_APP_DATA);
    crearCarpeta(entorno.MOZ_LOCAL_APP_DATA);
  } catch (error) {
    let limpieza = '';
    try {
      rmSync(raiz, { recursive: true, force: true });
    } catch (falloDeLimpieza) {
      limpieza = `; además no se puede retirar ${raiz}: ${mensaje(falloDeLimpieza)}`;
    }
    throw new FalloDeComprobacion(`No se pueden crear las carpetas de Firefox: ${mensaje(error)}${limpieza}`, {
      cause: error,
    });
  }
  return { raiz, entorno };
}

/**
 * Retira las carpetas de una ejecución cuando ya ha terminado.
 *
 * @param carpetas - Las creadas por prepararFirefox.
 */
export function retirarFirefox(carpetas: CarpetasFirefox): void {
  rmSync(carpetas.raiz, { recursive: true, force: true });
}

/** Cómo termina la tarea de conFirefox. */
type Desenlace<T> =
  | { readonly correcto: true; readonly valor: T }
  | { readonly correcto: false; readonly error: unknown };

/**
 * Ejecuta una tarea con carpetas de Firefox nuevas y las retira después. El fallo de la tarea se conserva tal cual,
 * con su código, y el de la limpieza se informa aparte; si solo falla la limpieza, la ejecución falla.
 *
 * @param base - Carpeta absoluta donde se crean.
 * @param tarea - Recibe las variables de Firefox.
 * @param retirar - Limpieza; solo se sustituye en las pruebas de los caminos de fallo.
 * @param avisar - Destino del aviso de una limpieza fallida tras un fallo de la tarea.
 * @returns Lo que devuelva la tarea.
 */
export async function conFirefox<T>(
  base: string,
  tarea: (entorno: EntornoFirefox) => Promise<T>,
  retirar: (carpetas: CarpetasFirefox) => void = retirarFirefox,
  avisar: (texto: string) => void = console.error,
): Promise<T> {
  const carpetas = prepararFirefox(base);
  let desenlace: Desenlace<T>;
  try {
    desenlace = { correcto: true, valor: await tarea(carpetas.entorno) };
  } catch (error) {
    desenlace = { correcto: false, error };
  }
  let limpieza: string | undefined;
  let falloDeLimpieza: unknown;
  try {
    retirar(carpetas);
  } catch (error) {
    falloDeLimpieza = error;
    limpieza = `No se pueden retirar las carpetas de Firefox (${carpetas.raiz}): ${mensaje(error)}`;
  }
  if (!desenlace.correcto) {
    if (limpieza !== undefined) {
      avisar(limpieza);
    }
    throw desenlace.error;
  }
  if (limpieza !== undefined) {
    throw new FalloDeComprobacion(`La tarea ha terminado, pero falla la limpieza. ${limpieza}`, {
      cause: falloDeLimpieza,
    });
  }
  return desenlace.valor;
}

/** El entorno heredado sin las variables excluidas. */
export function entornoHeredado(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([nombre, valor]) =>
      valor === undefined || VARIABLES_EXCLUIDAS.includes(nombre) ? [] : [[nombre, valor]],
    ),
  );
}

/**
 * Las carpetas de Firefox heredadas, si las dos están indicadas con rutas absolutas a carpetas que existen: dentro de
 * la batería son las que ha preparado el lanzador común.
 *
 * @param entorno - El entorno heredado.
 * @returns Las variables heredadas, o undefined si falta alguna o no es válida.
 */
export function firefoxHeredado(entorno: NodeJS.ProcessEnv): EntornoFirefox | undefined {
  const { MOZ_APP_DATA, MOZ_LOCAL_APP_DATA } = entorno;
  const valida = (ruta: string | undefined): ruta is string =>
    ruta !== undefined && isAbsolute(ruta) && statSync(ruta, { throwIfNoEntry: false })?.isDirectory() === true;
  return valida(MOZ_APP_DATA) && valida(MOZ_LOCAL_APP_DATA) ? { MOZ_APP_DATA, MOZ_LOCAL_APP_DATA } : undefined;
}

/** Las carpetas propias de este proceso, si no las ha heredado; se crean al primer uso y se retiran al salir. */
let delProceso: CarpetasFirefox | undefined;

/**
 * El entorno de un lanzamiento directo de navegador: el heredado sin las variables excluidas. Reutiliza las carpetas
 * de Firefox heredadas (las del lanzador común, dentro de la batería) y solo crea unas propias del proceso si faltan.
 * Las propias se retiran al salir normalmente; un proceso terminado por señal deja su faro-firefox-* en la carpeta
 * temporal (véase scripts/README.md). Vale igual para Chromium y WebKit.
 *
 * @param base - Carpeta absoluta donde se crean las propias.
 * @returns Las variables para `launch({ env })`.
 */
export function entornoParaLanzar(base: string = tmpdir()): Record<string, string> {
  const heredado = firefoxHeredado(process.env);
  if (heredado) {
    return { ...entornoHeredado(), ...heredado };
  }
  if (!delProceso) {
    const carpetas = prepararFirefox(base);
    delProceso = carpetas;
    process.once('exit', () => retirarFirefox(carpetas));
  }
  return { ...entornoHeredado(), ...delProceso.entorno };
}
