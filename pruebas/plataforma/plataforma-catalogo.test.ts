// El catálogo anuncia servicios admitidos y conserva GET/HEAD y errores en Problem Details sin pasar por la API.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { ENLACE_AL_CATALOGO } from '../../src/plataforma/cabeceras-web.ts';
import { catalogoDeApis, respuestaDelCatalogo, TIPO_DEL_CATALOGO } from '../../src/plataforma/catalogo-de-apis.ts';

const ORIGEN = 'https://sitio.example';
const SIN_AGENTES = { mcp: false, a2a: false, socios: false };
test('sin agentes publica REST con OpenAPI y salud exactos sin anunciar servicios apagados', () => {
  assert.deepEqual(catalogoDeApis(ORIGEN, SIN_AGENTES), {
    linkset: [
      { anchor: `${ORIGEN}/.well-known/api-catalog`, item: [{ href: `${ORIGEN}/api/`, title: 'API REST de Faro' }] },
      {
        anchor: `${ORIGEN}/api/`,
        'service-desc': [{ href: `${ORIGEN}/openapi.json`, type: 'application/json' }],
        status: [{ href: `${ORIGEN}/api/salud`, type: 'application/json' }],
      },
    ],
  });
});

test('GET conserva el cuerpo exacto y HEAD sus cabeceras sin cuerpo', async () => {
  const lectura = respuestaDelCatalogo('GET', ORIGEN, SIN_AGENTES);
  const cabeza = respuestaDelCatalogo('HEAD', ORIGEN, SIN_AGENTES);
  assert.equal(await lectura.text(), JSON.stringify(catalogoDeApis(ORIGEN, SIN_AGENTES)));
  assert.equal(await cabeza.text(), '');
  assert.deepEqual([...cabeza.headers], [...lectura.headers]);
  assert.equal(lectura.headers.get('content-type'), TIPO_DEL_CATALOGO);
  assert.equal(lectura.headers.get('link'), ENLACE_AL_CATALOGO);
});

test('un método ajeno devuelve 405 y declara GET y HEAD con Problem Details', async () => {
  const respuesta = respuestaDelCatalogo('POST', ORIGEN, SIN_AGENTES);
  assert.equal(respuesta.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(respuesta.headers.get('allow'), 'GET, HEAD');
  assert.equal(respuesta.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  assert.match(await respuesta.text(), /"type":"[^" ]*problema\/metodo_no_admitido"/);
});
