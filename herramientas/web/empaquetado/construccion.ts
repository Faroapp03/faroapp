// Las construcciones de esbuild del paquete: cada zona de páginas (también la del panel privado), el Worker del motor
// y el motor desde sus fuentes.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { build, type Metafile, type OutputFile } from 'esbuild';
import { RUTAS } from '../../../src/plataforma/node/rutas.ts';
import { CARPETA_DEL_MOTOR } from '../carpeta-del-motor.ts';
import { MOTOR_EN_LAS_PAGINAS } from '../integridad-motor.ts';
import { desdeLaRaiz, fuentesDeLaWeb, moduloDePagina, type Observado } from './fuentes.ts';
import type { FormaDelPaquete } from './grafo.ts';
import { IMPORTACIONES_CALCULADAS } from './importaciones-calculadas.ts';
import { origenesDelLector } from './lector.ts';
import { nombrePlano, TROZOS_DEL_MOTOR, type Zona, zonaDe } from './zonas.ts';

/** Los caracteres de la huella de contenido que lleva el nombre de cada entrada de página. */
const LONGITUD_DE_LA_HUELLA = 16;
/** El Worker del motor del dispositivo, desde web/. */
const WORKER = 'scripts/motor-local/worker.js';

/** Lo que una construcción de esbuild deja para el resumen: sus salidas, su metafile y sus avisos. */
export interface Construida {
  readonly archivos: Map<string, Uint8Array>;
  readonly metafile: Metafile;
  readonly avisos: readonly { readonly text: string; readonly id: string }[];
}

/** Las opciones comunes de las construcciones del paquete: ESM minificado, sin mapas y sin escribir. */
export const OPCIONES_DEL_PAQUETE = Object.freeze({
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  keepNames: true,
  sourcemap: false,
  metafile: true,
  write: false,
  charset: 'utf8',
  legalComments: 'eof',
  logLevel: 'silent',
} as const);

/** Las salidas de esbuild por su ruta desde web/. */
function salidas(web: string, archivos: readonly OutputFile[]): Map<string, Uint8Array> {
  return new Map(archivos.map(({ path, contents }) => [desdeLaRaiz(web, path), contents]));
}

function huellaCorta(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, LONGITUD_DE_LA_HUELLA);
}

/** Las entradas estables de una zona: los módulos de reintento que viven en ella, con su salida desde web/. */
function establesDeLaZona(web: string, zona: Zona): Map<string, string> {
  const objetivos = IMPORTACIONES_CALCULADAS.filter(
    ({ tratamiento, objetivo }) =>
      tratamiento === 'reintento' && existsSync(join(web, objetivo)) && zonaDe(objetivo).id === zona.id,
  ).map(({ objetivo }) => objetivo);
  return new Map(
    objetivos.map((objetivo) => [
      objetivo,
      objetivo.startsWith('idiomas/') ? objetivo : `${zona.carpeta}/${nombrePlano(objetivo)}.js`,
    ]),
  );
}

/** Una entrada de página: los módulos que importa y las páginas que la cargan. */
export interface EntradaDePaginas {
  readonly modulos: readonly string[];
  readonly rutas: readonly string[];
}

/**
 * Las entradas de las páginas de una zona, una por cada lista distinta de módulos. Las páginas que cargan los mismos
 * módulos comparten entrada: con una por página, esbuild emitiría copias idénticas y un trozo vacío con el módulo
 * virtual que todas importan. Una entrada de una sola página lleva su nombre; la compartida, el de sus módulos.
 */
export function entradasDeLasPaginas(zona: Zona): Map<string, EntradaDePaginas> {
  const porModulos = new Map<string, { modulos: readonly string[]; rutas: string[] }>();
  for (const { ruta, modulos } of zona.paginas) {
    const clave = moduloDePagina(modulos);
    const grupo = porModulos.get(clave) ?? { modulos, rutas: [] };
    grupo.rutas.push(ruta);
    porModulos.set(clave, grupo);
  }
  const entradas = new Map<string, EntradaDePaginas>();
  for (const { modulos, rutas } of porModulos.values()) {
    const nombre =
      rutas.length === 1 ? `pagina-${nombrePlano(rutas[0] ?? '')}` : `paginas-${modulos.map(nombrePlano).join('--')}`;
    const salida = `${zona.carpeta}/${nombre}`;
    const otra = entradas.get(salida);
    if (otra) {
      // «a/b.js» y «a-b.js» dan el mismo nombre plano: una entrada no puede tapar a otra.
      throw new Error(`${salida}: el mismo nombre para ${otra.rutas.join(', ')} y ${rutas.join(', ')}`);
    }
    entradas.set(salida, { modulos, rutas });
  }
  return entradas;
}

/** La entrada que emitió esbuild para una página; sin ella, la página no se puede publicar. */
export function entradaDeLaPagina(salidaDePagina: ReadonlyMap<string, string>, ruta: string): string {
  const salida = salidaDePagina.get(ruta);
  if (!salida) {
    throw new Error(`${ruta}: el paquete de su zona no tiene su entrada`);
  }
  return salida;
}

