// Lectura limitada de cuerpos, validación y cancelación sin transportar peticiones por red.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerCuerpoJson, leerTextoLimitado } from '../../src/api/cuerpo.ts';
import { PeticionCancelada, PlazoAgotado, SolicitudInvalida } from '../../src/api/errores.ts';
import type { EsquemaDe } from '../../src/comun/esquema.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';

const URL_PRUEBA = 'http://api.local/prueba-lector';
const MENSAJE_ESQUEMA = 'el relato no cumple el esquema';
const MAX_TEXTO_PRUEBA = 16000;
const ESQUEMA_PRUEBA: EsquemaDe<{ relato: string }> = {
  type: 'object',
  additionalProperties: false,
  required: ['relato'],
  properties: { relato: { type: 'string', maxLength: MAX_TEXTO_PRUEBA } },
};
const TEXTO: EsquemaDe<string> = { type: 'string' };
const UTF8_EN_DOS_BYTES = 2;
const BYTE_ENE_INICIAL = 0xc3;
const BYTE_ENE_FINAL = 0xb1;

function peticion(body: NonNullable<RequestInit['body']>, headers: Record<string, string> = {}): Request {
  return new Request(URL_PRUEBA, { method: 'POST', body, headers, duplex: 'half' });
}

/** Flujo finito con fragmentos dados: la división de bytes puede cruzar un carácter UTF-8. */
function flujo(trozos: readonly Uint8Array[], cancelar: () => void = () => undefined): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controlador) {
      for (const trozo of trozos) {
        controlador.enqueue(trozo);
      }
      controlador.close();
    },
    cancel: cancelar,
  });
}

test('sin cuerpo devuelve texto vacío y la lectura JSON da 400', async () => {
  assert.equal(await leerTextoLimitado(new Request(URL_PRUEBA)), '');
  await assert.rejects(leerCuerpoJson(new Request(URL_PRUEBA), TEXTO, MENSAJE_ESQUEMA), /el cuerpo no es JSON/);
});

test('los fragmentos conservan UTF-8 al partir un carácter entre bytes', async () => {
  const cuerpo = flujo([new Uint8Array([BYTE_ENE_INICIAL]), new Uint8Array([BYTE_ENE_FINAL])]);
  assert.equal(await leerTextoLimitado(peticion(cuerpo)), 'ñ');
});

test('el cuerpo exactamente al límite cabe y el byte siguiente da 400', async () => {
  assert.equal((await leerTextoLimitado(peticion('x'.repeat(MAX_CUERPO_BYTES)))).length, MAX_CUERPO_BYTES);
  await assert.rejects(
    leerTextoLimitado(peticion('x'.repeat(MAX_CUERPO_BYTES + 1))),
    (error: unknown) => error instanceof SolicitudInvalida && error.message === 'la petición es demasiado grande',
  );
});

test('el límite es de bytes y no de caracteres, aunque content-length declare menos', async () => {
  const texto = JSON.stringify({ relato: 'ñ'.repeat(MAX_CUERPO_BYTES / UTF8_EN_DOS_BYTES) });
  assert.ok(texto.length < MAX_CUERPO_BYTES);
  assert.ok(new TextEncoder().encode(texto).length > MAX_CUERPO_BYTES);
  await assert.rejects(
    leerCuerpoJson(peticion(texto, { 'content-length': '1' }), ESQUEMA_PRUEBA, MENSAJE_ESQUEMA),
    /la petición es demasiado grande/,
  );
});

test('el JSON comprueba el tamaño declarado antes de consumir y el lector de texto cuenta solo bytes reales', async () => {
  const cabecera = { 'content-length': String(MAX_CUERPO_BYTES + 1) };
  const request = peticion('{}', cabecera);
  await assert.rejects(leerCuerpoJson(request, ESQUEMA_PRUEBA, MENSAJE_ESQUEMA), /la petición es demasiado grande/);
  assert.equal(request.bodyUsed, false);
  assert.equal(await leerTextoLimitado(peticion('{}', cabecera)), '{}');
});

