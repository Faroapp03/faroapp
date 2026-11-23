// Las instalaciones aisladas copian el cierre de importaciones de sus módulos (pruebas/ayudas/fuentes-que-importa.ts):
// una dependencia nueva de una herramienta entra sola, y una importación de un módulo que no existe falla.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fuentesQueImporta } from '../ayudas/fuentes-que-importa.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

test('el cierre de preparar.ts lleva lo que importa, también de forma indirecta, salvo lo que se pone aparte', () => {
  const registro = 'src/plataforma/extensiones-instaladas.ts';
  const fuentes = fuentesQueImporta(RAIZ, ['herramientas/web/preparar.ts'], new Set([registro]));
  for (const necesaria of ['herramientas/web/copia-sin-conexion.ts', 'herramientas/web/carpeta-del-motor.ts']) {
    assert.ok(fuentes.includes(necesaria), necesaria);
  }
  assert.ok(!fuentes.includes(registro));
  assert.ok(
    fuentes.every((ruta) => !ruta.startsWith('web/demo/')),
    'sin el registro real no entra ninguna extensión',
  );
});

test('los tipos no son importaciones y un módulo importado que no existe falla', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'faro-fuentes-'));
  try {
    mkdirSync(join(raiz, 'h'));
    writeFileSync(
      join(raiz, 'h/a.ts'),
      "import type { T } from './tipos.ts';\nimport { b } from './b.ts';\nexport const a: T = b;\n",
    );
    writeFileSync(join(raiz, 'h/b.ts'), "export { c as b } from './c.js';\n");
    writeFileSync(join(raiz, 'h/c.js'), 'export const c = 1;\n');
    assert.deepEqual(fuentesQueImporta(raiz, ['h/a.ts']), ['h/a.ts', 'h/b.ts', 'h/c.js']);
    writeFileSync(join(raiz, 'h/c.js'), "export { c } from './falta.js';\n");
    assert.throws(() => fuentesQueImporta(raiz, ['h/a.ts']), /Falta el módulo h\/falta\.js/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
