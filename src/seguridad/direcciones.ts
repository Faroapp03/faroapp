// Direcciones postales, solo cuando su forma no deja duda: el tipo de vía, su nombre con mayúscula y el número del
// portal («calle Mayor, 5, 3º 2ª», «c/ de la Pau 12», «Avinguda Diagonal 640»), con el piso, la puerta, el código
// postal y la población que lo sigan; y el código postal tras «CP» o «código postal». Se sustituyen por una marca.
// Lo que se queda, a propósito:
//   - la calle sin número («trabajo en la tienda de la calle Mayor»): dice dónde se trabaja, no dónde vive nadie;
//   - un número que cuenta algo («limpio el Paseo Marítimo 2 veces al día»): tras el número de un portal no sigue
//     una palabra corriente, sino un signo, el piso, el código postal o el final;
//   - una dirección escrita toda en minúsculas («calle mayor 5»): sin la mayúscula, el nombre de la vía no se
//     distingue de la frase («reparto por la calle principal 200 paquetes»).

import { type SinMayusculas, sinDistinguirMayusculas } from '../comun/sin-distinguir-mayusculas.ts';
import type { Limpieza } from './limpieza.ts';

/** La marca que deja una dirección quitada. */
const MARCA = '[dirección eliminada]';

/** Tipos de vía, en castellano y en catalán, con sus abreviaturas más corrientes. */
const TIPO_DE_VIA = [
  ...[
    'gran\\s+v[ií]a',
    'calle',
    'c/',
    'carrer',
    'avenida',
    'avda\\.?',
    'av\\.',
    'avinguda',
    'plaza',
    'pza\\.',
    'plaça',
    'pl\\.',
  ],
  ...['paseo', 'passeig', 'pg\\.', 'p[º°]', 'camino', 'camí', 'carretera', 'ctra\\.', 'ronda', 'rda\\.', 'rambla'],
  ...['travesía', 'travessera', 'travessia', 'vía', 'via', 'pasaje', 'passatge', 'ptge\\.', 'glorieta'],
  ...['urbanización', 'urbanització', 'urb\\.', 'polígono', 'polígon'],
].join('|');
/**
 * Tras el tipo de vía no sigue otra letra: «VIAJES IBERIA 3» o «PLAZAS DISPONIBLES 3» no son «vía» ni «plaza» con un
 * nombre en mayúsculas. Tras una abreviatura con punto o barra, o tras «pº», el nombre puede ir pegado («c/Mayor 5»).
 */
const FIN_DEL_TIPO_DE_VIA = '(?:(?<=[./º°])|(?!\\p{L}))';
/** Lo que une las palabras del nombre de una vía: «de la», «dels», «d'», «i» («carrer de Pi i Margall»). */
const UNION = "(?:(?:de(?:\\s+(?:la|las|los|les))?|del|dels|y|i)\\s+|d['’]|l['’])";
/** Una palabra con mayúscula: «Mayor», «Sant», «Marcel·lí», «Antoni-Maria». */
const PALABRA_CON_MAYUSCULA = "\\p{Lu}[\\p{L}'’·-]*";
/** Una palabra del nombre de la vía: con mayúscula, o una abreviatura con punto delante de otra («Dr. Fleming»). */
const PALABRA_DE_VIA = `(?:\\p{Lu}\\p{Ll}{0,3}\\.(?=\\s+\\p{Lu})|${PALABRA_CON_MAYUSCULA})`;
/** El nombre de la vía: una palabra con mayúscula, o una fecha («8 de Marzo»), y hasta cinco más. */
const NOMBRE_DE_VIA =
  `${UNION}?(?:${PALABRA_DE_VIA}|\\d{1,2}\\s+de\\s+${PALABRA_DE_VIA})` +
  `(?:\\s+${UNION}?(?:${PALABRA_DE_VIA}|\\d{1,2}\\s+de\\s+${PALABRA_DE_VIA})){0,5}`;
