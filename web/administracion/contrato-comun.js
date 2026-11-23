// Forma cerrada de las respuestas administrativas, sin ejecutar accesores ni reflejar sus valores.
export class RespuestaAdministrativaInvalida extends Error {}
/** @returns {never} */
export function respuestaAdministrativaInvalida() {
  throw new RespuestaAdministrativaInvalida('Respuesta administrativa no válida');
}
/** @param {unknown} entrada @param {readonly string[]} claves @returns {Record<string, unknown>} */
export function objetoAdministrativo(entrada, claves) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return respuestaAdministrativaInvalida();
  }
  const prototipo = Object.getPrototypeOf(entrada);
  if (
    (prototipo !== Object.prototype && prototipo !== null) ||
    Object.getOwnPropertySymbols(entrada).length ||
    Object.getOwnPropertyNames(entrada).length !== claves.length
  ) {
    return respuestaAdministrativaInvalida();
  }
  /** @type {Record<string, unknown>} */
  const copia = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return respuestaAdministrativaInvalida();
    }
    copia[clave] = descriptor.value;
  }
  return copia;
}
