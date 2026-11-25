// Comprobaciones propias del producto: tipos, formato y pruebas de Node y Python.
// Cada paso conserva su salida y termina con error si falla o supera su plazo. Cada paso corre en un grupo de procesos
// propio; al cortarlo se detiene su árbol entero, también lo que se haya ido a otros grupos (ejecucion-del-paso.ts).

import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTENSIONES } from '../src/plataforma/extensiones.ts';
import { comprobarBaseEsco, resumenDeLaBaseEsco } from './base-esco.ts';
import { comprobarControladorDeVideo } from './controlador-de-video.ts';
import { ejecutarPaso as ejecutarConPlazo, type Paso } from './ejecucion-del-paso.ts';
import { conFirefox, type EntornoFirefox, VARIABLES_EXCLUIDAS } from './entorno-firefox.ts';
import { codigoDeSalida, FalloDeComprobacion } from './fallo-de-comprobacion.ts';
import { claveDePrueba } from './orden-pruebas.ts';
import { PLAZO_SUITE_NAVEGADOR_MS, PLAZO_SUITE_UNIDAD_MS } from './plazos-de-las-suites.ts';
import { ordenDelEnsayo, tipoPruebaMjs } from './pruebas-mjs.ts';
import {
  exigirPruebasEjecutadas,
  exigirPruebasNavegadorEjecutadas,
  OMISIONES_DE_LA_GLOBAL,
  OMISIONES_SIN_EXTENSIONES,
} from './resumen-pruebas.ts';
import { pasosDeTipos } from './tipos.ts';

export type { Paso } from './ejecucion-del-paso.ts';
export { codigoDeSalida, FalloDeComprobacion } from './fallo-de-comprobacion.ts';
export { PLAZO_SUITE_NAVEGADOR_MS, PLAZO_SUITE_UNIDAD_MS } from './plazos-de-las-suites.ts';
export { exigirPruebasEjecutadas, exigirPruebasNavegadorEjecutadas } from './resumen-pruebas.ts';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
/** Las carpetas de pruebas que declara cada extensión instalada en su registro, relativas a la raíz. */
const PRUEBAS_DE_EXTENSIONES = EXTENSIONES.map(({ carpetaDePruebas }) => carpetaDePruebas);
/** Dos minutos por control ordinario; las pruebas son locales y no requieren descargas. */
const PLAZO_POR_PASO_MS = 120_000;
/**
 * La suite de 4.272 casos, incluidos los cortes y la recuperación del catálogo, tardó 21 min 19 s en el Mac.
 * En Ubuntu, con la ejecución en serie, completó 3.886 casos en 40 min y alcanzó ese límite durante el ensayo
 * de varios ciclos. Los 75 min también cubren la ruta de una sola CPU y la variación entre runners.
 */
export const PLAZO_SUITE_PYTHON_MS = 4_500_000;
const CODIGO_EXITO = 0;
const CODIGO_USO_INVALIDO = 2;
const NODE_MAYOR_MINIMO = 24;
const NODE_MENOR_MINIMO = 22;
/** Node 24.22.3 incorpora SQLite 3.54.1 para el almacén administrativo local. */
const NODE_PARCHE_MINIMO = 3;
const NODE_VERSION_MINIMA = `${NODE_MAYOR_MINIMO}.${NODE_MENOR_MINIMO}.${NODE_PARCHE_MINIMO}`;

/**
 * Ejecuta una herramienta sin shell, en su grupo propio y con salida acotada (ejecucion-del-paso.ts).
 *
 * @param paso - Orden y argumentos de la herramienta.
 * @param raiz - Directorio de trabajo del producto o del caso de prueba.
 * @param plazoMs - Tiempo máximo del paso, en milisegundos; dos minutos por defecto.
 * @returns La salida de la herramienta si termina con éxito.
 * @throws {FalloDeComprobacion} Si falta la herramienta, falla, supera el plazo o escribe demasiado.
 */
