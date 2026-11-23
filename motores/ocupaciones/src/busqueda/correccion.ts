// Tolerancia a faltas: una palabra de la búsqueda que no está en ningún nombre del catálogo («electrisista», «fontanerro»,
// «carnizero») se busca como la palabra del vocabulario más parecida, si está a una o dos letras. Las tildes ya no
// cuentan (comun/texto.ts) y el género y el número tampoco (palabras.ts): aquí solo quedan las letras cambiadas,
// dobladas, de más, de menos o traspuestas (distancia de Damerau-Levenshtein restringida), y las faltas corrientes
// (b/v, g/j, c/s/z, h, letra doblada) cuestan media letra, así que ganan a un cambio cualquiera.
// Para no meter ruido: solo palabras de MIN_LETRAS letras o más (en su forma común), una sola letra de diferencia hasta
// LETRAS_PARA_DOS letras y dos a partir de ahí, la misma primera letra (casi nadie se equivoca en la primera, y así cada
// palabra se compara con una parte pequeña del vocabulario), y nunca un probable nombre propio. A igual distancia, la
// palabra que más ocupaciones usan.

import type { Indice } from './indice.ts';

/** Letras mínimas de una palabra (en su forma común) para corregirla: en las cortas, una letra cambia el sentido. */
export const MIN_LETRAS = 6;
/** Desde estas letras se admiten dos de diferencia. */
const LETRAS_PARA_DOS = 8;

/** El vocabulario de cada índice, por su primera letra; se prepara la primera vez que hace falta. */
const vocabularioPorInicial = new WeakMap<Indice, Map<string, string[]>>();

/** Las palabras del vocabulario del índice, agrupadas por su primera letra. */
function porInicial(indice: Indice): Map<string, string[]> {
  const guardado = vocabularioPorInicial.get(indice);
  if (guardado) {
    return guardado;
  }
  const grupos = new Map<string, string[]>();
  for (const palabra of indice.vocabulario) {
    const inicial = palabra[0] as string;
    const grupo = grupos.get(inicial);
    if (grupo) {
      grupo.push(palabra);
    } else {
      grupos.set(inicial, [palabra]);
    }
  }
  vocabularioPorInicial.set(indice, grupos);
  return grupos;
}

/**
 * Las confusiones de letras más corrientes al escribir en castellano y en catalán, que cuestan media letra: suenan
 * igual o casi («b» y «v», «g» y «j», «c», «s» y «z», «y» e «i», «c», «k» y «q»).
 */
const CONFUSIONES = new Set(['bv', 'gj', 'cz', 'sz', 'cs', 'iy', 'ck', 'kq', 'cq', 'lr', 'mn']);
/** Lo que cuesta una letra de las faltas corrientes: una confusión, una «h» o una letra doblada. */
const MEDIA_LETRA = 0.5;

/** Lo que cuesta cambiar una letra por otra. */
function costeDeCambiar(x: string, y: string): number {
  if (x === y) {
    return 0;
  }
  return CONFUSIONES.has(x < y ? `${x}${y}` : `${y}${x}`) ? MEDIA_LETRA : 1;
}

/** Lo que cuesta que sobre (o falte) la letra `letra` junto a `vecina`: media si es una «h» o la dobla. */
function costeDeSobrar(letra: string, vecina: string | undefined): number {
  return letra === 'h' || letra === vecina ? MEDIA_LETRA : 1;
}

/**
 * Distancia de edición entre dos palabras, con trasposición de dos letras vecinas (Damerau-Levenshtein restringida) y
 * con media letra para las faltas corrientes (CONFUSIONES, una «h» de más o de menos, una letra doblada o sin doblar:
 * «electrisista», «fontanerro», «conserge»), con un tope: en cuanto una fila entera lo supera, se deja de calcular.
 *
 * @param a - Una palabra.
 * @param b - La otra.
 * @param tope - La distancia máxima que interesa.
 * @returns La distancia, o tope + 1 si es mayor que el tope.
 */
