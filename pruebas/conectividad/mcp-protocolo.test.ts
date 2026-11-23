// Contratos directos del protocolo compartido por MCP y A2A.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODIGO,
  ErrorMcp,
  errorRpc,
  leerMensaje,
  META,
  metaDe,
  respuestaRpc,
  VERSION_MODERNA,
  VERSION_SIN_CABECERA,
  VERSIONES,
  VERSIONES_ANTERIORES,
  valorDeCabecera,
} from '../../src/api/mcp/protocolo.ts';

/** Estados HTTP del contrato de protocolo. */
const HTTP = { correcto: 200, solicitudIncorrecta: 400 } as const;
/** Identificadores de prueba que distinguen el entero de una fracción. */
const ID_PRUEBA = 7;
const ID_FRACCIONARIO = 1.5;

/** Exige el error de petición y su texto contractual. */
function errorDeMensaje(cuerpo: unknown, mensaje: string): void {
  assert.throws(
    () => leerMensaje(cuerpo),
    (error: unknown) =>
      error instanceof ErrorMcp &&
      error.codigo === CODIGO.peticion &&
      error.estado === HTTP.solicitudIncorrecta &&
      error.message === mensaje,
  );
}

test('versiones, metadatos y códigos conservan el contrato compartido', () => {
  assert.equal(VERSION_MODERNA, '2026-07-28');
  assert.deepEqual(VERSIONES_ANTERIORES, ['2025-11-25', '2025-06-18', '2025-03-26']);
  assert.deepEqual(VERSIONES, ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
  assert.equal(VERSION_SIN_CABECERA, '2025-03-26');
  assert.deepEqual(META, {
    version: 'io.modelcontextprotocol/protocolVersion',
    capacidades: 'io.modelcontextprotocol/clientCapabilities',
    cliente: 'io.modelcontextprotocol/clientInfo',
    servidor: 'io.modelcontextprotocol/serverInfo',
  });
  assert.deepEqual(CODIGO, {
    json: -32700,
    peticion: -32600,
    metodo: -32601,
    parametros: -32602,
    interno: -32603,
    cabeceras: -32020,
    version: -32022,
    demasiadas: -31429,
  });
});

test('ErrorMcp conserva estado por defecto, mensaje y datos originales', () => {
  const datos = { supported: VERSIONES };
  const defecto = new ErrorMcp(CODIGO.metodo, 'Method not found');
  assert.ok(defecto instanceof Error);
  assert.equal(defecto.estado, HTTP.correcto);
  assert.equal(defecto.datos, undefined);
  const error = new ErrorMcp(CODIGO.version, 'Unsupported protocol version', HTTP.solicitudIncorrecta, datos);
  assert.equal(error.datos, datos);
  assert.equal(error.message, 'Unsupported protocol version');
  assert.equal(error.estado, HTTP.solicitudIncorrecta);
});

test('una petición admite ids de texto o enteros y conserva sus parámetros', () => {
  const params = { name: 'ficha_grupo', arguments: { isco: '4224' } };
  for (const id of [ID_PRUEBA, 0, -1, '', 'a']) {
    const leida = leerMensaje({ jsonrpc: '2.0', id, method: 'tools/call', params });
    assert.deepEqual(leida, { id, metodo: 'tools/call', parametros: params });
    assert.ok('parametros' in leida);
    assert.equal(leida.parametros, params);
  }
  assert.deepEqual(leerMensaje({ jsonrpc: '2.0', id: 1, method: 'ping' }), {
    id: 1,
    metodo: 'ping',
    parametros: {},
  });
});

test('un lote, una versión distinta o un cuerpo que no es objeto da el error de petición', () => {
  for (const cuerpo of [null, [], [{ jsonrpc: '2.0', method: 'x' }], 'x', { jsonrpc: '1.0' }]) {
    errorDeMensaje(cuerpo, 'Se esperaba un único mensaje JSON-RPC 2.0');
  }
});

test('un mensaje sin método válido da el texto contractual', () => {
  for (const method of [undefined, null, 1, '']) {
    errorDeMensaje({ jsonrpc: '2.0', id: 1, method }, 'Falta el método');
  }
});

test('los parámetros presentes deben ser objeto, también en notificaciones', () => {
  for (const params of [null, [], 1, 'x', undefined]) {
    errorDeMensaje({ jsonrpc: '2.0', method: 'ping', params }, 'Los parámetros tienen que ser un objeto');
  }
});

test('null, fracciones y otros ids inválidos conservan su rechazo', () => {
  for (const id of [null, ID_FRACCIONARIO, Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
    errorDeMensaje({ jsonrpc: '2.0', id, method: 'tools/list' }, 'El identificador no es válido');
  }
});

test('las notificaciones y respuestas del cliente no esperan respuesta', () => {
  assert.deepEqual(leerMensaje({ jsonrpc: '2.0', method: 'notifications/initialized' }), { tipo: 'sin-respuesta' });
  for (const campo of [{ result: {} }, { error: { code: -32603, message: 'x' } }]) {
    assert.deepEqual(leerMensaje({ jsonrpc: '2.0', id: 3, ...campo }), { tipo: 'sin-respuesta' });
  }
});

test('metaDe conserva el objeto y sustituye solamente formas no admitidas', () => {
  const meta = { [META.version]: VERSION_MODERNA };
  assert.equal(metaDe({ _meta: meta }), meta);
  for (const parametros of [{}, { _meta: null }, { _meta: [] }, { _meta: 'x' }]) {
    assert.deepEqual(metaDe(parametros), {});
  }
});

test('las respuestas RPC mantienen id, resultado y datos sin copiarlos', () => {
  const resultado = { tools: [] };
  assert.deepEqual(respuestaRpc('a', resultado), { jsonrpc: '2.0', id: 'a', result: resultado });
  assert.equal(respuestaRpc(1, resultado).result, resultado);
  assert.deepEqual(errorRpc(null, new ErrorMcp(CODIGO.json, 'Parse error', HTTP.solicitudIncorrecta)), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'Parse error' },
  });
  for (const datos of [null, false, { supported: VERSIONES }]) {
    const respuesta = errorRpc(
      ID_PRUEBA,
      new ErrorMcp(CODIGO.version, 'Unsupported protocol version', HTTP.solicitudIncorrecta, datos),
    );
    assert.equal(respuesta.error.data, datos);
    assert.ok(Object.hasOwn(respuesta.error, 'data'));
  }
});

test('Mcp-Name admite ASCII visible, espacio y tabulador sin normalizar', () => {
  for (const texto of ['', 'ficha_grupo', ' faro://acerca\t', '~']) {
    assert.equal(valorDeCabecera(texto), texto);
  }
  for (const texto of ['índice', '\n', '\r', '\0', '\x7f']) {
    assert.equal(valorDeCabecera(texto), null);
  }
});

test('Mcp-Name en base64 conserva Unicode válido y rechaza base64 o UTF8 inválidos', () => {
  for (const texto of ['ficha_grupo', 'faro://índice', '😀 e\u0301', '']) {
    const cabecera = `=?base64?${Buffer.from(texto).toString('base64')}?=`;
    assert.equal(valorDeCabecera(cabecera), texto);
  }
  for (const base64 of ['A', '====', '/w==', 'wyg=']) {
    assert.equal(valorDeCabecera(`=?base64?${base64}?=`), null);
  }
});
