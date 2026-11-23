/** El código de salida de la verificación y del envolvente es el real de cada paso, nunca un 0 sustituido. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { codigoDeSalida, FalloDeComprobacion } from '../../scripts/verificar.ts';

const VERIFICAR = new URL('../../scripts/verificar.ts', import.meta.url).href;
const ENVOLVENTE = fileURLToPath(new URL('../../scripts/guardar-resultado.sh', import.meta.url));
const PLAZO_MS = 30_000;
const CODIGO_DEL_PASO = 7;

function areaDePrueba(contexto: TestContext): string {
  const area = mkdtempSync(join(realpathSync(tmpdir()), 'faro verificar codigo '));
  contexto.after(() => rmSync(area, { recursive: true, force: true }));
  return area;
}

/** Un proceso Node que ejecuta, con el verificador real, pasos que terminan con los códigos indicados. */
function conjunto(area: string, codigos: readonly number[]): readonly string[] {
  const pasos = codigos.map((codigo, indice) => ({
    nombre: `Paso ${indice + 1}`,
    comando: process.execPath,
    argumentos: [
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(join(area, `paso-${indice + 1}`))}, ''); process.exit(${codigo})`,
    ],
  }));
  const programa =
    `import { ejecutarPaso, terminarConCodigo } from ${JSON.stringify(VERIFICAR)};` +
    `await terminarConCodigo(async () => { for (const paso of ${JSON.stringify(pasos)}) await ejecutarPaso(paso, ${JSON.stringify(area)}); });`;
  return [process.execPath, '--input-type=module', '-e', programa];
}

function ejecutar(orden: readonly string[]): ReturnType<typeof spawnSync> {
  const [comando = '', ...argumentos] = orden;
  return spawnSync(comando, argumentos, { encoding: 'utf8', timeout: PLAZO_MS });
}

test('un paso que sale con 7 hace que el conjunto salga con 7 y no ejecuta los siguientes', (contexto) => {
  const area = areaDePrueba(contexto);
  const resultado = ejecutar(conjunto(area, [0, CODIGO_DEL_PASO, 0]));
  assert.equal(resultado.status, CODIGO_DEL_PASO, String(resultado.stderr));
  assert.match(String(resultado.stderr), /Paso 2: termina con código 7/);
  assert.match(String(resultado.stderr), /Código de salida de la verificación: 7/);
  assert.ok(existsSync(join(area, 'paso-1')) && existsSync(join(area, 'paso-2')));
  assert.equal(existsSync(join(area, 'paso-3')), false, 'tras un fallo no se ejecuta ningún paso más');
});

test('con todos los pasos en 0 el conjunto sale con 0', (contexto) => {
  const area = areaDePrueba(contexto);
  const resultado = ejecutar(conjunto(area, [0, 0, 0]));
  assert.equal(resultado.status, 0, String(resultado.stderr));
  assert.match(String(resultado.stderr), /Código de salida de la verificación: 0/);
  assert.ok(existsSync(join(area, 'paso-3')));
});

test('el envolvente devuelve y anota el código real del conjunto, sin tubería que lo cambie', (contexto) => {
  const area = areaDePrueba(contexto);
  for (const [codigos, esperado] of [
    [[0, CODIGO_DEL_PASO], CODIGO_DEL_PASO],
    [[0, 0], 0],
  ] as const) {
    const recibo = join(area, `recibo-${esperado}`);
    const resultado = ejecutar(['/bin/bash', ENVOLVENTE, recibo, '--', ...conjunto(area, codigos)]);
    assert.equal(resultado.status, esperado, String(resultado.stderr));
    assert.equal(readFileSync(join(recibo, 'codigo-salida.txt'), 'utf8'), `${esperado}\n`);
    assert.match(readFileSync(join(recibo, 'ejecucion.log'), 'utf8'), new RegExp(`verificación: ${esperado}`));
  }
});

test('el envolvente no reutiliza un directorio ya reservado y entonces no ejecuta la orden', (contexto) => {
  const area = areaDePrueba(contexto);
  const marca = join(area, 'ejecutada');
  const orden = [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marca)}, '')`];
  const resultado = ejecutar(['/bin/bash', ENVOLVENTE, area, '--', ...orden]);
  const codigoDirectorioReservado = 73;
  assert.equal(resultado.status, codigoDirectorioReservado);
  assert.equal(existsSync(marca), false);
  assert.equal(existsSync(join(area, 'ejecucion.log')), false);
});

test('el código del conjunto es el del paso que falló, o 1 si no terminó con un código', () => {
  assert.equal(codigoDeSalida(new FalloDeComprobacion('falla', { codigo: CODIGO_DEL_PASO })), CODIGO_DEL_PASO);
  assert.equal(codigoDeSalida(new FalloDeComprobacion('señal o plazo')), 1);
  assert.equal(codigoDeSalida(new Error('otro fallo')), 1);
  assert.equal(codigoDeSalida(new FalloDeComprobacion('código imposible', { codigo: 0 })), 1);
});
