// Los textos de Faro en cada idioma: el idioma en curso y cada texto por su clave, con sus marcadores rellenos. Sin
// DOM, red ni almacenamiento (guarda en memoria el idioma en curso y los diccionarios cargados): la usan idioma.js,
// que escribe los textos en la página, y los módulos que arman mensajes (el recorrido), que así se pueden probar sin
// navegador.
//
// Los diccionarios no se importan aquí: se cargan uno a uno, solo el que se usa (idiomas/cargar.js), y se apuntan con
// `registrarDiccionario`. Quien escriba textos antes de que su diccionario esté cargado verá la clave tal cual.
//
// Un texto se pide de dos formas:
// - `texto(clave, valores)`: la cadena en el idioma en curso, para lo que no vuelve a pintarse (un confirm()).
// - `traducible(clave, valores)`: la clave con sus valores, sin resolver. Lo que se pinta con ella (idioma.js,
//   `escribir`) recuerda su clave y se vuelve a escribir en cuanto la persona cambia de idioma.
// Los valores rellenan los marcadores con nombre ({titulo}, {n}); un valor puede ser, a su vez, un traducible.
// El texto que llega de fuera (lo que escribe la persona, lo que devuelve la API) no tiene clave: es un literal, y
// `enIdioma` le pone el idioma en que está escrito para que los lectores de pantalla lo lean bien. Un dato que llega
// con su versión en otros idiomas (un título oficial y su traducción de Faro) va `conVersiones`: se escribe en el
// idioma en curso si lo tiene y, si no, en el de partida.

/**
 * Un idioma de la web.
 * @typedef {'es' | 'ca'} Idioma
 */
/**
 * Un diccionario: cada clave con su plantilla (idiomas/es.js e idiomas/ca.js).
 * @typedef {Record<string, string>} Diccionario
 */
/**
 * Un texto del diccionario por su clave, sin resolver, con los valores de sus marcadores.
 * @typedef {{ clave: string, valores: Valores }} Traducible
 */
/**
 * Un texto que no sale del diccionario, con el idioma en que está escrito.
 * @typedef {{ literal: string, idioma: string }} LiteralEnIdioma
 */
/**
 * Un dato de fuera con sus versiones por idioma; `forma` da forma a la versión elegida, que recibe con su idioma.
 * @typedef {Object} ConVersiones
 * @property {Partial<Record<Idioma, string | null>>} versiones
 * @property {((version: string, idioma: Idioma) => string) | null} forma
 */
/**
 * Lo que se puede escribir: un traducible, un literal con su idioma, un dato con versiones o un texto o número tal
 * cual. null y undefined se escriben vacíos.
 * @typedef {Traducible | LiteralEnIdioma | ConVersiones | string | number | null | undefined} Parte
 */
/**
 * Los valores de los marcadores con nombre de un texto: {titulo} → valores.titulo.
 * @typedef {Record<string, Parte>} Valores
 */

/**
 * Los idiomas de la web, el de partida primero: es el del HTML y el que completa lo que le falte a otro.
 * @type {readonly Idioma[]}
 */
export const IDIOMAS = Object.freeze(['es', 'ca']);
/** @type {Idioma} */
export const IDIOMA_DE_PARTIDA = 'es';
/**
 * Los diccionarios que ya están cargados, por idioma: un registro mutable que llena `registrarDiccionario`. Solo se
 * carga el que se usa (idiomas/cargar.js), así que una página en castellano no tiene por qué descargar el catalán.
 * @type {Partial<Record<Idioma, Diccionario>>}
 */
const diccionarios = {};
/**
 * Los atributos del HTML que se traducen: cada uno lleva su clave en data-texto-<atributo>.
 * @type {readonly string[]}
 */
export const ATRIBUTOS_TRADUCIBLES = Object.freeze(['aria-label', 'alt', 'title', 'placeholder', 'content']);
/** Un marcador con nombre: {titulo}, {numero}. Los de cifras ({0}, {1}) son los hijos de un elemento del HTML. */
const MARCADOR = /\{([a-z]\w*)\}/gi;

/**
 * El idioma en que se escriben los textos. Solo lo cambia `fijarIdioma`; empieza en el idioma de partida.
 * @type {Idioma}
 */
let idiomaEnCurso = IDIOMA_DE_PARTIDA;

/**
 * Apunta el diccionario de `idioma`, ya cargado, para que sus textos se puedan escribir (idiomas/cargar.js).
 * @param {Idioma} idioma @param {Diccionario} diccionario @returns {void}
 */
export function registrarDiccionario(idioma, diccionario) {
  diccionarios[idioma] = diccionario;
}

/**
 * Si el diccionario de `idioma` ya está cargado.
 * @param {string} idioma @returns {boolean}
 */
export function hayDiccionario(idioma) {
  return Object.hasOwn(diccionarios, idioma);
}

/**
 * Si `valor` es uno de los idiomas de la web. `valor` puede ser cualquier cosa: un atributo, un campo de la API.
 * @param {unknown} valor @returns {valor is Idioma}
 */
export function esIdioma(valor) {
  return IDIOMAS.some((idioma) => idioma === valor);
}

/**
 * El idioma en que se escriben ahora los textos.
 * @returns {Idioma}
 */