export function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) * MEDIA_LETRA > tope) {
    return tope + 1;
  }
  let anterior2: number[] = [];
  let anterior: number[] = [0];
  for (let j = 1; j <= b.length; j++) {
    anterior.push((anterior[j - 1] as number) + costeDeSobrar(b[j - 1] as string, b[j - 2]));
  }
  for (let i = 1; i <= a.length; i++) {
    const fila = [(anterior[0] as number) + costeDeSobrar(a[i - 1] as string, a[i - 2])];
    for (let j = 1; j <= b.length; j++) {
      fila.push(celda({ a, b, i, j }, { anterior2, anterior, fila }));
    }
    if (Math.min(...fila) > tope) {
      return tope + 1;
    }
    anterior2 = anterior;
    anterior = fila;
  }
  return anterior[b.length] as number;
}

/** Una celda de la tabla de distancias: las dos palabras y su posición. */
interface Posicion {
  a: string;
  b: string;
  i: number;
  j: number;
}

/** Las filas ya calculadas de la tabla: la de hace dos, la anterior y la que se está llenando. */
interface Filas {
  anterior2: readonly number[];
  anterior: readonly number[];
  fila: readonly number[];
}

/** El valor de la celda (i, j): lo más barato de quitar, poner, cambiar o trasponer una letra. */
function celda({ a, b, i, j }: Posicion, { anterior2, anterior, fila }: Filas): number {
  const letra = a[i - 1] as string;
  const otra = b[j - 1] as string;
  const valor = Math.min(
    (anterior[j] as number) + costeDeSobrar(letra, a[i - 2] === letra ? letra : otra),
    (fila[j - 1] as number) + costeDeSobrar(otra, b[j - 2] === otra ? otra : letra),
    (anterior[j - 1] as number) + costeDeCambiar(letra, otra),
  );
  const traspuestas = i > 1 && j > 1 && letra === b[j - 2] && a[i - 2] === otra;
  return traspuestas ? Math.min(valor, (anterior2[j - 2] as number) + 1) : valor;
}

/**
 * La palabra del vocabulario del índice con que se busca una palabra que no está en él, o null si ninguna está lo
 * bastante cerca. Quien llama decide si la palabra se corrige (no está en el vocabulario ni la continúa ninguna, y no
 * es un nombre propio).
 *
 * @param indice - El índice del catálogo.
 * @param palabra - La palabra de la búsqueda, en su forma común.
 * @returns La palabra corregida, en su forma común, o null.
 */
export function corregir(indice: Indice, palabra: string): string | null {
  if (palabra.length < MIN_LETRAS) {
    return null;
  }
  const tope = palabra.length >= LETRAS_PARA_DOS ? 2 : 1;
  let mejor: Parecida | null = null;
  for (const candidata of porInicial(indice).get(palabra[0] as string) ?? []) {
    const parecida = comoParecida(indice, palabra, candidata, Math.min(tope, mejor?.distancia ?? tope));
    if (parecida && (!mejor || mejorQue(parecida, mejor))) {
      mejor = parecida;
    }
  }
  return mejor?.palabra ?? null;
}

/** Una palabra del vocabulario parecida a la buscada: a qué distancia está y cuántas ocupaciones la usan. */
interface Parecida {
  palabra: string;
  distancia: number;
  frecuencia: number;
}

/** La candidata como parecida, si está dentro del tope y no es demasiado corta; si no, null. */
function comoParecida(indice: Indice, palabra: string, candidata: string, tope: number): Parecida | null {
  if (candidata.length < MIN_LETRAS - 1) {
    return null;
  }
  const d = distancia(palabra, candidata, tope);
  return d > tope
    ? null
    : { palabra: candidata, distancia: d, frecuencia: indice.apariciones.get(candidata)?.length ?? 0 };
}

/** Más cerca gana; a igual distancia, la que más ocupaciones usan. */
function mejorQue(una: Parecida, otra: Parecida): boolean {
  return una.distancia < otra.distancia || (una.distancia === otra.distancia && una.frecuencia > otra.frecuencia);
}