export function ejecutarPaso(paso: Paso, raiz: string, plazoMs: number = PLAZO_POR_PASO_MS): Promise<string> {
  return ejecutarConPlazo(paso, raiz, plazoMs);
}

/**
 * Las carpetas de pruebas propias: pruebas/, la de cada motor independiente (motores/<motor>/pruebas/) y la que
 * declara cada extensión instalada en su registro, si existen.
 *
 * @param raiz - Raíz del producto.
 * @returns Las rutas absolutas de las carpetas, pruebas/ primero.
 */
function carpetasDePruebas(raiz: string): readonly string[] {
  const motores = join(raiz, 'motores');
  const deMotores = existsSync(motores)
    ? readdirSync(motores, { withFileTypes: true })
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => join(motores, entrada.name, 'pruebas'))
        .filter((carpeta) => existsSync(carpeta))
        .sort()
    : [];
  const deExtensiones = PRUEBAS_DE_EXTENSIONES.map((carpeta) => join(raiz, carpeta)).filter(existsSync);
  return [join(raiz, 'pruebas'), ...deMotores, ...deExtensiones];
}

function agregarPrueba(raiz: string, archivo: string, unidad: string[], navegador: string[]): void {
  if (!archivo.endsWith('.test.mjs')) {
    unidad.push(archivo);
    return;
  }
  const ruta = relative(raiz, archivo).split(sep).join('/');
  const tipo = tipoPruebaMjs(ruta, PRUEBAS_DE_EXTENSIONES);
  if (tipo === 'navegador') {
    navegador.push(archivo);
  } else if (tipo === 'unidad') {
    unidad.push(archivo);
  } else if (tipo === 'ensayo') {
    // Un ensayo con orden propia no entra en las baterías, pero no se omite en silencio: su orden tiene que existir.
    if (!ordenDelEnsayo(raiz, ruta)) {
      throw new FalloDeComprobacion(`Ensayo de navegador sin su orden en package.json: ${ruta}`);
    }
  } else {
    throw new FalloDeComprobacion(`Prueba mjs sin clasificar: ${ruta}`);
  }
}

/** Descubre todas las pruebas y exige clasificar explícitamente cada nuevo módulo mjs. */
function clasificarPruebas(raiz: string): { unidad: string[]; navegador: string[] } {
  const unidad: string[] = [];
  const navegador: string[] = [];
  for (const carpeta of carpetasDePruebas(raiz)) {
    for (const entrada of readdirSync(carpeta, { recursive: true, withFileTypes: true })) {
      if (!entrada.isFile() || !/\.test\.(ts|js|mjs)$/.test(entrada.name)) {
        continue;
      }
      const archivo = join(entrada.parentPath, entrada.name);
      agregarPrueba(raiz, archivo, unidad, navegador);
    }
  }
  return {
    unidad: unidad.sort((a, b) => {
      const primero = claveDePrueba(raiz, a);
      const segundo = claveDePrueba(raiz, b);
      return primero < segundo ? -1 : Number(primero > segundo);
    }),
    navegador: navegador.sort(),
  };
}

/** Archivos de unidad, incluidos los módulos mjs sin navegador. */
export function listarPruebas(raiz: string): readonly string[] {
  const { unidad } = clasificarPruebas(raiz);
  if (!unidad.length) {
    throw new FalloDeComprobacion('No hay archivos de pruebas propias');
  }
  return unidad;
}

/** La suite de navegador se descubre separadamente y nunca se omite en la verificación real. */
export function listarPruebasNavegador(raiz: string): readonly string[] {
  return clasificarPruebas(raiz).navegador;
}

/**
 * Exige Node 24 desde 24.22.3 para usar su SQLite corregido y la API de resúmenes por archivo.
 *
 * @param version - Versión del Node que ejecuta el verificador.
 * @throws {FalloDeComprobacion} Si la versión no es válida o es anterior a la mínima o de otra rama.
 */
