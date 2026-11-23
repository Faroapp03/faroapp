/** Comprueba localmente el mismo contrato que admitirá el receptor autenticado. */
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { leerResultado, MAX_RESULTADO_ACTUALIZACION_BYTES } from '../../src/administracion/resultado-actualizacion.ts';

/** Lee un archivo regular acotado; ni el contenido ni su ruta aparecen en el diagnóstico. */
export function comprobarRecibo(ruta: string): void {
  const descriptor = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const estado = fstatSync(descriptor);
    if (!estado.isFile() || estado.size > MAX_RESULTADO_ACTUALIZACION_BYTES) {
      throw new Error('Recibo no válido');
    }
    const bytes = Buffer.alloc(MAX_RESULTADO_ACTUALIZACION_BYTES + 1);
    let usados = 0;
    while (usados < bytes.length) {
      const leidos = readSync(descriptor, bytes, usados, bytes.length - usados, null);
      if (leidos === 0) {
        break;
      }
      usados += leidos;
    }
    if (usados > MAX_RESULTADO_ACTUALIZACION_BYTES) {
      throw new Error('Recibo no válido');
    }
    const contenido: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, usados)));
    leerResultado(contenido);
  } finally {
    closeSync(descriptor);
  }
}

if (import.meta.main) {
  try {
    const [ruta, ...resto] = process.argv.slice(2);
    if (!ruta || resto.length !== 0) {
      throw new Error('Argumentos no válidos');
    }
    comprobarRecibo(ruta);
  } catch {
    console.error('No se ha podido validar el recibo del candidato.');
    process.exitCode = 1;
  }
}
