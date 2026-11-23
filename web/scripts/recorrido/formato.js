// Cómo se escriben para la persona los números, las notas, los títulos y la fecha del recorrido, y cómo se comparan y
// se miden sus textos (las letras con que se cuentan los mínimos).

import { cifra } from '../cifras.js';

/**
 * Marcas diacríticas combinantes de Unicode (U+0300 a U+036F). Tras la normalización NFD, cada tilde, diéresis o
 * virgulilla es una de ellas: «á» pasa a ser «a» + U+0301 y «ñ», «n» + U+0303.
 */
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;
/** Los títulos se ordenan como en un diccionario en castellano: sin distinguir mayúsculas ni tildes. */
const ORDEN_ALFABETICO = new Intl.Collator('es', { sensitivity: 'base' });
/** Las notas de la OIT llevan siempre dos decimales. */
const DECIMALES_DE_LA_NOTA = 2;
/** Una letra de cualquier alfabeto: no lo son las cifras, los signos, los espacios ni los emojis. */
const LETRA = /\p{L}/gu;
/**
 * Lo que separa palabras al comparar: todo lo que no es una letra, una cifra o una marca de cualquier alfabeto. Las
 * marcas se conservan porque en otros alfabetos (devanagari, árabe) forman parte de la palabra; las tildes latinas ya
 * se han quitado antes (MARCAS_DIACRITICAS).
 */
const SEPARADORES = /[^\p{L}\p{N}\p{M}]+/gu;
/** Mitad alta de un par sustituto; el recorte no la separa de su mitad baja. */
const SUSTITUTO_ALTO = { desde: 0xd800, hasta: 0xdbff };

/** Prefijo que reserva una unidad UTF-16 para la elipsis sin cortar un par válido.
 * @param {string} texto @param {number} letras Límite entero positivo en unidades UTF-16.
 */
function prefijoDelRecorte(texto, letras) {
  const ultima = texto.charCodeAt(letras - 2);
  const partido = ultima >= SUSTITUTO_ALTO.desde && ultima <= SUSTITUTO_ALTO.hasta;
  return texto.slice(0, partido ? letras - 2 : letras - 1);
}

/**
 * Un número entero con punto de miles también en los de cuatro cifras, para que el contador diga «1.250 de 4.000» y no
 * «1250 de 4000» (cifras.js).
 * @param {number} valor @returns {string}
 */
export function formatearNumero(valor) {
  return cifra(valor);
}

/**
 * Una nota de la OIT con dos decimales y coma decimal: 0,74.
 * @param {number} valor @returns {string}
 */
export function formatearNota(valor) {
  return cifra(valor, DECIMALES_DE_LA_NOTA);
}

/**
 * Corta un texto largo en `letras` unidades UTF-16, sin partir un par sustituto y con puntos suspensivos.
 * @param {string} texto @param {number} letras @returns {string}
 */
export function recortar(texto, letras) {
  return texto.length > letras ? `${prefijoDelRecorte(texto, letras).trimEnd()}…` : texto;
}

/**
 * Corta un texto largo en `letras` caracteres como mucho sin partir ninguna palabra: en el último espacio que cabe, sin
 * la coma o el punto en que acabe, y con «…» (que cuenta). Una sola palabra más larga que todo se corta donde toque.
 * El límite cuenta unidades UTF-16 y no parte pares sustitutos válidos. Es el recorte del motor
 * (recortarEnPalabras, src/comun/recorte.ts).
 * @param {string} texto @param {number} letras @returns {string}
 */
export function recortarEnPalabras(texto, letras) {
  if (texto.length <= letras) {
    return texto;
  }
  const cabe = prefijoDelRecorte(texto, letras);
  const espacio = /\s\S*$/.exec(cabe)?.index ?? -1;
  // Límite entero positivo y texto más largo: el índice existe.
  const entero = /\s/.test(/** @type {string} */ (texto[letras - 1])) || espacio <= 0 ? cabe : cabe.slice(0, espacio);
  return `${entero.replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * La fecha de `ahora` (por defecto, la de hoy) en la hora y el huso del dispositivo de la persona, como AAAA-MM-DD.
 * @param {Date} [ahora] el instante del que se toma la fecha; las pruebas fijan el suyo
 * @returns {string}
 */
export function fechaLocalDeHoy(ahora = new Date()) {
  /** @param {number} valor */
  const dosCifras = (valor) => String(valor).padStart(2, '0');
  return `${ahora.getFullYear()}-${dosCifras(ahora.getMonth() + 1)}-${dosCifras(ahora.getDate())}`;
}

/**
 * Cuántas letras tiene un texto. Los mínimos del recorrido se cuentan en letras y no en caracteres: «🚌🚌🚌» son seis
 * caracteres y ninguna letra, y no dice qué tarea es.
 * @param {string} texto @returns {number}
 */
export function contarLetras(texto) {
  let letras = 0;
  for (const _ of texto.matchAll(LETRA)) {
    letras += 1;
  }
  return letras;
}

/**
 * Un texto en una forma única para compararlo letra a letra: sin mayúsculas, con los espacios justos y la misma forma
 * Unicode (NFKC), pero con sus tildes y sus signos. Para comparar sin tildes ni signos, `comparable`.
 * @param {string | null | undefined} texto @returns {string}
 */
export function normalizarTexto(texto) {
  return (texto ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Un texto para comparar su escritura sin tildes ni signos (para comparar con ellos, `normalizarTexto`): minúsculas sin
 * tildes latinas; cada secuencia de signos, espacios
 * o emojis se convierte en un espacio y se recortan los extremos. «Diseñar» y «disenar» dan el mismo resultado; un
 * texto en otro alfabeto (cirílico, árabe, chino) conserva sus letras y se distingue de otro.
 * @param {string | null | undefined} texto @returns {string}
 */
export function comparable(texto) {
  return (texto ?? '').toLowerCase().normalize('NFD').replace(MARCAS_DIACRITICAS, '').replace(SEPARADORES, ' ').trim();
}

/**
 * Una copia de `lista` en orden alfabético de su título, como en un diccionario. `tituloDe` dice cuál es: por defecto,
 * su `titulo`; el recorrido ordena por el que ve la persona, en el idioma de la página.
 * @template {{ titulo: string }} Elemento
 * @param {Elemento[]} lista @param {(elemento: Elemento) => string} [tituloDe] @returns {Elemento[]}
 */
export function ordenarPorTitulo(lista, tituloDe = (elemento) => elemento.titulo) {
  return [...lista].sort((a, b) => ORDEN_ALFABETICO.compare(tituloDe(a), tituloDe(b)));
}

/**
 * El título contiene el fragmento buscado tras normalizar ambos textos con comparable.
 * @param {string} titulo @param {string} palabra @returns {boolean}
 */
export function contienePalabra(titulo, palabra) {
  return comparable(titulo).includes(comparable(palabra));
}
