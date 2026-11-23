// Los ensayos de navegador con orden propia (scripts/pruebas-mjs.ts, ENSAYOS_CON_ORDEN): no entran en las baterías de
// `npm run verificar`, cuyo plazo no les alcanza, pero no se omiten en silencio. Cada uno tiene su orden de
// package.json que lo ejecuta, y el descubrimiento de verificar falla si falta o si no lo ejecuta con node.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ordenDelEnsayo, tipoPruebaMjs } from '../../scripts/pruebas-mjs.ts';
import { listarPruebas, listarPruebasNavegador } from '../../scripts/verificar.ts';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const ENSAYO = 'pruebas/navegadores/arranque-bloqueado.test.mjs';
const ORDEN = 'probar:arranque-bloqueado';
/** Una prueba de unidad del proyecto mínimo: sin ninguna, el descubrimiento falla por eso y no por el ensayo. */
const UNIDAD = 'pruebas/unidad.test.ts';

/**
 * Un proyecto mínimo con el ensayo, una prueba de unidad y, si se da, un package.json con esas órdenes; se retira al
 * terminar.
 */
function proyectoConElEnsayo(t: TestContext, ordenes?: Record<string, string>): string {
  const area = mkdtempSync(join(tmpdir(), 'faro-ensayo-'));
  t.after(() => rmSync(area, { recursive: true, force: true }));
  mkdirSync(join(area, 'pruebas', 'navegadores'), { recursive: true });
  writeFileSync(join(area, ENSAYO), '');
  writeFileSync(join(area, UNIDAD), '');
  if (ordenes) {
    writeFileSync(join(area, 'package.json'), JSON.stringify({ scripts: ordenes }));
  }
  return area;
}

test('el ensayo del arranque bloqueado tiene su orden y no entra en ninguna batería de verificar', () => {
  assert.equal(tipoPruebaMjs(ENSAYO), 'ensayo');
  assert.equal(ordenDelEnsayo(RAIZ, ENSAYO), ORDEN);
  const archivo = join(RAIZ, ENSAYO);
  assert.equal(listarPruebasNavegador(RAIZ).includes(archivo), false, 'no está en la batería de navegador');
  assert.equal(listarPruebas(RAIZ).includes(archivo), false, 'ni en la de unidad');
});

test('un ensayo sin su orden, o con una orden que no lo ejecuta, hace fallar el descubrimiento', (t) => {
  assert.throws(() => listarPruebas(proyectoConElEnsayo(t)), /sin su orden/, 'sin package.json');
  assert.throws(() => listarPruebas(proyectoConElEnsayo(t, {})), /sin su orden/, 'sin la orden');
  assert.throws(
    () => listarPruebas(proyectoConElEnsayo(t, { [ORDEN]: 'node pruebas/navegadores/otro.mjs' })),
    /sin su orden/,
    'con una orden que ejecuta otra cosa',
  );
  // Órdenes que nombran el archivo sin ejecutarlo, o que ocultan su resultado.
  for (const comando of [
    `echo ${ENSAYO}`,
    `node --check ${ENSAYO}`,
    `node pruebas/navegadores/otra.mjs ${ENSAYO}`,
    `node ${ENSAYO} || true`,
  ]) {
    assert.throws(() => listarPruebas(proyectoConElEnsayo(t, { [ORDEN]: comando })), /sin su orden/, comando);
  }
  assert.equal(
    ordenDelEnsayo(proyectoConElEnsayo(t, { [ORDEN]: `node ${ENSAYO} --motor chromium` }), ENSAYO),
    ORDEN,
    'con argumentos del propio ensayo tras la ruta',
  );
  const completo = proyectoConElEnsayo(t, { [ORDEN]: `node ${ENSAYO}` });
  assert.deepEqual(listarPruebasNavegador(completo), []);
  assert.deepEqual(listarPruebas(completo), [join(completo, UNIDAD)], 'solo la prueba de unidad, sin el ensayo');
});
