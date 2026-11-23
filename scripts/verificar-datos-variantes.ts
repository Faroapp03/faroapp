// La comprobación del ciclo acepta cualquier paquete válido, no solo el de hoy. Para cada variante que cumple los
// contratos del paquete y no es la de hoy (pruebas/ayudas/variantes_del_paquete.py) prepara una raíz propia, como la
// copia limpia del repositorio con los datos nuevos sobre la que trabaja el ciclo, y ejecuta en ella lo mismo que el
// ciclo: npm run web:preparar y npm run verificar:datos, sin el humo de Chromium. Lo que falle con una variante válida
// es una foto que se ejecuta como si fuera un invariante (scripts/fotos-del-paquete.ts).
// La raíz lleva copias reales (clones del disco cuando el sistema de archivos los admite) de lo que el repositorio
// versiona y de lo que no versiona pero lee la comprobación (datos/ y la base ESCO de var/actualizacion/); solo se
// enlazan node_modules y .venv, que no se escriben. Cada variante tiene su raíz y no se borra nada.
// Uso: node scripts/verificar-datos-variantes.ts [variante …]

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';
import { terminarConCodigo } from './verificar.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Las variantes de la ayuda Python, en su orden; «sin-cambios» es el control: el mismo paquete por el mismo camino. */
export const VARIANTES_VALIDAS = [
  'sin-cambios',
  'quitar-cursos',
  'quitar-proveedor-pequeno',
  'anadir-cursos',
  'fechas-un-dia-despues',
  'cambiar-idioma',
] as const;
export type VarianteValida = (typeof VARIANTES_VALIDAS)[number];

export const AYUDA_DE_VARIANTES = 'pruebas/ayudas/variantes_del_paquete.py';
/** Las dependencias: se enlazan porque nadie las escribe; el resto de la raíz es propio. */
const DEPENDENCIAS = ['node_modules', '.venv'];
/** Lo que la comprobación lee y Git no versiona: el paquete entero y la base ESCO validada con su captura. */
const SIN_VERSIONAR = ['datos', 'var/actualizacion'];
/** Lo que escribe cada variante; la raíz se prepara sin ello para que no quede publicado un catálogo anterior. */
const DE_LA_VARIANTE = ['web/datos/catalogo-cursos/', 'web/datos/catalogo-aprendizaje/'];
const SALIDA_MAXIMA = 67_108_864;
const PLAZO_MS = 3_600_000;

function exigirExito(resultado: SpawnSyncReturns<string>, que: string): string {
  if (resultado.status !== 0) {
    throw new FalloDeComprobacion(`${que}:\n${resultado.stdout ?? ''}\n${resultado.stderr ?? ''}`);
  }
  return resultado.stdout;
}

/** Los archivos del producto tal como están en la copia de trabajo: versionados, nuevos sin ignorar y los no versionados que se leen. */
function archivosDelProducto(raiz: string): readonly string[] {
  const git = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: SALIDA_MAXIMA,
  });
  const versionados = exigirExito(git, 'No se pueden listar los archivos del repositorio').split('\0');
  const sinVersionar = SIN_VERSIONAR.filter((carpeta) => existsSync(join(raiz, carpeta))).flatMap((carpeta) =>
    readdirSync(join(raiz, carpeta), { recursive: true, withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => relative(raiz, join(entrada.parentPath, entrada.name)).split(sep).join('/')),
  );
  return [...new Set([...versionados, ...sinVersionar])]
    .filter((ruta) => ruta && existsSync(join(raiz, ruta)))
    .filter((ruta) => !DE_LA_VARIANTE.some((carpeta) => ruta.startsWith(carpeta)))
    .sort();
}

/** Exige que una ruta en la que se va a escribir esté dentro de la raíz de la variante, sin salir por un enlace. */
function exigirDentro(copia: string, ruta: string): void {
  const propia = `${realpathSync(copia)}${sep}`;
  if (!`${realpathSync(ruta)}${sep}`.startsWith(propia)) {
    throw new FalloDeComprobacion(`${ruta} sale de la raíz de la variante`);
  }
}

/**
 * Prepara la raíz de una variante y escribe en ella el paquete de la variante.
 *
 * @param raiz - Raíz del producto, con el paquete de hoy.
 * @param variante - La variante válida.
 * @param copia - Carpeta vacía, propia, donde se prepara.
 */
