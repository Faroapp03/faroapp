import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artefactosComunes } from '../../herramientas/web/comunes.ts';

test('las copias del estado y secciones declaran su fuente y el vigilante comparte contrato', () => {
  const publicaciones = artefactosComunes();
  const contenidoDe = (ruta: string) =>
    [...publicaciones].find(([url]) => url.href === new URL(ruta, import.meta.url).href)?.[1];
  for (const [destino, origen] of [
    ['../../web/administracion/estado-datos.js', 'src/administracion/estado-datos.js'],
    ['../../web/scripts/secciones-contrato.js', 'src/administracion/secciones-web.js'],
  ] as const) {
    const contenido = contenidoDe(destino);
    assert.ok(contenido?.includes(`// Generado desde ${origen}; no editar esta copia.`));
  }
  assert.ok(contenidoDe('../../web/administracion/vigilante-panel.js'));
});