export function exigirVersionNode(version: string): void {
  const [mayor = -1, menor = -1, parche = -1] = version.split('.').map(Number);
  const formatoValido = /^\d+\.\d+\.\d+$/.test(version);
  const versionAdmitida =
    mayor === NODE_MAYOR_MINIMO &&
    (menor > NODE_MENOR_MINIMO || (menor === NODE_MENOR_MINIMO && parche >= NODE_PARCHE_MINIMO));
  if (!formatoValido || !versionAdmitida) {
    throw new FalloDeComprobacion(
      `Se requiere Node >=${NODE_VERSION_MINIMA} <${NODE_MAYOR_MINIMO + 1} para los resúmenes de pruebas y las correcciones de seguridad; recibido ${version}`,
    );
  }
}

/** Node en ejecución es el de todas las órdenes JS, no el que casualmente devuelva el PATH. */
function pasoNode(nombre: string, argumentos: readonly string[]): Paso {
  return { nombre, comando: process.execPath, argumentos };
}

/** Controles reales de los archivos admitidos, con herramientas instaladas en esta copia. */
export function pasosDeCodigo(raiz: string): readonly Paso[] {
  const python = join(raiz, '.venv/bin/python');
  return [
    ...pasosDeTipos(raiz),
    pasoNode('Biome', [join(raiz, 'node_modules/@biomejs/biome/bin/biome'), 'check', '--error-on-warnings', '.']),
    pasoNode('Vectores del móvil y procedencia', ['herramientas/vectores-movil/empaquetar.ts', '--comprobar']),
    pasoNode('Clasificador, procedencia y paridad Python', [
      'herramientas/clasificador-movil/empaquetar.ts',
      '--comprobar',
    ]),
    pasoNode('Informe de ejemplo', ['herramientas/web/informe-ejemplo.ts', '--comprobar']),
    pasoNode('Utilidades web compartidas', ['herramientas/web/comunes.ts', '--comprobar']),
    pasoNode('Publicación de datos globales', ['herramientas/web/datos-globales.ts', '--comprobar']),
    pasoNode('Publicación de Biblioteca', ['herramientas/web/lecturas.ts', '--comprobar']),
    pasoNode('Contrato OpenAPI y protocolo web', ['herramientas/api/openapi.ts', '--comprobar']),
    pasoNode('Fuentes de la web sin generados', ['herramientas/web/preparar.ts', '--comprobar']),
    pasoNode('Web local: construcción, integridad, copia sin conexión y artefactos', [
      'herramientas/web/construir.ts',
      '--local',
    ]),
    pasoNode('Construcción y aislamiento Cloudflare', ['herramientas/cloudflare/comprobar-construccion.ts']),
    pasoNode('Huellas CSP de la portada', ['herramientas/cloudflare/actualizar-portada.ts', '--comprobar']),
    pasoNode('Huellas CSP de la pantalla de acceso', [
      'herramientas/cloudflare/actualizar-acceso-web.ts',
      '--comprobar',
    ]),
    {
      nombre: 'Python y SQLite con FTS5',
      comando: python,
      argumentos: ['-I', '-B', join(raiz, 'plataforma_datos/comun/entorno_python.py')],
    },
    { nombre: 'Ruff', comando: python, argumentos: ['-m', 'ruff', 'check', '.'] },
    { nombre: 'Formato Python', comando: python, argumentos: ['-m', 'ruff', 'format', '--check', '.'] },
  ];
}

/** Ejecuta la suite Python requerida; su descubridor rechaza cero casos y omisiones totales. */
export async function probarPython(raiz: string): Promise<string> {
  return ejecutarPaso(
    {
      nombre: 'Pruebas Python',
      comando: join(raiz, '.venv/bin/python'),
      argumentos: [join(raiz, 'scripts/pruebas_python.py')],
    },
    raiz,
    PLAZO_SUITE_PYTHON_MS,
  );
}

