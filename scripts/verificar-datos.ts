// Comprobación de los datos nuevos: lo que el ciclo diario ejecuta sobre el paquete recién generado.
// El código del ciclo es el de una revisión que ya pasó la batería completa (npm run verificar) para publicarse; lo
// único nuevo en cada ciclo son los datos. Esta orden ejecuta todo lo que lee el paquete: las comprobaciones que leen
// datos/ o web/datos/ (también la base ESCO, cuya huella fija el manifiesto) y las pruebas de Node y de Python que abren
// el paquete real, el almacén validado o la web local construida con él. Sin navegadores: la web construida se coteja
// antes con npm run web:preparar.
// Con FARO_HUMO_CHROMIUM distinto de 0 (por omisión, activado) abre además el humo de datos en Chromium.
// Uso: node scripts/verificar-datos.ts [--medir]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSIONES } from '../src/plataforma/extensiones.ts';
import { comprobarBaseEsco, resumenDeLaBaseEsco } from './base-esco.ts';
import type { Paso } from './ejecucion-del-paso.ts';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';
import { esFotoDelPaquete } from './fotos-del-paquete.ts';
import {
  archivoDelModulo,
  LISTA_MEDIDA,
  type ListaMedida,
  medirPruebasDeDatos,
  modulosDePruebasPython,
} from './medir-pruebas-de-datos.ts';
import {
  DURACIONES_PYTHON,
  type LoteDePython,
  leerDuracionesPython,
  PROCESOS_DE_PYTHON,
  repartirPruebasPython,
} from './reparto-de-pruebas-python.ts';
import { OMISIONES_DE_LA_GLOBAL, OMISIONES_SIN_EXTENSIONES } from './resumen-pruebas.ts';
import {
  ejecutarPaso,
  exigirPruebasEjecutadas,
  exigirVersionNode,
  listarPruebas,
  PLAZO_SUITE_UNIDAD_MS,
  pasoPruebasDeUnidad,
  pasoPruebasPropias,
  terminarConCodigo,
} from './verificar.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
// Las pruebas Python que leen el paquete tardan unos 17,6 minutos en serie en el Mac (medido: 1.054 s; los 892 casos de sus 86 módulos, contados con unittest) y se
// reparten en procesos que corren a la vez, cada uno con este plazo: el de la etapa sigue siendo uno solo. Con menos CPU
// que procesos se turnan y terminan como en serie, 36 minutos con el runner más lento medido (2,03 veces el Mac).
const PLAZO_PYTHON_MS = 2_700_000;
/** El humo de datos en Chromium: el catálogo de Cursos, una búsqueda y el informe de ejemplo con el paquete nuevo. */
export const HUMO_DE_DATOS = 'pruebas/web-publicacion/humo-de-datos.test.ts';
const PLAZO_HUMO_MS = 300_000;
const CODIGO_USO_INVALIDO = 2;
/** Lo que produce la cadena de datos y leen las pruebas: el paquete, su parte web y el almacén validado. */
const CARPETAS_DEL_PAQUETE = ['datos/', 'web/datos/', 'web/recursos/', 'var/actualizacion/validados/'];
/** Los datos del paquete, sin web/recursos/: ahí está también el código generado desde src/ que leen las pruebas. */
const CARPETAS_DE_DATOS = CARPETAS_DEL_PAQUETE.filter((carpeta) => carpeta !== 'web/recursos/');
/** El resumen final de unittest cuando todo pasa sin omitir nada: «Ran N tests» y «OK», sin «skipped». */
const PYTHON_EN_VERDE = /^Ran ([1-9]\d*) tests? in [\d.]+s\s+OK$/m;
/** Las variables de los temporales: cada proceso de Python tiene los suyos y no comparte ninguno con los demás. */
const VARIABLES_DE_TEMPORALES = ['TMPDIR', 'TEMP', 'TMP'] as const;

