// La carpeta de mediciones del motor empaquetado (FARO_SALIDA) se crea y se comprueba antes de medir.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepararSalida, SalidaNoEscribible } from './motor-empaquetado/salida.ts';

const SOLO_LECTURA = 0o500;
const LECTURA_Y_ESCRITURA = 0o700;

test('una carpeta de mediciones que no existe se crea, se puede escribir y no queda el archivo de prueba', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'salida-del-motor-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const carpeta = join(base, 'nueva', 'mediciones');
  assert.equal(prepararSalida(carpeta), carpeta);
  assert.ok(existsSync(carpeta));
  assert.deepEqual(readdirSync(carpeta), []);
});

test('una carpeta de mediciones que es un archivo o no admite escritura falla antes de medir, con su motivo', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'salida-del-motor-'));
  t.after(() => {
    chmodSync(join(base, 'solo-lectura'), LECTURA_Y_ESCRITURA);
    rmSync(base, { recursive: true, force: true });
  });
  const archivo = join(base, 'es-un-archivo');
  writeFileSync(archivo, '');
  assert.throws(() => prepararSalida(archivo), SalidaNoEscribible);
  assert.throws(() => prepararSalida(join(archivo, 'dentro')), SalidaNoEscribible);
  const soloLectura = join(base, 'solo-lectura');
  prepararSalida(soloLectura);
  chmodSync(soloLectura, SOLO_LECTURA);
  assert.throws(() => prepararSalida(soloLectura), /FARO_SALIDA no se puede usar/);
});
