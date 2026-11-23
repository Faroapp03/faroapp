import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const programa = fileURLToPath(new URL('../../herramientas/cloudflare/artefacto.ts', import.meta.url));
const LONGITUD_SHA256 = 64;
const cero = '0'.repeat(LONGITUD_SHA256);
const cli = (...args: string[]) => spawnSync(process.execPath, [programa, ...args], { encoding: 'utf8' });

test('la orden distingue argumentos, huella, descriptor y archivo sin mostrar rutas', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'privado-artefacto-'));
  try {
    const archivo = join(carpeta, 'descriptor.json');
    const datos = Buffer.from('{"version":99}');
    writeFileSync(archivo, datos);
    const sha = createHash('sha256').update(datos).digest('hex');
    for (const [args, diagnostico] of [
      [['descriptor', archivo], /argumentos/i],
      [['descriptor', archivo, '--sha256', 'inválida'], /argumentos/i],
      [['descriptor', archivo, '--sha256', cero], /huella/i],
      [['descriptor', archivo, '--sha256', sha], /descriptor/i],
      [['descriptor', join(carpeta, 'ausente'), '--sha256', cero], /archivo/i],
      [['descriptor', join(archivo, 'hijo'), '--sha256', cero], /archivo/i],
    ] as const) {
      const salida = cli(...args);
      assert.equal(salida.status, 1);
      assert.equal(salida.stdout, '');
      assert.match(salida.stderr, diagnostico);
      assert.doesNotMatch(salida.stderr, /privado-artefacto|descriptor\.json/u);
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
