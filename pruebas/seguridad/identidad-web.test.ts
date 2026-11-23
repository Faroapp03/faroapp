/** La identidad de red no contiene autoría y no negocia idioma ni navegación en las API. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { cabecerasIdentidadWeb, IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

test('cuatro cabeceras públicas del perfil central, sin entorno ni identidad de proyecto', () => {
  assert.deepEqual(Object.keys(IDENTIDAD_WEB).sort(), [
    'User-Agent',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
  ]);
  assert.match(IDENTIDAD_WEB['User-Agent'], /Chrome\/[0-9]+\.0\.0\.0 Safari\/537\.36$/);
  assert.equal(IDENTIDAD_WEB['sec-ch-ua-mobile'], '?0');
  assert.equal(IDENTIDAD_WEB['sec-ch-ua-platform'], '"Windows"');
  assert.doesNotMatch(JSON.stringify(IDENTIDAD_WEB), /Faro|DataReader|@|Darwin|Node|Python/i);
});

test('identidad ajena no sustituye perfil y la API conserva autenticación, cuerpo e idioma propio', () => {
  const adicionales = {
    'user-agent': 'equipo-local',
    'SEC-CH-UA': 'contradictoria',
    Authorization: 'Bearer sintetico',
    Accept: 'application/json',
    'Accept-Encoding': 'identity',
    'Accept-Language': 'ca',
  };
  const antes = JSON.stringify(adicionales);
  const cabeceras = new Headers(cabecerasIdentidadWeb(adicionales));
  for (const [nombre, valor] of Object.entries(IDENTIDAD_WEB)) {
    assert.equal(cabeceras.get(nombre), valor);
  }
  assert.equal(cabeceras.get('authorization'), 'Bearer sintetico');
  assert.equal(cabeceras.get('accept'), 'application/json');
  assert.equal(cabeceras.get('accept-encoding'), 'identity');
  assert.equal(cabeceras.get('accept-language'), 'ca');
  assert.equal(cabeceras.has('sec-fetch-mode'), false);
  assert.equal(JSON.stringify(adicionales), antes);
  assert.equal(new Headers(cabecerasIdentidadWeb()).has('accept-language'), false);
});
