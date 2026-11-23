/** Búsqueda y posiciones del título: normalización común y límites de palabra para términos cortos. */
import { textoBuscable } from '../comun/texto-buscable.js';

const MAX_LETRAS_PALABRA_CORTA = 2;
const PALABRAS = /[\p{L}\p{N}]+/gu;
export type RangoDeTexto = readonly [desde: number, hasta: number];

export function palabrasBuscadas(consulta: string): readonly string[] {
  return [...new Set(textoBuscable(consulta).match(PALABRAS) ?? [])];
}
export function contieneBusqueda(texto: string, palabras: readonly string[]): boolean {
  const comparable = textoBuscable(texto);
  const completas = new Set(comparable.match(PALABRAS) ?? []);
  return palabras.every((palabra) =>
    [...palabra].length <= MAX_LETRAS_PALABRA_CORTA ? completas.has(palabra) : comparable.includes(palabra),
  );
}
function posiciones(texto: string) {
  let normalizado = '';
  let posicion = 0;
  const desde: number[] = [];
  const hasta: number[] = [];
  for (const letra of texto) {
    const base = textoBuscable(letra);
    if (!base && hasta.length > 0) {
      hasta[hasta.length - 1] = posicion + letra.length;
    }
    for (let indice = 0; indice < base.length; indice++) {
      desde.push(posicion);
      hasta.push(posicion + letra.length);
    }
    normalizado += base;
    posicion += letra.length;
  }
  return { normalizado, desde, hasta };
}
function coincidencias(texto: string, palabra: string): readonly RangoDeTexto[] {
  if ([...palabra].length <= MAX_LETRAS_PALABRA_CORTA) {
    return [...texto.matchAll(PALABRAS)].flatMap((m) =>
      m[0] === palabra ? [[m.index, m.index + m[0].length] as const] : [],
    );
  }
  const rangos: RangoDeTexto[] = [];
  for (let i = texto.indexOf(palabra); i >= 0; i = texto.indexOf(palabra, i + 1)) {
    rangos.push([i, i + palabra.length]);
  }
  return rangos;
}
/** Los rangos son unidades UTF-16 del original; incluyen acentos combinados y no parten caracteres astrales. */
export function rangosEncontrados(texto: string, consulta: string): readonly RangoDeTexto[] {
  const { normalizado, desde, hasta } = posiciones(texto);
  const rangos = palabrasBuscadas(consulta)
    .flatMap((p) => coincidencias(normalizado, p))
    .flatMap(([inicio, fin]) => {
      const a = desde[inicio];
      const b = hasta[fin - 1];
      return a === undefined || b === undefined ? [] : [[a, b] as const];
    })
    .sort(([a], [b]) => a - b);
  const unidos: [number, number][] = [];
  for (const [a, b] of rangos) {
    const ultimo = unidos.at(-1);
    if (ultimo && a <= ultimo[1]) {
      ultimo[1] = Math.max(ultimo[1], b);
    } else {
      unidos.push([a, b]);
    }
  }
  return unidos;
}
