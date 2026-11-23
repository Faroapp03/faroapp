/** El Worker no dispone de node:crypto; las huellas persistidas conservan su formato anterior. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { build } from 'esbuild';
import {
  comprobarVigilanteSqlite,
  prepararVigilanteSqlite,
} from '../../src/plataforma/acceso-publico/vigilante-sqlite.ts';
import { sha256 } from '../../web/terceros/noble/hashes/sha2.js';
import { bytesToHex } from '../../web/terceros/noble/hashes/utils.js';
import { baseVigilante, CONFIG_VIGILANTE, CORTE_VIGILANTE, PROGRAMADA_VIGILANTE } from '../ayudas/vigilante.ts';

const hashAnterior = (valor: string) => createHash('sha256').update(valor).digest('hex');
test('el módulo de vigilante se empaqueta para Worker sin módulos Node', async () => {
  const salida = await build({
    entryPoints: ['src/plataforma/acceso-publico/vigilante-sqlite.ts'],
    absWorkingDir: process.cwd(),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    logLevel: 'silent',
  });
  assert.equal(salida.outputFiles.length, 1);
  assert.doesNotMatch(salida.outputFiles[0]?.text ?? '', /node:crypto/);
});
test('SHA-256 síncrono mantiene vectores y huellas del almacén anterior', async (t) => {
  for (const texto of ['', 'abc', 'Faro · català 🧭', JSON.stringify({ a: null, b: [true, 1, 'ñ'] })]) {
    assert.equal(bytesToHex(sha256(new TextEncoder().encode(texto))), hashAnterior(texto));
  }
  const f = await baseVigilante(t);
  prepararVigilanteSqlite(f.sql, CONFIG_VIGILANTE, CORTE_VIGILANTE);
  comprobarVigilanteSqlite(f.sql, CONFIG_VIGILANTE, PROGRAMADA_VIGILANTE, CORTE_VIGILANTE);
  const configuracion = f.db.prepare('SELECT sha, documento FROM administracion_vigilante_configuraciones').get();
  assert.ok(configuracion && typeof configuracion.documento === 'string');
  assert.equal(configuracion.sha, hashAnterior(configuracion.documento));
  const decisiones = f.db.prepare('SELECT * FROM administracion_vigilante_decisiones').all();
  assert.ok(decisiones.length > 0);
  for (const d of decisiones) {
    const contenido = [
      d.clave,
      d.estado,
      d.motivo,
      d.observado_en,
      d.evaluado_en,
      d.referencia,
      d.configuracion_sha,
      d.avisar,
    ];
    if (d.origen != null) {
      contenido.push(d.origen);
    }
    assert.equal(d.sha, hashAnterior(JSON.stringify(contenido)));
  }
});
