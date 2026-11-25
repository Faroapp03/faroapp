// El reparto de las pruebas Python de los datos (scripts/verificar-datos.ts) en varios procesos a la vez. Es
// determinista: depende solo de la lista de módulos y de su duración medida (scripts/duraciones-pruebas-python.json).
// Cada módulo va entero a un proceso, con sus clases y sus preparativos, y conserva en él el orden de la lista.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Los procesos de Python a la vez: el tope de procesos de pruebas simultáneos del Mac y del runner. */
export const PROCESOS_DE_PYTHON = 3;
/** La duración medida de cada módulo, en segundos, con su origen. */
export const DURACIONES_PYTHON = 'scripts/duraciones-pruebas-python.json';

/** El archivo de duraciones: de dónde salen las cifras y los segundos de cada módulo. */
export interface DuracionesPython {
  readonly origen: string;
  readonly segundos: Readonly<Record<string, number>>;
}

/** Los módulos que ejecuta un proceso y la suma de sus duraciones medidas (o supuestas). */
export interface LoteDePython {
  readonly modulos: readonly string[];
  readonly segundos: number;
}

/** El reparto completo y lo que se ha supuesto: los módulos sin duración y la mediana que se les asignó. */
export interface RepartoDePython {
  readonly lotes: readonly LoteDePython[];
  readonly sinDuracion: readonly string[];
  readonly mediana: number;
}

/**
 * Lee las duraciones versionadas.
 *
 * @param raiz - Raíz del producto.
 * @returns El origen y los segundos de cada módulo.
 */
export function leerDuracionesPython(raiz: string): DuracionesPython {
  return JSON.parse(readFileSync(join(raiz, DURACIONES_PYTHON), 'utf8')) as DuracionesPython;
}

/** Las cargas se dan en centésimas de segundo, la precisión de la medición. */
const CENTESIMAS = 100;

/** El orden de los nombres por sus unidades de código, igual en cualquier idioma del sistema. */
function porNombre(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** La mediana de unas duraciones; sin ninguna, un segundo: todos los módulos pesan lo mismo. */
function mediana(valores: readonly number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  if (orden.length === 0) {
    return 1;
  }
  return orden.length % 2 ? (orden[medio] ?? 1) : ((orden[medio - 1] ?? 1) + (orden[medio] ?? 1)) / 2;
}

/**
 * Reparte los módulos entre los procesos: el más largo primero, al proceso menos cargado. Los empates de duración se
 * deshacen por el nombre del módulo y los de carga, por el primer proceso, para que el reparto no dependa de nada más.
 * Un módulo sin duración medida pesa la mediana de los medidos y se devuelve aparte, para avisar. Un proceso que se
 * quedaría sin módulos no se lanza: unittest sin nombres descubriría todas las pruebas.
 *
 * @param modulos - Los módulos, en el orden en que los ejecutaría un solo proceso.
 * @param segundos - La duración medida de cada módulo.
 * @param procesos - Cuántos procesos a la vez.
 * @returns Los lotes no vacíos, cada uno con sus módulos en el orden de la lista, y lo supuesto.
 */
export function repartirPruebasPython(
  modulos: readonly string[],
  segundos: Readonly<Record<string, number>>,
  procesos = PROCESOS_DE_PYTHON,
): RepartoDePython {
  const medidos = modulos.filter((modulo) => Object.hasOwn(segundos, modulo));
  const supuesta = mediana(medidos.map((modulo) => segundos[modulo] ?? 0));
  const duracion = (modulo: string): number => (Object.hasOwn(segundos, modulo) ? (segundos[modulo] ?? 0) : supuesta);
  const posicion = new Map(modulos.map((modulo, indice) => [modulo, indice]));
  const lotes = Array.from({ length: procesos }, () => ({ modulos: [] as string[], segundos: 0 }));
  const porDuracion = [...modulos].sort((a, b) => duracion(b) - duracion(a) || porNombre(a, b));
  for (const modulo of porDuracion) {
    const destino = lotes.reduce((menor, lote) => (lote.segundos < menor.segundos ? lote : menor));
    destino.modulos.push(modulo);
    destino.segundos += duracion(modulo);
  }
  return {
    lotes: lotes
      .filter((lote) => lote.modulos.length > 0)
      .map((lote) => ({
        modulos: lote.modulos.sort((a, b) => (posicion.get(a) ?? 0) - (posicion.get(b) ?? 0)),
        segundos: Math.round(lote.segundos * CENTESIMAS) / CENTESIMAS,
      })),
    sinDuracion: modulos.filter((modulo) => !Object.hasOwn(segundos, modulo)),
    mediana: supuesta,
  };
}
