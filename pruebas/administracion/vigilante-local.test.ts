/** La CLI opera exclusivamente sobre un almacén sintético existente y no instala tareas. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ejecutarVigilanteLocal } from '../../herramientas/mantenimiento/vigilante.ts';
import { baseVigilante, CONFIG_VIGILANTE, CORTE_VIGILANTE } from '../ayudas/vigilante.ts';

test('consulta no migra; preparar y repetir no crean otra autoridad ni avisos duplicados', async (t) => {
  const f = await baseVigilante(t);
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'vigilante-local-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const base = join(dir, 'administracion.sqlite');
  const config = join(dir, 'configuracion.json');
  f.db.prepare('VACUUM INTO ?').run(base);
  writeFileSync(config, JSON.stringify(CONFIG_VIGILANTE), { mode: 0o600 });
  const args = ['verificar', base, config];
  const reloj = () => CORTE_VIGILANTE;
  assert.throws(() => ejecutarVigilanteLocal(args, {}, reloj));
  assert.equal(ejecutarVigilanteLocal(['preparar', base, config], {}, reloj).codigo, 0);
  const primero = ejecutarVigilanteLocal(args, {}, reloj);
  assert.equal(primero.codigo, 1);
  const antes = ejecutarVigilanteLocal(['historial', base, config], {}, reloj);
  ejecutarVigilanteLocal(args, {}, reloj);
  assert.deepEqual(ejecutarVigilanteLocal(['historial', base, config], {}, reloj), antes);
});
test('ausencia y configuración corrupta fallan sin crear una base; deshabilitado no accede a ella', (t) => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'vigilante-config-'));
  t.after(() => rmSync(dir, { recursive: true }));
  const base = join(dir, 'ausente.sqlite');
  const config = join(dir, 'configuracion.json');
  writeFileSync(config, JSON.stringify(CONFIG_VIGILANTE), { mode: 0o600 });
  assert.throws(() => ejecutarVigilanteLocal(['verificar', base, config], {}, () => CORTE_VIGILANTE));
  assert.equal(existsSync(base), false);
  writeFileSync(config, '{roto');
  assert.throws(() => ejecutarVigilanteLocal(['verificar', base, config], {}, () => CORTE_VIGILANTE));
  writeFileSync(config, JSON.stringify({ ...CONFIG_VIGILANTE, habilitado: false }));
  assert.equal(ejecutarVigilanteLocal(['verificar', base, config], {}, () => CORTE_VIGILANTE).codigo, 0);
  assert.equal(existsSync(base), false);
});