/** La precarga que impide a las pruebas Node salir a la red (pruebas/ayudas/sin-red.ts). */
export const PRECARGA_SIN_RED = new URL('../pruebas/ayudas/sin-red.ts', import.meta.url).href;
/** Resuelve el motor por su dirección fija al empaquetado de la web local (pruebas/ayudas/motor-construido.ts). */
export const PRECARGA_MOTOR = new URL('../pruebas/ayudas/motor-construido.ts', import.meta.url).href;

/**
 * La orden de las pruebas Node. La precarga va en `NODE_OPTIONS`, así la reciben el ejecutor de pruebas, cada archivo
 * aislado en su proceso y cualquier proceso Node que lance una prueba; los workers la reciben de la propia precarga.
 *
 * @param archivos - Los archivos de pruebas, en orden.
 * @returns El paso, con su entorno.
 */
export function pasoPruebasPropias(archivos: readonly string[]): Paso {
  const previas = process.env.NODE_OPTIONS?.trim();
  return {
    ...pasoNode('Pruebas propias', [
      '--test',
      `--test-reporter=${new URL('./registro-pruebas.ts', import.meta.url).href}`,
      '--test-concurrency=2',
      '--test-isolation=process',
      `--test-timeout=${PLAZO_POR_PASO_MS}`,
      ...archivos,
    ]),
    diagnosticosSeparados: true,
    entorno: {
      NODE_OPTIONS: [previas, `--import=${PRECARGA_SIN_RED}`, `--import=${PRECARGA_MOTOR}`].filter(Boolean).join(' '),
    },
  };
}

/**
 * La orden de la suite de unidad de la batería global. No transmite FARO_CONSTRUCCION: el motor empaquetado se omite
 * siempre aquí (OMISIONES_DE_LA_GLOBAL) y se ejecuta aparte sobre el artefacto final, aunque quien lanza la tenga.
 *
 * @param archivos - Los archivos de pruebas de unidad, en orden.
 * @returns El paso, con su entorno.
 */
export function pasoPruebasDeUnidad(archivos: readonly string[]): Paso {
  return { ...pasoPruebasPropias(archivos), excluir: ['FARO_CONSTRUCCION'] };
}

/**
 * La orden de la batería de navegador: secuencial y con las carpetas de Firefox de esta batería (no de cada caso) en su
 * entorno, que heredan el ejecutor de pruebas, cada archivo y sus hijos. Sustituyen a las MOZ_* de quien lanza; del
 * resto del entorno heredado solo se retira VARIABLES_EXCLUIDAS, y HOME se conserva.
 *
 * @param archivos - Las pruebas de navegador, en orden.
 * @param entornoFirefox - Las variables de las carpetas de Firefox creadas para esta ejecución.
 * @returns El paso, con su entorno.
 */
export function pasoPruebasNavegador(archivos: readonly string[], entornoFirefox: EntornoFirefox): Paso {
  const paso = pasoPruebasPropias(archivos);
  return {
    ...paso,
    nombre: 'Pruebas de navegador',
    argumentos: paso.argumentos.map((argumento) =>
      argumento === '--test-concurrency=2' ? '--test-concurrency=1' : argumento,
    ),
    entorno: { ...paso.entorno, ...entornoFirefox },
    excluir: VARIABLES_EXCLUIDAS,
  };
}

/** Ejecuta la batería de navegador con carpetas de Firefox nuevas y las retira al terminar. */
async function probarNavegador(raiz: string, navegador: readonly string[]): Promise<void> {
  if (!navegador.length) {
    throw new FalloDeComprobacion('No hay pruebas de navegador');
  }
  comprobarControladorDeVideo();
  // Un fallo de la batería conserva su código; uno de la limpieza se informa aparte y nunca pasa por correcto.
  await conFirefox(tmpdir(), async (entorno) => {
    const salida = await ejecutarPaso(pasoPruebasNavegador(navegador, entorno), raiz, PLAZO_SUITE_NAVEGADOR_MS);
    exigirPruebasNavegadorEjecutadas(salida, navegador);
    console.log(salida.trim());
  });
}

