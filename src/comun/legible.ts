// Caracteres que no se dibujan y no cambian lo que se lee: un carácter invisible en medio de una palabra
// («ign» + U+200B + «ora») no la separa para quien la lee.

/**
 * Caracteres invisibles que se retiran para no separar una palabra reconocible: marcas de dirección
 * del texto, espacios y uniones de ancho cero, guion opcional, unión de grafemas, anotaciones interlineales y marca
 * de orden de bytes. La limpieza de datos personales
 * (seguridad/privacidad.ts) quita esta misma lista, importada de aquí, y además los selectores de variante y las
 * etiquetas de Unicode. El literal conserva los caracteres originales, algunos invisibles, para mantener intacta
 * su fuente compartida: U+034F, U+00AD, U+061C, U+180E, U+200B–U+200F, U+202A–U+202E, U+2060–U+2064,
 * U+2066–U+206F, U+FEFF y U+FFF9–U+FFFB.
 */
export const INVISIBLES = /͏|[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/gu;
