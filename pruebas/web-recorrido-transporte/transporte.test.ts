import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { completarAbortSignal } from '../../web/scripts/compatibilidad.js';
import { CABECERA_CONTRATO, CONTRATO_API } from '../../web/scripts/protocolo-web.js';
import { esCancelacion, motivoDelFallo } from '../../web/scripts/recorrido/api/errores.js';
import { preparar } from './ayudas.ts';

/** El informe mínimo que el transporte admite como respuesta correcta de /informe. */
const HTML = '<p>Informe</p>';

await cargarDiccionario('es');
const CABECERA_SESION = 'x-faro-sesion';
const CABECERA_TURNSTILE = 'x-faro-turnstile';
const TEXTO = 'Me llamo Laura Pérez y mi correo es laura@example.invalid. Atiendo pedidos.';
const CORRECTO = 200,
  CONFLICTO = 409,
  DEMASIADAS = 429;

test('Worker local: JSON/contrato y datos personales reconocidos filtrados antes de procesar', async (t) => {
  const p = await preparar(t);
  await p.transporte.pedir('/informe', { tareas: [{ texto: TEXTO }], idioma: 'es' });
  assert.equal(p.locales.length, 1);
  const [enviada] = p.locales;
  assert.ok(enviada);
  assert.equal(enviada.opciones.mode, 'same-origin');
  assert.equal(enviada.opciones.method, 'POST');
  assert.equal(new Headers(enviada.opciones.headers).get(CABECERA_CONTRATO), String(CONTRATO_API));
  assert.doesNotMatch(String(enviada.opciones.body), /Laura|Pérez|laura@example/);
  assert.match(String(enviada.opciones.body), /Atiendo pedidos/);
});

test('el cuerpo queda en transporte local sin token ni petición de texto al servidor', async (t) => {
  const p = await preparar(t);
  await p.transporte.pedir('/informe', { tareas: [{ texto: TEXTO }] });
  assert.deepEqual(p.peticiones, []);
  assert.equal(p.locales.length, 1);
  const local = p.locales[0];
  assert.ok(local);
  assert.doesNotMatch(String(local.opciones.body), /Laura|Pérez|laura@example/);
  assert.equal(new Headers(local.opciones.headers).get(CABECERA_TURNSTILE), null);
  assert.equal(p.cabeza.children.length, 0);
});

test('respuesta inválida o contrato distinto se rechaza, no se convierte en éxito', async (t) => {
  const respuestas = [
    new Response('no-json'),
    Response.json([]),
    Response.json({}),
    Response.json({ html: HTML }, { headers: { [CABECERA_CONTRATO]: 'otro' } }),
  ];
  const p = await preparar(t, {
    responder: () => {
      const r = respuestas.shift();
      assert.ok(r);
      return r;
    },
  });
  for (const codigo of [CORRECTO, CORRECTO, CORRECTO, CONFLICTO]) {
    await assert.rejects(p.transporte.pedir('/informe', { tareas: [{ texto: 'Cobro' }] }), (e) => {
      assert.ok(e instanceof Error && 'codigo' in e);
      assert.equal(e.codigo, codigo);
      return true;
    });
  }
});

test('cancelar durante JSON no recuerda un pase tardío ni entrega datos de la conversación retirada', async (t) => {
  let controlador: ReadableStreamDefaultController<Uint8Array> | undefined;
  const cuerpo = new ReadableStream<Uint8Array>({
    start(c) {
      controlador = c;
    },
  });
  const respuesta = new Response(cuerpo, { headers: { [CABECERA_SESION]: 'tardio' } });
  let llamadas = 0;
  const p = await preparar(t, {
    responder: () => (++llamadas === 1 ? respuesta : Response.json({ html: HTML })),
  });
  const pendiente = p.transporte.pedir('/informe', { tareas: [{ texto: 'Cobro' }] });
  await turno();
  p.transporte.cancelarPeticiones();
  assert.ok(controlador);
  controlador.enqueue(new TextEncoder().encode(JSON.stringify({ html: HTML })));
  controlador.close();
  await assert.rejects(pendiente, esCancelacion);
  // La petición nueva no debe llevar el pase de la lectura retirada.
  await p.transporte.pedir('/informe', { tareas: [{ texto: 'Repongo' }] });
  assert.equal(new Headers(p.locales[1]?.opciones.headers).get(CABECERA_SESION), null);
});

test('cancelar antes del envío: fetch respeta señal abortada y ningún texto sale', async (t) => {
  const p = await preparar(t);
  // Un GET anterior deja modo/configuración ya resueltos. La limpieza se espera en otro microturno.
  await p.transporte.pedir('/grupos?padre=');
  p.locales.length = 0;
  const pendiente = p.transporte.pedir('/informe', { tareas: [{ texto: TEXTO }] });
  queueMicrotask(() => p.transporte.cancelarPeticiones());
  await assert.rejects(pendiente, esCancelacion);
  assert.deepEqual(p.locales, []);
});

test('una respuesta ajena al motor local no inventa un límite de red ni bloquea la siguiente consulta', async (t) => {
  let llamadas = 0;
  const p = await preparar(t, {
    responder: () =>
      ++llamadas === 1
        ? Response.json({}, { status: DEMASIADAS, headers: { 'retry-after': '3600' } })
        : Response.json({ hijos: [] }),
  });
  await assert.rejects(p.transporte.pedir('/grupos?padre='), (e) => motivoDelFallo(e) === 'otro');
  assert.deepEqual(await p.transporte.pedir('/grupos?padre='), { hijos: [] });
  assert.equal(p.locales.length, 2);
  assert.deepEqual(p.peticiones, []);
});

test('con el relleno de AbortSignal.any, cada petición retira sus oyentes de la cancelación al terminar', async (t) => {
  const relleno = { timeout: AbortSignal.timeout } as unknown as typeof AbortSignal;
  completarAbortSignal(relleno);
  t.mock.method(AbortSignal, 'any', relleno.any);
  const p = await preparar(t);
  const cancelacion = p.transporte.senalDeCancelacion();
  await p.transporte.pedir('/informe', { tareas: [{ texto: 'Cobro' }] });
  await p.transporte.pedir('/grupos?padre=');
  assert.equal(getEventListeners(cancelacion, 'abort').length, 0);
});
