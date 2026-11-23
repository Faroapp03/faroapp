/**
 * La batería Node no puede salir a la red. Se ejecuta la sonda con la orden y el entorno reales que arma
 * `scripts/verificar.ts`: si dejara de poner la precarga, o la precarga dejara de cubrir una vía, esta prueba falla.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRECARGA_SIN_RED, pasoPruebasPropias } from '../../scripts/verificar.ts';
import { esAnfitrionLocal } from '../ayudas/sin-red.ts';

const SONDA = fileURLToPath(new URL('../ayudas/sonda-sin-red.ts', import.meta.url));
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const PLAZO_MS = 60_000;

test('la orden real de verificar lleva la precarga y la sonda no consigue salir por ninguna vía', () => {
  const paso = pasoPruebasPropias([SONDA]);
  assert.ok(paso.entorno?.NODE_OPTIONS?.includes(`--import=${PRECARGA_SIN_RED}`));
  const entorno = Object.fromEntries(Object.entries(process.env).filter(([nombre]) => nombre !== 'NODE_TEST_CONTEXT'));
  // Se quita el reportero estructurado para leer el resultado en el formato estándar.
  const argumentos = paso.argumentos.filter((a) => !a.startsWith('--test-reporter='));
  const resultado = spawnSync(paso.comando, argumentos, {
    cwd: RAIZ,
    env: { ...entorno, NODE_OPTIONS: paso.entorno?.NODE_OPTIONS ?? '' },
    encoding: 'utf8',
    timeout: PLAZO_MS,
  });
  assert.equal(resultado.status, 0, resultado.stdout + resultado.stderr);
  assert.match(resultado.stdout, /ℹ pass 3\b/u);
});

test('solo son locales localhost, 127.0.0.0/8 y ::1', () => {
  for (const local of ['localhost', '127.0.0.1', '127.8.9.10', '::1', '[::1]']) {
    assert.equal(esAnfitrionLocal(local), true, local);
  }
  for (const externo of ['192.0.2.10', '10.0.0.1', '2001:db8::1', 'ejemplo.invalid', 'localhost.ejemplo']) {
    assert.equal(esAnfitrionLocal(externo), false, externo);
  }
});
