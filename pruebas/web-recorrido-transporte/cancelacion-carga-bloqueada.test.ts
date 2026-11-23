import './ayudas.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { esCancelacion, motivoDelFallo } from '../../web/scripts/recorrido/api/errores.js';
import { navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

/** El informe mínimo que el transporte admite como respuesta correcta de /informe. */
const HTML = '<p>Informe</p>';

const fuente = new URL('../../src/seguridad/privacidad.ts', import.meta.url).href;
const demorada = `import { limpiarDatosPersonales } from ${JSON.stringify(fuente)};
Reflect.get(globalThis, '__filtroBloqueadoIniciado')();
await Reflect.get(globalThis, '__filtroBloqueado');
throw new Error('Rechazo tardío del filtro controlado por la prueba');
export { limpiarDatosPersonales };`;
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (spec.endsWith('/web/motor/src/seguridad/privacidad.js')) {
      return { url: `data:text/javascript,${encodeURIComponent(demorada)}`, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});

const PLAZO_DEL_RECORRIDO_MS = 60_000;

test('plazo y cancelación terminan sin liberar la carga pendiente del filtro ni iniciar el Worker después', async (t) => {
  let avisar = () => {},
    liberar = () => {};
  const iniciada = new Promise<void>((ok) => {
    avisar = ok;
  });
  const bloqueo = new Promise<void>((ok) => {
    liberar = ok;
  });
  navegador(t, { __filtroBloqueadoIniciado: avisar, __filtroBloqueado: bloqueo });
  t.after(liberar);
  const plazos: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, PLAZO_DEL_RECORRIDO_MS);
    const controlador = new AbortController();
    plazos.push(controlador);
    return controlador.signal;
  });
  let llamadas = 0;
  fijarMotor(async () => {
    llamadas += 1;
    return Response.json({ html: HTML });
  });
  const { pedir, cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');
  const primera = pedir('/informe', { tareas: [{ texto: 'Organizo pedidos' }] }).then(
    () => 'exito',
    (error: unknown) => (esCancelacion(error) ? 'cancelada' : motivoDelFallo(error)),
  );
  await iniciada;
  plazos[0]?.abort(new DOMException('Plazo controlado', 'TimeoutError'));
  assert.equal(await Promise.race([primera, turno().then(() => 'pendiente')]), 'tarda');
  const segunda = pedir('/informe', { tareas: [{ texto: 'Reviso facturas' }] }).then(
    () => 'exito',
    (error: unknown) => (esCancelacion(error) ? 'cancelada' : motivoDelFallo(error)),
  );
  cancelarPeticiones();
  assert.equal(await Promise.race([segunda, turno().then(() => 'pendiente')]), 'cancelada');
  assert.equal(llamadas, 0);
  liberar();
  await turno();
  assert.equal(llamadas, 0);
});
