// Cómo compara el buscador de ocupaciones (ocupaciones.ts) las palabras de una búsqueda con las de los nombres del
// catálogo: qué palabras no cuentan, la forma común que iguala el masculino con el femenino y el singular con el
// plural, la frase entera sin género y cuánto se parecen dos palabras que no son la misma.

import { normalizar } from '../../../../src/comun/texto.ts';

/**
 * Palabras que no distinguen una ocupación de otra («soy», «trabajo como»…): no cuentan al buscar. Incluyen preposiciones,
 * conjunciones, determinantes, pronombres y fórmulas de presentación, además de las que ESCO usa dentro de un nombre («personas **sin** hogar»,
 * «lucha **contra** incendios»): están en tan pocos nombres que, si contaran, pesarían como la palabra que más
 * identifica y «xyz sin sentido» propondría trabajadores sociales.
 */
const PALABRAS_VACIAS = new Set([
  ...['de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'a', 'al', 'un', 'una', 'con', 'para', 'por', 'soy'],
  ...['trabajo', 'como', 'mi', 'me', 'o', 'e', 'u', 'sin', 'que', 'sobre', 'contra', 'entre', 'ante', 'bajo', 'tras'],
  ...['hasta', 'desde', 'segun', 'mediante', 'no', 'se', 'su', 'sus', 'lo', 'le', 'les', 'te', 'nos'],
  // Las mismas en catalán: «Sóc infermera a l'hospital». l, d, n y s son restos separados por el apóstrofo.
  ...['i', 'l', 'd', 'n', 's', 'els', 'dels', 'als', 'amb', 'per', 'pel', 'pels', 'sense', 'fins', 'des', 'com'],
  ...['em', 'jo', 'soc', 'treballo', 'faig'],
]);

/** Las palabras de hasta 4 letras se dejan enteras, sin quitarles la terminación. */
const MAX_LETRAS_SIN_RAIZ = 4;
/** Lo que se añade a la raíz de una palabra en plural para no confundirla con el singular al comparar frases. */
const MARCA_PLURAL = '+s';
/**
 * Femeninos que la raíz no iguala con su masculino: palabras cortas, que se dejan enteras, y femeninos irregulares.
 * Son todos los de los títulos dobles de ESCO («jefe/jefa», «mozo/moza», «actor/actriz», «alcalde/alcaldesa»,
 * «chófer/choferesa»); una prueba lo comprueba con el catálogo.
 */
const FEMENINOS_IRREGULARES = new Map([
  ['jefa', 'jefe'],
  ['moza', 'mozo'],
  ['actriz', 'actor'],
  ['actrices', 'actores'],
  ['alcaldesa', 'alcalde'],
  ['alcaldesas', 'alcaldes'],
  ['choferesa', 'chofer'],
  ['choferesas', 'choferes'],
]);
/** Letras mínimas para que dos raíces se parezcan cuando una empieza por la otra. */
export const MIN_LETRAS_PREFIJO = 4;
/**
 * Lo que vale que una raíz solo empiece por la otra, frente a que sean la misma palabra. Un principio común no es la
 * misma palabra («inglés» e «ingletadora» comparten las cuatro primeras letras), así que respalda la mitad: encuentra
 * la ocupación cuando la raíz se queda corta («soldador» con «soldadura»), pero no le da el peso de una palabra dicha.
 */
export const VALOR_DEL_PREFIJO = 0.5;
/**
 * Terminaciones con que una palabra deriva de otra del mismo oficio, ya sin su vocal final (como las deja `raiz`):
 * «limpi(o)» → «limpiador», «vend(o)» → «vendedor», «peluquer(o)» → «peluqueri(a)», «flor(es)» → «florist(a)».
 */
const TERMINACIONES_DERIVADAS = new Set([
  'ador',
  'edor',
  'idor',
  'dor',
  'or',
  'er',
  'ier',
  'ist',
  'i',
  'eri',
  'ari',
  'ad',
  'ant',
  'ent',
]);

/**
 * Raíz sencilla para igualar género y número: administrativo/administrativa/administrativos.
 *
 * @param palabra - Palabra normalizada.
 * @returns La palabra sin su terminación de género y número, o entera si tiene hasta MAX_LETRAS_SIN_RAIZ letras.
 */
function raiz(palabra: string): string {
  return palabra.length > MAX_LETRAS_SIN_RAIZ ? palabra.replace(/(as|os|es|a|o|e|s)$/, '') : palabra;
}

/**
 * La forma con la que se compara una palabra: la misma en masculino y en femenino, en singular y en plural. Límite
 * conocido: una palabra de hasta MAX_LETRAS_SIN_RAIZ letras se deja entera y su plural, que ya es más largo, pierde la
 * terminación, así que no se igualan («jefe» da «jefe» y «jefes», «jef»).
 *
 * @param palabra - Palabra normalizada (palabrasDe), sin palabras vacías.
 * @returns Su forma común.
 */
export function formaComun(palabra: string): string {
  return raiz(FEMENINOS_IRREGULARES.get(palabra) ?? palabra);
}

/**
 * La palabra larga sigue a la corta con una terminación derivada («limpi» → «limpiador»; «mari» → «marin», no).
 *
 * @param corta - Raíz que se supone primero; la larga empieza por ella.
 * @param larga - Raíz que se supone derivada.
 * @returns Si lo que sigue a `corta` en `larga` es una de TERMINACIONES_DERIVADAS.
 */
export function derivada(corta: string, larga: string): boolean {
  return TERMINACIONES_DERIVADAS.has(larga.slice(corta.length));
}

/**
 * Las palabras de un conjunto en su forma común, para compararlas con las de la búsqueda.
 *
 * @param palabras - Palabras normalizadas.
 * @returns Un conjunto nuevo con la forma común de cada una.
 */
export function enFormaComun(palabras: ReadonlySet<string>): Set<string> {
  return new Set([...palabras].map(formaComun));
}

/**
 * Palabras significativas de un texto, normalizadas y sin palabras vacías.
 *
 * @param texto - Texto de una búsqueda o de un nombre del catálogo.
 * @returns Sus palabras en orden, sin las de PALABRAS_VACIAS.
 */
export function palabrasDe(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((palabra) => palabra && !PALABRAS_VACIAS.has(palabra));
}

/**
 * El texto sin las palabras vacías con que empieza: sin la fórmula de presentación («soy», «trabajo de», «sóc», «faig
 * de», «treballo a»…), que no forma parte del oficio. «Soy cajera» se reconoce así como el nombre «cajera».
 *
 * @param texto - Texto de una búsqueda.
 * @returns El texto normalizado desde su primera palabra que cuenta; vacío si no tiene ninguna.
 */
export function sinPresentacion(texto: string): string {
  const palabras = normalizar(texto).split(' ');
  const primera = palabras.findIndex((palabra) => palabra && !PALABRAS_VACIAS.has(palabra));
  return primera < 0 ? '' : palabras.slice(primera).join(' ');
}

/** La forma común, pero conservando el número: «cajeros» y «cajeras» son iguales; «cajero» y «cajeros», no. */
function sinGenero(palabra: string): string {
  return palabra.length > MAX_LETRAS_SIN_RAIZ && palabra.endsWith('s')
    ? `${formaComun(palabra)}${MARCA_PLURAL}`
    : formaComun(palabra);
}

/**
 * Un nombre o una búsqueda entera, para reconocer si uno repite o contiene al otro: normalizado y sin distinguir el
 * género de cada palabra, así que «analista financiera» repite «analista financiero». Se conservan el número y las
 * palabras vacías: «técnico de drenajes» no repite «técnico de drenaje», ni «soy camarera» repite «camarero».
 *
 * @param texto - Nombre del catálogo o búsqueda.
 * @returns La frase normalizada con cada palabra sin género (y, si estaba en plural, con MARCA_PLURAL).
 */
export function fraseSinGenero(texto: string): string {
  return normalizar(texto)
    .split(' ')
    .map((palabra) => (PALABRAS_VACIAS.has(palabra) ? palabra : sinGenero(palabra)))
    .join(' ');
}

/**
 * Cuánto respalda una raíz a la otra: todo si son la misma palabra, VALOR_DEL_PREFIJO si una empieza por la otra (con
 * 4 letras o más) y nada si no se parecen. Con `soloDerivadas` (un probable nombre propio), empezar no basta: la otra
 * tiene que seguirla con una terminación derivada.
 *
 * @param a - Raíz de la búsqueda (formaComun).
 * @param b - Raíz de un nombre del catálogo (formaComun).
 * @param soloDerivadas - Si empezar por la otra solo cuenta con una terminación derivada.
 * @returns 1, VALOR_DEL_PREFIJO o 0.
 */
export function coincidencia(a: string, b: string, soloDerivadas: boolean): number {
  if (a === b) {
    return 1;
  }
  if (Math.min(a.length, b.length) < MIN_LETRAS_PREFIJO) {
    return 0;
  }
  const sigue = (corta: string, larga: string) => larga.startsWith(corta) && (!soloDerivadas || derivada(corta, larga));
  return sigue(a, b) || sigue(b, a) ? VALOR_DEL_PREFIJO : 0;
}