test('un tamaño declarado ausente, negativo o no numérico conserva la lectura limitada', async () => {
  for (const headers of [{}, { 'content-length': '-1' }, { 'content-length': 'no-numérico' }]) {
    assert.equal(await leerCuerpoJson(peticion('"relato"', headers), TEXTO, MENSAJE_ESQUEMA), 'relato');
  }
});

test('el JSON mal formado y los valores que no son objeto conservan sus errores de entrada', async () => {
  await assert.rejects(leerCuerpoJson(peticion('no es json'), ESQUEMA_PRUEBA, MENSAJE_ESQUEMA), /el cuerpo no es JSON/);
  for (const texto of ['null', '[]', '7', '"texto"', '{}']) {
    await assert.rejects(
      leerCuerpoJson(peticion(texto), ESQUEMA_PRUEBA, MENSAJE_ESQUEMA),
      (error: unknown) => error instanceof SolicitudInvalida && error.message === MENSAJE_ESQUEMA,
    );
  }
});

test('el relato conserva su tope propio dentro de un cuerpo admitido', async () => {
  const dentro = JSON.stringify({ relato: 'x'.repeat(MAX_TEXTO_PRUEBA) });
  assert.deepEqual(await leerCuerpoJson(peticion(dentro), ESQUEMA_PRUEBA, MENSAJE_ESQUEMA), {
    relato: 'x'.repeat(MAX_TEXTO_PRUEBA),
  });
  const fuera = JSON.stringify({ relato: 'x'.repeat(MAX_TEXTO_PRUEBA + 1) });
  await assert.rejects(
    leerCuerpoJson(peticion(fuera), ESQUEMA_PRUEBA, MENSAJE_ESQUEMA),
    /el relato no cumple el esquema/,
  );
});

test('una señal ya retirada conserva su motivo y libera el lector', async () => {
  const retirada = new AbortController();
  const motivo = new PeticionCancelada();
  retirada.abort(motivo);
  const request = new Request(URL_PRUEBA, { method: 'POST', body: '{}', signal: retirada.signal });
  await assert.rejects(leerTextoLimitado(request), (error: unknown) => error === motivo);
  assert.equal(request.body?.locked, false);
});

for (const Motivo of [PeticionCancelada, PlazoAgotado]) {
  test(`cancelar durante la lectura conserva ${Motivo.name}, corta el flujo y libera el lector`, async () => {
    const retirada = new AbortController();
    const lectura = Promise.withResolvers<void>();
    const cancelaciones: unknown[] = [];
    const cuerpo = new ReadableStream<Uint8Array>({
      start: (controlador) => controlador.enqueue(new TextEncoder().encode('{')),
      pull: () => lectura.resolve(),
      cancel: (motivo) => {
        cancelaciones.push(motivo);
      },
    });
    const request = new Request(URL_PRUEBA, { method: 'POST', body: cuerpo, duplex: 'half', signal: retirada.signal });
    const pendiente = leerTextoLimitado(request);
    await lectura.promise;
    const motivo = new Motivo();
    retirada.abort(motivo);
    await assert.rejects(pendiente, (error: unknown) => error === motivo);
    assert.deepEqual(cancelaciones, [motivo]);
    assert.equal(request.body?.locked, false);
  });
}

test('el exceso cancela un flujo incompleto sin esperar a su cierre', async () => {
  let cancelaciones = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    start: (controlador) => controlador.enqueue(new Uint8Array(MAX_CUERPO_BYTES + 1)),
    cancel: () => {
      cancelaciones++;
    },
  });
  const request = peticion(cuerpo);
  await assert.rejects(leerTextoLimitado(request), /la petición es demasiado grande/);
  assert.equal(cancelaciones, 1);
  assert.equal(request.body?.locked, false);
});
