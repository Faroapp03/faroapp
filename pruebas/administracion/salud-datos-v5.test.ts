/** La ayuda compartida produce estados v5 por defecto y conserva la v4 con su propio campo. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leerEstadoDatosPanel } from '../../src/administracion/estado-datos.js';
import { instantaneaSalud, instantaneaSaludV4 } from '../ayudas/salud-datos.ts';

const VERSION_ACTUAL = 5;
const VERSION_HISTORICA = 4;
const NO_VALIDO = { message: 'Estado de datos del panel no válido' };

test('el estado por defecto es v5 y lleva la revisión pendiente sin el campo de la v4', () => {
  const actual = instantaneaSalud({ formacionAbiertaRevisionPendiente: '2027-01-05' });
  const observacion = leerEstadoDatosPanel(actual);
  assert.equal(observacion.version, VERSION_ACTUAL);
  // Estrecha el tipo a v5: el campo de revisión pendiente solo existe en esa versión.
  assert.ok(observacion.version === VERSION_ACTUAL);
  assert.equal(observacion.formacionAbiertaRevisionPendiente, '2027-01-05');
  assert.equal(Object.hasOwn(observacion, 'formacionAbiertaCaduca'), false);
  assert.deepEqual(observacion, actual);
  assert.equal(instantaneaSalud().formacionAbiertaRevisionPendiente, null);
  const { formacionAbiertaRevisionPendiente: _revision, ...sinRevision } = actual;
  assert.throws(() => leerEstadoDatosPanel(sinRevision), NO_VALIDO);
  assert.throws(() => leerEstadoDatosPanel({ ...actual, formacionAbiertaCaduca: null }), NO_VALIDO);
});

test('el estado v4 pedido por su nombre conserva su campo y sus valores', () => {
  const historica = instantaneaSaludV4({ formacionAbiertaCaduca: '2026-11-01' });
  const observacion = leerEstadoDatosPanel(historica);
  assert.equal(observacion.version, VERSION_HISTORICA);
  // Estrecha el tipo a v4, la última versión con `formacionAbiertaCaduca`.
  assert.ok(observacion.version === VERSION_HISTORICA);
  assert.equal(observacion.formacionAbiertaCaduca, '2026-11-01');
  assert.equal(Object.hasOwn(observacion, 'formacionAbiertaRevisionPendiente'), false);
  assert.deepEqual(observacion, historica);
  assert.throws(() => leerEstadoDatosPanel({ ...historica, formacionAbiertaRevisionPendiente: null }), NO_VALIDO);
});