export function prepararVariante(raiz: string, variante: VarianteValida, copia: string): void {
  if (readdirSync(copia).length) {
    throw new FalloDeComprobacion(`${copia} tiene que estar vacía`);
  }
  for (const ruta of archivosDelProducto(raiz)) {
    const destino = join(copia, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    exigirDentro(copia, dirname(destino));
    copyFileSync(join(raiz, ruta), destino, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
  }
  for (const dependencia of DEPENDENCIAS) {
    symlinkSync(join(raiz, dependencia), join(copia, dependencia));
  }
  escribirVariante(raiz, variante, copia);
}

/**
 * Escribe el catálogo, el compañero y la referencia de la variante (la ayuda Python los valida con su contrato).
 *
 * @param raiz - Raíz del producto, de donde se lee el catálogo de hoy.
 * @param variante - La variante válida.
 * @param copia - Raíz donde se escriben, sin catálogo publicado.
 * @returns Lo que la ayuda dice de la variante: sus ofertas y la huella del catálogo.
 */
export function escribirVariante(raiz: string, variante: VarianteValida, copia: string): string {
  const entorno = { ...process.env, PYTHONPATH: raiz, FARO_PRUEBAS_SIN_RED: '1' };
  const ayuda = spawnSync(
    join(raiz, '.venv/bin/python'),
    ['-B', join(raiz, AYUDA_DE_VARIANTES), raiz, copia, variante],
    {
      cwd: raiz,
      env: entorno,
      encoding: 'utf8',
    },
  );
  return exigirExito(ayuda, `La variante ${variante} no cumple el contrato del catálogo`).trim();
}

/** El entorno del ciclo en la raíz de la variante: sin humo y sin escribir bytecode en el .venv enlazado. */
function entornoDeLaVariante(): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _contexto, ...entorno } = process.env;
  return { ...entorno, FARO_HUMO_CHROMIUM: '0', PYTHONDONTWRITEBYTECODE: '1' };
}

function npm(copia: string, guion: string): SpawnSyncReturns<string> {
  return spawnSync('npm', ['run', guion], {
    cwd: copia,
    env: entornoDeLaVariante(),
    encoding: 'utf8',
    maxBuffer: SALIDA_MAXIMA,
    timeout: PLAZO_MS,
  });
}

/**
 * Ejecuta en la raíz de la variante lo que el ciclo ejecuta sobre los datos nuevos.
 *
 * @param copia - La raíz de la variante.
 * @returns El resultado de la comprobación del ciclo y cuánto tardó.
 */
export function comprobarVariante(copia: string): { resultado: SpawnSyncReturns<string>; milisegundos: number } {
  exigirExito(npm(copia, 'web:preparar'), 'La web local de la variante no se construye');
  exigirDentro(copia, join(copia, '.web-local'));
  const inicio = performance.now();
  const resultado = npm(copia, 'verificar:datos');
  return { resultado, milisegundos: Math.round(performance.now() - inicio) };
}

/** Cada variante pedida (todas, por omisión), en serie; falla si alguna no pasa, después de probarlas todas. */
async function principal(pedidas: readonly string[]): Promise<void> {
  const desconocidas = pedidas.filter((nombre) => !(VARIANTES_VALIDAS as readonly string[]).includes(nombre));
  if (desconocidas.length) {
    throw new FalloDeComprobacion(`Variantes desconocidas: ${desconocidas.join(', ')}`);
  }
  const variantes = (pedidas.length ? pedidas : VARIANTES_VALIDAS) as readonly VarianteValida[];
  const rechazadas: string[] = [];
  for (const variante of variantes) {
    const copia = mkdtempSync(join(tmpdir(), `faro-variante-${variante}-`));
    prepararVariante(RAIZ, variante, copia);
    const { resultado, milisegundos } = comprobarVariante(copia);
    console.log(`${variante}: ${resultado.status === 0 ? 'aceptada' : 'rechazada'} en ${milisegundos} ms (${copia})`);
    if (resultado.status !== 0) {
      rechazadas.push(variante);
      console.log(`${resultado.stdout}\n${resultado.stderr}`);
    }
  }
  if (rechazadas.length) {
    throw new FalloDeComprobacion(`La comprobación del ciclo rechaza paquetes válidos: ${rechazadas.join(', ')}`);
  }
}

if (import.meta.main) {
  await terminarConCodigo(() => principal(process.argv.slice(2)));
}
