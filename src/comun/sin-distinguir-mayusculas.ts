// Un trozo de expresión regular que no distingue mayúsculas, sin el modificador `(?i:…)`. El modificador es de ES2025
// y un navegador que no lo conoce no carga el módulo que lo lleva. La limpieza de datos personales corre también en
// el navegador (web/scripts/recorrido/minimizar.js): si no carga, el transporte bloquea la petición. La
// bandera `i` para toda la expresión no sirve, porque con ella `\p{Lu}` admite también las minúsculas. Aquí cada
// letra se cambia por la clase de todas las que la comparación sin mayúsculas de JavaScript iguala con ella (con la
// bandera `u`, el plegado simple de Unicode): «s» por `[sSſ]`, «é» por `[éÉ]`. El resultado encuentra exactamente lo
// mismo que `(?i:…)`. pruebas/comun/texto-comun.test.ts vigila el plegado de las letras especiales, los grupos y escapes,
// los rechazos y que las propiedades de fuera del trozo sigan distinguiendo mayúsculas.
// Se admiten solo las piezas cuya traducción es exacta: letras del latín (hasta U+017F, donde están todas las del castellano y el catalán), signos, `\s`, `\d`, los
// escapes de un signo, grupos, clases sin rangos y cuantificadores. Lo demás lanza un error al cargar el módulo que lo
// usa: `\p{…}`, `\w` o `\b` cambian de sentido sin distinguir mayúsculas, y un rango o una clase negada pedirían otra
// cuenta.

/** Los caracteres que se traducen: el latín hasta la extensión A (comprobados uno a uno) y las comillas simples. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: el intervalo empieza en U+0000 a propósito: todos se admiten.
const ADMITIDOS = /^[\u0000-\u017f\u2018\u2019]$/u;
/**
 * Las formas que el plegado simple de Unicode iguala a una letra del latín y que no son ni su mayúscula ni su
 * minúscula: la s larga, el signo de grado Kelvin, el de ángstrom y la eszett mayúscula.
 */
const OTRAS_FORMAS: Readonly<Record<string, string>> = { s: 'ſ', k: 'K', å: 'Å', ß: 'ẞ' };
/** Los escapes que no cambian sin distinguir mayúsculas: espacios, cifras, controles y un signo escapado. */
const ESCAPE = /\\[sSdDnrtfv0^$\\.*+?()[\]{}|/-]/uy;
/** Lo que abre un grupo: «(?:», «(?=», «(?!», «(?<=», «(?<!» o un grupo con nombre «(?<nombre>», que se copia tal cual. */
const APERTURA_DE_GRUPO = /\(\?(?::|=|!|<=|<!|<[\p{L}\d_$]+>)/uy;
/** Lo que hay que escapar para escribir un carácter dentro de una clase. */
const ESPECIAL_EN_CLASE = /[\\\][^-]/u;
/** Las vueltas de mayúscula y minúscula que hacen falta para reunir todas las formas de una letra. */
const VUELTAS = 2;
/** Los signos de la sintaxis que se copian tal cual. */
const SINTAXIS = /^[()|?*+.^$]$/;
/** Un cuantificador entre llaves: «{2}», «{0,3}», «{1,}». */
const CUANTIFICADOR = /\{\d+(?:,\d*)?\}/y;

/** El trozo de `fuente` que empieza en `posicion` y encaja con `patron` (con la bandera `y`), o un error. */
function trozoEn(fuente: string, posicion: number, patron: RegExp, que: string): string {
  patron.lastIndex = posicion;
  const encontrado = patron.exec(fuente);
  if (!encontrado) {
    throw new Error(`sinDistinguirMayusculas: ${que} sin traducción exacta en la posición ${posicion}.`);
  }
  return encontrado[0];
}

/** Añade a `formas` la minúscula, la mayúscula y la otra forma de `forma`, si son un único carácter. */
function anadirCambios(formas: Set<string>, forma: string): void {
  for (const cambio of [forma.toLowerCase(), forma.toUpperCase(), OTRAS_FORMAS[forma.toLowerCase()] ?? '']) {
    if ([...cambio].length === 1) {
      formas.add(cambio);
    }
  }
}

/** Las formas de `caracter` que la comparación sin mayúsculas iguala con él, empezando por él; un error si no se admite. */
function formasDe(caracter: string): string[] {
  if (!ADMITIDOS.test(caracter)) {
    throw new Error(`sinDistinguirMayusculas: «${caracter}» está fuera de los caracteres comprobados.`);
  }
  const formas = new Set([caracter]);
  // Dos vueltas bastan: «µ» da «Μ», y «Μ», «μ». Solo valen los cambios que dejan un único carácter («ß» da «SS»).
  for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
    for (const forma of [...formas]) {
      anadirCambios(formas, forma);
    }
  }
  // La mayúscula de una letra no siempre se iguala con ella: la de «ı» es «I», y sin distinguir mayúsculas «ı» solo
  // es «ı». Se queda la forma que la propia comparación sin mayúsculas del motor de JavaScript iguala.
  const igual = new RegExp(`^[${ESPECIAL_EN_CLASE.test(caracter) ? '\\' : ''}${caracter}]$`, 'iu');
  return [...formas].filter((forma) => igual.test(forma));
}

