import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ejecutarTipos, pasosDeTipos } from '../../scripts/tipos.ts';
import { pasosDeCodigo } from '../../scripts/verificar.ts';
import { EXTENSIONES } from '../../src/plataforma/extensiones.ts';

const raiz = fileURLToPath(new URL('../../', import.meta.url));

/** Los dos proyectos de cada extensión instalada: el de su registro y el de su carpeta de pruebas. */
const DE_EXTENSIONES = EXTENSIONES.flatMap(({ proyectoTypeScript, carpetaDePruebas }) => [
  ['--project', proyectoTypeScript.proyecto],
  ['--project', `${carpetaDePruebas}/tsconfig.json`],
]);

test('las dos órdenes comparten los proyectos de la aplicación y de las extensiones, con sus opciones', () => {
  const pasos = pasosDeTipos(raiz);
  assert.deepEqual(pasosDeCodigo(raiz).slice(0, pasos.length), pasos);
  assert.deepEqual(
    pasos.map((paso) => paso.argumentos.slice(1)),
    [
      ['--project', 'tsconfig.json'],
      ['--project', 'tsconfig.web.json'],
      ...DE_EXTENSIONES,
      ['--project', 'tsconfig.pruebas-web.json'],
      ['--project', 'tsconfig.service-worker.json'],
      ['--project', 'tsconfig.navegador.json', '--noEmit'],
    ],
  );
  assert.ok(pasos.every((paso) => paso.comando === process.execPath));
  const paquete = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { scripts: { tipos: string } };
  assert.equal(paquete.scripts.tipos, 'node scripts/tipos.ts');
});

test('un compilador que falla interrumpe la secuencia y transmite su código', () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'tipos-faro-'));
  try {
    const bin = join(carpeta, 'node_modules/typescript/bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'tsc'),
      "const fs = require('node:fs'); fs.appendFileSync('llamadas', process.argv.slice(2).join(' ') + '\\n'); if (process.argv.includes('tsconfig.pruebas-web.json')) process.exit(7);\n",
    );
    const CODIGO_FALLO_DEL_COMPILADOR = 7;
    assert.equal(ejecutarTipos(carpeta), CODIGO_FALLO_DEL_COMPILADOR);
    assert.deepEqual(readFileSync(join(carpeta, 'llamadas'), 'utf8').trim().split('\n'), [
      '--project tsconfig.json',
      '--project tsconfig.web.json',
      ...DE_EXTENSIONES.map((argumentos) => argumentos.join(' ')),
      '--project tsconfig.pruebas-web.json',
    ]);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
