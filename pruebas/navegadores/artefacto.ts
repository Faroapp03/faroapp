/** Ejecuta la construcción entregada: las importaciones Data de Workers se adaptan a ArrayBuffer en Node. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  comprobarArtefactoCloudflare,
  leerDescriptorArtefactoCloudflare,
} from '../../herramientas/cloudflare/artefacto.ts';

export const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(RAIZ, 'dist');
export const huella = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** El destino que declara la construcción en su descriptor (artefacto.json); undefined si no declara ninguno. */
export function destinoDeLaConstruccion(directorio = DIST): string | undefined {
  const descriptor = join(directorio, 'artefacto.json');
  return leerDescriptorArtefactoCloudflare(descriptor, huella(readFileSync(descriptor))).destino;
}

export async function cargarArtefacto(directorio = DIST) {
  const sha256 = huella(readFileSync(join(directorio, 'artefacto.json')));
  const resumen = comprobarArtefactoCloudflare(directorio, sha256);
  const descriptor = leerDescriptorArtefactoCloudflare(join(directorio, 'artefacto.json'), sha256);
  const fichas = new Map(descriptor.archivos.map((archivo) => [archivo.ruta, archivo]));
  const leer = (ruta: string): Buffer<ArrayBuffer> => {
    const ficha = fichas.get(ruta);
    assert(ficha, `Recurso fuera de la construcción: ${ruta}`);
    const bytes = readFileSync(join(directorio, ruta));
    assert.equal(bytes.length, ficha.bytes);
    assert.equal(huella(bytes), ficha.sha256);
    return bytes;
  };
  const datos = pathToFileURL(`${join(directorio, 'worker/datos')}/`).href;
  const hooks = registerHooks({
    load(url, contexto, siguiente) {
      if (!url.startsWith(datos) || !url.endsWith('.json')) {
        return siguiente(url, contexto);
      }
      const ruta = `worker/datos/${fileURLToPath(url).split('/').at(-1)}`;
      const texto = JSON.stringify(leer(ruta).toString('utf8'));
      return {
        format: 'module',
        source: `export default new TextEncoder().encode(${texto}).buffer;`,
        shortCircuit: true,
      };
    },
  });
  try {
    leer('worker/worker.mjs');
    const modulo = await import(pathToFileURL(join(directorio, 'worker/worker.mjs')).href);
    const worker = modulo as typeof import('../../src/plataforma/cloudflare/worker.ts');
    return { worker, resumen, fichas, leer, directorio, destino: descriptor.destino };
  } finally {
    hooks.deregister();
  }
}

export type Artefacto = Awaited<ReturnType<typeof cargarArtefacto>>;
