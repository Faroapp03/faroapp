// La construcción no depende de dónde está la carpeta temporal: con dos TMPDIR de profundidad distinta, la misma web.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { construirWebLocal } from '../../herramientas/web/construir.ts';

function archivos(web: string): Map<string, Buffer> {
  return new Map(
    readdirSync(web, { recursive: true, withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => {
        const ruta = join(entrada.parentPath, entrada.name);
        return [ruta.slice(web.length + 1), readFileSync(ruta)] as const;
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

test('dos TMPDIR de profundidad distinta dan la misma web construida', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'faro-reproducible-'));
  const anterior = process.env.TMPDIR;
  t.after(() => {
    process.env.TMPDIR = anterior;
    rmSync(base, { recursive: true, force: true });
  });
  const somera = join(base, 'a');
  const honda = join(base, 'b', 'una', 'carpeta', 'mucho', 'mas', 'honda');
  mkdirSync(somera, { recursive: true });
  mkdirSync(honda, { recursive: true });
  process.env.TMPDIR = somera;
  const primera = await construirWebLocal(join(base, 'primera'));
  process.env.TMPDIR = honda;
  const segunda = await construirWebLocal(join(base, 'segunda'));
  process.env.TMPDIR = anterior;
  const uno = archivos(primera.web);
  const dos = archivos(segunda.web);
  assert.deepEqual([...dos.keys()], [...uno.keys()]);
  for (const [ruta, bytes] of uno) {
    assert.ok(bytes.equals(dos.get(ruta) ?? Buffer.alloc(0)), ruta);
  }
  assert.equal(segunda.huellaMapaModulos, primera.huellaMapaModulos);
});
