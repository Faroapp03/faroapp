// Parecido entre lo que cuenta la persona y las tareas oficiales de un grupo, sin modelo de lenguaje. Se parte el
// relato en palabras con significado, cada verbo conjugado se lleva también a su infinitivo («archivo» → «archivar»,
// con los verbos oficiales de ia/infinitivo.ts) y se compara con los textos corto y largo de cada tarea, en
// castellano y en catalán, en su forma común (busqueda/palabras.ts). Cada palabra compartida suma su rareza dentro
// del grupo (IDF): «archivar» distingue más que «trabajo».
//
// Es el adaptador léxico de `SimilitudDeTareas`: otra implementación con la misma firma podría ordenar las tareas
// sin tocar la pantalla.

import { clave, infinitivosPosibles } from '../../../../../src/ia/infinitivo.ts';
import { formaComun, palabrasDe } from '../../busqueda/palabras.ts';

/** Una tarea oficial con los textos con que se compara (corto y largo, en castellano y en catalán). */
export interface TareaComparable {
  readonly id: string;
  readonly textos: readonly string[];
}

/** El parecido de cada tarea con el relato (mismo orden que `tareas`), de 0 en adelante; 0 es «nada en común». */
export type SimilitudDeTareas = (relato: string, tareas: readonly TareaComparable[]) => number[];

/** Letras mínimas de la parte común para que dos formas distintas cuenten como la misma palabra. */
const MIN_PREFIJO = 5;
/** Con palabras cortas basta una parte común de 4 letras si es la palabra corta entera y a la larga le sobran 2 letras
 * como mucho («cobr» y «cobrar»; «cont» y «contrat», no). */
const MIN_PREFIJO_CORTA = 4;
const MAX_RESTO_CORTA = 2;
/** Formas comunes que aparecen en casi cualquier tarea o relato y no distinguen nada. */
const SIN_VALOR = new Set(
  [
    ...['trabaj', 'treball', 'tare', 'tasc', 'person', 'activid', 'activitat', 'otr', 'altr', 'tip', 'cos', 'feina'],
    ...['tambien', 'tambe', 'cad', 'tod', 'tot', 'dia', 'muy', 'molt', 'hag', 'hac', 'fer', 'fem', 'estoy', 'est'],
    ...['hay', 'hi', 'ha', 'son', 'sobretot', 'sobre', 'cuand', 'quan', 'gent', 'empres', 'emprese'],
  ].map(formaComun),
);

/** Las formas de una palabra del relato: la común y, si es un verbo conjugado, la de su infinitivo. */
function formasDe(palabra: string): string[] {
  const formas = new Set([formaComun(palabra)]);
  for (const infinitivo of infinitivosPosibles(palabra)) {
    formas.add(formaComun(clave(infinitivo)));
  }
  return [...formas].filter((f) => f.length >= MIN_PREFIJO_CORTA - 1 && !SIN_VALOR.has(f));
}

function prefijoComun(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

/** Si dos formas comunes son la misma palabra: iguales o con una parte común larga («archiv» y «archivador»). */
export function mismaForma(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const comun = prefijoComun(a, b);
  const corta = Math.min(a.length, b.length);
  const larga = Math.max(a.length, b.length);
  return comun >= MIN_PREFIJO || (comun >= MIN_PREFIJO_CORTA && comun === corta && larga - corta <= MAX_RESTO_CORTA);
}

/** Las formas comunes de un texto oficial, sin repetir. */
function formasDelTexto(texto: string): Set<string> {
  return new Set(
    palabrasDe(texto)
      .map(formaComun)
      .filter((f) => f.length >= MIN_PREFIJO_CORTA - 1 && !SIN_VALOR.has(f)),
  );
}

/** Las formas de un relato, una lista por palabra (con su infinitivo si es un verbo). */
export function formasDelRelato(relato: string): string[][] {
  return [...new Set(palabrasDe(relato))].map(formasDe).filter((f) => f.length > 0);
}

/** Las formas de los textos de una tarea, sin repetir. */
export function formasDeLaTarea(tarea: TareaComparable): string[] {
  const todas = new Set<string>();
  for (const texto of tarea.textos) {
    for (const f of formasDelTexto(texto)) {
      todas.add(f);
    }
  }
  return [...todas];
}

/** Si alguna de las formas de una palabra del relato está entre las de una tarea. */
export function aparece(formas: readonly string[], deLaTarea: readonly string[]): boolean {
  return formas.some((x) => deLaTarea.some((y) => mismaForma(x, y)));
}

/**
 * Similitud léxica: para cada tarea, la suma de la rareza (IDF dentro de la lista) de las palabras del relato que
 * aparecen en sus textos. Determinista y sin red.
 */
export const similitudLexica: SimilitudDeTareas = (relato, tareas) => {
  const delRelato = formasDelRelato(relato);
  if (delRelato.length === 0 || tareas.length === 0) {
    return tareas.map(() => 0);
  }
  const formasPorTarea = tareas.map(formasDeLaTarea);
  const idf = delRelato.map((formas) => {
    const con = formasPorTarea.filter((f) => aparece(formas, f)).length;
    return con === 0 ? 0 : Math.log(1 + tareas.length / con);
  });
  return formasPorTarea.map((f) =>
    delRelato.reduce((suma, formas, i) => suma + (aparece(formas, f) ? (idf[i] ?? 0) : 0), 0),
  );
};
