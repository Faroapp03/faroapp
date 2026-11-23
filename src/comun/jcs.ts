// JSON canónico según JCS (RFC 8785, JSON Canonicalization Scheme): lo que se firma (seguridad/firma.ts) se escribe
// siempre igual, con independencia del orden en que se construyeron sus claves. JCS toma la serialización de
// ECMAScript para los números y los textos (la de JSON.stringify), y ordena las claves de cada objeto por sus unidades
// UTF-16, que es el orden por defecto de sort() en JavaScript. Solo valores JSON: un número que no es finito, una
// función, un símbolo o un objeto que no es plano (Date, Map, Set, una clase) no tienen forma canónica y se rechazan;
// una clave con valor undefined se omite, como en JSON.
// La recursión baja un nivel por cada objeto o lista anidados, y la acota la forma de lo que se firma: la construye el
// motor, con una profundidad fija de pocos niveles, para una estimación (contenidoFirmado, api/estimacion-firmada.ts).
// Los textos que van dentro llegan en un cuerpo que ya ha pasado el límite de
// tamaño (MAX_CUERPO_BYTES, api/cuerpo.ts) y su esquema.

import { esObjeto } from './json.ts';

/** Texto con sustitutos UTF16 sueltos: no es I-JSON y no admite canonicalización JCS. */
export class TextoJcsInvalido extends TypeError {}

/** Serializa un texto sin normalizarlo; JCS exige Unicode válido también en las claves. */
function textoCanonico(texto: string): string {
  if (!texto.isWellFormed()) {
    throw new TextoJcsInvalido('JCS no admite textos con sustitutos sueltos');
  }
  return JSON.stringify(texto);
}

/**
 * Comprueba que un objeto es un objeto JSON plano: creado con un literal, con `Object.create(null)` o por
 * `JSON.parse`. Un Date, un Map, un Set o la instancia de una clase no lo son: JSON.stringify los escribiría según su
 * `toJSON` o como `{}`, y lo firmado no sería lo que otro verificador calcula.
 *
 * @param valor - Objeto ya comprobado con esObjeto.
 * @returns Si su prototipo es Object.prototype o null.
 */
function esObjetoPlano(valor: object): boolean {
  const prototipo: unknown = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

/**
 * Escribe el texto canónico (RFC 8785) de un valor JSON.
 *
 * @param valor - Valor JSON: null, booleano, número finito, texto, lista u objeto plano, anidados.
 * @returns El texto canónico, con las claves ordenadas por sus unidades UTF-16 y sin espacios.
 * @throws {TypeError} Si el valor (o algo dentro) no es representable en JSON: un número que no es finito, una
 *   función, un símbolo, un bigint o un objeto que no es plano. TextoJcsInvalido si un texto (valor o clave)
 *   contiene sustitutos UTF16 sueltos, como exige RFC 8785 §3.2.2.2; nunca se reemplazan ni normalizan.
 */
export function jsonCanonico(valor: unknown): string {
  if (typeof valor === 'string') {
    return textoCanonico(valor);
  }
  if (valor === null || typeof valor === 'boolean') {
    return JSON.stringify(valor);
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new TypeError('JCS no admite números que no son finitos');
    }
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) {
    // Una posición vacía se escribe como null; el recorrido no depende de un iterador añadido a la lista.
    const elementos = Array.from({ length: valor.length }, (_elemento, indice) => jsonCanonico(valor[indice] ?? null));
    return `[${elementos.join(',')}]`;
  }
  if (!esObjeto(valor)) {
    throw new TypeError(`JCS no admite valores de tipo ${typeof valor}`);
  }
  if (!esObjetoPlano(valor)) {
    throw new TypeError(`JCS solo admite objetos planos, no ${Object.prototype.toString.call(valor)}`);
  }
  const claves = Object.keys(valor)
    .filter((clave) => valor[clave] !== undefined)
    .sort();
  return `{${claves.map((clave) => `${textoCanonico(clave)}:${jsonCanonico(valor[clave])}`).join(',')}}`;
}
