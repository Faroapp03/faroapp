/** Motor real de prueba: señala el inicio del bucle antes de ocupar exclusivamente su trabajador. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { isMainThread, threadId } from 'node:worker_threads';
import { catalogoDeCursos as catalogoDePrueba } from './motor-de-cursos-de-prueba.ts';

export * from './motor-de-cursos-de-prueba.ts';

export function catalogoDeCursos(
  ...argumentos: Parameters<typeof catalogoDePrueba>
): ReturnType<typeof catalogoDePrueba> {
  if (argumentos[1].filtros?.texto === 'bucle') {
    assert.equal(isMainThread, false, 'El bucle solo puede ejecutarse en el trabajador de Cursos');
    const marca = new URL(import.meta.url).searchParams.get('marca');
    assert(marca, 'La prueba debe proporcionar la marca de inicio');
    writeFileSync(new URL(marca), String(threadId));
  }
  return catalogoDePrueba(...argumentos);
}