/** La clase `[…]` de `fuente` que empieza en `posicion`, con las formas de cada letra, y dónde acaba. */
function traducirClase(fuente: string, posicion: number): { clase: string; fin: number } {
  if (fuente[posicion + 1] === '^') {
    throw new Error(`sinDistinguirMayusculas: clase negada en la posición ${posicion}.`);
  }
  let clase = '[';
  let i = posicion + 1;
  while (i < fuente.length && fuente[i] !== ']') {
    if (fuente[i] === '-') {
      throw new Error(`sinDistinguirMayusculas: rango en la posición ${i}.`);
    }
    const escapado = fuente[i] === '\\' ? trozoEn(fuente, i, ESCAPE, 'escape') : null;
    // El límite del bucle garantiza que existe esta unidad UTF-16.
    clase += escapado ?? formasDe(fuente[i] as string).join('');
    i += escapado?.length ?? 1;
  }
  if (i >= fuente.length) {
    throw new Error(`sinDistinguirMayusculas: clase sin cerrar en la posición ${posicion}.`);
  }
  return { clase: `${clase}]`, fin: i + 1 };
}

/** Una letra suelta: ella misma si no tiene otras formas, o la clase de todas. */
function traducirLetra(caracter: string): string {
  const formas = formasDe(caracter);
  return formas.length === 1 ? caracter : `[${formas.join('')}]`;
}

/** Lo que se copia tal cual desde `posicion`: un escape, la apertura de un grupo o una llave; `null` si no es nada de eso. */
function copiadoEn(fuente: string, posicion: number): string | null {
  const caracter = fuente[posicion];
  if (caracter === '\\') {
    return trozoEn(fuente, posicion, ESCAPE, 'escape');
  }
  if (caracter === '(' && fuente[posicion + 1] === '?') {
    return trozoEn(fuente, posicion, APERTURA_DE_GRUPO, 'grupo');
  }
  if (caracter === '{') {
    return trozoEn(fuente, posicion, CUANTIFICADOR, 'llave');
  }
  return null;
}

/** La traducción del trozo de `fuente` que empieza en `posicion` y dónde acaba. */
function traducirTrozo(fuente: string, posicion: number): { clase: string; fin: number } {
  // Solo se llama desde el bucle con `posicion < fuente.length`.
  const caracter = fuente[posicion] as string;
  if (caracter === '[') {
    return traducirClase(fuente, posicion);
  }
  const copiado = copiadoEn(fuente, posicion);
  if (copiado !== null) {
    return { clase: copiado, fin: posicion + copiado.length };
  }
  return { clase: SINTAXIS.test(caracter) ? caracter : traducirLetra(caracter), fin: posicion + 1 };
}

/**
 * El trozo de expresión regular `fuente` (escrito para la bandera `u`) como un grupo `(?:…)` que encuentra lo mismo
 * que `(?i:fuente)`, sin el modificador. Lanza un error si `fuente` lleva algo cuya traducción no es exacta.
 *
 * @param fuente - El texto de la expresión regular.
 * @returns La expresión que no distingue mayúsculas de minúsculas.
 */
export function sinDistinguirMayusculas(fuente: string): string {
  let resultado = '';
  // Cada vuelta avanza al menos un carácter: acaba en `fuente.length` vueltas como mucho.
  for (let i = 0; i < fuente.length; ) {
    const { clase, fin } = traducirTrozo(fuente, i);
    resultado += clase;
    i = fin;
  }
  return `(?:${resultado})`;
}

/** Cómo se escribe un trozo que no distingue mayúsculas: con esta función o, en la prueba de equivalencia, con `(?i:…)`. */
export type SinMayusculas = (fuente: string) => string;
