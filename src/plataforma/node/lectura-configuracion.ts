/** Lectura acotada de configuración del servidor; nunca reproduce su contenido en errores. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { ErrorDeProcesamiento } from '../../comun/error-de-procesamiento.ts';

const MAX_ARCHIVO_BYTES = 65_536;

/** Lee solo archivos regulares y como máximo 64 KiB, sin reproducir el contenido en errores. */
export function leerTextoConfiguracion(ruta: string): string {
  let descriptor: number;
  try {
    descriptor = openSync(ruta, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    throw new ErrorDeProcesamiento('no_configurado', 'No se puede abrir el archivo de configuración indicado');
  }
  try {
    const estado = fstatSync(descriptor);
    if (!estado.isFile() || estado.size > MAX_ARCHIVO_BYTES) {
      throw new ErrorDeProcesamiento('no_configurado', 'La configuración debe ser un archivo de hasta 64 KiB');
    }
    const bytes = Buffer.alloc(MAX_ARCHIVO_BYTES + 1);
    const leidos = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (leidos > MAX_ARCHIVO_BYTES) {
      throw new ErrorDeProcesamiento('no_configurado', 'La configuración supera los 64 KiB');
    }
    return textoUtf8(bytes.subarray(0, leidos));
  } finally {
    closeSync(descriptor);
  }
}

/** Una codificación dañada no cambia silenciosamente nombres, rutas o identificadores. */
function textoUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ErrorDeProcesamiento('no_configurado', 'El archivo de configuración no contiene UTF-8 válido');
  }
}
