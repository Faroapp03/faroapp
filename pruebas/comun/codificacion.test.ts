// Vectores externos y límites de Base64 y PAE: los bytes del mensaje firmado se conservan sin normalización.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aBase64Url, deBase64Url } from '../../src/comun/base64url.js';
import { aBase64, bytesDeBase64, mensajeAFirmar, TIPOS } from '../../src/comun/sobre-dsse.ts';

/** Vectores de RFC 4648, apartado 10, independientes de los codificadores. */
const VECTORES = [
  ['', '', ''],
  ['f', 'Zg==', 'Zg'],
  ['fo', 'Zm8=', 'Zm8'],
  ['foo', 'Zm9v', 'Zm9v'],
  ['foob', 'Zm9vYg==', 'Zm9vYg'],
  ['fooba', 'Zm9vYmE=', 'Zm9vYmE'],
  ['foobar', 'Zm9vYmFy', 'Zm9vYmFy'],
] as const;
const BYTES_CON_MAS_Y_BARRA = Buffer.from('fbff', 'hex');
const BYTES_CON_VISTA_DE_FOO = Buffer.from('ff666f6ffe', 'hex');
const BYTES_CON_VISTA_BINARIA = Buffer.from('ff0020fffe', 'hex');
const CONTENIDO_BINARIO = Buffer.from('0020ff', 'hex');
const LONGITUD_TIPO_VECTOR_DSSE_BYTES = 29;
const VALORES_DE_BYTE = 256;
const LONGITUD_GRANDE_BYTES = 131_073;
const CODIFICADOR = new TextEncoder();

/** Verifica contenido y propiedad del buffer que puede recibir Web Crypto. */
function comprobarBytes(actual: Uint8Array<ArrayBuffer> | null, esperado: Uint8Array): void {
  assert.deepEqual(actual, esperado);
  assert.ok(actual?.buffer instanceof ArrayBuffer);
  assert.equal(actual.byteOffset, 0);
  assert.equal(actual.buffer.byteLength, esperado.byteLength);
}

test('los dos alfabetos reproducen los vectores de RFC 4648 y descodifican en buffers propios', () => {
  for (const [texto, estandar, url] of VECTORES) {
    const bytes = CODIFICADOR.encode(texto);
    assert.equal(aBase64(bytes), estandar);
    assert.equal(aBase64Url(bytes), url);
    comprobarBytes(bytesDeBase64(estandar), bytes);
    comprobarBytes(deBase64Url(url), bytes);
  }
});

