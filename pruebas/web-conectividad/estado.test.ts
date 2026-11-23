import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConectividadNoComprobada,
  consultarConectividad,
  crearConsultaConectividad,
  leerEstadoConectividad,
} from '../../web/scripts/conectividad/estado.js';

import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';

const PLAZO_DE_CONSULTA_MS = 6000;
const CARACTERES_MULTIBYTE_EXCESIVOS = 3000;
const BYTE_UTF8_INVALIDO = 0xff;
const CIERRE_CUERPO_MS = 20;
const LECTURA = {
  version: 1,
  comprobadoEn: '2026-10-23T16:42:00.000Z',
  servicios: { mcp: true, api: false, a2a: false },
};
const respuesta = (dato: unknown = LECTURA) =>
  new Response(JSON.stringify(dato), { headers: { 'cache-control': 'no-store' } });
const pedir = (accion: () => Promise<Response>) => accion as typeof fetch;

test('solo booleans confirmados: las ocho combinaciones conservan el estado recibido', () => {
  for (const mcp of [false, true]) {
    for (const api of [false, true]) {
      for (const a2a of [false, true]) {
        const entrada = { ...LECTURA, servicios: { mcp, api, a2a } };
        assert.deepEqual(leerEstadoConectividad(entrada), entrada);
      }
    }
  }
  for (const dato of [
    {},
    [],
    { ...LECTURA, version: 2 },
    { ...LECTURA, servicios: { mcp: 0, api: false, a2a: false } },
    { ...LECTURA, comprobadoEn: '2026-02-30T00:00:00.000Z' },
    { ...LECTURA, servicios: { ...LECTURA.servicios, extra: true } },
  ]) {
    assert.throws(() => leerEstadoConectividad(dato), ConectividadNoComprobada);
  }
});

test('consulta pública sin caché ni redirección y con credenciales del mismo origen: no usa el indicador local como autoridad', async () => {
  const lectura = await consultarConectividad({
    pedir: (async (url, opciones) => {
      assert.ok(String(url).endsWith('/api/conectividad/estado'));
      assert.equal(opciones?.cache, 'no-store');
      assert.equal(opciones?.credentials, 'same-origin');
      assert.equal(opciones?.redirect, 'error');
      assert.equal(new Headers(opciones?.headers).get(CABECERA_CONTRATO), String(CONTRATO_API));
      assert.ok(opciones?.signal instanceof AbortSignal);
      return respuesta();
    }) as typeof fetch,
    enLinea: () => false,
  });
  assert.deepEqual(lectura, LECTURA, 'una respuesta real manda aunque navigator.onLine sea falso');
});

test('sin red, 503, cuerpo roto o respuesta cacheable nunca producen tres falsos apagados', async () => {
  const motivos = [
    {
      consulta: pedir(async () => {
        throw new TypeError('Red no disponible');
      }),
      enLinea: false,
      motivo: 'sin-conexion',
    },
    { consulta: pedir(async () => new Response('{}', { status: 503 })), enLinea: false, motivo: 'no-disponible' },
    {
      consulta: pedir(async () => new Response('{', { headers: { 'cache-control': 'no-store' } })),
      enLinea: true,
      motivo: 'no-disponible',
    },
    { consulta: pedir(async () => new Response(JSON.stringify(LECTURA))), enLinea: true, motivo: 'no-disponible' },
  ];
  for (const caso of motivos) {
    await assert.rejects(consultarConectividad({ pedir: caso.consulta, enLinea: () => caso.enLinea }), (error) => {
      assert.ok(error instanceof ConectividadNoComprobada);
      assert.equal(error.motivo, caso.motivo);
      return true;
    });
  }
});

