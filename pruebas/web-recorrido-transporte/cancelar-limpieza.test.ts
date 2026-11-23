import './ayudas.ts';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { navegador } from '../web-controles/ayudas.js';
import { preparar } from './ayudas.ts';

// Solo se demora la carga de la privacidad real, no se sustituye su función ni se permite red.
const fuente = new URL('../../src/seguridad/privacidad.ts', import.meta.url).href;
const demorada = `import { limpiarDatosPersonales } from ${JSON.stringify(fuente)};
Reflect.get(globalThis, '__cargaLimpiezaIniciada')();
await Reflect.get(globalThis, '__esperaLimpieza');
export { limpiarDatosPersonales };`;
registerHooks({
  resolve(spec, contexto, siguiente) {
    if (spec.endsWith('/web/motor/src/seguridad/privacidad.js')) {
      return { url: `data:text/javascript,${encodeURIComponent(demorada)}`, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});

test('abortar durante carga real del limpiador no envía texto al reanudarse', async (t) => {
  let reanudar = () => {},
    avisar = () => {};
  const espera = new Promise<void>((ok) => {
    reanudar = ok;
  });
  const iniciada = new Promise<void>((ok) => {
    avisar = ok;
  });
  navegador(t, { __esperaLimpieza: espera, __cargaLimpiezaIniciada: avisar });
  const p = await preparar(t);
  const pendiente = p.transporte.pedir('/informe', { tareas: [{ texto: 'Me llamo Laura Pérez y cobro.' }] });
  await iniciada;
  p.transporte.cancelarPeticiones();
  reanudar();
  await assert.rejects(pendiente, (e) => e instanceof Error && 'codigo' in e && e.codigo === 'cancelada');
  assert.deepEqual(p.peticiones, []);
  assert.deepEqual(p.locales, []);
});