/** Empaqueta una zona; las entradas de página reciben la huella de su contenido en el nombre. */
export async function empaquetarZona(web: string, zona: Zona, forma: FormaDelPaquete, observado: Observado) {
  const compartida = forma === 'compartida';
  const estables = compartida ? establesDeLaZona(web, zona) : new Map<string, string>();
  const entradas = entradasDeLasPaginas(zona);
  const origenes = origenesDelLector();
  const resultado = await build({
    ...OPCIONES_DEL_PAQUETE,
    absWorkingDir: web,
    outdir: web,
    splitting: compartida,
    entryNames: '[dir]/[name]',
    chunkNames: `${zona.carpeta}/[name]-[hash]`,
    entryPoints: [
      ...[...entradas].map(([salida, { modulos }]) => ({ in: moduloDePagina(modulos), out: salida })),
      ...[...estables].map(([objetivo, salida]) => ({ in: join(web, objetivo), out: salida.replace(/\.js$/, '') })),
    ],
    plugins: [fuentesDeLaWeb({ web, carpeta: zona.carpeta, estables, observado, origenesDelLector: origenes })],
  });
  const emitidos = salidas(web, resultado.outputFiles);
  const renombres = new Map<string, string>();
  const salidaDePagina = new Map<string, string>();
  for (const [salida, { rutas }] of entradas) {
    const bytes = emitidos.get(`${salida}.js`);
    if (bytes) {
      renombres.set(`${salida}.js`, `${salida}-${huellaCorta(bytes)}.js`);
    }
    for (const ruta of rutas) {
      salidaDePagina.set(ruta, `${salida}.js`);
    }
  }
  const archivos = new Map([...emitidos].map(([ruta, bytes]) => [renombres.get(ruta) ?? ruta, bytes]));
  return { archivos, renombres, salidaDePagina, metafile: resultado.metafile, avisos: resultado.warnings };
}

/** El Worker del motor del dispositivo, en un solo archivo y en su misma dirección. */
export async function empaquetarWorker(web: string, observado: Observado): Promise<Construida> {
  const resultado = await build({
    ...OPCIONES_DEL_PAQUETE,
    absWorkingDir: web,
    outdir: web,
    entryPoints: [{ in: join(web, WORKER), out: WORKER.replace(/\.js$/, '') }],
    plugins: [
      fuentesDeLaWeb({
        web,
        carpeta: posix.dirname(WORKER),
        estables: new Map(),
        observado,
        origenesDelLector: origenesDelLector(),
      }),
    ],
  });
  return { archivos: salidas(web, resultado.outputFiles), metafile: resultado.metafile, avisos: resultado.warnings };
}

/** El motor desde sus fuentes: sus dos entradas y los módulos que cargan las páginas, en su dirección fija. */
export async function empaquetarMotor(
  web: string,
  forma: FormaDelPaquete,
  revisiones?: ReadonlyMap<string, Uint8Array>,
) {
  const configuracion = JSON.parse(
    readFileSync(join(RUTAS.raiz, 'tsconfig.navegador.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  ) as { files: string[] };
  const desdeLasPaginas = MOTOR_EN_LAS_PAGINAS.map((modulo) =>
    modulo.slice(`${CARPETA_DEL_MOTOR}/`.length).replace(/\.js$/, '.ts'),
  );
  return empaquetarEntradasDelMotor(web, forma, [...new Set([...configuracion.files, ...desdeLasPaginas])], revisiones);
}

/**
 * Unas entradas del motor (rutas .ts desde la raíz) con las opciones del motor publicado, en web/motor/<entrada>.js.
 *
 * @param web - La web en la que se escribirían, para las rutas de salida; no se escribe nada.
 * @param forma - La forma del paquete.
 * @param entradas - Las entradas, desde la raíz de la instalación.
 */
export async function empaquetarEntradasDelMotor(
  web: string,
  forma: FormaDelPaquete,
  entradas: readonly string[],
  revisiones?: ReadonlyMap<string, Uint8Array>,
) {
  const resultado = await build({
    ...OPCIONES_DEL_PAQUETE,
    absWorkingDir: RUTAS.raiz,
    tsconfig: 'tsconfig.navegador.json',
    outdir: join(web, CARPETA_DEL_MOTOR),
    splitting: forma === 'compartida',
    entryNames: '[dir]/[name]',
    chunkNames: `${TROZOS_DEL_MOTOR}/[name]-[hash]`,
    entryPoints: entradas.map((entrada) => ({ in: entrada, out: entrada.replace(/\.ts$/, '') })),
    plugins: [
      {
        name: 'revisiones-capturadas',
        setup(compilacion) {
          compilacion.onLoad({ filter: /\.json$/ }, ({ path }) => {
            const bytes = revisiones?.get(desdeLaRaiz(RUTAS.raiz, path));
            return bytes ? { contents: bytes, loader: 'json' } : undefined;
          });
        },
      },
    ],
    logOverride: { 'unsupported-dynamic-import': 'error', 'empty-glob': 'error' },
  });
  return {
    archivos: salidas(web, resultado.outputFiles),
    entradas: entradas.map((entrada) => `${CARPETA_DEL_MOTOR}/${entrada.replace(/\.ts$/, '.js')}`),
    metafile: resultado.metafile,
    avisos: resultado.warnings,
  };
}

/** Los avisos de esbuild que no se esperaban en la forma pedida. */
export function avisosInesperados(avisos: readonly { text: string; id: string }[], forma: FormaDelPaquete): string[] {
  // Sin trozos compartidos, el reintento con marca queda como un patrón sin archivos: el módulo ya va en la página.
  return avisos.filter(({ id }) => !(forma === 'por-pagina' && id === 'empty-glob')).map(({ text }) => text);
}
