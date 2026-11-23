// Generado desde src/comun/base64url.js; no editar esta copia.
// Base64url sin relleno (RFC 4648, apartado 5) para transportar bytes en texto.
// Sin dependencias: usa btoa y atob de la plataforma. El JavaScript y su JSDoc permiten compartir el módulo
// sin compilarlo. Corresponde al consumidor validar el tipo de la entrada y acotar su tamaño.

/** Solo caracteres del alfabeto base64url, sin relleno. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;
/** Base64 se descodifica en grupos de 4 caracteres: el relleno «=» completa el último. */
const CARACTERES_POR_GRUPO = 4;

/**
 * Bytes en base64url sin relleno. Usa las API disponibles en las plataformas admitidas; las conversiones nativas
 * de Uint8Array solo pueden sustituirlas cuando estén disponibles en todas. Letra a letra, sin repartir los bytes
 * como argumentos: evita el límite de argumentos de una llamada. El consumidor fija el tamaño máximo.
 * @param {ArrayBuffer | Uint8Array} bytes - Un buffer completo o los bytes de una vista.
 * @returns {string} Los bytes codificados, sin relleno.
 */
export function aBase64Url(bytes) {
  let binario = '';
  for (const byte of new Uint8Array(bytes)) {
    binario += String.fromCharCode(byte);
  }
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Descodifica base64url sin relleno; acepta bits sobrantes no nulos en el último grupo.
 * El consumidor valida la entrada como string y fija el tamaño máximo antes de llamar.
 * @param {string} texto - El texto codificado.
 * @returns {Uint8Array<ArrayBuffer> | null} Bytes en un buffer propio, o null si el alfabeto o la longitud no valen.
 */
export function deBase64Url(texto) {
  if (!BASE64URL.test(texto)) {
    return null;
  }
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const grupos = Math.ceil(base64.length / CARACTERES_POR_GRUPO);
  try {
    return Uint8Array.from(atob(base64.padEnd(grupos * CARACTERES_POR_GRUPO, '=')), (letra) => letra.charCodeAt(0));
  } catch {
    // Una longitud que base64 no puede tener: un carácter suelto en el último grupo.
    return null;
  }
}