/** El número del portal: «5», «5 B», «12-14», «5 bis», con «nº» o «núm.» delante si lo lleva. */
const NUMERO =
  '(?:n[º°o]\\.?\\s*|núm\\.?\\s*|número\\s+)?\\d{1,4}(?:\\s?(?:-|bis)\\s?\\d{0,4})?(?:\\s?[A-Za-z](?!\\p{L}))?';
/** El piso, la escalera y la puerta: «3º 2ª», «1r 2a», «bajo B», «pral.», «esc. B», «puerta 4». */
const PARTES_DEL_PISO = [
  ...['\\d{1,2}\\s?[º°ªoa]', '\\d{1,2}(?:r|n|t|è|er)', 'bajos?', 'baixos', 'pral\\.?', 'principal', 'entresuelo'],
  ...[
    'entresòl',
    'ático',
    'àtic',
    'esc(?:alera)?\\.?\\s*[A-Z\\d]',
    '(?:puerta|porta)\\s+\\w{1,3}',
    '(?:piso|planta)\\s+\\d{1,2}',
  ],
].join('|');
/** Hasta tres partes del piso, cada una con su coma o su espacio delante y, si la lleva, la letra de la puerta. */
const PISO = `(?:,?\\s*(?:${PARTES_DEL_PISO})(?!\\p{L})(?:\\s?[A-Z](?!\\p{L}))?){0,3}`;
/** La población que sigue al código postal: hasta cuatro palabras con mayúscula («Cornellà de Llobregat»). */
const POBLACION = `\\s+${PALABRA_CON_MAYUSCULA}(?:\\s+${UNION}?${PALABRA_CON_MAYUSCULA}){0,3}`;
/** El código postal (01000 a 52999), con «CP» o sin él, y la población que lo sigue: «08940 Cornellà de Llobregat». */
const CODIGO_POSTAL = `(?:,?\\s*(?:C\\.?\\s?P\\.?\\s*)?(?:0[1-9]|[1-4]\\d|5[0-2])\\d{3}(?!\\d)(?:${POBLACION})?)?`;
/** Tras el número de un portal no sigue una palabra corriente: un signo, el final o «y», «de», «en». */
function finDeDireccion(sinMayusculas: SinMayusculas): string {
  return `(?=[^\\S\\n]*(?:$|[,.;:)!?\\n]|${sinMayusculas('y|e|i|en|de|del|a')}(?!\\p{L})))`;
}

/**
 * La dirección entera: tipo de vía, nombre, número y lo que lo sigue. Es una función para que la prueba de
 * equivalencia la compare escrita con el modificador `(?i:…)`.
 *
 * @param sinMayusculas - Cómo se escriben, sin distinguir mayúsculas, el tipo de vía y la palabra que la cierra.
 * @returns La expresión, con las banderas `g` y `u`.
 */
export function expresionDeDireccion(sinMayusculas: SinMayusculas): RegExp {
  return new RegExp(
    `(?<!\\p{L})${sinMayusculas(TIPO_DE_VIA)}${FIN_DEL_TIPO_DE_VIA}\\s*${NOMBRE_DE_VIA},?\\s*${NUMERO}${PISO}` +
      CODIGO_POSTAL +
      finDeDireccion(sinMayusculas),
    'gu',
  );
}
const DIRECCION = expresionDeDireccion(sinDistinguirMayusculas);
/** El código postal anunciado: «CP 08940», «C.P.: 08940», «el código postal es 08940», «codi postal 08940». */
const CODIGO_POSTAL_ANUNCIADO =
  /(?<!\p{L})(?:C\.?\s?P\.?|(?:c[oó]digo|codi)\s+postal)(?:\s+(?:es|és))?\s*:?\s*\d{5}(?!\d)/giu;

/**
 * Quita las direcciones con número y los códigos postales anunciados, y cuenta cada uno.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada dirección cambiada por la marca, y cuántas se han quitado.
 */
export function quitarDirecciones(texto: string): Limpieza {
  let eliminados = 0;
  const marcar = (): string => {
    eliminados += 1;
    return MARCA;
  };
  const limpio = texto.replace(DIRECCION, marcar).replace(CODIGO_POSTAL_ANUNCIADO, marcar);
  return { texto: limpio, eliminados };
}