export function idiomaActual() {
  return idiomaEnCurso;
}

/**
 * Cambia el idioma de los textos. Un valor que no es un idioma de la web no cambia nada.
 * @param {string | undefined} idioma
 * @returns {Idioma} el idioma en curso, haya cambiado o no
 */
export function fijarIdioma(idioma) {
  if (esIdioma(idioma)) {
    idiomaEnCurso = idioma;
  }
  return idiomaEnCurso;
}

/**
 * Un texto por su clave, sin resolver todavía: se escribe en el idioma que haya cuando se pinte.
 * @param {string} clave @param {Valores} [valores] @returns {Traducible}
 */
export function traducible(clave, valores = {}) {
  return { clave, valores };
}

/**
 * Un texto que no sale del diccionario (de la API, por ejemplo), con el idioma en que está escrito.
 * @param {string} literal @param {string} idioma @returns {LiteralEnIdioma}
 */
export function enIdioma(literal, idioma) {
  return { literal, idioma };
}

/**
 * Un dato de fuera con sus versiones por idioma ({ es: 'Conductores', ca: 'Conductors' }). `versiones` se lee al
 * pintar, así que una versión que llegue después sirve al volver a pintar; una que falte (o que sea null) se escribe
 * en el idioma de partida. `forma` (opcional) da forma a la versión elegida, según su idioma: una mayúscula, un punto
 * final, la forma breve de un título de ocupación.
 * @param {ConVersiones['versiones']} versiones @param {ConVersiones['forma']} [forma] @returns {ConVersiones}
 */
export function conVersiones(versiones, forma = null) {
  return { versiones, forma };
}

// Las tres preguntas por el tipo de una parte reciben cualquier valor (un texto, un número, null) y miran su forma.

/** @param {unknown} parte @returns {parte is Traducible} */
export function esTraducible(parte) {
  return typeof parte === 'object' && parte !== null && 'clave' in parte && typeof parte.clave === 'string';
}
/** @param {unknown} parte @returns {parte is LiteralEnIdioma} */
export function esLiteralEnIdioma(parte) {
  return typeof parte === 'object' && parte !== null && 'literal' in parte && typeof parte.literal === 'string';
}
/** @param {unknown} parte @returns {parte is ConVersiones} */
export function esConVersiones(parte) {
  return (
    typeof parte === 'object' &&
    parte !== null &&
    'versiones' in parte &&
    typeof parte.versiones === 'object' &&
    parte.versiones !== null
  );
}

/**
 * El idioma en que se escribe ahora un dato con versiones: el en curso si lo tiene y, si no, el de partida.
 * @param {Pick<ConVersiones, 'versiones'>} dato @returns {Idioma}
 */
export function idiomaDeLaVersion({ versiones }) {
  return typeof versiones[idiomaEnCurso] === 'string' ? idiomaEnCurso : IDIOMA_DE_PARTIDA;
}

/** @param {ConVersiones} parte @returns {string} */
function versionEnCurso(parte) {
  const idioma = idiomaDeLaVersion(parte);
  const version = parte.versiones[idioma] ?? '';
  return parte.forma ? parte.forma(version, idioma) : version;
}

/**
 * La plantilla de `clave` en el idioma en curso; si le falta, la del idioma de partida (si su diccionario está
 * cargado). Los dos diccionarios tienen las mismas claves (pruebas/web-idiomas/textos.test.ts), así que no hace falta el de
 * partida para escribir en el otro.
 * @param {string} clave @returns {string | undefined}
 */
function plantilla(clave) {
  const actual = diccionarios[idiomaEnCurso];
  const partida = diccionarios[IDIOMA_DE_PARTIDA];
  const elegida = actual && Object.hasOwn(actual, clave) ? actual[clave] : undefined;
  return elegida ?? (partida && Object.hasOwn(partida, clave) ? partida[clave] : undefined);
}

/**
 * Una parte de un mensaje como cadena: un traducible se resuelve; un dato con versiones, en la del idioma en curso; un
 * literal, tal cual.
 * `resolver` y `texto` son mutuamente recursivas (un valor puede ser otro traducible): la profundidad es la de los
 * traducibles anidados que construye el código de Faro; ningún dato externo llega aquí sin pasar por `enIdioma`.
 * @param {Parte} parte @returns {string}
 */
export function resolver(parte) {
  if (esTraducible(parte)) {
    return texto(parte.clave, parte.valores);
  }
  if (esConVersiones(parte)) {
    return versionEnCurso(parte);
  }
  if (esLiteralEnIdioma(parte)) {
    return parte.literal;
  }
  return String(parte ?? '');
}

/**
 * El texto de `clave` en el idioma en curso, con cada marcador con nombre sustituido por su valor. Una clave que no
 * existe se devuelve tal cual, para que se vea (las pruebas de los idiomas impiden que llegue a publicarse).
 * @param {string} clave @param {Valores} [valores] @returns {string}
 */
export function texto(clave, valores = {}) {
  const base = plantilla(clave);
  if (base === undefined) {
    return clave;
  }
  return base.replace(MARCADOR, (marcador, nombre) => (nombre in valores ? resolver(valores[nombre]) : marcador));
}
