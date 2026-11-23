import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../../', import.meta.url));

test('la comprobación editorial detecta una guarda alterada sin escribir', () => {
  const copia = mkdtempSync(join(tmpdir(), 'firmas-editoriales-'));
  try {
    for (const ruta of [
      'src/catalogo-cursos',
      'src/comun',
      'compartido',
      'herramientas/catalogo-cursos',
      'herramientas/comun',
    ]) {
      cpSync(join(raiz, ruta), join(copia, ruta), { recursive: true });
    }
    mkdirSync(join(copia, 'pruebas/fixtures'), { recursive: true });
    symlinkSync(
      join(raiz, 'pruebas/fixtures/catalogo-clasificacion-20261025.utf8'),
      join(copia, 'pruebas/fixtures/catalogo-clasificacion-20261025.utf8'),
    );
    const ruta = join(copia, 'src/catalogo-cursos/clasificacion-revisada.json');
    const revision = JSON.parse(readFileSync(ruta, 'utf8')) as { unidadesRevisadas: Record<string, string> };
    const primera = Object.keys(revision.unidadesRevisadas)[0];
    assert.ok(primera);
    revision.unidadesRevisadas[primera] = 'alterada';
    writeFileSync(ruta, JSON.stringify(revision));
    const antes = readFileSync(ruta);
    const resultado = spawnSync(
      process.execPath,
      [join(copia, 'herramientas/catalogo-cursos/firmas-editoriales.ts'), '--comprobar'],
      { encoding: 'utf8', cwd: copia },
    );
    assert.notEqual(resultado.status, 0);
    assert.match(resultado.stderr, /Guardas editoriales desactualizadas/u);
    assert.deepEqual(readFileSync(ruta), antes);
  } finally {
    rmSync(copia, { recursive: true, force: true });
  }
});
