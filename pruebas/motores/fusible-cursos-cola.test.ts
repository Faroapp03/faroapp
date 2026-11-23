// Cada operación obtiene su propio plazo al salir de la cola; el cierre no abre trabajadores nuevos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { OFERTA_POR_DEFECTO } from '../../compartido/contratos/oferta-de-formacion.ts';
import { type AvisosDelTrabajador, crearPuertaEnTrabajador } from '../../src/plataforma/motor-de-cursos.ts';
import type { MensajeAlTrabajador } from '../../src/plataforma/operaciones-de-cursos.ts';

/** Mayor que el plazo de cálculo (50 ms), menor que el de la operación anterior (1000 ms). */
const ESPERA_EN_COLA_MS = 100;

type Operacion = Extract<MensajeAlTrabajador, { tipo: 'operacion' }>;
/** Un transporte controlado: no responde hasta que la prueba resuelve la carga o el cálculo. */
function transporte() {
  const trabajadores: { avisos: AvisosDelTrabajador; enviados: Operacion[]; terminado: boolean }[] = [];
  const puerta = crearPuertaEnTrabajador(
    (avisos) => {
      const estado = { avisos, enviados: [] as Operacion[], terminado: false };
      trabajadores.push(estado);
      queueMicrotask(() => avisos.mensaje({ tipo: 'listo' }));
      return {
        enviar: (mensaje) => {
          if (mensaje.tipo === 'operacion') {
            estado.enviados.push(mensaje);
          }
        },
        terminar: () => {
          estado.terminado = true;
        },
      };
    },
    { limiteOperacionMs: 50 },
  );
  function responder(trabajador: number, indice: number) {
    const estado = trabajadores[trabajador];
    const pedido = estado?.enviados[indice];
    assert(estado && pedido, 'La operación se ha mandado al trabajador');
    estado.avisos.mensaje({ tipo: 'hecho', id: pedido.id, valor: null });
  }
  return { puerta, trabajadores, responder };
}

test('la operación en cola espera la anterior y empieza después su propio plazo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { puerta, trabajadores, responder } = transporte();
  t.after(() => puerta.cerrar());
  const anterior = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }], {
    limiteMs: 1000,
  });
  await setImmediate();
  const corta = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  await setImmediate();
  t.mock.timers.tick(ESPERA_EN_COLA_MS);
  await setImmediate();
  assert.equal(trabajadores.length, 1);
  assert.equal(trabajadores[0]?.terminado, false);
  assert.equal(trabajadores[0]?.enviados.length, 1);
  responder(0, 0);
  assert.equal((await anterior).disponible, true);
  await setImmediate();
  responder(0, 1);
  assert.equal((await corta).disponible, true);
});

test('una operación colgada vence y la que esperaba se ejecuta en un trabajador nuevo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { puerta, trabajadores, responder } = transporte();
  t.after(() => puerta.cerrar());
  const colgada = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  const siguiente = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  await setImmediate();
  t.mock.timers.tick(60);
  const fallo = await colgada;
  assert.equal(fallo.disponible, false);
  assert.equal(!fallo.disponible && fallo.motivo, 'bloqueado');
  await setImmediate();
  assert.equal(trabajadores[0]?.terminado, true);
  assert.equal(trabajadores.length, 2);
  responder(1, 0);
  assert.equal((await siguiente).disponible, true);
});

test('cerrar retira la operación activa y resuelve la cola sin abrir otro trabajador', async (t) => {
  const { puerta, trabajadores } = transporte();
  t.after(() => puerta.cerrar());
  const activa = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  const enCola = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  await setImmediate();
  puerta.cerrar();
  assert.equal((await activa).disponible, false);
  assert.equal((await enCola).disponible, false);
  assert.equal(trabajadores.length, 1);
  assert.equal(trabajadores[0]?.terminado, true);
});

test('cerrar al recibir el resultado no manda la operación en cola al trabajador retirado', async (t) => {
  const { puerta, trabajadores, responder } = transporte();
  t.after(() => puerta.cerrar());
  const primera = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  const siguiente = puerta.operar('catalogoDeCursos', [{ hoy: '2026-10-21', oferta: OFERTA_POR_DEFECTO }]);
  await setImmediate();
  responder(0, 0);
  puerta.cerrar();
  assert.equal((await primera).disponible, true);
  const respuesta = await siguiente;
  assert(!respuesta.disponible);
  assert.equal(respuesta.motivo, 'averiado');
  assert.match(respuesta.detalle, /se ha cerrado/u);
  assert.equal(trabajadores.length, 1);
  assert.equal(trabajadores[0]?.enviados.length, 1, 'No se envía nada después del cierre');
});
