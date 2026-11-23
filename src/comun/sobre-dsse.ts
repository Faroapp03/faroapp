// Tipo del contenido, base64 estándar y mensaje firmado mediante PAE de DSSE. Las longitudes se cuentan en bytes,
// con el tipo en UTF-8 y el contenido sin reinterpretarlo. Corresponde al consumidor validar sobres y acotar su tamaño.
// Los JSDoc tipados se conservan al borrar los tipos de TypeScript para comprobar el JavaScript compartido.
// Sin dependencias: usa TextEncoder, btoa y atob de la plataforma.

/** Base64 estándar con relleno (RFC 4648, apartado 4): el alfabeto de los sobres. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Base64 se escribe en grupos de 4 caracteres: un texto de otra longitud está mal formado. */
const CARACTERES_POR_GRUPO = 4;

/**
 * El tipo de cada contenido firmado. El de la lista de materiales de IA es el tipo registrado de CycloneDX en JSON
 * (IANA); los demás son propios de Faro, en el árbol de fabricante («vnd.», RFC 6838).
 */
export const TIPOS = Object.freeze({
  aiBom: 'application/vnd.cyclonedx+json',
  certificado: 'application/vnd.faro.clave-diaria+json',
  instalacion: 'application/vnd.faro.instalacion+json',
  manifiesto: 'application/vnd.faro.manifiesto-del-dispositivo+json',
  respuestaMcp: 'application/vnd.faro.respuesta-mcp+json',
} as const);

/** De texto a sus bytes en UTF-8: las longitudes de la PAE se cuentan en bytes. */
const CODIFICADOR = new TextEncoder();

/**
 * Bytes a base64 estándar con relleno. Evita pasar cada byte como argumento; el consumidor fija el tamaño máximo.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const byte of bytes) {
    binario += String.fromCharCode(byte);
  }
  return btoa(binario);
}

/**
 * Los bytes de un texto en base64 estándar con relleno, en un ArrayBuffer propio (lo que admite Web Crypto), o null
 * si el alfabeto, el relleno o la longitud no valen. Acepta bits sobrantes no nulos en el último grupo; el consumidor
 * fija el tamaño máximo antes de llamar.
 * @param {unknown} codificado
 * @returns {Uint8Array<ArrayBuffer> | null}
 */
export function bytesDeBase64(codificado: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof codificado !== 'string' || !BASE64.test(codificado) || codificado.length % CARACTERES_POR_GRUPO !== 0) {
    return null;
  }
  return Uint8Array.from(atob(codificado), (letra) => letra.charCodeAt(0));
}

/**
 * El mensaje que se firma: PAE(tipo, contenido) = "DSSEv1" SP LEN(tipo) SP tipo SP LEN(contenido) SP contenido, con
 * las longitudes en bytes y en decimal.
 * @param {string} tipo
 * @param {Uint8Array} contenido
 * @returns {Uint8Array<ArrayBuffer>}
 */
export function mensajeAFirmar(tipo: string, contenido: Uint8Array): Uint8Array<ArrayBuffer> {
  const longitudDelTipo = CODIFICADOR.encode(tipo).length;
  const cabecera = CODIFICADOR.encode(`DSSEv1 ${longitudDelTipo} ${tipo} ${contenido.length} `);
  const mensaje = new Uint8Array(cabecera.length + contenido.length);
  mensaje.set(cabecera);
  mensaje.set(contenido, cabecera.length);
  return mensaje;
}
