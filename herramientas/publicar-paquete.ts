// Publicación local del paquete: valida una captura completa antes de tocar el destino y escribe esos mismos bytes.
// Las versiones anteriores se retiran al terminar. Las carpetas de la función son argumentos explícitos.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFIESTO } from '../src/plataforma/archivos-del-paquete.ts';
import { paqueteDeManifiesto } from '../src/plataforma/node/paquete-publicado.ts';
import { CARPETA_DEL_PAQUETE } from '../src/plataforma/paquete-publicado.ts';

/** Lee una vez los bytes de cada archivo y comprueba el paquete completo antes de permitir su escritura. */
function prepararPaquete(carpeta: string): { version: string; archivos: ReadonlyMap<string, Buffer> } {
  const bytesDelManifiesto = readFileSync(join(carpeta, MANIFIESTO));
  const paquete = paqueteDeManifiesto(carpeta, bytesDelManifiesto);
  // paqueteDeManifiesto validó estas entradas y sus huellas sobre la misma captura de bytes.
  const manifiesto = JSON.parse(bytesDelManifiesto.toString('utf8')) as Record<string, { sha256: string }>;
  const archivos = new Map<string, Buffer>([[MANIFIESTO, bytesDelManifiesto]]);
  for (const archivo of paquete.archivos.slice(1)) {
    const contenido = archivo === MANIFIESTO ? bytesDelManifiesto : readFileSync(join(carpeta, archivo));
    const entrada = manifiesto[archivo] as { sha256: string };
    if (createHash('sha256').update(contenido).digest('hex') !== entrada.sha256) {
      throw new Error(`${archivo} no coincide con su huella en ${MANIFIESTO}: vuelve a exportar el paquete`);
    }
    archivos.set(archivo, contenido);
  }
  return { version: paquete.version, archivos };
}

/**
 * Deja en la carpeta pública del paquete solo la versión actual, completa. Una entrada defectuosa no toca destino;
 * tras validar, conserva la captura y la escribe sin volver a abrir el origen. La limpieza se hace al finalizar.
 *
 * @param paquete - La carpeta de los datos oficiales.
 * @param web - La carpeta de la web donde se construye el artefacto local.
 * @returns La versión publicada.
 */
export function publicarPaquete(paquete: string, web: string): string {
  const { version, archivos } = prepararPaquete(paquete);
  const publicado = join(web, CARPETA_DEL_PAQUETE);
  const destino = join(publicado, version);
  mkdirSync(destino, { recursive: true });
  for (const [archivo, contenido] of archivos) {
    writeFileSync(join(destino, archivo), contenido);
  }
  // Si una escritura falla, las versiones anteriores todavía no se han retirado.
  for (const vieja of readdirSync(publicado).filter((nombre) => nombre !== version)) {
    rmSync(join(publicado, vieja), { recursive: true, force: true });
  }
  return version;
}
