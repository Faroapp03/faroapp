// Medición de las pruebas que leen el paquete (node scripts/verificar-datos.ts --medir): ejecuta la batería de unidad
// de Node y cada módulo de pruebas Python con la traza (scripts/traza-de-datos.ts y scripts/traza_datos/), y escribe
// en scripts/pruebas-que-leen-datos.json qué pruebas abrieron algo de lo que produce la cadena de datos. Es la medida
// con la que pruebas/herramientas/verificar-datos.test.ts comprueba que la selección del ciclo no deja ninguna fuera.
// Requiere la web local construida (npm run web:preparar), como la batería completa.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { EXTENSIONES } from '../src/plataforma/extensiones.ts';
import type { Paso } from './ejecucion-del-paso.ts';
import { esFotoDelPaquete } from './fotos-del-paquete.ts';
import { OMISIONES_DE_LA_GLOBAL, OMISIONES_SIN_EXTENSIONES } from './resumen-pruebas.ts';
import {
  ejecutarPaso,
  exigirPruebasEjecutadas,
  listarPruebas,
  PLAZO_SUITE_UNIDAD_MS,
  pasoPruebasDeUnidad,
} from './verificar.ts';

/** La lista medida, en el árbol: la escribe esta medición y la lee la prueba de la selección. */
export const LISTA_MEDIDA = 'scripts/pruebas-que-leen-datos.json';
/** Cada módulo Python va en su proceso; el más lento de la batería tarda unos minutos. */
const PLAZO_MODULO_PYTHON_MS = 600_000;
const PRECARGA_TRAZA = new URL('./traza-de-datos.ts', import.meta.url).href;

/** Las pruebas medidas: archivos de Node desde la raíz y módulos Python con puntos, ordenados. */
export interface ListaMedida {
  readonly node: readonly string[];
  readonly python: readonly string[];
}

/**
 * Todos los módulos de pruebas Python del producto, con puntos y ordenados (los que descubre scripts/pruebas_python.py).
 *
 * @param raiz - Raíz del producto.
 * @returns Los módulos.
 */
export function modulosDePruebasPython(raiz: string): readonly string[] {
  return readdirSync(join(raiz, 'plataforma_datos'), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /^test_\w+\.py$/.test(entrada.name))
    .map((entrada) => relative(raiz, join(entrada.parentPath, entrada.name)).slice(0, -'.py'.length))
    .map((ruta) => ruta.split(sep).join('.'))
    .sort();
}

/**
 * El archivo de un módulo de pruebas Python.
 *
 * @param raiz - Raíz del producto.
 * @param modulo - El módulo, con puntos.
 * @returns Su ruta absoluta.
 */
export function archivoDelModulo(raiz: string, modulo: string): string {
  return join(raiz, `${modulo.split('.').join('/')}.py`);
}

/** El entorno de la traza: dónde se anota y la guardia de red de Python con su gancho de auditoría. */
function entornoDeLaTraza(raiz: string, destino: string): Record<string, string> {
  return { FARO_TRAZA_DATOS: destino, PYTHONPATH: join(raiz, 'scripts/traza_datos'), FARO_PRUEBAS_SIN_RED: '1' };
}

/** La prueba que lee la lista medida no entra en la medición: sin la lista, fallaría y la medición no terminaría. */
const PRUEBA_DE_LA_SELECCION = 'pruebas/herramientas/verificar-datos.test.ts';
/**
 * Lo que la medición no ejecuta: la prueba de la selección y las fotos del paquete, que la comprobación del ciclo no
 * puede ejecutar (scripts/fotos-del-paquete.ts) y por eso no deben entrar en la lista.
 */
function fueraDeLaMedicion(raiz: string, archivo: string): boolean {
  return archivo === join(raiz, PRUEBA_DE_LA_SELECCION) || esFotoDelPaquete(archivo);
}

async function medirNode(raiz: string, destino: string): Promise<void> {
  const archivos = listarPruebas(raiz).filter((archivo) => !fueraDeLaMedicion(raiz, archivo));
  const paso = pasoPruebasDeUnidad(archivos);
  const entorno = paso.entorno ?? {};
  const salida = await ejecutarPaso(
    {
      ...paso,
      entorno: {
        ...entorno,
        ...entornoDeLaTraza(raiz, destino),
        NODE_OPTIONS: `${entorno.NODE_OPTIONS ?? ''} --import=${PRECARGA_TRAZA}`.trim(),
      },
    },
    raiz,
    PLAZO_SUITE_UNIDAD_MS,
  );
  const admitidas = EXTENSIONES.length ? OMISIONES_DE_LA_GLOBAL : OMISIONES_SIN_EXTENSIONES;
  exigirPruebasEjecutadas(salida, { raiz, archivos, admitidas });
}

/**
 * Cada módulo en su proceso, para saber cuál abre cada archivo; uno en rojo detiene la medición, que no sería fiable.
 * Las fotos del paquete no se miden, igual que en Node.
 */
async function medirPython(raiz: string, destino: string): Promise<void> {
  const medibles = modulosDePruebasPython(raiz).filter((modulo) => !esFotoDelPaquete(archivoDelModulo(raiz, modulo)));
  for (const modulo of medibles) {
    const paso: Paso = {
      nombre: `Python ${modulo}`,
      comando: join(raiz, '.venv/bin/python'),
      argumentos: ['-m', 'unittest', modulo],
      entorno: { ...entornoDeLaTraza(raiz, destino), FARO_TRAZA_PRUEBA: modulo },
    };
    await ejecutarPaso(paso, raiz, PLAZO_MODULO_PYTHON_MS);
  }
}

/**
 * Agrupa la traza en la lista medida.
 *
 * @param traza - Las líneas «prueba<TAB>ruta».
 * @returns Las pruebas de Node (con «/») y los módulos Python (con puntos), sin repetir y ordenados.
 */
export function listaDeLaTraza(traza: string): ListaMedida {
  const pruebas = new Set(
    traza
      .split('\n')
      .filter(Boolean)
      .map((linea) => linea.split('\t')[0] ?? ''),
  );
  const ordenadas = [...pruebas].filter(Boolean).sort();
  return {
    node: ordenadas.filter((prueba) => prueba.includes('/')),
    python: ordenadas.filter((prueba) => !prueba.includes('/')),
  };
}

/** Ejecuta la medición y escribe la lista medida. */
export async function medirPruebasDeDatos(raiz: string): Promise<void> {
  const carpeta = mkdtempSync(join(tmpdir(), 'faro-traza-datos-'));
  try {
    const destino = join(carpeta, 'traza.tsv');
    writeFileSync(destino, '');
    await medirNode(raiz, destino);
    await medirPython(raiz, destino);
    const lista = listaDeLaTraza(readFileSync(destino, 'utf8'));
    writeFileSync(join(raiz, LISTA_MEDIDA), `${JSON.stringify(lista, null, 2)}\n`);
    console.log(`${LISTA_MEDIDA}: ${lista.node.length} pruebas Node y ${lista.python.length} módulos Python`);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}