/**
 * Las pruebas de navegador pedidas por quien ejecuta una prueba suelta: solo se admiten archivos de la suite.
 *
 * @param raiz - Raíz del producto.
 * @param pedidas - Rutas recibidas, relativas al directorio actual o absolutas.
 * @returns Las rutas absolutas, en el orden recibido.
 * @throws {FalloDeComprobacion} Si no hay ninguna o alguna no pertenece a la suite de navegador.
 */
export function pruebasNavegadorPedidas(raiz: string, pedidas: readonly string[]): readonly string[] {
  const suite = new Set(listarPruebasNavegador(raiz));
  const archivos = pedidas.map((ruta) => resolve(ruta));
  const ajenas = archivos.filter((archivo) => !suite.has(archivo));
  if (!archivos.length || ajenas.length) {
    throw new FalloDeComprobacion(
      `No son pruebas de navegador de la suite: ${ajenas.join(', ') || 'ninguna indicada'}`,
    );
  }
  return archivos;
}

/** Ambas suites tienen un plazo de grupo; Node limita además cada archivo por separado. */
async function probar(raiz: string): Promise<void> {
  const archivos = listarPruebas(raiz);
  const salida = await ejecutarPaso(pasoPruebasDeUnidad(archivos), raiz, PLAZO_SUITE_UNIDAD_MS);
  const admitidas = EXTENSIONES.length ? OMISIONES_DE_LA_GLOBAL : OMISIONES_SIN_EXTENSIONES;
  exigirPruebasEjecutadas(salida, { raiz, archivos, admitidas });
  console.log(salida.trim());
  await probarNavegador(raiz, listarPruebasNavegador(raiz));
  console.log((await probarPython(raiz)).trim());
}

/**
 * Ejecuta la verificación y fija el código del proceso: 0 solo si todo termina bien.
 *
 * @param tarea - La verificación completa o una parte.
 */
export async function terminarConCodigo(tarea: () => Promise<void>): Promise<void> {
  try {
    await tarea();
    process.exitCode = CODIGO_EXITO;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'La comprobación ha fallado');
    process.exitCode = codigoDeSalida(error);
  }
  console.error(`Código de salida de la verificación: ${process.exitCode}`);
}

/**
 * Verifica solo sus órdenes documentadas; los argumentos desconocidos no se ignoran. La base ESCO local se comprueba
 * primero, en la verificación completa y en `npm test`: sin ella, una prueba del motor de ocupaciones se omitiría, y
 * eso no se admite. Las pruebas de navegador sueltas no la usan.
 *
 * @param raiz - Raíz de la instalación.
 * @param argumentos - Los argumentos de la orden, sin el ejecutable ni el programa.
 */
export async function principal(raiz: string, argumentos: readonly string[]): Promise<void> {
  exigirVersionNode(process.versions.node);
  if (argumentos[0] === '--navegador') {
    await probarNavegador(raiz, pruebasNavegadorPedidas(raiz, argumentos.slice(1)));
    return;
  }
  const soloPruebas = argumentos.length === 1 && argumentos[0] === '--pruebas';
  if (argumentos.length !== 0 && !soloPruebas) {
    throw new FalloDeComprobacion(
      'Uso: npm run verificar, npm test, o node scripts/verificar.ts --navegador <pruebas de navegador>',
      { codigo: CODIGO_USO_INVALIDO },
    );
  }
  console.log(resumenDeLaBaseEsco(await comprobarBaseEsco(raiz)));
  if (!soloPruebas) {
    for (const paso of pasosDeCodigo(raiz)) {
      const salida = await ejecutarPaso(paso, raiz);
      console.log(`${paso.nombre}: correcto${salida.trim() ? `\n${salida.trim()}` : ''}`);
    }
  }
  await probar(raiz);
}

if (import.meta.main) {
  await terminarConCodigo(() => principal(RAIZ, process.argv.slice(2)));
}
