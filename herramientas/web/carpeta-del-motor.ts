import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** La carpeta de la web construida donde se publica el motor. */
export const CARPETA_DEL_MOTOR = 'motor';

/**
 * Los archivos de una carpeta, con su ruta desde `base` separada por «/», en orden.
 *
 * @param carpeta - La carpeta que se recorre; debe existir.
 * @param base - Desde dónde se escribe cada ruta; por omisión, la propia carpeta.
 * @returns Las rutas de los archivos (no de las carpetas), ordenadas.
 */
export function listarArchivos(carpeta: string, base: string = carpeta): string[] {
  return readdirSync(carpeta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => relative(base, join(entrada.parentPath, entrada.name)).split(sep).join('/'))
    .sort();
}
