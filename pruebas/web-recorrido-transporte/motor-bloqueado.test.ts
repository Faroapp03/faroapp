// El motor del dispositivo que no arranca con la copia ya lista (MotorBloqueado, motor-local/cliente.js) se cuenta en
// cualquier petición que pase por el transporte, también las de la clasificación oficial, igual que en el paso de
// ocupación: con la explicación aprobada, «Faro no ha podido prepararse. Vuelve a intentarlo.», que se puede
// reintentar y no pide recargar la página ni perder lo hecho.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cargarDiccionario } from '../../web/idiomas/cargar.js';
import { ErrorFaro, motivoDelFallo, sePuedeReintentar } from '../../web/scripts/recorrido/api/errores.js';
import { preparar } from './ayudas.ts';
import { MotorBloqueado } from './motor-local-doble.ts';

await cargarDiccionario('es');

const ARRANQUE = 'recorrido.error.bloqueo';
const TEXTO = 'Faro no ha podido prepararse. Vuelve a intentarlo.';
/** Lo que pide la clasificación oficial: un nivel (gruposHijos) y la ficha de un grupo (fichaDeGrupo). */
const RUTAS = ['/grupos?padre=', '/grupos?padre=51', '/grupos/5131'];

test('si el motor no arranca, la clasificación oficial dice el texto aprobado y se puede volver a intentar', async (t) => {
  t.mock.method(console, 'error', () => {});
  const p = await preparar(t, {
    responder: () => {
      throw new MotorBloqueado('El motor del dispositivo no ha respondido a tiempo');
    },
  });
  for (const ruta of RUTAS) {
    const error = await p.transporte.pedir(ruta).then(
      () => assert.fail('La petición tenía que fallar'),
      (motivo: unknown) => motivo,
    );
    assert.ok(error instanceof ErrorFaro, `un ErrorFaro: ${String(error)}`);
    assert.equal(error.codigo, 0, ruta);
    assert.deepEqual(error.explicacion, { clave: ARRANQUE, valores: {} }, ruta);
    assert.equal(error.message, TEXTO, `${ruta}: sin pedir que se recargue la página`);
    assert.equal(motivoDelFallo(error), 'otro', ruta);
    assert.equal(sePuedeReintentar(error), true, `${ruta}: se ofrece «Volver a intentarlo»`);
  }
});
