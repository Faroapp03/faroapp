// Empaqueta la tabla de vectores del móvil (datos/vectores-movil/, archivos binarios y su huellas.json) en un archivo
// del paquete de datos, datos/vectores-movil.json, y pone su huella en datos/manifiesto.json. Así se publica en
// /paquete/<versión>/, se guarda sin conexión y se comprueba como el resto del paquete, sin ser una parte del motor
// (ARCHIVOS_EXTRA_DEL_PAQUETE): el Worker no la carga y el navegador la pide después de arrancar.
// Los binarios van en base64, como los demás vectores del paquete (vectores-oit.json, vectores-formacion.json).
// La cadena de datos conserva esta entrada si los bytes y sus fuentes locales mantienen las huellas registradas.
// Uso: node herramientas/vectores-movil/empaquetar.ts [--comprobar]

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHIVOS_DE_VECTORES } from '../../motores/ocupaciones/src/index.ts';
import { ARCHIVOS_EXTRA_DEL_PAQUETE, MANIFIESTO } from '../../src/plataforma/archivos-del-paquete.ts';

const DATOS = fileURLToPath(new URL('../../datos/', import.meta.url));
const CARPETA = join(DATOS, 'vectores-movil');
const ARCHIVO = ARCHIVOS_EXTRA_DEL_PAQUETE.vectoresMovil;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** El contenido de vectores-movil.json: cada archivo de la tabla en base64, con su huella. */
function contenido(): { bytes: Buffer; origenes: Record<string, string> } {
  const huellas = JSON.parse(readFileSync(join(CARPETA, 'huellas.json'), 'utf8')) as Record<string, string>;
  const archivos: Record<string, string> = {};
  const origenes: Record<string, string> = {};
  for (const archivo of ARCHIVOS_DE_VECTORES) {
    const bytes = readFileSync(join(CARPETA, archivo));
    if (sha256(bytes) !== huellas[archivo]) {
      throw new Error(`${archivo} no coincide con su huella en datos/vectores-movil/huellas.json`);
    }
    archivos[archivo] = bytes.toString('base64');
    origenes[`datos/vectores-movil/${archivo}`] = sha256(bytes);
  }
  const datos = {
    formato: 1,
    fuente:
      'Tabla derivada de EmbeddingGemma 2 (Google DeepMind, Apache-2.0), ajustada y destilada por Faro con datos de ' +
      'ESCO (UE, CC BY 4.0) y de la OIT. Ver datos/vectores-movil/LICENCIA.md.',
    huellas: Object.fromEntries(ARCHIVOS_DE_VECTORES.map((archivo) => [archivo, huellas[archivo]])),
    archivos,
  };
  return { bytes: Buffer.from(`${JSON.stringify(datos)}\n`), origenes };
}

const { bytes, origenes } = contenido();
const manifiesto = JSON.parse(readFileSync(join(DATOS, MANIFIESTO), 'utf8')) as Record<string, unknown>;
const entrada = { origenes, sha256: sha256(bytes) };

if (process.argv.includes('--comprobar')) {
  const guardado = (() => {
    try {
      return readFileSync(join(DATOS, ARCHIVO));
    } catch {
      return null;
    }
  })();
  const igual = guardado?.equals(bytes) && JSON.stringify(manifiesto[ARCHIVO]) === JSON.stringify(entrada);
  console.log(igual ? `${ARCHIVO} y su huella están al día` : `${ARCHIVO} no está al día: ejecuta la herramienta`);
  process.exit(igual ? 0 : 1);
}

writeFileSync(join(DATOS, ARCHIVO), bytes);
manifiesto[ARCHIVO] = entrada;
writeFileSync(join(DATOS, MANIFIESTO), `${JSON.stringify(manifiesto, null, 2)}\n`);
console.log(`Escrito datos/${ARCHIVO} (${bytes.length} bytes) y su huella en datos/${MANIFIESTO}`);
