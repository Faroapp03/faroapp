import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ArchivoDelPaqueteYaLeido,
  leerArchivoDelPaquete,
  soltarArchivoDelPaquete,
} from '../../src/comun/archivo-del-paquete.ts';

const BYTE_UTF8_INVALIDO = 0xff;

test('el JSON importado por Node conserva su identidad y sus valores', () => {
  for (const importado of [{ texto: 'Núria' }, ['a', 2], null, false, 0]) {
    assert.equal(leerArchivoDelPaquete(importado), importado);
  }
});

test('los bytes del Worker se sueltan al leerlos; la lectura se repite hasta que se da por guardada', () => {
  const bytes = new TextEncoder().encode('{"texto":"Núria","valor":0}').buffer;
  assert.deepEqual(leerArchivoDelPaquete(bytes), { texto: 'Núria', valor: 0 });
  assert.equal(bytes.detached, true);
  assert.deepEqual(leerArchivoDelPaquete(bytes), { texto: 'Núria', valor: 0 });
  soltarArchivoDelPaquete(bytes);
  assert.throws(() => leerArchivoDelPaquete(bytes), ArchivoDelPaqueteYaLeido);
});

test('un JSON defectuoso suelta los bytes antes de fallar; no admite una segunda lectura', () => {
  const bytes = new TextEncoder().encode('{').buffer;
  assert.throws(() => leerArchivoDelPaquete(bytes), SyntaxError);
  assert.equal(bytes.detached, true);
  assert.throws(() => leerArchivoDelPaquete(bytes), ArchivoDelPaqueteYaLeido);
});

test('UTF-8 inválido falla sin sustituciones y sin llegar a soltar los bytes', () => {
  const bytes = new Uint8Array([BYTE_UTF8_INVALIDO]).buffer;
  assert.throws(() => leerArchivoDelPaquete(bytes), TypeError);
  assert.equal(bytes.detached, false);
});
