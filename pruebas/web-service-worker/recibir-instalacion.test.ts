// El resultado que llega de otro dispositivo (otro-dispositivo/recibir.js) pide sus fichas y su informe al motor del
// dispositivo como los demás consumidores: si la instalación del service worker no coincide (la señal de
// scripts/instalacion.js, recorrido/instalacion-que-no-coincide.js), no espera al motor, que esperaría a un service
// worker que no va a llegar: falla con la explicación de la primera visita.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.includes('/web/scripts/') && spec.endsWith('motor-local/cliente.js')) {
      return { url: new URL('./cliente-que-espera-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: {
    baseURI: 'https://faro.example/recorrido.html',
    documentElement: { dataset: { instalacionNoCoincide: '' } },
  },
});
const { codificar } = await import('../../web/scripts/otro-dispositivo/formato.js');
const { informeDelCodigo } = await import('../../web/scripts/otro-dispositivo/recibir.js');
const { pedidas } = await import('./cliente-que-espera-doble.ts');

const RESULTADO = {
  idioma: 'es' as const,
  isco08: '7512',
  fecha: '2026-10-14',
  tareas: [{ tareaOit: '7512-1', tiempo: 'algo' as const }],
  sinViajar: 0,
};

test('con la instalación que no coincide, el informe recibido falla en el acto con su explicación', async () => {
  const error = await informeDelCodigo(codificar(RESULTADO), { signal: new AbortController().signal }).then(
    () => assert.fail('tenía que fallar'),
    (motivo: unknown) => motivo,
  );
  assert.ok(error instanceof ErrorFaro, `un ErrorFaro, no ${String(error)}`);
  assert.deepEqual(error.explicacion, { clave: 'recorrido.error.instalacion-no-coincide', valores: {} });
  assert.equal(pedidas.length, 1, 'una sola petición, que no se espera');
});
