// Cancelación por petición: una consulta retirada no deja trabajo pendiente ni hereda otro trabajador.
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { OFERTA_POR_DEFECTO } from '../../compartido/contratos/oferta-de-formacion.ts';
import type { ContextoApi } from '../../src/api/contexto-api.ts';
import { PeticionCancelada } from '../../src/api/errores.ts';
import { dentroDelPlazo } from '../../src/api/plazo.ts';
import { cursosCon } from '../../src/api/rutas/cursos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { type AvisosDelTrabajador, crearPuertaEnTrabajador } from '../../src/plataforma/motor-de-cursos.ts';

const LIMITE_MS = 1000;
const CONSULTA = { hoy: '2026-10-26', oferta: OFERTA_POR_DEFECTO, filtros: {}, pagina: 1 };
function doble(preparado = true) {
  const inicio = Promise.withResolvers<void>();
  const primera = Promise.withResolvers<void>();
  const operaciones: { responder(): void }[] = [];
  let actual: AvisosDelTrabajador | undefined;
  let terminados = 0;
  const puerta = crearPuertaEnTrabajador(
    (avisos) => {
      actual = avisos;
      inicio.resolve();
      if (preparado) {
        queueMicrotask(() => avisos.mensaje({ tipo: 'listo' }));
      }
      return {
        enviar(mensaje) {
          if (mensaje.tipo !== 'operacion') {
            return;
          }
          operaciones.push({
            responder: () => avisos.mensaje({ tipo: 'hecho', id: mensaje.id, valor: { sintetico: true } }),
          });
          primera.resolve();
        },
        terminar() {
          terminados++;
        },
      };
    },
    { limiteCargaMs: LIMITE_MS, limiteOperacionMs: LIMITE_MS },
  );
  return {
    puerta,
    inicio: inicio.promise,
    primera: primera.promise,
    operaciones,
    listo: () => actual?.mensaje({ tipo: 'listo' }),
    terminados: () => terminados,
  };
}
function observar(promesa: Promise<unknown>) {
  let estado: unknown = 'pendiente';
  void promesa.then(
    () => {
      estado = 'resuelta';
    },
    (error) => {
      estado = error;
    },
  );
  return () => estado;
}

test('la retirada en cola rechaza inmediatamente y no manda la consulta cancelada al trabajador', async (t) => {
  const f = doble();
  t.after(() => f.puerta.cerrar());
  const primera = f.puerta.operar('catalogoDeCursos', [CONSULTA]);
  await f.primera;
  const retirada = new AbortController(),
    motivo = new Error('retirada sintética');
  const segunda = f.puerta.operar('catalogoDeCursos', [CONSULTA], { senal: retirada.signal });
  const estado = observar(segunda);
  retirada.abort(motivo);
  await setImmediate();
  assert.equal(estado(), motivo);
  assert.equal(getEventListeners(retirada.signal, 'abort').length, 0);
  assert.equal(f.operaciones.length, 1);
  f.operaciones[0]?.responder();
  assert.equal((await primera).disponible, true);
  await setImmediate();
  assert.equal(f.operaciones.length, 1);
});

test('la retirada durante la carga termina el trabajador y conserva el motivo sin mandar operaciones', async (t) => {
  const f = doble(false);
  t.after(() => f.puerta.cerrar());
  const retirada = new AbortController(),
    motivo = new Error('carga retirada');
  const estado = observar(f.puerta.operar('catalogoDeCursos', [CONSULTA], { senal: retirada.signal }));
  await f.inicio;
  retirada.abort(motivo);
  await setImmediate();
  assert.equal(estado(), motivo);
  assert.equal(getEventListeners(retirada.signal, 'abort').length, 0);
  assert.equal(f.terminados(), 1);
  assert.equal(f.operaciones.length, 0);
});

test('la retirada activa limpia el trabajador y una consulta posterior sin señal conserva su comportamiento', async (t) => {
  const f = doble();
  t.after(() => f.puerta.cerrar());
  const retirada = new AbortController(),
    motivo = new Error('operación retirada');
  const estado = observar(f.puerta.operar('catalogoDeCursos', [CONSULTA], { senal: retirada.signal }));
  await f.primera;
  retirada.abort(motivo);
  await setImmediate();
  assert.equal(estado(), motivo);
  assert.equal(getEventListeners(retirada.signal, 'abort').length, 0);
  assert.equal(f.terminados(), 1);
  const nueva = f.puerta.operar('catalogoDeCursos', [CONSULTA]);
  await setImmediate();
  assert.equal(f.operaciones.length, 2);
  f.operaciones[1]?.responder();
  assert.equal((await nueva).disponible, true);
});

test('cursosCon transmite la señal del plazo: retirar la segunda petición no activa trabajo en cola', async (t) => {
  const f = doble();
  t.after(() => f.puerta.cerrar());
  const ruta = cursosCon(f.puerta),
    url = new URL('http://localhost/api/cursos');
  const contexto = { datos: {}, oferta: OFERTA_POR_DEFECTO, origenesPermitidos: [] } as unknown as ContextoApi;
  const primera = ruta(contexto, new Request(url), url, []);
  await f.primera;
  const retirada = new AbortController();
  const segunda = dentroDelPlazo(
    (signal) => ruta(contexto, new Request(url, { signal }), url, []),
    LIMITE_MS,
    retirada.signal,
  );
  const estado = observar(segunda);
  await setImmediate();
  retirada.abort();
  await setImmediate();
  assert.ok(estado() instanceof PeticionCancelada);
  f.operaciones[0]?.responder();
  assert.equal((await primera).status, ESTADO_HTTP.correcto);
  await setImmediate();
  assert.equal(f.operaciones.length, 1);
});
