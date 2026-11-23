// El motor del dispositivo que no es el de esta versión (MotorQueNoCoincide, motor-local/cliente.js) se cuenta igual en
// cualquier petición del recorrido que pase por el transporte, también las de la clasificación oficial: con su
// explicación propia y sin «Volver a intentarlo». Cualquier otro fallo del motor sigue siendo el de siempre, que sí se
// puede reintentar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { ErrorFaro, motivoDelFallo, sePuedeReintentar } from '../../web/scripts/recorrido/api/errores.js';
import { preparar } from './ayudas.ts';
import { MotorQueNoCoincide } from './motor-local-doble.ts';

await cargarDiccionario('es');

/** Las claves del diccionario de los dos fallos del motor (api/errores.js). */
const NO_COINCIDE = 'recorrido.error.motor-no-coincide';
const MOTOR_LOCAL = 'recorrido.error.motor-local';
/** Lo que pide la clasificación oficial: un nivel (gruposHijos) y la ficha de un grupo (fichaDeGrupo). */
const RUTAS = ['/grupos?padre=', '/grupos?padre=51', '/grupos/5131'];

/** El fallo con que rechaza `pedir`, o un fallo de la prueba si no rechaza. */
async function fallo(promesa: Promise<unknown>): Promise<ErrorFaro> {
  const motivo = await promesa.then(
    () => assert.fail('La petición tenía que fallar'),
    (error: unknown) => error,
  );
  assert.ok(motivo instanceof ErrorFaro, `un ErrorFaro: ${String(motivo)}`);
  return motivo;
}

test('si el motor no es el de esta versión, la clasificación oficial lo cuenta con su explicación y sin reintento', async (t) => {
  t.mock.method(console, 'error', () => {});
  const p = await preparar(t, {
    responder: () => {
      throw new MotorQueNoCoincide('El motor del dispositivo no es el de esta versión');
    },
  });
  for (const ruta of RUTAS) {
    const error = await fallo(p.transporte.pedir(ruta));
    assert.equal(error.codigo, 0, ruta);
    assert.deepEqual(error.explicacion, { clave: NO_COINCIDE, valores: {} }, ruta);
    assert.equal(motivoDelFallo(error), 'motorQueNoCoincide', ruta);
    assert.equal(sePuedeReintentar(error), false, `${ruta}: no se ofrece «Volver a intentarlo»`);
  }
  assert.equal(p.locales.length, RUTAS.length, 'una sola petición al motor por cada una, sin reintentos');
});

test('otro fallo del motor del dispositivo sigue siendo el general, que se puede reintentar', async (t) => {
  t.mock.method(console, 'error', () => {});
  const p = await preparar(t, {
    responder: () => {
      throw new TypeError('El motor del dispositivo no ha podido responder');
    },
  });
  const error = await fallo(p.transporte.pedir('/grupos?padre='));
  assert.equal(error.codigo, 0);
  assert.deepEqual(error.explicacion, { clave: MOTOR_LOCAL, valores: {} });
  assert.equal(sePuedeReintentar(error), true);
});
