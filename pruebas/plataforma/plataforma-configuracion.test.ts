// Las opciones validan valores exactos; ningún error de escritura concede capacidad o abre un servicio.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpcionesApi } from '../../src/api/api.ts';
import { ErrorDeConfiguracion, opcionesDelEntorno } from '../../src/plataforma/configuracion.ts';

test('valores de interruptores mal escritos se rechazan sin encender servicios', () => {
  for (const nombre of ['FARO_MCP', 'FARO_A2A', 'FARO_API_SOCIOS', 'FARO_CAMINO_A_MANO', 'FARO_CITILAB_PAGO']) {
    assert.throws(() => opcionesDelEntorno({ [nombre]: 'sí' }), ErrorDeConfiguracion);
  }
});

test('opciones por defecto conservan los agentes apagados y los requisitos de firma y socios se validan', () => {
  const opciones = opcionesDelEntorno({ FARO_SECRETO_FIRMA: 'sintetica' });
  assert.deepEqual(opciones.agentes, { mcp: false, a2a: false, clavesFirmaMcp: null });
  assert.equal(opciones.seguridad.secretoFirma, 'sintetica');
  assert.throws(() => opcionesDelEntorno({ FARO_FIRMA_MCP_CLAVES: '{' }), ErrorDeConfiguracion);
  assert.throws(() => opcionesDelEntorno({ FARO_API_SOCIOS: 'si' }), ErrorDeConfiguracion);
});

test('los secretos ausentes o vacíos se omiten para componer directamente la seguridad de la API', () => {
  for (const valor of [undefined, '']) {
    const seguridad: NonNullable<OpcionesApi['seguridad']> = opcionesDelEntorno({
      FARO_SECRETO_FIRMA: valor,
      FARO_SECRETO_FIRMA_ANTERIOR: valor,
    }).seguridad;
    assert.equal(Object.hasOwn(seguridad, 'secretoFirma'), false);
    assert.equal(Object.hasOwn(seguridad, 'secretoFirmaAnterior'), false);
    assert.equal(seguridad.secretoFirma, undefined);
    assert.equal(seguridad.secretoFirmaAnterior, undefined);
  }
});
