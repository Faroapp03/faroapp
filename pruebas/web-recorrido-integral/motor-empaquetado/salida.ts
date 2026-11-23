// La carpeta donde la prueba del motor empaquetado deja sus mediciones (FARO_SALIDA). Se prepara y se comprueba ANTES de
// medir: cada medición tarda minutos, y una carpeta que no existe o en la que no se puede escribir solo se descubriría
// al final, al guardar el resultado.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Una carpeta de mediciones que no se puede crear o en la que no se puede escribir. */
export class SalidaNoEscribible extends Error {
  override name = 'SalidaNoEscribible';
}

/**
 * Crea la carpeta de mediciones si no existe y comprueba que se puede escribir en ella con un archivo de prueba, que se
 * retira enseguida.
 *
 * @param carpeta - La carpeta de FARO_SALIDA.
 * @returns La misma carpeta, lista para escribir.
 * @throws {SalidaNoEscribible} Si no se puede crear o no se puede escribir en ella.
 */
export function prepararSalida(carpeta: string): string {
  const prueba = join(carpeta, `.escritura-${process.pid}`);
  try {
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(prueba, '');
    rmSync(prueba);
  } catch (error) {
    throw new SalidaNoEscribible(
      `FARO_SALIDA no se puede usar para las mediciones: ${carpeta} (${(error as Error).message})`,
      { cause: error },
    );
  }
  return carpeta;
}
