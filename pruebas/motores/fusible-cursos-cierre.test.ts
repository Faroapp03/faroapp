/** El cierre explícito no reabre el trabajador ni deja cargas pendientes, incluso con datos averiados. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  anotarDatosDeCursosAveriados,
  crearPuertaEnTrabajador,
  puertaConSusDatos,
} from '../../src/plataforma/motor-de-cursos.ts';

function puertaSinResponder() {
  const cuenta = { lanzados: 0, terminados: 0 };
  const puerta = crearPuertaEnTrabajador(() => {
    cuenta.lanzados += 1;
    return {
      enviar: () => {},
      terminar: () => {
        cuenta.terminados += 1;
      },
    };
  });
  return { cuenta, puerta };
}
test('cerrar antes del primer uso no arranca trabajadores y todos los usos posteriores fallan', async () => {
  const { cuenta, puerta } = puertaSinResponder();
  puerta.cerrar();
  puerta.cerrar();
  const respuesta = await puerta.operar('catalogoDeCursos', [
    { hoy: '2026-10-21', oferta: { formacionAbierta: 'gratis', citilabDePago: false } },
  ]);
  assert.equal(respuesta.disponible, false);
  assert.match(!respuesta.disponible ? respuesta.detalle : '', /se ha cerrado/);
  assert.deepEqual(cuenta, { lanzados: 0, terminados: 0 });
});
test('cerrar durante la carga resuelve el pendiente y termina una sola vez; los datos conservan el cierre', async () => {
  const { cuenta, puerta } = puertaSinResponder();
  const pendiente = puerta.operar('catalogoDeCursos', [
    { hoy: '2026-10-21', oferta: { formacionAbierta: 'gratis', citilabDePago: false } },
  ]);
  await setImmediate();
  assert.equal(cuenta.lanzados, 1, 'La carga ha comenzado antes de probar su cierre');
  const datos = {};
  anotarDatosDeCursosAveriados(datos, 'fallo sintético');
  const protegida = puertaConSusDatos(puerta, datos);
  protegida.cerrar();
  protegida.cerrar();
  const respuesta = await pendiente;
  assert.equal(respuesta.disponible, false);
  assert.match(!respuesta.disponible ? respuesta.detalle : '', /se ha cerrado/);
  assert.equal(
    (
      await puerta.operar('catalogoDeCursos', [
        { hoy: '2026-10-21', oferta: { formacionAbierta: 'gratis', citilabDePago: false } },
      ])
    ).disponible,
    false,
  );
  assert.deepEqual(cuenta, { lanzados: 1, terminados: 1 });
});
