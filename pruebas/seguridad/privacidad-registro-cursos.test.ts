import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContextoApi } from '../../src/api/contexto-api.ts';
import { responderSinMotorDeCursos } from '../../src/api/rutas/cursos.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';

test('el fallo de cursos no registra ni devuelve detalles del servicio', async (t) => {
  const avisos = t.mock.method(console, 'warn', () => {});
  const marcador = 'marcador-sintetico-privado';
  const respuesta = responderSinMotorDeCursos(
    { origenesPermitidos: [] } as unknown as ContextoApi,
    new Request('https://ejemplo.invalid/api/cursos'),
    { disponible: false, motivo: 'averiado', detalle: marcador },
    'Los cursos',
  );
  assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
  assert.doesNotMatch(
    JSON.stringify(avisos.mock.calls.map((llamada) => llamada.arguments)),
    /marcador-sintetico-privado/,
  );
  assert.doesNotMatch(await respuesta.text(), /marcador-sintetico-privado/);
});