test('una respuesta anterior no publica luces ni dirección tras otra consulta o retirar la página', async () => {
  let liberar = (_respuesta: Response) => {};
  const demorada = new Promise<Response>((resolver) => {
    liberar = resolver;
  });
  let llamadas = 0;
  const estados: Parameters<Parameters<typeof crearConsultaConectividad>[0]['alCambiar']>[0][] = [];
  const consulta = crearConsultaConectividad({
    pedir: pedir(() =>
      ++llamadas === 1
        ? demorada
        : Promise.resolve(respuesta({ ...LECTURA, servicios: { mcp: false, api: false, a2a: false } })),
    ),
    alCambiar: (estado) => estados.push(estado),
  });
  const antigua = consulta.comprobar();
  await consulta.comprobar();
  liberar(respuesta());
  await antigua;
  const ultima = estados.at(-1);
  assert.equal(ultima?.estado, 'confirmado');
  assert.ok(ultima?.estado === 'confirmado');
  assert.equal(ultima.lectura.servicios.mcp, false);
  const cantidad = estados.length;
  consulta.retirar();
  await consulta.comprobar();
  assert.equal(estados.length, cantidad);
});

test('el error de programación se muestra como no comprobado y sigue rechazándose, sin disfrazarlo de red', async () => {
  const fallo = new Error('Fallo interno del ensayo');
  const estados: string[] = [];
  const consulta = crearConsultaConectividad({
    pedir: pedir(async () => {
      throw fallo;
    }),
    alCambiar: (e) => estados.push(e.estado),
  });
  await assert.rejects(consulta.comprobar(), (error) => error === fallo);
  assert.deepEqual(estados, ['consultando', 'no-disponible']);
});

test('el plazo de consulta también corta un cuerpo que no termina', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const promesa = consultarConectividad({
    pedir: (async (_url, opciones) => {
      const cuerpo = new ReadableStream<Uint8Array>({
        start(control) {
          opciones?.signal?.addEventListener(
            'abort',
            () => control.error(new DOMException('Cuerpo cortado', 'AbortError')),
            { once: true },
          );
        },
      });
      return new Response(cuerpo, { headers: { 'cache-control': 'no-store' } });
    }) as typeof fetch,
    enLinea: () => true,
  });
  await Promise.resolve();
  t.mock.timers.tick(PLAZO_DE_CONSULTA_MS);
  await assert.rejects(promesa, ConectividadNoComprobada);
});

test('el límite se aplica a bytes antes de acumular y cancela el cuerpo demasiado grande', async () => {
  let cancelaciones = 0;
  let cierre: ReturnType<typeof setTimeout>;
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      control.enqueue(new TextEncoder().encode('é'.repeat(CARACTERES_MULTIBYTE_EXCESIVOS)));
      cierre = setTimeout(() => control.close(), CIERRE_CUERPO_MS);
    },
    cancel() {
      clearTimeout(cierre);
      cancelaciones++;
    },
  });
  await assert.rejects(
    consultarConectividad({
      pedir: pedir(async () => new Response(cuerpo, { headers: { 'cache-control': 'no-store' } })),
      enLinea: () => true,
    }),
    ConectividadNoComprobada,
  );
  assert.equal(cancelaciones, 1);
  assert.equal(cuerpo.locked, false);
});

test('lee UTF-8 repartido entre bloques y rechaza una secuencia inválida sin dejar el lector bloqueado', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(LECTURA));
  const cuerpo = new ReadableStream<Uint8Array>({
    start(control) {
      for (const byte of bytes) {
        control.enqueue(new Uint8Array([byte]));
      }
      control.close();
    },
  });
  assert.deepEqual(
    await consultarConectividad({
      pedir: pedir(async () => new Response(cuerpo, { headers: { 'cache-control': 'no-store' } })),
    }),
    LECTURA,
  );
  assert.equal(cuerpo.locked, false);
  await assert.rejects(
    consultarConectividad({
      pedir: pedir(
        async () => new Response(new Uint8Array([BYTE_UTF8_INVALIDO]), { headers: { 'cache-control': 'no-store' } }),
      ),
    }),
    ConectividadNoComprobada,
  );
});
