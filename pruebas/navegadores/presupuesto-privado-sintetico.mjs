// Una construcción privada sintética con la forma de servible() (paquete-comun.mjs), para las pruebas sin navegador
// del presupuesto de rendimiento: un worker/worker.mjs mínimo, un artefacto.json con su huella y el módulo cargado, de
// modo que comprobarWorkerPrivado() (presupuesto-servidor.mjs) la acepte como la de verdad.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** La construcción, en una carpeta temporal nueva; `retirar()` la borra. */
export async function construccionPrivadaSintetica() {
  const carpeta = mkdtempSync(join(realpathSync(tmpdir()), 'faro-privado-sintetico-'));
  mkdirSync(join(carpeta, 'worker'));
  const ruta = join(carpeta, 'worker/worker.mjs');
  const bytes = Buffer.from('export default { fetch: () => new Response(null, { status: 404 }) };\n');
  writeFileSync(ruta, bytes);
  const archivos = [{ ruta: 'worker/worker.mjs', bytes: bytes.length, sha256: sha256(bytes) }];
  const descriptor = Buffer.from(JSON.stringify({ version: 1, destino: 'privado', archivos }));
  writeFileSync(join(carpeta, 'artefacto.json'), descriptor);
  const worker = await import(pathToFileURL(ruta).href);
  return {
    artefacto: { directorio: carpeta, worker, fichas: new Map() },
    servidor: 'Worker privado sintético',
    privado: { destino: 'privado', carpeta, ruta, sha256: sha256(bytes), sha256Artefacto: sha256(descriptor), worker },
    oficial: null,
    retirar: () => rmSync(carpeta, { recursive: true, force: true }),
  };
}
