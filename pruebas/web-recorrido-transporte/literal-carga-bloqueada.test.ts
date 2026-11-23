import './ayudas.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { setImmediate as turno } from 'node:timers/promises';
import { esCancelacion, motivoDelFallo } from '../../web/scripts/recorrido/api/errores.js';
import { navegador } from '../web-controles/ayudas.js';
import { fijarMotor } from './motor-local-doble.ts';

const fuente = new URL('../../src/seguridad/privacidad.ts', import.meta.url).href;
const demorada = `import { limpiarDatosPersonales } from ${JSON.stringify(fuente)};
Reflect.get(globalThis, '__filtroBloqueadoIniciado')();
await Reflect.get(globalThis, '__filtroBloqueado');
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

test('cancelar un literal termina sin liberar el filtro y una respuesta tardía no crea la tarea', async (t) => {
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
  fijarMotor(async () => assert.fail('Un literal no pide inferencia al Worker'));
  const { cancelarPeticiones } = await import('../../web/scripts/recorrido/api/transporte.js');
  const { tareasDeLoQueEscribe } = await import('../../web/scripts/recorrido/tareas-libres.js');
  const { estado } = await import('../../web/scripts/recorrido/estado.js');
  const id = estado.siguienteId;
  const pendiente = tareasDeLoQueEscribe('Reviso pedidos', 1).then(
    () => 'exito',
    (error: unknown) => (esCancelacion(error) ? 'cancelada' : motivoDelFallo(error)),
  );
  await iniciada;
  cancelarPeticiones();
  assert.equal(await Promise.race([pendiente, turno().then(() => 'pendiente')]), 'cancelada');
  assert.equal(plazos.length, 1);
  liberar();
  await turno();
  assert.equal(estado.siguienteId, id);
});