/** Las comprobaciones de scripts/verificar.ts que leen datos/ o web/datos/; las demás solo leen código o web/. */
export function pasosDeDatos(): readonly Paso[] {
  const node = (nombre: string, argumentos: readonly string[]): Paso => ({
    nombre,
    comando: process.execPath,
    argumentos,
  });
  return [
    node('Vectores del móvil y procedencia', ['herramientas/vectores-movil/empaquetar.ts', '--comprobar']),
    node('Clasificador, procedencia y paridad Python', [
      'herramientas/clasificador-movil/empaquetar.ts',
      '--comprobar',
    ]),
    node('Informe de ejemplo', ['herramientas/web/informe-ejemplo.ts', '--comprobar']),
    node('Publicación de datos globales', ['herramientas/web/datos-globales.ts', '--comprobar']),
    node('Publicación de Biblioteca', ['herramientas/web/lecturas.ts', '--comprobar']),
    node('Construcción y aislamiento Cloudflare', ['herramientas/cloudflare/comprobar-construccion.ts']),
  ];
}

/** Las importaciones relativas escritas en un módulo, sin ejecutarlo. */
function importacionesRelativas(codigo: string): string[] {
  return [...codigo.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map(([, ruta]) => ruta ?? '');
}

/** Las pruebas y sus ayudas, que son lo único que se recorre: el código del producto no decide qué lee una prueba. */
function esDeLasPruebas(ruta: string): boolean {
  return ruta.startsWith('pruebas/') || ruta.includes('/pruebas/');
}

/**
 * Indica si un módulo de pruebas lee el paquete real: una ruta escrita desde el propio archivo que cae en las
 * carpetas del paquete (una URL relativa al propio archivo que sube hasta `datos`), una ruta unida a la raíz del repositorio
 * (join(RAIZ, 'datos', …)), la web local construida con el paquete (webConstruida, webLocalVigente) o el catálogo
 * de Cursos publicado leído con su referencia (catalogoPublicado).
 */
function leeElPaquete(raiz: string, ruta: string, codigo: string, carpetas = CARPETAS_DEL_PAQUETE): boolean {
  for (const [, escrita = ''] of codigo.matchAll(/['"`]((?:\.\.?\/)+[^'"`$]*)['"`]/g)) {
    const destino = `${relative(raiz, resolve(dirname(join(raiz, ruta)), escrita))
      .split(sep)
      .join('/')}/`;
    if (carpetas.some((carpeta) => destino.startsWith(carpeta))) {
      return true;
    }
  }
  const unidaALaRaiz = carpetas.includes('web/recursos/')
    ? /\bRAIZ\w*\s*,\s*['"`](?:datos|web\/datos|web\/recursos)[/'"`]/i
    : /\bRAIZ\w*\s*,\s*['"`](?:datos|web\/datos)[/'"`]/i;
  return unidaALaRaiz.test(codigo) || /\b(?:webConstruida|webLocalVigente|catalogoPublicado)\(/.test(codigo);
}

/**
 * Una prueba y las ayudas de pruebas que importa, con su código.
 *
 * @param raiz - Raíz del producto.
 * @param archivo - La prueba, con su ruta absoluta.
 * @returns Cada módulo recorrido, por su ruta desde la raíz.
 */
export function cierreDeLaPrueba(raiz: string, archivo: string): ReadonlyMap<string, string> {
  const vistas = new Map<string, string>();
  const pendientes = [relative(raiz, archivo).split(sep).join('/')];
  for (let ruta = pendientes.pop(); ruta !== undefined; ruta = pendientes.pop()) {
    // Una ruta escrita dentro del código de un caso (una plantilla) no es una importación de esta prueba.
    if (vistas.has(ruta) || !esDeLasPruebas(ruta) || !existsSync(join(raiz, ruta))) {
      continue;
    }
    const codigo = readFileSync(join(raiz, ruta), 'utf8');
    vistas.set(ruta, codigo);
    for (const importada of importacionesRelativas(codigo)) {
      pendientes.push(posix.normalize(posix.join(posix.dirname(ruta), importada)));
    }
  }
  return vistas;
}

/** Abre un navegador quien importa playwright-core; el ciclo no instala navegadores. */
const ABRE_UN_NAVEGADOR = /\bfrom\s*['"]playwright-core['"]|import\(\s*['"]playwright-core['"]\s*\)/;

/**
 * Lo que la traza vio leer el paquete (scripts/pruebas-que-leen-datos.json, que escribe --medir). Sin la lista, vacío:
 * el ciclo se queda con lo que reconoce por el código, y una prueba avisa de que falta medir.
 *
 * @param raiz - Raíz del producto.
 * @returns Las pruebas de Node, por su ruta desde la raíz, y los módulos de Python medidos.
 */
function listaMedida(raiz: string): ListaMedida {
  const ruta = join(raiz, LISTA_MEDIDA);
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as ListaMedida) : { node: [], python: [] };
}

/**
 * Las pruebas de unidad que leen el paquete real: las que la traza vio abrirlo y, como red para las que aún no se han
 * medido, las que lo nombran en su código o en las ayudas de pruebas que importan. Quedan fuera las que abren un
 * navegador y las fotos del paquete (scripts/fotos-del-paquete.ts): esas siguen en la batería completa.
 *
 * @param raiz - Raíz del producto.
 * @returns Las rutas absolutas, en el orden de la batería completa.
 */
export function pruebasNodeDeDatos(raiz: string): readonly string[] {
  const medidas = new Set(listaMedida(raiz).node);
  return listarPruebas(raiz).filter(
    (archivo) =>
      (medidas.has(relative(raiz, archivo).split(sep).join('/')) ||
        [...cierreDeLaPrueba(raiz, archivo)].some(([ruta, codigo]) => leeElPaquete(raiz, ruta, codigo))) &&
      !abreUnNavegador(raiz, archivo) &&
      !esFotoDelPaquete(archivo),
  );
}

/**
 * Si la prueba, o una ayuda de pruebas que importa, lee los datos del paquete y no solo el código generado que se
 * publica junto a ellos (web/recursos/).
 *
 * @param raiz - Raíz del producto.
 * @param archivo - La prueba, con su ruta absoluta.
 * @returns Si lee datos del paquete.
 */
export function leeLosDatosDelPaquete(raiz: string, archivo: string): boolean {
  return [...cierreDeLaPrueba(raiz, archivo)].some(([ruta, codigo]) =>
    leeElPaquete(raiz, ruta, codigo, CARPETAS_DE_DATOS),
  );
}

/** Si la prueba, o una ayuda de pruebas que importa, abre un navegador. */
export function abreUnNavegador(raiz: string, archivo: string): boolean {
  return [...cierreDeLaPrueba(raiz, archivo).values()].some((codigo) => ABRE_UN_NAVEGADOR.test(codigo));
}

/**
 * Los módulos de pruebas Python que abren el paquete o la web real: los que la traza vio abrirlos y, como red para los
 * que aún no se han medido, los que los nombran desde la raíz (RAIZ / "datos", RAIZ / "web"). Quedan fuera las fotos
 * del paquete, que siguen en la batería completa.
 *
 * @param raiz - Raíz del producto.
 * @returns Los módulos con puntos, ordenados.
 */
export function pruebasPythonDeDatos(raiz: string): readonly string[] {
  const medidos = new Set(listaMedida(raiz).python);
  return modulosDePruebasPython(raiz).filter((modulo) => {
    const archivo = archivoDelModulo(raiz, modulo);
    const leeElPaquete = medidos.has(modulo) || /\bRAIZ\w*\s*\/\s*"(?:datos|web)\b/.test(readFileSync(archivo, 'utf8'));
    return leeElPaquete && !esFotoDelPaquete(archivo);
  });
}

/**
 * Exige que las pruebas Python de los datos se hayan ejecutado todas: unittest da por buena una omisión, y una prueba
 * que se omite porque falta el paquete no lo protege.
 *
 * @param salida - Lo que escribió unittest.
 * @throws {FalloDeComprobacion} Si no hay casos ejecutados o alguno se omitió.
 */
export function exigirPythonSinOmisiones(salida: string): number {
  const casos = PYTHON_EN_VERDE.exec(salida)?.[1];
  if (casos === undefined) {
    throw new FalloDeComprobacion('Las pruebas Python de los datos no se ejecutaron todas o omitieron alguna');
  }
  return Number(casos);
}

/**
 * El reloj con que el ensayo con datos grabados fija su ciclo (plataforma_datos/comun/instante_del_ciclo.py). Las
 * pruebas fijan el suyo: sin estas variables corren como en producción, donde nunca están.
 */
export const RELOJ_DEL_ENSAYO: readonly string[] = ['FARO_HOY', 'FARO_INSTANTE'];

/**
 * Las pruebas Python que abren el paquete, con la misma guardia sin red que la batería completa
 * (scripts/pruebas_python.py, heredada por sitecustomize.py) y sin el reloj del ensayo.
 * @param raiz - La raíz del repositorio.
 * @param modulos - Los módulos de pruebas, con puntos.
 * @returns El paso que las ejecuta.
 */
export function pasoPruebasPythonDeDatos(raiz: string, modulos: readonly string[]): Paso {
  return {
    nombre: 'Pruebas Python de los datos',
    comando: join(raiz, '.venv/bin/python'),
    argumentos: ['-m', 'unittest', ...modulos],
    entorno: { PYTHONPATH: join(raiz, 'scripts/sin_red'), FARO_PRUEBAS_SIN_RED: '1' },
    excluir: RELOJ_DEL_ENSAYO,
  };
}

/**
 * Un proceso de Python con su lote de módulos: el paso de las pruebas de los datos (guardia sin red, sin el reloj del
 * ensayo) y su carpeta de temporales propia.
 */
export function pasoDePython(raiz: string, lote: LoteDePython, numero: number, temporal: string): Paso {
  const paso = pasoPruebasPythonDeDatos(raiz, lote.modulos);
  return {
    ...paso,
    nombre: `${paso.nombre}, proceso ${numero}`,
    entorno: {
      ...paso.entorno,
      ...Object.fromEntries(VARIABLES_DE_TEMPORALES.map((variable) => [variable, temporal])),
    },
  };
}

/**
 * Combina los procesos como si fueran uno: todos deben terminar bien y sin omisiones. Si alguno falla, la orden falla
 * con la salida completa de cada proceso que falló.
 *
 * @param resultados - Lo que devolvió cada proceso, en el orden de los lotes.
 * @returns Los casos ejecutados entre todos.
 * @throws {FalloDeComprobacion} Con la salida de cada proceso que falló u omitió casos.
 */
export function concluirProcesosDePython(resultados: readonly PromiseSettledResult<string>[]): number {
  const fallos: string[] = [];
  let casos = 0;
  resultados.forEach((resultado, indice) => {
    const titulo = `Pruebas Python de los datos, proceso ${indice + 1} de ${resultados.length}`;
    if (resultado.status === 'rejected') {
      fallos.push(`${titulo}:\n${resultado.reason instanceof Error ? resultado.reason.message : resultado.reason}`);
      return;
    }
    try {
      casos += exigirPythonSinOmisiones(resultado.value);
    } catch (error) {
      fallos.push(`${titulo}: ${(error as Error).message}\n${resultado.value.trim()}`);
    }
  });
  if (fallos.length) {
    throw new FalloDeComprobacion(fallos.join('\n\n'));
  }
  return casos;
}

/**
 * Ejecuta los módulos repartidos en procesos a la vez (scripts/reparto-de-pruebas-python.ts) y espera a todos, para
 * informar de cada fallo. Cada proceso tiene su carpeta de temporales, que se retira al terminar.
 *
 * @param raiz - Raíz del producto.
 * @param modulos - Los módulos, en el orden de un solo proceso.
 * @param procesos - Cuántos procesos a la vez; el ciclo usa el tope, PROCESOS_DE_PYTHON.
 * @returns Los casos ejecutados entre todos.
 */
export async function probarPythonEnProcesos(
  raiz: string,
  modulos: readonly string[],
  procesos = PROCESOS_DE_PYTHON,
): Promise<number> {
  const reparto = repartirPruebasPython(modulos, leerDuracionesPython(raiz).segundos, procesos);
  if (reparto.sinDuracion.length) {
    console.warn(
      `Aviso: ${reparto.sinDuracion.join(', ')} no tiene duración medida en ${DURACIONES_PYTHON}; ` +
        `se reparte con la mediana (${reparto.mediana} s). Mídelo y añádelo.`,
    );
  }
  const area = mkdtempSync(join(tmpdir(), 'faro-pruebas-python-de-datos-'));
  try {
    const resultados = await Promise.allSettled(
      reparto.lotes.map((lote, indice) => {
        const temporal = join(area, `proceso-${indice + 1}`);
        mkdirSync(temporal);
        console.log(
          `Pruebas Python de los datos, proceso ${indice + 1} de ${reparto.lotes.length}: ` +
            `${lote.modulos.length} módulos, ${lote.segundos} s medidos`,
        );
        return ejecutarPaso(pasoDePython(raiz, lote, indice + 1, temporal), raiz, PLAZO_PYTHON_MS);
      }),
    );
    const casos = concluirProcesosDePython(resultados);
    console.log(
      `Pruebas Python de los datos: ${casos} casos de ${modulos.length} módulos en ${reparto.lotes.length} procesos, sin omisiones`,
    );
    return casos;
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
}

/** Ejecuta las comprobaciones de datos y las pruebas que abren el paquete; cualquier fallo detiene la orden. */
async function comprobarLosDatos(raiz: string): Promise<void> {
  exigirVersionNode(process.versions.node);
  console.log(resumenDeLaBaseEsco(await comprobarBaseEsco(raiz)));
  for (const paso of pasosDeDatos()) {
    const salida = await ejecutarPaso(paso, raiz);
    console.log(`${paso.nombre}: correcto${salida.trim() ? `\n${salida.trim()}` : ''}`);
  }
  const archivos = pruebasNodeDeDatos(raiz);
  const python = pruebasPythonDeDatos(raiz);
  if (!archivos.length || !python.length) {
    throw new FalloDeComprobacion('No hay pruebas que abran el paquete de datos');
  }
  const salida = await ejecutarPaso(pasoPruebasDeUnidad(archivos), raiz, PLAZO_SUITE_UNIDAD_MS);
  const todas = EXTENSIONES.length ? OMISIONES_DE_LA_GLOBAL : OMISIONES_SIN_EXTENSIONES;
  const elegidas = new Set(archivos.map((archivo) => relative(raiz, archivo).split(sep).join('/')));
  const admitidas = Object.fromEntries(Object.entries(todas).filter(([ruta]) => elegidas.has(ruta)));
  exigirPruebasEjecutadas(salida, { raiz, archivos, admitidas });
  console.log(`Pruebas Node de los datos: ${archivos.length} archivos`);
  await probarPythonEnProcesos(raiz, python);
  if (process.env.FARO_HUMO_CHROMIUM !== '0') {
    await probarElHumo(raiz);
  }
}

/** El humo en un solo motor, en serie; el ciclo lo apaga con FARO_HUMO_CHROMIUM=0 si no instala Chromium. */
async function probarElHumo(raiz: string): Promise<void> {
  const humo = [join(raiz, HUMO_DE_DATOS)];
  const paso = pasoPruebasPropias(humo);
  const argumentos = paso.argumentos.map((a) => (a === '--test-concurrency=2' ? '--test-concurrency=1' : a));
  const salida = await ejecutarPaso({ ...paso, nombre: 'Humo de datos en Chromium', argumentos }, raiz, PLAZO_HUMO_MS);
  exigirPruebasEjecutadas(salida, { raiz, archivos: humo, admitidas: {} });
  console.log('Humo de datos en Chromium: correcto');
}

/** La orden del ciclo, o la medición de las pruebas que leen el paquete; nada más. */
async function principal(raiz: string, argumentos: readonly string[]): Promise<void> {
  if (argumentos.length === 0) {
    return comprobarLosDatos(raiz);
  }
  if (argumentos.length === 1 && argumentos[0] === '--medir') {
    return medirPruebasDeDatos(raiz);
  }
  throw new FalloDeComprobacion('Uso: node scripts/verificar-datos.ts [--medir]', { codigo: CODIGO_USO_INVALIDO });
}

if (import.meta.main) {
  await terminarConCodigo(() => principal(RAIZ, process.argv.slice(2)));
}
