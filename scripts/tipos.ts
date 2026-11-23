/** Ejecuta los mismos proyectos y argumentos que la verificación completa. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROYECTOS_TYPESCRIPT } from './proyectos-typescript.ts';

export function pasosDeTipos(raiz: string) {
  return PROYECTOS_TYPESCRIPT.map(({ nombre, proyecto, sinEmitir }) => ({
    nombre,
    comando: process.execPath,
    argumentos: [
      join(raiz, 'node_modules/typescript/bin/tsc'),
      '--project',
      proyecto,
      ...(sinEmitir ? ['--noEmit'] : []),
    ],
  }));
}

export function ejecutarTipos(raiz: string): number {
  for (const paso of pasosDeTipos(raiz)) {
    const resultado = spawnSync(paso.comando, paso.argumentos, { cwd: raiz, stdio: 'inherit' });
    if (resultado.error || resultado.status !== 0) {
      return resultado.status || 1;
    }
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = ejecutarTipos(fileURLToPath(new URL('../', import.meta.url)));
}
