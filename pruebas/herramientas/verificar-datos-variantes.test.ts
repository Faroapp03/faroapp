// Las variantes válidas del paquete con las que npm run verificar:datos-variantes prueba la comprobación del ciclo
// (scripts/verificar-datos-variantes.ts): cada una cumple el contrato del catálogo, la ayuda la valida al escribirla, y
// solo el control es el paquete de hoy. Ejecutar el ciclo con ellas es una orden propia, no esta batería.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { escribirVariante, VARIANTES_VALIDAS } from '../../scripts/verificar-datos-variantes.ts';
import { REFERENCIA } from '../../web/scripts/catalogo-cursos/referencia.js';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

test('cada variante válida cumple el contrato del catálogo y, salvo el control, no es el paquete de hoy', (t) => {
  const huellas = new Set<string>();
  for (const variante of VARIANTES_VALIDAS) {
    const raiz = mkdtempSync(join(tmpdir(), `faro-variante-escrita-${variante}-`));
    t.after(() => rmSync(raiz, { recursive: true, force: true }));
    const { sha256 } = JSON.parse(escribirVariante(RAIZ, variante, raiz)) as { sha256: string };
    assert.equal(sha256 === REFERENCIA.sha256, variante === 'sin-cambios', variante);
    huellas.add(sha256);
  }
  assert.equal(huellas.size, VARIANTES_VALIDAS.length, 'Cada variante es un paquete distinto');
});
