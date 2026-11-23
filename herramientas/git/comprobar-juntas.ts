// Las juntas combinan trabajos ya guardados; cualquier adaptación se guarda en un commit propio.
// Por defecto se revisa todo el historial alcanzable, sin depender de un repositorio de origen.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OID_COMPLETO = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const USO = 'Uso: node herramientas/git/comprobar-juntas.ts [--corte <OID-completo>]';
const PLAZO_GIT_MS = 10_000;
/** Veinte MiB: supera las diferencias esperadas sin aceptar una salida ilimitada. */
const MAX_SALIDA_GIT = 20_971_520;
const CODIGO_FALLO = 1;

/** Una línea añadida o retirada por la junta respecto de todos sus padres. */
export interface CambioPropio {
  readonly archivo: string;
  readonly linea: number;
}

/** Estado de un bloque combinado, con una columna de diferencia por cada padre. */
interface Bloque {
  padres: number;
  linea: number;
}

/** Lee solo cuerpos de bloques: las cabeceras +++ no son líneas añadidas. */
export function cambiosPropiosDeJunta(diferencia: string): readonly CambioPropio[] {
  const nuevas: CambioPropio[] = [];
  let archivo = '';
  let bloque: Bloque | undefined;
  for (const linea of diferencia.split('\n')) {
    if (/^diff --(?:cc|combined) /.test(linea)) {
      archivo = linea.replace(/^diff --(?:cc|combined) /, '');
      bloque = undefined;
    } else if (/^(?:Binary files |GIT binary patch)/.test(linea)) {
      nuevas.push({ archivo, linea: 0 });
    } else if (/^@@@/.test(linea)) {
      bloque = bloqueDe(linea);
    } else if (bloque) {
      const numero = bloque.linea;
      if (esCambioPropio(linea, bloque)) {
        nuevas.push({ archivo, linea: numero });
      }
    }
  }
  return nuevas;
}

/** Interpreta los rangos del resultado y cuenta padres incluso en juntas de más de dos ramas. */
function bloqueDe(linea: string): Bloque {
  const cabecera = /^(@{3,}) /.exec(linea);
  const posicion = / \+(\d+)(?:,\d+)? @+/.exec(linea);
  if (!cabecera?.[1] || !posicion?.[1]) {
    throw new Error(`Bloque combinado inválido: ${linea}`);
  }
  return { padres: cabecera[1].length - 1, linea: Number(posicion[1]) };
}

/** Avanza por el resultado del bloque, omitiendo las líneas eliminadas de sus padres. */
function esCambioPropio(linea: string, bloque: Bloque): boolean {
  if (linea.length < bloque.padres || linea.startsWith('\\')) {
    return false;
  }
  const marcas = linea.slice(0, bloque.padres);
  if (!marcas.includes('-')) {
    bloque.linea += 1;
  }
  return marcas === '+'.repeat(bloque.padres) || marcas === '-'.repeat(bloque.padres);
}

/** Git local, sin shell, paginador, diff externo ni filtros de contenido. */
function git(raiz: string, argumentos: readonly string[]): string {
  return execFileSync('git', ['--no-pager', ...argumentos], {
    cwd: raiz,
    encoding: 'utf8',
    timeout: PLAZO_GIT_MS,
    maxBuffer: MAX_SALIDA_GIT,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

/**
 * Revisa todas las ramas alcanzables desde HEAD, no solo la línea de integración.
 * Las huellas tampoco se regeneran dentro de una junta: van en un commit posterior.
 * @param raiz - Copia de trabajo con el historial completo.
 * @param corte - Commit ancestro excluido junto a sus antecesores; sin él se revisa desde todas las raíces.
 * @returns El número de juntas comprobadas en el alcance declarado.
 * @throws {Error} Si falta historial o una junta introduce contenido nuevo.
 */
export function comprobarJuntas(raiz: string, corte?: string): number {
  if (git(raiz, ['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('La guarda de juntas necesita el historial completo, sin clon superficial');
  }
  if (corte !== undefined) {
    validarCorte(raiz, corte);
  }
  const lista = git(raiz, ['rev-list', '--min-parents=2', 'HEAD', ...(corte === undefined ? [] : [`^${corte}`])]);
  const juntas = lista ? lista.split('\n') : [];
  for (const junta of juntas) {
    const diferencia = git(raiz, [
      'show',
      '--format=',
      '--cc',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--no-renames',
      '--unified=0',
      junta,
    ]);
    const nuevas = cambiosPropiosDeJunta(diferencia);
    if (nuevas.length) {
      const lugares = nuevas.map(({ archivo, linea }) => `${archivo}:${linea || 'binario'}`).join(', ');
      throw new Error(`La junta ${junta} contiene cambios propios: ${lugares}. Guárdalo en un commit aparte.`);
    }
  }
  return juntas.length;
}

/** Un corte es un objeto commit inmutable y alcanzable, nunca una referencia u opción interpretada por Git. */
function validarCorte(raiz: string, corte: string): void {
  if (typeof corte !== 'string' || !OID_COMPLETO.test(corte)) {
    throw new Error('El corte debe ser un OID completo de 40 o 64 caracteres hexadecimales');
  }
  if (git(raiz, ['cat-file', '-t', corte]) !== 'commit') {
    throw new Error('El corte debe identificar un commit, no una etiqueta ni otro objeto');
  }
  git(raiz, ['merge-base', '--is-ancestor', corte, 'HEAD']);
}

/** Solo se admite un corte explícito; opciones duplicadas o argumentos adicionales son errores. */
function corteDeOpciones(args: readonly string[]): string | undefined {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 2 && args[0] === '--corte' && args[1]) {
    return args[1];
  }
  throw new Error(USO);
}

if (import.meta.main) {
  try {
    const corte = corteDeOpciones(process.argv.slice(2));
    const raiz = fileURLToPath(new URL('../../', import.meta.url));
    console.log(`${comprobarJuntas(raiz, corte)} juntas comprobadas: sin adaptaciones propias`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo comprobar el historial');
    process.exitCode = CODIGO_FALLO;
  }
}
