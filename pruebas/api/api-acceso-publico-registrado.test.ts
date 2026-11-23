/** Un fallo operativo conserva diagnóstico estructurado sin copiar credenciales ni mensajes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccesoPublicoNoDisponible, operacionPublica } from '../../src/api/socios/acceso-publico.ts';

test('el fallo de una operación pública queda en el registro con su tipo y sin su mensaje', async (t) => {
  const registro = t.mock.method(console, 'error', () => {});
  await assert.rejects(
    operacionPublica(async () => {
      throw new RangeError('token sintético tk-no-registrar');
    }),
    AccesoPublicoNoDisponible,
  );
  assert.equal(registro.mock.callCount(), 1);
  const evento = JSON.parse(String(registro.mock.calls[0]?.arguments[0]));
  const { peticion, ...campos } = evento;
  assert.match(peticion, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  assert.deepEqual(campos, {
    suceso: 'fallo operativo',
    operacion: 'registro-conectividad',
    estado: 503,
    tipo: 'RangeError',
    codigo: null,
  });
  assert.doesNotMatch(JSON.stringify(evento), /tk-no-registrar|token sintético/);
});
