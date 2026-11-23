import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durableDeLaConstruccion } from './fixture.ts';

class Anterior {
  readonly estado: object;
  readonly entorno: object;
  constructor(estado: object, entorno: object) {
    this.estado = estado;
    this.entorno = entorno;
  }
}
class Nueva extends Anterior {}

test('el objeto durable sigue a la construcción servida y conserva el mismo almacén', () => {
  const estado = { storage: 'mismo almacén' };
  const entorno = { FARO_ADMINISTRACION: 'si' };
  let clase: typeof Anterior = Anterior;
  const durable = durableDeLaConstruccion(() => clase, estado, entorno);
  const primero = durable();
  assert.equal(primero.constructor, Anterior);
  assert.equal(durable(), primero, 'sin cambio de construcción, la misma instancia');
  clase = Nueva;
  const segundo = durable();
  assert.equal(segundo.constructor, Nueva, 'tras el cambio, la clase de la construcción nueva');
  assert.notEqual(segundo, primero);
  assert.equal(segundo.estado, estado, 'sobre el mismo almacén');
  assert.equal(segundo.entorno, entorno);
  assert.equal(durable(), segundo);
});
