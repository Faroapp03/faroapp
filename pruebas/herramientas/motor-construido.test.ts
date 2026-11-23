import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { huellaDeLasFuentes } from '../../herramientas/web/web-local.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PRECARGA = new URL('../ayudas/motor-construido.ts', import.meta.url).href;
const MODULO = new URL('../../web/motor/src/seguridad/privacidad.js', import.meta.url).href;

/** Una web local con un motor de prueba y el descriptor de las fuentes que se indiquen. */
function webLocal(t: TestContext, huellaDeFuentes: string): string {
  const destino = mkdtempSync(join(tmpdir(), 'faro-motor-construido-'));
  t.after(() => rmSync(destino, { recursive: true, force: true }));
  mkdirSync(join(destino, 'web/motor/src/seguridad'), { recursive: true });
  writeFileSync(join(destino, 'web/motor/src/seguridad/privacidad.js'), 'export const origen = "construido";\n');
  writeFileSync(
    join(destino, 'construccion.json'),
    JSON.stringify({ huellaDeFuentes, huellaMapaModulos: '', version: 'x' }),
  );
  return destino;
}

/** Importa el motor por su dirección en web/ con la precarga, contra la web local de `destino`. */
function importar(destino: string) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      PRECARGA,
      '--input-type=module',
      '-e',
      `console.log((await import(${JSON.stringify(MODULO)})).origen);`,
    ],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, FARO_WEB_LOCAL_DE_PRUEBA: destino } },
  );
}

test('el motor por su dirección fija se resuelve al de la web local vigente', (t) => {
  const resultado = importar(webLocal(t, huellaDeLasFuentes()));
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.equal(resultado.stdout.trim(), 'construido');
});

test('con una web local de otras fuentes, la precarga no la usa y pide npm run web:preparar', (t) => {
  const resultado = importar(webLocal(t, 'vieja'));
  assert.notEqual(resultado.status, 0);
  assert.match(resultado.stderr, /ejecuta antes npm run web:preparar/);
});
