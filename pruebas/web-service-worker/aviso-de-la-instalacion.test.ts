// La instalación del service worker que falla porque un archivo comprobado no es el de esta versión, vista desde el
// recorrido (recorrido/motor.js): scripts/instalacion.js lo cuenta con una marca en <html> y un evento, y la petición
// al motor, que esperaría a un service worker que no va a llegar, falla en el acto con la explicación de la primera
// visita (recorrido.error.instalacion-no-coincide: no hay nada guardado que borrar, a diferencia de la copia guardada
// que no coincide), y la preparación se retira. Sin esa señal, la petición sigue esperando y no deja oyentes al acabar.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  ErrorFaro,
  esInstalacionQueNoCoincide,
  esMotorQueNoCoincide,
} from '../../web/scripts/recorrido/api/errores.js';
import { pedidas, responderTodas } from './cliente-que-espera-doble.ts';

const EVENTO = 'faro-instalacion-no-coincide';
const MARCA = 'instalacionNoCoincide';
/** Lo que se espera a ver si una petición sigue sin acabar. */
const UN_MOMENTO_MS = 30;

registerHooks({
  resolve(spec, contexto, siguiente) {
    if (contexto.parentURL?.includes('/web/scripts/recorrido/') && spec === '../motor-local/cliente.js') {
      return { url: new URL('./cliente-que-espera-doble.ts', import.meta.url).href, shortCircuit: true };
    }
    return siguiente(spec, contexto);
  },
});
const dataset: Record<string, string> = {};
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { baseURI: 'https://faro.example/recorrido.html', documentElement: { dataset } },
});
/** Los eventos de la ventana, con los oyentes que quedan puestos. */
const ventana = new EventTarget();
const oyentes = new Set<unknown>();
Object.assign(globalThis, {
  addEventListener: (tipo: string, oyente: EventListener, opciones?: AddEventListenerOptions) => {
    oyentes.add(oyente);
    ventana.addEventListener(tipo, oyente, opciones);
  },
  removeEventListener: (tipo: string, oyente: EventListener) => {
    oyentes.delete(oyente);
    ventana.removeEventListener(tipo, oyente);
  },
});
const { pedir } = await import('../../web/scripts/recorrido/motor.js');
const { mostrarLaPreparacion } = await import('../../web/scripts/recorrido/preparacion.js');

/** El aviso «Faro se está preparando…» de la conversación, que anota si se retira. */
function aviso() {
  const visto = { retirado: false };
  mostrarLaPreparacion({ querySelector: () => null, remove: () => (visto.retirado = true) } as unknown as HTMLElement);
  return visto;
}

/** Cómo ha acabado `promesa` en UN_MOMENTO_MS: su error, «respondida» o «esperando». */
function enUnMomento(promesa: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promesa.then(
      () => 'respondida',
      (error: unknown) => error,
    ),
    new Promise((listo) => setTimeout(() => listo('esperando'), UN_MOMENTO_MS)),
  ]);
}

/** Exige la explicación de la instalación que no coincide, la de una primera visita. */
function esElAviso(error: unknown): void {
  assert.ok(error instanceof ErrorFaro, `un ErrorFaro, no ${String(error)}`);
  assert.equal(error.codigo, 0);
  assert.deepEqual(error.explicacion, { clave: 'recorrido.error.instalacion-no-coincide', valores: {} });
  assert.equal(esInstalacionQueNoCoincide(error), true);
  assert.equal(esMotorQueNoCoincide(error), true, 'tampoco se reintenta ni se ofrece nada que use el motor');
}

test('sin la señal de la instalación, la petición espera al motor y no deja oyentes al acabar', async () => {
  const peticion = pedir('paso', {});
  assert.equal(await enUnMomento(peticion), 'esperando');
  responderTodas();
  assert.deepEqual(await peticion, {});
  assert.equal(oyentes.size, 0);
});

test('si la instalación no coincide mientras se espera, la petición falla en el acto con su aviso', async () => {
  const preparando = aviso();
  const peticion = pedir('paso', {});
  assert.equal(await enUnMomento(peticion), 'esperando');
  dataset[MARCA] = '';
  ventana.dispatchEvent(new Event(EVENTO));
  esElAviso(await enUnMomento(peticion));
  assert.equal(preparando.retirado, true, 'el aviso de que Faro se prepara ya no es verdad');
  assert.equal(oyentes.size, 0);
  responderTodas();
});

test('con la instalación ya marcada, la petición siguiente falla en el acto sin esperar', async () => {
  const antes = pedidas.length;
  esElAviso(await enUnMomento(pedir('paso', {})));
  assert.equal(pedidas.length, antes + 1, 'una sola petición');
  assert.equal(oyentes.size, 0);
  responderTodas();
});
