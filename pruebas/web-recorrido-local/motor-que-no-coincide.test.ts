// Las peticiones del paso de ocupación al motor del dispositivo (recorrido/motor.js) cuando el motor no es el de esta
// versión (MotorQueNoCoincide): fallan en el acto con un ErrorFaro con su explicación propia, no con MotorNoListo (que
// el paso volvería a intentar), y la preparación se detiene: el aviso «Faro se está preparando…» se retira de la
// conversación (recorrido/preparacion.js). Un fallo de paso sigue siendo MotorNoListo y deja el aviso donde está.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { ErrorFaro } from '../../web/scripts/recorrido/api/errores.js';
import { fijarFallo, MotorQueNoCoincide, pedidas } from './cliente-del-motor-doble.ts';

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
const { pedir } = await import('../../web/scripts/recorrido/motor.js');
const { mostrarLaPreparacion } = await import('../../web/scripts/recorrido/preparacion.js');

/** El aviso «Faro se está preparando…» de la conversación, que anota si se retira. */
function aviso() {
  const visto = { retirado: false };
  const mensaje = {
    querySelector: () => null,
    remove: () => {
      visto.retirado = true;
    },
  };
  mostrarLaPreparacion(mensaje as unknown as HTMLElement);
  return visto;
}

/** El motivo con que rechaza `promesa`, o un fallo de la prueba si no rechaza. */
async function motivo(promesa: Promise<unknown>): Promise<unknown> {
  return promesa.then(
    () => assert.fail('La petición tenía que fallar'),
    (error: unknown) => error,
  );
}

test('un fallo de paso del motor es MotorNoListo y la preparación sigue con su aviso', async () => {
  const preparando = aviso();
  fijarFallo(new TypeError('El motor del dispositivo no ha podido responder'));
  const error = await motivo(pedir('paso', {}));
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'MotorNoListo');
  assert.equal(preparando.retirado, false);
});

test('si el motor no es el de esta versión, la petición falla con su explicación y la preparación se retira', async () => {
  const preparando = aviso();
  const antes = pedidas.length;
  fijarFallo(new MotorQueNoCoincide('El motor del dispositivo no es el de esta versión'));
  const error = await motivo(pedir('paso', {}));
  assert.ok(error instanceof ErrorFaro, `un ErrorFaro, no ${String(error)}`);
  assert.equal(error.codigo, 0);
  assert.deepEqual(error.explicacion, { clave: 'recorrido.error.motor-no-coincide', valores: {} });
  assert.equal(preparando.retirado, true, 'el aviso de que Faro se prepara ya no es verdad');
  assert.equal(pedidas.length, antes + 1, 'una sola petición');
  assert.equal(aviso().retirado, true, 'un aviso nuevo tampoco se queda mientras la preparación está detenida');
});
