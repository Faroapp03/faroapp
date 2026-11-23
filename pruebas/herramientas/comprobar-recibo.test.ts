import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { comprobarRecibo } from '../../herramientas/mantenimiento/comprobar-recibo.ts';
import { MAX_RESULTADO_ACTUALIZACION_BYTES } from '../../src/administracion/resultado-actualizacion.ts';

const CLI = fileURLToPath(new URL('../../herramientas/mantenimiento/comprobar-recibo.ts', import.meta.url));
const PLAZO_MS = 5000;
const BYTE_UTF8_INVALIDO = 0xff;
const RECIBO = {
  version: 1,
  solicitudId: '11111111-1111-4111-8111-111111111111',
  revisionReserva: 1,
  accion: 'actualizar-datos',
  resultado: 'rechazado',
  veredicto: null,
  terminadoEn: '2026-10-16T12:00:00Z',
  estado: null,
  huellaPaquete: null,
  error: 'candidato_no_verificable',
};

test('el ejecutor admite el contrato del receptor sin modificar los bytes conservados', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'recibo Año '));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const ruta = join(carpeta, 'recibo.json');
  const original = JSON.stringify(RECIBO, null, 2);
  writeFileSync(ruta, original);
  comprobarRecibo(ruta);
  const resultado = spawnSync(process.execPath, [CLI, ruta], { encoding: 'utf8', timeout: PLAZO_MS });
  assert.equal(resultado.status, 0, resultado.stderr);
  assert.equal(resultado.stdout, '');
  assert.equal(readFileSync(ruta, 'utf8'), original);
});

test('un recibo mal formado, excesivo o enlazado no pasa al transporte', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'recibo inválido '));
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const ruta = join(carpeta, 'privado.json');
  for (const contenido of [
    JSON.stringify({ ...RECIBO, resultado: 'validado', veredicto: 'verde', error: null }),
    JSON.stringify({ ...RECIBO, datoAjeno: 'NO-MOSTRAR' }),
    'x'.repeat(MAX_RESULTADO_ACTUALIZACION_BYTES + 1),
    Buffer.from([BYTE_UTF8_INVALIDO]),
  ]) {
    writeFileSync(ruta, contenido);
    assert.throws(() => comprobarRecibo(ruta));
  }
  writeFileSync(ruta, JSON.stringify(RECIBO));
  const enlace = join(carpeta, 'enlace.json');
  symlinkSync(ruta, enlace);
  assert.throws(() => comprobarRecibo(enlace));
  const resultado = spawnSync(process.execPath, [CLI, enlace], { encoding: 'utf8', timeout: PLAZO_MS });
  assert.equal(resultado.status, 1);
  assert.equal(resultado.stdout, '');
  assert.equal(resultado.stderr, 'No se ha podido validar el recibo del candidato.\n');
});
