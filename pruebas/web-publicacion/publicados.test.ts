import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leer } from '../../herramientas/web/publicados.ts';
import { exclusionesDeArchivos } from '../../src/comun/exclusiones-de-archivos.ts';
import { webAislada } from './web-aislada.ts';

const EXCLUSIONES = leer('.assetsignore');
test('excluye documentación, tipos, procedencia y temporales, pero conserva recursos y licencias', () => {
  const archivos = {
    '.assetsignore': EXCLUSIONES,
    'README.md': 'documentación',
    'terceros/noble/procedencia.json': '{}',
    'terceros/noble/a.d.ts': 'declare const x: number;',
    'scripts/a.js': 'export const x = 1;',
    'terceros/noble/LICENSE': 'licencia',
    'a.tmp': 'temporal',
    'a.bak': 'copia temporal',
    'a~': 'editor',
    'motor/src/a.js': 'generado',
    'paquete/a.json': '{}',
    'firmas/a.json': '{}',
  };
  const publicados = JSON.parse(
    webAislada(
      archivos,
      "import { archivosPublicados } from './publicados.ts'; process.stdout.write(JSON.stringify(archivosPublicados()));",
    ),
  );
  assert.deepEqual(publicados, ['scripts/a.js', 'scripts/secciones-publicas.js', 'terceros/noble/LICENSE']);
});

test('la sintaxis de exclusiones no admitida falla explícitamente', () => {
  assert.throws(() => exclusionesDeArchivos('!secreto.json'), /no admitido/);
});
