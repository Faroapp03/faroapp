// Textos: normalización para compararlos sin que importen mayúsculas, acentos ni signos, y listas separadas por comas.

/** Las marcas diacríticas combinables (U+0300–U+036F): los acentos que la forma NFD separa de su letra. */
const MARCAS_DIACRITICAS = /[̀-ͯ]/g;
/**
 * Lo que no es una letra de la «a» a la «z» ni una cifra. Tras sinAcentos ya no queda ninguna «ñ» (NFD la separa en
 * «n» y su tilde), así que no hace falta nombrarla.
 */
const SIGNOS_Y_ESPACIOS = /[^a-z0-9]+/g;

/**
 * Minúsculas y sin acentos, conservando los signos (hacen falta para reconocer marcadores como «system:»).
 *
 * @param texto - El texto que se normaliza.
 * @returns El texto en minúsculas, en NFD y sin marcas diacríticas («Núria» → «nuria», «ñ» → «n»).
 */
export function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(MARCAS_DIACRITICAS, '');
}

/**
 * La forma de comparar palabras: minúsculas, sin acentos y solo con las letras de la «a» a la «z» y las cifras; todo
 * lo demás (signos, espacios y las letras de otros alfabetos, como el cirílico o el chino) se convierte en un espacio.
 *
 * @param texto - El texto que se normaliza.
 * @returns Las palabras separadas por un espacio, sin espacios al principio ni al final.
 */
export function normalizar(texto: string): string {
  return sinAcentos(texto).replace(SIGNOS_Y_ESPACIOS, ' ').trim();
}

/**
 * Los elementos no vacíos de una lista separada por comas («a, b,,c» → a, b y c), como en la configuración.
 *
 * @param texto - La lista, o undefined si no se ha configurado.
 * @returns Los elementos, sin espacios alrededor, en su orden; una lista vacía si no hay ninguno.
 */
export function listaDeComas(texto: string | undefined): string[] {
  return (texto ?? '')
    .split(',')
    .map((elemento) => elemento.trim())
    .filter(Boolean);
}
