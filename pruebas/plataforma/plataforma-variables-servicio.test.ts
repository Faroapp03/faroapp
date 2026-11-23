/** Perfil cerrado de datos y seguridad; nunca ignora opciones ajenas ni muestra sus valores. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ErrorDeProcesamiento } from '../../src/comun/error-de-procesamiento.ts';
import { ErrorDeConfiguracion, opcionesDelEntorno } from '../../src/plataforma/configuracion.ts';
import { variablesDelServicio } from '../../src/plataforma/variables-del-servicio.ts';

test('el perfil cerrado conserva las comprobaciones de configuración de los servicios', () => {
  assert.throws(() => opcionesDelEntorno(variablesDelServicio({ FARO_API_SOCIOS: 'si' })), ErrorDeConfiguracion);
  assert.throws(() => opcionesDelEntorno(variablesDelServicio({ FARO_MCP: 'sí' })), ErrorDeConfiguracion);
});

test('las opciones desconocidas fallan sin repetir nombres ni valores recibidos', () => {
  const originales = Object.freeze({ FARO_OPCION_DESCONOCIDA: 'valor-sintetico-confidencial' });
  assert.throws(
    () => variablesDelServicio(originales),
    (error: unknown) => {
      assert.ok(error instanceof ErrorDeProcesamiento);
      assert.doesNotMatch(error.message, /FARO_OPCION_DESCONOCIDA|valor-sintetico-confidencial/);
      return true;
    },
  );
  assert.equal(originales.FARO_OPCION_DESCONOCIDA, 'valor-sintetico-confidencial');
});

test('conserva todas las opciones vigentes de datos y seguridad sin modificar la entrada', () => {
  const originales = Object.freeze({
    FARO_SECRETO_FIRMA: 'sintetico',
    FARO_ACCESS_EQUIPO: 'acceso.example',
    FARO_ACCESS_AUD: 'audiencia-sintetica',
    FARO_MCP: 'no',
    FARO_FORMACION_ABIERTA: 'toda',
    FARO_SECRETO_FIRMA_ANTERIOR: undefined,
  });
  assert.deepEqual(variablesDelServicio(originales), {
    FARO_SECRETO_FIRMA: 'sintetico',
    FARO_ACCESS_EQUIPO: 'acceso.example',
    FARO_ACCESS_AUD: 'audiencia-sintetica',
    FARO_MCP: 'no',
    FARO_FORMACION_ABIERTA: 'toda',
  });
  assert.ok(Object.hasOwn(originales, 'FARO_SECRETO_FIRMA_ANTERIOR'));
});

test('conserva la declaración explícita de Access y rechaza un campo no admitido sin filtrarlo', () => {
  const variables = { FARO_ACCESS_DECLARACION: 'pruebas-con-relatos-ficticios' };
  assert.deepEqual(variablesDelServicio(variables), variables);
  assert.throws(() => variablesDelServicio({ ...variables, FARO_PERMISO_DESCONOCIDO: 'si' }), ErrorDeProcesamiento);
});
