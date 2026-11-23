// Respuestas pequeñas de conectividad: límite en bytes antes de acumular, incluido un cuerpo sin Content-Length.
const MAX_BYTES = 4096;
export class CuerpoDeConectividadInvalido extends Error {}
/** @param {Response} respuesta @returns {Promise<string>} */
export async function leerCuerpoDeConectividad(respuesta) {
  if (!respuesta.body) {
    throw new CuerpoDeConectividadInvalido();
  }
  const lector = respuesta.body.getReader();
  const bytes = new Uint8Array(MAX_BYTES);
  let usados = 0;
  try {
    for (;;) {
      const parte = await lector.read();
      if (parte.done) {
        break;
      }
      if (parte.value.byteLength > MAX_BYTES - usados) {
        await lector.cancel();
        throw new CuerpoDeConectividadInvalido();
      }
      bytes.set(parte.value, usados);
      usados += parte.value.byteLength;
    }
  } finally {
    lector.releaseLock();
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, usados));
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    throw new CuerpoDeConectividadInvalido();
  }
}
