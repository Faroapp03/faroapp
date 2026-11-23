// Materializa las respuestas acotadas de la API, retirando su lectura al desconectarse el cliente HTTP.
import { Readable } from 'node:stream';

/** Cuerpo completo, con cancelación de su origen; no cambia los bytes ni las cabeceras de transporte actuales. */
export async function materializarRespuesta(respuesta: Response, cancelacion: AbortSignal): Promise<Buffer> {
  if (!respuesta.body) {
    return Buffer.alloc(0);
  }
  // Node y Fetch usan el mismo ReadableStream en ejecución; sus declaraciones difieren entre node:stream/web y DOM.
  const lectura = Readable.fromWeb(respuesta.body as import('node:stream/web').ReadableStream, { signal: cancelacion });
  const trozos: Buffer[] = [];
  // El cuerpo acotado lo produce la API; el flujo termina al completarse, fallar o cancelarse la petición HTTP.
  for await (const trozo of lectura) {
    if (!Buffer.isBuffer(trozo)) {
      throw new TypeError('La respuesta HTTP debe contener bytes');
    }
    trozos.push(trozo);
  }
  return Buffer.concat(trozos);
}
