/** El libro de cuotas/revocaciones no puede seguir operando si pierde su autoridad persistida. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AlmacenPublicoSqlite } from '../../src/plataforma/acceso-publico/sqlite.ts';
import { motorPanel } from '../ayudas/persistencia-panel.ts';

const TAM_JTI = 22;
for (const operacion of ['consumir', 'revocar', 'revocado'] as const) {
  test(`${operacion}: metadatos ausentes fallan sin escribir ni reconstruir`, async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const almacen = new AlmacenPublicoSqlite(motorPanel(db), { maxClientes: 2, ahora: () => 0 });
      const jti = 'a'.repeat(TAM_JTI);
      await almacen.revocar(jti, 60);
      db.exec('DELETE FROM publico_estado');
      const antes = ['publico_contadores', 'publico_revocados'].map((t) => db.prepare(`SELECT * FROM ${t}`).all());
      const llamadas = {
        consumir: () => almacen.consumir([{ clave: 'consultas:global', limite: 2, ventanaMs: 1000 }]),
        revocar: () => almacen.revocar('b'.repeat(TAM_JTI), 60),
        revocado: () => almacen.revocado(jti),
      };
      await assert.rejects(llamadas[operacion]);
      assert.deepEqual(
        ['publico_contadores', 'publico_revocados'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
        antes,
      );
      assert.equal(db.prepare('SELECT count(*) AS n FROM publico_estado').get()?.n, 0);
    } finally {
      db.close();
    }
  });
}
