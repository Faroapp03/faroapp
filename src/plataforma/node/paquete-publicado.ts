// Identidad y lista de archivos del paquete de una carpeta. La publicación y el servidor usan el mismo orden
// y contrato de nombres; el manifiesto se incluye primero y su huella completa determina la versión pública.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esObjeto } from '../../comun/json.ts';
import { MANIFIESTO } from '../archivos-del-paquete.ts';
import { archivoDelPaquetePublicado, CARPETA_DEL_PAQUETE, versionDelPaquete } from '../paquete-publicado.ts';

const CIFRAS_DE_UNA_SHA256 = 64;
const SHA256_HEXADECIMAL = new RegExp(`^[0-9a-f]{${CIFRAS_DE_UNA_SHA256}}$`);

// Rechaza UTF-8 malformado sin sustituciones; conserva el rechazo de BOM que corresponde a JSON.parse.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Lo que se publica de un paquete: su versión y los nombres de sus archivos (el manifiesto primero). */
export interface PaquetePublicado {
  readonly version: string;
  readonly archivos: readonly string[];
}

/**
 * La versión del paquete de `carpeta` y los archivos que se publican: el manifiesto y los que nombra, en orden. Cada
 * nombre del manifiesto tiene que poder publicarse tal cual (un JSON sin subcarpetas, la misma forma que sirve
 * archivoDelPaquetePublicado) y traer su huella: quien copia los archivos une el nombre a una carpeta, y un «../x»
 * escribiría fuera de ella.
 *
 * @param carpeta - La carpeta del paquete, para identificar un manifiesto inválido.
 * @param bytes - Captura del manifiesto que se validará y cuya huella determina la versión.
 * @returns La versión del paquete y los archivos que se publican.
 * @throws {Error} Si el manifiesto no se puede leer, no es un objeto o nombra un archivo que no se puede publicar o
 *   sin su huella SHA-256.
 */
export function paqueteDeManifiesto(carpeta: string, bytes: Uint8Array): PaquetePublicado {
  const manifiesto: unknown = JSON.parse(UTF8.decode(bytes));
  if (!esObjeto(manifiesto)) {
    throw new Error(`${MANIFIESTO} de ${carpeta} no es un objeto: vuelve a exportar el paquete`);
  }
  const version = versionDelPaquete(createHash('sha256').update(bytes).digest('hex'));
  const archivos = Object.keys(manifiesto).sort();
  for (const archivo of archivos) {
    const publicado = archivoDelPaquetePublicado(`/${CARPETA_DEL_PAQUETE}/${version}/${archivo}`);
    const entrada = manifiesto[archivo];
    if (
      publicado?.archivo !== archivo ||
      !esObjeto(entrada) ||
      typeof entrada.sha256 !== 'string' ||
      entrada.sha256.length !== CIFRAS_DE_UNA_SHA256 ||
      !SHA256_HEXADECIMAL.test(entrada.sha256)
    ) {
      throw new Error(
        `${MANIFIESTO} de ${carpeta} nombra «${archivo}», que no se puede publicar: vuelve a exportar el paquete`,
      );
    }
  }
  return { version, archivos: [MANIFIESTO, ...archivos] };
}

/**
 * Lee solo el manifiesto de una carpeta y devuelve la identidad y los nombres publicables del paquete.
 * No lee los archivos de datos: el servidor consulta este registro por petición.
 *
 * @param carpeta - La carpeta de los datos oficiales.
 * @returns Versión y nombres, con el manifiesto primero.
 */
export function paqueteParaPublicar(carpeta: string): PaquetePublicado {
  return paqueteDeManifiesto(carpeta, readFileSync(join(carpeta, MANIFIESTO)));
}
