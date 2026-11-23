import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { errorDeCancelacion, esCancelacion } from '../../web/scripts/recorrido/api/errores.js';
import { olvidarLlamadas, unaVez } from '../../web/scripts/recorrido/memoria-llamadas.js';

beforeEach(olvidarLlamadas);

test('dos lectores comparten la promesa pendiente; claves de idioma distintas no comparten respuesta', async () => {
  const pendiente = Promise.withResolvers<string>();
  let llamadas = 0;
  const pedir = () => {
    llamadas += 1;
    return pendiente.promise;
  };
  const primera = unaVez('grupo:es', pedir);
  assert.equal(unaVez('grupo:es', pedir), primera);
  assert.equal(llamadas, 1);
  assert.equal(await unaVez('grupo:ca', async () => 'català'), 'català');
  pendiente.resolve('castellano');
  assert.equal(await primera, 'castellano');
});

test('rechazo y cancelación se retiran y permiten reintentar la misma clave', async () => {
  for (const error of [new Error('Fallo sintético'), errorDeCancelacion()]) {
    await assert.rejects(
      unaVez('clave', async () => Promise.reject(error)),
      (recibido) => recibido === error,
    );
    assert.equal(await unaVez('clave', async () => 'recuperada'), 'recuperada');
    olvidarLlamadas();
  }
  assert.equal(esCancelacion(errorDeCancelacion()), true);
});

test('el cierre tardío de la conversación anterior no borra la respuesta de la nueva', async () => {
  for (const falla of [false, true]) {
    olvidarLlamadas();
    const retirada = Promise.withResolvers<string>();
    const vieja = unaVez('misma', () => retirada.promise);
    const observada = vieja.catch(() => 'retirada');
    olvidarLlamadas();
    const nueva = unaVez('misma', async () => 'actual');
    if (falla) {
      retirada.reject(errorDeCancelacion());
    } else {
      retirada.resolve('anterior');
    }
    await observada;
    assert.equal(await nueva, 'actual');
    assert.equal(await unaVez('misma', async () => 'no debe pedirse'), 'actual');
  }
});

test('el tope de 64 respuestas retira la más antigua y conserva las otras, sin almacenar de forma persistente', async () => {
  const tope = 64;
  const pedidas: string[] = [];
  const pedir = (clave: string) => unaVez(clave, async () => pedidas.push(clave));
  for (let i = 0; i <= tope; i += 1) {
    await pedir(`clave-${i}`);
  }
  await pedir('clave-1');
  await pedir(`clave-${tope}`);
  assert.equal(pedidas.length, tope + 1);
  await pedir('clave-0');
  assert.equal(pedidas.at(-1), 'clave-0');
});
