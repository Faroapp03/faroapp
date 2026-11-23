// El azar de las personas simuladas: fijo por persona y pregunta, para que la misma persona responda igual a la misma
// pregunta en todas las versiones y la comparación sea justa. --semilla da otra tirada independiente.

import { createHash } from 'node:crypto';
import type { Atributos } from './tipos.ts';

/** 2^32: lleva los primeros 4 bytes de la huella a [0, 1). */
const ESCALA_DEL_AZAR = 4294967296;
/** Cifras del subgrupo en que se busca primero el grupo vecino (CIUO-08 de 3 cifras). */
const CIFRAS_DEL_SUBGRUPO = 3;
/** Cifras del subgrupo principal, si en el de 3 no hay otro grupo. */
const CIFRAS_DEL_SUBGRUPO_PRINCIPAL = 2;

/** Una función de azar en [0, 1) a partir de unas partes de texto. */
export type Azar = (...partes: string[]) => number;

/**
 * El azar de la medición.
 *
 * @param semilla - La de --semilla, o null para la tirada fija (la de la referencia).
 * @returns La función de azar.
 */
export function crearAzar(semilla: string | boolean | null): Azar {
  return (...partes) =>
    createHash('sha256')
      .update((semilla ? [`semilla ${semilla}`, ...partes] : partes).join('|'))
      .digest()
      .readUInt32BE(0) / ESCALA_DEL_AZAR;
}

/**
 * El grupo vecino con que se confunde la persona: otro del mismo subgrupo de 3 cifras (o de 2), fijo por persona.
 *
 * @param atributos - La tabla de atributos.
 * @param grupo - El grupo de la persona.
 * @param clave - La clave de la persona («clave de ruido del banco/id#grupo»).
 * @param azar - El azar de la medición.
 * @returns El grupo vecino, o el suyo si no hay otro.
 */
export function vecinoDe(atributos: Atributos, grupo: string, clave: string, azar: Azar): string {
  const todos = Object.keys(atributos.grupos).filter((g) => g !== grupo);
  const tres = todos.filter((g) => g.slice(0, CIFRAS_DEL_SUBGRUPO) === grupo.slice(0, CIFRAS_DEL_SUBGRUPO));
  const dos = (): string[] =>
    todos.filter((g) => g.slice(0, CIFRAS_DEL_SUBGRUPO_PRINCIPAL) === grupo.slice(0, CIFRAS_DEL_SUBGRUPO_PRINCIPAL));
  const lista = tres.length ? tres : dos();
  return lista.length ? (lista[Math.floor(azar('vecino', clave) * lista.length)] ?? grupo) : grupo;
}
