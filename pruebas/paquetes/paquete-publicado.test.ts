// Contrato del paquete publicado: versión, nombres, orden y errores, sin copiar ni servir archivos.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import {
  archivoDelPaquetePublicado,
  CACHE_DEL_PAQUETE,
  CARPETA_DEL_PAQUETE,
  versionDelPaquete,
} from '../../src/plataforma/paquete-publicado.ts';

const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VERSION = '0123456789abcdef';
const BYTE_UTF8_INVALIDO = 0xff;

/** Carpeta mínima, aislada y portátil: para listar el paquete solo hace falta su manifiesto. */
function conManifiesto(contenido: string | Buffer, comprobar: (carpeta: string) => void): void {
  const carpeta = mkdtempSync(join(tmpdir(), 'paquete-publicado-'));
  try {
    writeFileSync(join(carpeta, 'manifiesto.json'), contenido);
    comprobar(carpeta);
  } finally {
    rmSync(carpeta, { recursive: true });
  }
}

test('conserva versión corta, ruta pública y cabecera de caché', () => {
  assert.equal(versionDelPaquete(SHA256), VERSION);
  assert.equal(CARPETA_DEL_PAQUETE, 'paquete');
  assert.equal(CACHE_DEL_PAQUETE, 'public, max-age=31536000, immutable');
  assert.deepEqual(archivoDelPaquetePublicado(`/paquete/${VERSION}/a-1.json`), {
    huella: VERSION,
    archivo: 'a-1.json',
  });
});

test('conserva las restricciones de rutas sin subcarpetas ni consulta', () => {
  const rutas = [
    `/paquete/${VERSION}/../a.json`,
    `/paquete/${VERSION}/sub/a.json`,
    `/paquete/${VERSION}/a_b.json`,
    `/paquete/${VERSION}/á.json`,
    `/paquete/${VERSION}/a.JSON`,
    `/paquete/${VERSION}/a.json?q=1`,
    `/paquete/${VERSION}/a.json#parte`,
    `/paquete/${VERSION.slice(1)}/a.json`,
    `/paquete/${VERSION.toUpperCase()}/a.json`,
  ];
  for (const ruta of rutas) {
    assert.equal(archivoDelPaquetePublicado(ruta), null, ruta);
  }
});

test('deriva versión de los bytes, ordena nombres y conserva manifiesto primero sin mutación', () => {
  const texto = JSON.stringify({ 'z.json': { sha256: SHA256 }, 'a-1.json': { sha256: SHA256 } });
  conManifiesto(texto, (carpeta) => {
    const original = readFileSync(join(carpeta, 'manifiesto.json'));
    const esperado = {
      version: createHash('sha256').update(original).digest('hex').slice(0, VERSION.length),
      archivos: ['manifiesto.json', 'a-1.json', 'z.json'],
    };
    assert.deepEqual(paqueteParaPublicar(carpeta), esperado);
    assert.deepEqual(readFileSync(join(carpeta, 'manifiesto.json')), original);
  });
});

test('rechaza claves no publicables y entradas sin texto sha256 con diagnóstico original', () => {
  conManifiesto(JSON.stringify({ '../a.json': { sha256: SHA256 } }), (carpeta) => {
    assert.throws(
      () => paqueteParaPublicar(carpeta),
      new Error(
        `manifiesto.json de ${carpeta} nombra «../a.json», que no se puede publicar: vuelve a exportar el paquete`,
      ),
    );
  });
  conManifiesto(JSON.stringify({ 'a.json': { sha256: null } }), (carpeta) => {
    assert.throws(
      () => paqueteParaPublicar(carpeta),
      new Error(
        `manifiesto.json de ${carpeta} nombra «a.json», que no se puede publicar: vuelve a exportar el paquete`,
      ),
    );
  });
});

test('rechaza una sha256 textual que no sea un digest hexadecimal minúsculo', () => {
  for (const sha256 of ['huella-textual', SHA256.toUpperCase(), `${SHA256}\n`]) {
    conManifiesto(JSON.stringify({ 'a.json': { sha256 } }), (carpeta) => {
      assert.throws(() => paqueteParaPublicar(carpeta), /no se puede publicar/);
    });
  }
});

test('conserva los errores para manifiesto no objeto, JSON inválido y BOM', () => {
  conManifiesto('[]', (carpeta) => {
    assert.throws(
      () => paqueteParaPublicar(carpeta),
      new Error(`manifiesto.json de ${carpeta} no es un objeto: vuelve a exportar el paquete`),
    );
  });
  conManifiesto('{', (carpeta) => assert.throws(() => paqueteParaPublicar(carpeta), SyntaxError));
  conManifiesto('\uFEFF{}', (carpeta) => assert.throws(() => paqueteParaPublicar(carpeta), SyntaxError));
});

test('rechaza UTF-8 malformado antes de calcular una versión publicable', () => {
  const contenido = Buffer.concat([
    Buffer.from('{"a.json":{"sha256":"'),
    Buffer.from([BYTE_UTF8_INVALIDO]),
    Buffer.from('"}}'),
  ]);
  conManifiesto(contenido, (carpeta) => {
    assert.throws(() => paqueteParaPublicar(carpeta), { name: 'TypeError', code: 'ERR_ENCODING_INVALID_ENCODED_DATA' });
  });
});
