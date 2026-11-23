// Los códigos de idioma admitidos y sus valores por defecto, compartidos por validación y dominio.
// El idioma de respuesta ('es' o 'ca') se distingue del idioma de un dato original, que también puede ser inglés.

import { IDIOMAS, type Idioma } from '../../compartido/contratos/idioma.ts';

export { IDIOMAS, type Idioma };

/** El idioma de un dato: los de Faro y el inglés, en que la OIT publica sus tareas. */
export type IdiomaDeDato = Idioma | 'en';

/** El idioma de partida de las respuestas que no piden otro. Con tipo literal, para poder excluirlo de Idioma. */
export const IDIOMA_POR_DEFECTO = 'es' satisfies Idioma;

/** El idioma en que están los datos oficiales del paquete (los títulos y los textos de origen). */
export const IDIOMA_DE_LOS_DATOS = 'es' satisfies Idioma;

/**
 * Si un valor que llega de fuera es un idioma de Faro.
 *
 * @param valor - Cualquier valor que llegue de fuera.
 * @returns Si es un idioma de Faro.
 */
export function esIdioma(valor: unknown): valor is Idioma {
  return IDIOMAS.some((idioma) => idioma === valor);
}
