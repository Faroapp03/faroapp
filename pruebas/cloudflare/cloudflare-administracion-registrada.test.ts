// El Worker con la administración encendida pero sin poder montarla (aquí, sin REGISTRO_SOCIOS): el panel, sus
// archivos, el mantenimiento y el catálogo responden 503 como siempre, y cada uno deja en el registro por qué. Un fallo
// del montaje o de la autoridad durable no se queda en un 503 sin rastro.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../../src/plataforma/cloudflare/worker.ts';

const ORIGEN = 'https://panel.example';
const NO_DISPONIBLE = 503;
const ENTORNO = {
  FARO_ADMINISTRACION: 'si',
  FARO_ADMIN_ORIGEN: ORIGEN,
  FARO_ADMIN_ACCESS_EQUIPO: 'equipo-prueba',
  FARO_ADMIN_ACCESS_AUD: 'panel',
  FARO_ACCESS_AUD: 'publica',
  FARO_SECRETO_FIRMA: 'firma y credencial sintetica de mas de treinta y dos caracteres',

  ASSETS: { fetch: async () => assert.fail('la administración no cae en los archivos estáticos') },
};

const PETICIONES: readonly [string, RequestInit][] = [
  ['/administracion/api/sesion/abrir', { method: 'POST', body: '{}' }],
  ['/administracion/', {}],
  ['/mantenimiento/resultado', { method: 'POST', body: '{}' }],
  ['/.well-known/api-catalog', {}],
];

for (const [ruta, opciones] of PETICIONES) {
  test(`${ruta}: 503 y el motivo en el registro`, async (t) => {
    const registro = t.mock.method(console, 'error', () => {});
    const respuesta = await worker.fetch(new Request(`${ORIGEN}${ruta}`, opciones), ENTORNO);
    assert.equal(respuesta.status, NO_DISPONIBLE);
    assert.equal(registro.mock.calls.length, 1);
    const diagnostico = JSON.parse(String(registro.mock.calls[0]?.arguments[0])) as Record<string, unknown>;
    assert.equal(diagnostico.operacion, 'montaje-conectividad');
    assert.equal(diagnostico.tipo, 'Error');
    assert.equal(diagnostico.estado, NO_DISPONIBLE);
    assert.doesNotMatch(JSON.stringify(diagnostico), /REGISTRO_SOCIOS|message|stack/);
  });
}
