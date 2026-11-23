// Cómo lee esbuild las fuentes de la web de una zona: cada página es un módulo virtual que importa los suyos en orden;
// las fuentes conservan sus avisos legales, aplican la lista cerrada de importaciones calculadas y reescriben
// `import.meta.url` a la dirección que tenía cada fuente, calculada desde la raíz de la web.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';
import { type Comment, parse } from 'acorn';
import type { Loader, OnResolveResult, Plugin } from 'esbuild';
import type { ImportacionCalculada } from '../../../src/plataforma/extension.ts';
import { RUTAS } from '../../../src/plataforma/node/rutas.ts';
import { argumentosCalculados, declarada, type Observada } from './importaciones-calculadas.ts';
import { FUENTE, LECTOR_EN_LA_WEB, type origenesDelLector, sinBarrilDelLector } from './lector.ts';

/** Un aviso legal en un comentario: se conserva aunque su autor no lo marcara para los minificadores. */
const AVISO_LEGAL = /@(?:license|preserve)\b|\bcopyright\b|\bSPDX\b/i;
/** El espacio de nombres de los módulos virtuales de página. */
const PAGINA = 'pagina';
/**
 * Lo que se empaqueta desde el repositorio y no desde la copia temporal de la web (el lector del catálogo, en src/):
 * esbuild calcula los nombres con huella con la ruta de cada módulo desde `absWorkingDir`, la copia temporal, y la de un
 * archivo del repositorio depende de dónde está esa copia (TMPDIR). En este espacio de nombres la ruta es la de la raíz
 * del repositorio, fija, y la construcción da lo mismo desde cualquier carpeta temporal.
 */
const REPOSITORIO = 'repositorio';
const CARGADORES: Readonly<Record<string, Loader>> = { '.ts': 'ts', '.js': 'js', '.json': 'json' };
/** La marca que el código reescrito usa para la raíz de la web, hasta que se sustituye por su expresión. */
const RAIZ_DEL_PAQUETE = '__RAIZ_DEL_PAQUETE__';

/** Lo que el empaquetado de una zona aprende de sus fuentes. */
export interface Observado {
  readonly calculadas: Observada[];
  /** Instantánea de las dos revisiones, por ruta desde la raíz del repositorio. */
  readonly revisiones?: ReadonlyMap<string, Uint8Array>;
}
/** Lo que necesita la lectura de las fuentes de una zona. */
export interface LecturaDeZona {
  /** La copia de la web que se construye. */
  readonly web: string;
  /** La carpeta de la zona, desde web/: todas sus salidas están a esa profundidad. */
  readonly carpeta: string;
  /** Las entradas estables de la zona: el módulo que sustituyen y su salida, desde web/. */
  readonly estables: ReadonlyMap<string, string>;
  readonly observado: Observado;
  /** De dónde viene cada nombre del lector del catálogo (empaquetado/lector.ts). */
  readonly origenesDelLector: ReturnType<typeof origenesDelLector>;
}

/** La ruta desde web/ de un archivo del disco. */
export function desdeLaRaiz(web: string, ruta: string): string {
  return relative(web, ruta).split(sep).join('/');
}

function dentroDe(carpeta: string, ruta: string): boolean {
  const desde = relative(carpeta, ruta);
  return desde !== '' && !desde.startsWith('..') && !isAbsolute(desde);
}

/** Un archivo del repositorio fuera de la copia de la web, por su ruta desde la raíz; lo demás, sin cambiar. */
function delRepositorio(web: string, ruta: string): OnResolveResult | undefined {
  if (dentroDe(web, ruta) || !dentroDe(RUTAS.raiz, ruta)) {
    return undefined;
  }
  return { path: desdeLaRaiz(RUTAS.raiz, ruta), namespace: REPOSITORIO };
}

/** El módulo virtual de una página: importa sus módulos en el orden de la página. */
export function moduloDePagina(modulos: readonly string[]): string {
  return `${PAGINA}:${JSON.stringify(modulos)}`;
}

/** La raíz de la web vista desde un archivo de la carpeta `carpeta`, como expresión. */
function raizDesde(carpeta: string): string {
  return `new URL(${JSON.stringify('../'.repeat(carpeta.split('/').length))}, import.meta.url)`;
}

