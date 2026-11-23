// Un registro del service worker fallido no se arregla con reintentos automáticos de la misma petición.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { SinServiceWorker } from '../../web/scripts/paquete-sin-conexion.js';
import { ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';
import { fijarFallo, pedidas } from './cliente-del-motor-doble.ts';

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.includes('/web/scripts/recorrido/') && spec === '../motor-local/cliente.js') {
      return { url: new URL('./cliente-del-motor-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { baseURI: 'https://faro.example/recorrido.html' },
});
const { pedirMientrasSePrepara } = await import('../../web/scripts/recorrido/espera-del-motor.js');
const { salidasTrasElFallo } = await import('../../web/scripts/recorrido/reparar.js');
const { mostrarLaPreparacion } = await import('../../web/scripts/recorrido/preparacion.js');

test('sin registro del service worker, se retira el aviso y el paso falla sin reintentos automáticos', async () => {
  const visto = { retirado: false, pausas: 0 };
  mostrarLaPreparacion({
    querySelector: () => null,
    remove: () => {
      visto.retirado = true;
    },
  } as unknown as HTMLElement);
  fijarFallo(new SinServiceWorker('No hay service worker'));
  const antes = pedidas.length;
  let fallo: unknown;
  await assert.rejects(
    pedirMientrasSePrepara(
      'paso',
      {},
      {
        esperar: async () => {
          visto.pausas += 1;
        },
      },
    ),
    (error: unknown) => {
      fallo = error;
      return (
        error instanceof ErrorFaro &&
        JSON.stringify(error.explicacion) ===
          JSON.stringify({ clave: 'recorrido.error.sin-service-worker', valores: {} })
      );
    },
  );
  assert.equal(pedidas.length - antes, 1);
  assert.equal(visto.pausas, 0);
  assert.equal(visto.retirado, true);
  let recargas = 0;
  const salidas = salidasTrasElFallo(fallo, [{ texto: 'Volver a intentarlo', accion: () => {} }], {
    recargar: () => {
      recargas += 1;
    },
  });
  assert.equal(salidas.length, 1);
  const salida = salidas[0];
  assert.ok(salida?.accion);
  assert.deepEqual(salida.texto, { clave: 'recorrido.sin-textos.recargar', valores: {} });
  salida.accion();
  assert.equal(recargas, 1);
});

test('sin la API del navegador, explica la incompatibilidad y no ofrece recargar', async () => {
  const { ServiceWorkerNoDisponible } = await import('../../web/scripts/paquete-sin-conexion.js');
  fijarFallo(new ServiceWorkerNoDisponible('El navegador no ofrece service workers'));
  const antes = pedidas.length;
  let fallo: unknown;
  await assert.rejects(
    pedirMientrasSePrepara('paso', {}, { esperar: async () => assert.fail('no reintenta') }),
    (error: unknown) => {
      fallo = error;
      return (
        error instanceof ErrorFaro &&
        JSON.stringify(error.explicacion) ===
          JSON.stringify({ clave: 'recorrido.error.service-worker-no-disponible', valores: {} })
      );
    },
  );
  assert.equal(pedidas.length - antes, 1);
  assert.deepEqual(salidasTrasElFallo(fallo, []), []);
});

test('la ausencia real de la API produce el fallo de incompatibilidad', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const { estadoDelPaquete, ServiceWorkerNoDisponible } = await import('../../web/scripts/paquete-sin-conexion.js');
    await assert.rejects(estadoDelPaquete(), ServiceWorkerNoDisponible);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'navigator', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
});
