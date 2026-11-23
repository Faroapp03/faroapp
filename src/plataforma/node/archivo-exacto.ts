import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Raíz operativa y raíz canónica: la comprobación no depende de exclusiones de publicación. */
export interface CarpetaExacta {
  readonly carpeta: string;
  readonly carpetaReal: string;
}

/** Errores del sistema de archivos que significan «ahí no hay ese archivo»: se responden con 404. */
const CODIGOS_DE_NO_ESTA: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG']);

/**
 * Dice si en la web hay un archivo normal justo en esa ruta: sin enlaces simbólicos por medio y con las mismas
 * mayúsculas. En un disco que no las distingue (APFS por defecto), «/PRUEBAS/x» encontraría «pruebas/x» y se saltaría
 * las exclusiones de .assetsignore, que sí las distinguen, como Cloudflare.
 *
 * @param web - La web que se sirve.
 * @param relativa - La ruta del archivo dentro de la carpeta, ya normalizada.
 * @returns `true` si el archivo existe con esa ruta exacta y es un archivo normal.
 * @throws {Error} El del sistema de archivos, si no es uno de CODIGOS_DE_NO_ESTA (sin permiso, por ejemplo).
 */
export function esArchivoExacto(web: CarpetaExacta, relativa: string): boolean {
  try {
    const real = realpathSync.native(join(web.carpeta, relativa));
    return real === join(web.carpetaReal, relativa) && statSync(real).isFile();
  } catch (error) {
    if (error instanceof Error && 'code' in error && CODIGOS_DE_NO_ESTA.has(String(error.code))) {
      return false;
    }
    throw error;
  }
}