/** Los comentarios con aviso legal que su autor no marcó, convertidos en avisos que esbuild conserva. */
function avisosMarcados(codigo: string): string {
  const comentarios: Comment[] = [];
  parse(codigo, { ecmaVersion: 'latest', sourceType: 'module', onComment: comentarios });
  return comentarios
    .filter(({ value }) => AVISO_LEGAL.test(value) && !value.startsWith('!'))
    .map(({ value }) => `/*!${value.replaceAll('*/', '* /')}*/\n`)
    .join('');
}

/** Una importación calculada con su tratamiento: literal, dirigida a su entrada estable o tal como está. */
function sustituida(
  codigo: string,
  argumento: string,
  declaracion: ImportacionCalculada | undefined,
  estables: ReadonlyMap<string, string>,
): string {
  const original = `import(${argumento})`;
  if (declaracion?.tratamiento === 'literal') {
    return codigo.replace(original, `import(${JSON.stringify(`./${posix.basename(declaracion.objetivo)}`)})`);
  }
  const estable = declaracion?.tratamiento === 'reintento' ? estables.get(declaracion.objetivo) : undefined;
  if (estable && argumento.startsWith('`./')) {
    const resto = argumento.slice(argumento.indexOf('#'));
    return codigo.replace(original, `import(new URL(\`${estable}${resto}, ${RAIZ_DEL_PAQUETE}).href)`);
  }
  return codigo;
}

/** La fuente de un módulo de la web tal como la empaqueta su zona. */
function fuenteDeLaZona(zona: LecturaDeZona, ruta: string): string {
  const archivo = desdeLaRaiz(zona.web, ruta);
  const leido = sinBarrilDelLector(archivo, readFileSync(ruta, 'utf8'), zona.origenesDelLector);
  let codigo = leido;
  for (const argumento of argumentosCalculados(leido)) {
    zona.observado.calculadas.push({ archivo, argumento });
    codigo = sustituida(codigo, argumento, declarada({ archivo, argumento }), zona.estables);
  }
  const original = `new URL(${JSON.stringify(archivo)}, ${RAIZ_DEL_PAQUETE}).href`;
  codigo = codigo.replaceAll('import.meta.url', original).replaceAll(RAIZ_DEL_PAQUETE, raizDesde(zona.carpeta));
  return archivo.startsWith('terceros/') ? avisosMarcados(codigo) + codigo : codigo;
}

/** El complemento de esbuild que lee las fuentes de la web de una zona. */
export function fuentesDeLaWeb(zona: LecturaDeZona): Plugin {
  const { web } = zona;
  return {
    name: 'fuentes-de-la-web',
    setup(compilacion) {
      compilacion.onResolve({ filter: new RegExp(`^${PAGINA}:`) }, ({ path }) => ({ path, namespace: PAGINA }));
      compilacion.onLoad({ filter: /.*/, namespace: PAGINA }, ({ path }) => ({
        contents: (JSON.parse(path.slice(`${PAGINA}:`.length)) as string[])
          .map((modulo) => `import ${JSON.stringify(join(web, modulo))};\n`)
          .join(''),
        resolveDir: web,
        loader: 'js',
      }));
      // Lo que quede del lector sin nombres (empaquetado/lector.ts) se toma de su fuente, nunca del paquete aparte.
      compilacion.onResolve({ filter: /lector\.js$/ }, ({ path, resolveDir }) =>
        desdeLaRaiz(web, join(resolveDir, path)) === LECTOR_EN_LA_WEB ? delRepositorio(web, FUENTE) : undefined,
      );
      compilacion.onResolve({ filter: /^\// }, ({ path }) => delRepositorio(web, path));
      compilacion.onResolve({ filter: /^\.\.?\//, namespace: REPOSITORIO }, ({ path, importer }) => ({
        path: posix.join(posix.dirname(importer), path),
        namespace: REPOSITORIO,
      }));
      compilacion.onLoad({ filter: /.*/, namespace: REPOSITORIO }, ({ path }) => ({
        contents: zona.observado.revisiones?.get(path) ?? readFileSync(join(RUTAS.raiz, path), 'utf8'),
        loader: CARGADORES[posix.extname(path)] ?? 'js',
        resolveDir: join(RUTAS.raiz, posix.dirname(path)),
      }));
      compilacion.onLoad({ filter: /\.js$/ }, ({ path }) => ({ contents: fuenteDeLaZona(zona, path), loader: 'js' }));
    },
  };
}