test('los alfabetos conservan todos los valores de byte y los tres restos de longitud', () => {
  const todos = Uint8Array.from({ length: VALORES_DE_BYTE }, (_, indice) => indice);
  for (let longitud = 1; longitud <= VALORES_DE_BYTE; longitud++) {
    const bytes = todos.subarray(0, longitud);
    assert.equal(aBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.equal(aBase64Url(bytes), Buffer.from(bytes).toString('base64url'));
    comprobarBytes(bytesDeBase64(aBase64(bytes)), bytes);
    comprobarBytes(deBase64Url(aBase64Url(bytes)), bytes);
  }
});

test('base64url sustituye los dos caracteres del alfabeto estándar y retira el relleno', () => {
  const bytes = Uint8Array.from(BYTES_CON_MAS_Y_BARRA);
  assert.equal(aBase64(bytes), '+/8=');
  assert.equal(aBase64Url(bytes), '-_8');
  comprobarBytes(deBase64Url('-_8'), bytes);
  comprobarBytes(bytesDeBase64('+/8='), bytes);
});

test('los codificadores respetan el offset y la longitud de una vista y no modifican la entrada', () => {
  const completo = Uint8Array.from(BYTES_CON_VISTA_DE_FOO);
  const vista = completo.subarray(1, -1);
  assert.equal(aBase64(vista), 'Zm9v');
  assert.equal(aBase64Url(vista), 'Zm9v');
  assert.equal(aBase64Url(completo.buffer), '_2Zvb_4');
  assert.deepEqual(completo, Uint8Array.from(BYTES_CON_VISTA_DE_FOO));
});

test('los codificadores admiten un bloque mayor que los límites habituales de argumentos de una llamada', () => {
  const bytes = Uint8Array.from({ length: LONGITUD_GRANDE_BYTES }, (_, indice) => indice % VALORES_DE_BYTE);
  assert.equal(aBase64(bytes), Buffer.from(bytes).toString('base64'));
  assert.equal(aBase64Url(bytes), Buffer.from(bytes).toString('base64url'));
});

test('base64url rechaza relleno, caracteres ajenos y longitudes con un carácter suelto', () => {
  for (const texto of ['A', 'AAAAA', 'AAAAAAAAA', 'QQ=', 'QQ==', '+/8', 'Q Q', 'QQ\n', 'QQ\r\n', 'QQ\t', 'á']) {
    assert.equal(deBase64Url(texto), null, JSON.stringify(texto));
  }
});

test('base64 estándar rechaza otros tipos, caracteres ajenos y grupos o rellenos mal formados', () => {
  const entradas: readonly unknown[] = [
    null,
    undefined,
    0,
    false,
    {},
    [],
    Object('QQ=='),
    'QQ',
    'QQ=',
    'A===',
    '====',
    'AA=A',
    'AA==AAAA',
    '-_8=',
    'Q Q=',
    'AAA\n',
    'AA\r\n',
    'QQ==\t',
    'á===',
  ];
  for (const entrada of entradas) {
    assert.equal(bytesDeBase64(entrada), null, String(entrada));
  }
});

test('los decodificadores conservan la aceptación de bits finales no canónicos', () => {
  comprobarBytes(deBase64Url('QQ'), CODIFICADOR.encode('A'));
  comprobarBytes(deBase64Url('QR'), CODIFICADOR.encode('A'));
  comprobarBytes(bytesDeBase64('AA=='), Uint8Array.of(0));
  comprobarBytes(bytesDeBase64('AB=='), Uint8Array.of(0));
  comprobarBytes(bytesDeBase64('AAB='), Uint8Array.of(0, 0));
});

test('cada descodificación devuelve un buffer independiente de las demás', () => {
  const primero = bytesDeBase64('Zm9v');
  const segundo = bytesDeBase64('Zm9v');
  assert.ok(primero && segundo);
  primero.fill(0);
  comprobarBytes(segundo, CODIFICADOR.encode('foo'));
});

test('la PAE reproduce el vector del protocolo DSSE 1.0.2 con la longitud del tipo comprobada', () => {
  const tipo = 'http://example.com/HelloWorld';
  assert.equal(CODIFICADOR.encode(tipo).length, LONGITUD_TIPO_VECTOR_DSSE_BYTES);
  comprobarBytes(
    mensajeAFirmar(tipo, CODIFICADOR.encode('hello world')),
    CODIFICADOR.encode('DSSEv1 29 http://example.com/HelloWorld 11 hello world'),
  );
});

test('la PAE cuenta bytes UTF-8 del tipo y conserva contenido binario de una vista', () => {
  const tipo = 'é/😀';
  const completo = Uint8Array.from(BYTES_CON_VISTA_BINARIA);
  const contenido = completo.subarray(1, -1);
  const esperado = Uint8Array.from([...CODIFICADOR.encode('DSSEv1 7 é/😀 3 '), ...CONTENIDO_BINARIO]);
  comprobarBytes(mensajeAFirmar(tipo, contenido), esperado);
  assert.deepEqual(completo, Uint8Array.from(BYTES_CON_VISTA_BINARIA));
});

test('la PAE conserva los campos vacíos y distingue tipos de contenido sin normalizarlos', () => {
  comprobarBytes(mensajeAFirmar('', new Uint8Array()), CODIFICADOR.encode('DSSEv1 0  0 '));
  assert.notDeepEqual(mensajeAFirmar('é', Uint8Array.of(0)), mensajeAFirmar('e\u0301', Uint8Array.of(0)));
  assert.notDeepEqual(mensajeAFirmar('Tipo', Uint8Array.of(0)), mensajeAFirmar('tipo', Uint8Array.of(0)));
});

test('la PAE devuelve un mensaje independiente de cambios posteriores en su contenido', () => {
  const contenido = CODIFICADOR.encode('hola');
  const mensaje = mensajeAFirmar('texto', contenido);
  contenido.fill(0);
  comprobarBytes(mensaje, CODIFICADOR.encode('DSSEv1 5 texto 4 hola'));
});

test('los tipos firmados conservan sus valores, orden y congelación superficial', () => {
  assert.deepEqual(Object.entries(TIPOS), [
    ['aiBom', 'application/vnd.cyclonedx+json'],
    ['certificado', 'application/vnd.faro.clave-diaria+json'],
    ['instalacion', 'application/vnd.faro.instalacion+json'],
    ['manifiesto', 'application/vnd.faro.manifiesto-del-dispositivo+json'],
    ['respuestaMcp', 'application/vnd.faro.respuesta-mcp+json'],
  ]);
  assert.equal(Object.isFrozen(TIPOS), true);
});
