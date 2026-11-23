// Orden alfabético de los textos destinados a lectura, con un Intl.Collator por idioma explícito (ECMA-402).
// Escribir el idioma evita tomar el del entorno; el orden concreto depende de los datos de ICU de la plataforma.
// Los identificadores se ordenan por unidades de código UTF-16 (orden.js).

import type { Idioma } from './idioma.ts';

/** El orden alfabético de cada idioma de Faro. */
const ALFABETICO: Readonly<Record<Idioma, Intl.Collator>> = Object.freeze({
  es: new Intl.Collator('es'),
  ca: new Intl.Collator('ca'),
});

/**
 * Compara dos textos por orden alfabético en un idioma, para ordenar lo que se lee.
 *
 * @param a - Un texto.
 * @param b - El otro.
 * @param idioma - El idioma del orden.
 * @returns Negativo si `a` va antes, positivo si va después y 0 si el idioma los ordena igual.
 */
export function compararTexto(a: string, b: string, idioma: Idioma): number {
  return ALFABETICO[idioma].compare(a, b);
}
