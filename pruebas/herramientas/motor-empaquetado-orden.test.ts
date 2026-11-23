/**
 * La orden oficial del motor empaquetado (`npm run probar:motor-empaquetado`) y la prueba que ejecuta: sin
 * construcción, o con una ruta sin motor, fallan; nunca se dan por buenas con los casos omitidos.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { VARIABLES_EXCLUIDAS } from '../../scripts/entorno-firefox.ts';
import { pasoMotorEmpaquetado } from '../../scripts/probar-motor-empaquetado.ts';
import { ejecutarPaso } from '../../scripts/verificar.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PRUEBA = join(RAIZ, 'pruebas/web-recorrido-integral/motor-empaquetado.test.ts');
const ORDEN = join(RAIZ, 'scripts/probar-motor-empaquetado.ts');
const PLAZO_MS = 60_000;

/** Una carpeta nueva y vacía, que se retira al terminar la prueba. */
function carpetaSinMotor(contexto: TestContext): string {
  const carpeta = mkdtempSync(join(tmpdir(), 'sin-motor-'));
  contexto.after(() => rmSync(carpeta, { recursive: true, force: true }));
  return carpeta;
}

function ejecutar(argumentos: readonly string[], entorno: Record<string, string> = {}) {
  // Sin el marcador de node:test del padre, el hijo es una suite propia con su código de salida.
  const { FARO_CONSTRUCCION: _heredada, NODE_TEST_CONTEXT: _contexto, ...heredado } = process.env;
  return spawnSync(process.execPath, argumentos, {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...heredado, ...entorno },
    timeout: PLAZO_MS,
  });
}

test('con FARO_CONSTRUCCION en una ruta sin motor, la prueba del motor empaquetado falla en vez de omitirse', (t) => {
  const carpeta = carpetaSinMotor(t);
  const hecho = ejecutar(['--test', '--test-reporter=tap', PRUEBA], { FARO_CONSTRUCCION: carpeta });
  assert.notEqual(hecho.status, 0, hecho.stdout);
  assert.doesNotMatch(hecho.stdout, /# SKIP/);
  assert.match(`${hecho.stdout}${hecho.stderr}`, /no es una construcción/);
});

test('la orden oficial sin construcción termina con su uso y un código distinto de 0', () => {
  const hecho = ejecutar([ORDEN]);
  assert.notEqual(hecho.status, 0);
  assert.match(hecho.stderr, /Uso: npm run probar:motor-empaquetado -- <construcción>/);
});

test('la orden oficial sobre una ruta sin motor falla sin dar por buenos los casos', (t) => {
  const hecho = ejecutar([ORDEN, carpetaSinMotor(t)]);
  assert.notEqual(hecho.status, 0);
  assert.match(hecho.stderr, /no es una construcción/);
});

test('la orden oficial no transmite las variables que la batería de navegador excluye ni FARO_VARIANTES ni FARO_NAVEGADORES', async (t) => {
  const heredadas = ['FARO_VARIANTES', 'FARO_NAVEGADORES', ...VARIABLES_EXCLUIDAS];
  const anteriores = heredadas.map((nombre) => [nombre, process.env[nombre]] as const);
  for (const nombre of heredadas) {
    process.env[nombre] = `heredada de quien lanza: ${nombre}`;
  }
  t.after(() => {
    for (const [nombre, valor] of anteriores) {
      if (valor === undefined) {
        delete process.env[nombre];
      } else {
        process.env[nombre] = valor;
      }
    }
  });
  const construccion = carpetaSinMotor(t);
  // El entorno y las exclusiones del paso real, con una orden que dice lo que recibe.
  const vistas = [...heredadas, 'FARO_CONSTRUCCION'];
  const paso = {
    ...pasoMotorEmpaquetado(construccion),
    comando: process.execPath,
    argumentos: [
      '--eval',
      `console.log(JSON.stringify(${JSON.stringify(vistas)}.map((nombre) => process.env[nombre] ?? null)))`,
    ],
  };
  const enElHijo = JSON.parse(await ejecutarPaso(paso, RAIZ, PLAZO_MS));
  assert.deepEqual(enElHijo, [...heredadas.map(() => null), construccion]);
});
