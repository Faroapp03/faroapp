// Expresiones fijas: dos palabras seguidas de la búsqueda que también van seguidas en los nombres de varias
// ocupaciones del catálogo («recursos humanos», «atención al cliente», «mozo de almacén», «marketing digital»). Juntas
// dicen una cosa que ninguna dice sola: un nombre que solo lleva una de las dos («recursos naturales», «derechos
// humanos», «recursos hídricos») no es lo que se busca y cae (FACTOR_EXPRESION_ROTA, puntuacion.ts). Se sacan del
// propio catálogo, sin lista a mano.

import type { Indice } from './indice.ts';

/** Ocupaciones del catálogo, como mínimo, en cuyos nombres van seguidas las dos palabras para que sean una expresión. */
const MIN_OCUPACIONES_DE_UNA_EXPRESION = 3;

/** Las parejas de palabras seguidas de cada índice, con cuántas ocupaciones las llevan; se preparan una vez. */
const parejasPorIndice = new WeakMap<Indice, ReadonlyMap<string, number>>();

/** La clave de una pareja de palabras. */
function clave(una: string, otra: string): string {
  return `${una} ${otra}`;
}

/** Cuántas ocupaciones del índice llevan cada pareja de palabras seguidas en alguno de sus nombres. */
function parejasDelIndice(indice: Indice): ReadonlyMap<string, number> {
  const guardadas = parejasPorIndice.get(indice);
  if (guardadas) {
    return guardadas;
  }
  const parejas = new Map<string, number>();
  for (const ocupacion of indice.ocupaciones) {
    const suyas = new Set<string>();
    for (const nombre of ocupacion.nombres) {
      for (let i = 1; i < nombre.length; i++) {
        suyas.add(clave(nombre[i - 1] as string, nombre[i] as string));
      }
    }
    for (const pareja of suyas) {
      parejas.set(pareja, (parejas.get(pareja) ?? 0) + 1);
    }
  }
  parejasPorIndice.set(indice, parejas);
  return parejas;
}

/**
 * Las expresiones fijas de una búsqueda: cada dos palabras seguidas que van seguidas en los nombres de al menos
 * MIN_OCUPACIONES_DE_UNA_EXPRESION ocupaciones del índice.
 *
 * @param indice - El índice del catálogo.
 * @param palabras - Las palabras de la búsqueda en su orden, en su forma en el índice.
 * @returns Las parejas que son expresiones fijas.
 */
export function expresionesFijas(indice: Indice, palabras: readonly string[]): [string, string][] {
  const parejas = parejasDelIndice(indice);
  const fijas: [string, string][] = [];
  for (let i = 1; i < palabras.length; i++) {
    const una = palabras[i - 1] as string;
    const otra = palabras[i] as string;
    if (una !== otra && (parejas.get(clave(una, otra)) ?? 0) >= MIN_OCUPACIONES_DE_UNA_EXPRESION) {
      fijas.push([una, otra]);
    }
  }
  return fijas;
}
