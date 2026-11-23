/** Fallos de la autoridad administrativa: indisponibilidad explícita y diagnóstico sin contenido privado. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearApi } from '../../src/api/api.ts';
import { capturarControles } from '../../src/api/controles-administrativos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

const DATOS = cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url)));

test('si los controles no se pueden leer, null y diagnóstico sin el mensaje privado', async (t) => {
  const registro = t.mock.method(console, 'error', () => {});
  const controles = await capturarControles(
    {
      leerControles: async () => {
        throw new Error('autoridad sintética caída');
      },
    },
    new AbortController().signal,
  );
  assert.equal(controles, null);
  assert.equal(registro.mock.callCount(), 1);
  const evento = JSON.parse(String(registro.mock.calls[0]?.arguments[0]));
  const { peticion, ...campos } = evento;
  assert.match(peticion, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u);
  assert.deepEqual(campos, {
    suceso: 'fallo operativo',
    operacion: 'controles',
    estado: 503,
    tipo: 'Error',
    codigo: null,
  });
  assert.doesNotMatch(JSON.stringify(evento), /autoridad sintética caída/);
});

test('una capacidad ajena al contrato administrativo se rechaza sin invocarla ni registrar su contenido', async (t) => {
  const registro = t.mock.method(console, 'error', () => {});
  let llamadas = 0;
  await assert.rejects(
    crearApi({
      datos: DATOS,
      origenesPermitidos: [],
      administracion: {
        leerControles: async () => ({ version: 2, revision: 0, api: 'deshabilitada', mcp: false, a2a: false }),
        ...{
          capacidadAjena: async () => {
            llamadas++;
            throw new TypeError('clave sintética sk-no-registrar');
          },
        },
      },
    }),
    { name: 'TypeError', message: 'Opciones de API no válidas' },
  );
  assert.equal(llamadas, 0);
  assert.equal(registro.mock.callCount(), 0);
});
