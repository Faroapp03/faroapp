// Fachada HTTP: contrato, origen, tipo, CORS, Problem Details e idioma, sin montar api.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ContratoIncompatible,
  OrigenNoPermitido,
  respuestaDeError,
  SolicitudInvalida,
  TipoNoAdmitido,
} from '../../src/api/errores.ts';
import {
  CABECERA_CONTRATO,
  CABECERA_PETICION,
  CONTRATO_API,
  CONTRATO_SIN_CABECERA,
  cabecerasApi,
  comprobarContrato,
  comprobarPeticionPost,
  idiomaDeLaConsulta,
  leerCuerpoJson,
  respuestaConProblema,
  respuestaPreflight,
} from '../../src/api/http.ts';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';

const URL_API = 'http://api.local/api/clasificar';
const ORIGEN_PERMITIDO = 'https://web-permitida.example';
const ORIGEN_AJENO = 'https://otro.example';
const PERMITIDOS = [ORIGEN_PERMITIDO];

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

test('el contrato vigente admite espacios en su cabecera y conserva la versión histórica sin cabecera', () => {
  for (const version of [String(CONTRATO_API), ` ${CONTRATO_API} `]) {
    assert.doesNotThrow(() => comprobarContrato(post({ [CABECERA_CONTRATO]: version })));
  }
  assert.notEqual(CONTRATO_SIN_CABECERA, CONTRATO_API);
  for (const headers of [
    {},
    { [CABECERA_CONTRATO]: '' },
    { [CABECERA_CONTRATO]: String(CONTRATO_SIN_CABECERA) },
    { [CABECERA_CONTRATO]: 'no-numérico' },
  ]) {
    assert.throws(() => comprobarContrato(post(headers)), ContratoIncompatible);
  }
});

test('una página de otro sitio se rechaza antes de comprobar el tipo del cuerpo', () => {
  for (const headers of [{ origin: ORIGEN_AJENO }, { 'sec-fetch-site': 'cross-site' }, { origin: 'null' }]) {
    assert.throws(
      () => comprobarPeticionPost(post({ ...headers, 'content-type': 'text/plain' }), PERMITIDOS),
      OrigenNoPermitido,
    );
  }
});

test('mismo origen, lista permitida y ausencia de Origin admitida conservan la regla de POST', () => {
  for (const headers of [
    {},
    { origin: 'http://api.local', 'sec-fetch-site': 'same-origin' },
    { origin: ORIGEN_PERMITIDO, 'sec-fetch-site': 'cross-site' },
    { origin: 'null', 'sec-fetch-site': 'same-origin' },
  ]) {
    assert.doesNotThrow(() => comprobarPeticionPost(post(headers), PERMITIDOS));
  }
});

test('Origin null solo pasa con same-origin y una marca cross-site sin Origin no pasa', () => {
  for (const sitio of ['cross-site', 'same-site', 'none']) {
    assert.throws(
      () => comprobarPeticionPost(post({ origin: 'null', 'sec-fetch-site': sitio }), PERMITIDOS),
      OrigenNoPermitido,
    );
  }
  assert.throws(() => comprobarPeticionPost(post({ 'sec-fetch-site': 'cross-site' }), PERMITIDOS), OrigenNoPermitido);
});

test('POST admite JSON con parámetros o mayúsculas y rechaza otros tipos', () => {
  for (const tipo of ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON']) {
    assert.doesNotThrow(() => comprobarPeticionPost(post({ 'content-type': tipo }), PERMITIDOS));
  }
  for (const tipo of ['', 'text/plain', 'application/x-www-form-urlencoded', 'application/problem+json']) {
    assert.throws(() => comprobarPeticionPost(post({ 'content-type': tipo }), PERMITIDOS), TipoNoAdmitido);
  }
});

test('las cabeceras abren CORS solo a la lista y no permiten caché', () => {
  const permitido = cabecerasApi(post({ origin: ORIGEN_PERMITIDO }), PERMITIDOS);
  assert.equal(permitido['access-control-allow-origin'], ORIGEN_PERMITIDO);
  assert.equal(permitido['access-control-expose-headers'], `${CABECERA_CONTRATO}, ${CABECERA_PETICION}, retry-after`);
  for (const cabeceras of [
    permitido,
    cabecerasApi(post({ origin: ORIGEN_AJENO }), PERMITIDOS),
    cabecerasApi(post(), PERMITIDOS),
  ]) {
    assert.equal(cabeceras['cache-control'], 'no-store');
    assert.equal(cabeceras.vary, 'origin');
    assert.equal(cabeceras['x-content-type-options'], 'nosniff');
    assert.equal(cabeceras[CABECERA_CONTRATO], String(CONTRATO_API));
  }
  assert.equal(cabecerasApi(post({ origin: ORIGEN_AJENO }), PERMITIDOS)['access-control-allow-origin'], undefined);
});

test('preflight conserva 204 sin cuerpo, métodos, cabeceras y plazo CORS', async () => {
  const request = new Request(URL_API, { method: 'OPTIONS', headers: { origin: ORIGEN_PERMITIDO } });
  const admitidos = { metodos: 'POST, OPTIONS', cabeceras: `content-type, ${CABECERA_CONTRATO}` };
  const respuesta = respuestaPreflight(request, PERMITIDOS, admitidos);
  assert.equal(respuesta.status, ESTADO_HTTP.sinContenido);
  assert.equal(await respuesta.text(), '');
  assert.equal(respuesta.headers.get('access-control-allow-methods'), admitidos.metodos);
  assert.equal(respuesta.headers.get('access-control-allow-headers'), admitidos.cabeceras);
  assert.equal(respuesta.headers.get('access-control-max-age'), '600');
});

test('Problem Details conserva el cuerpo y las cabeceras específicas con su tipo de contenido', async () => {
  const error = respuestaDeError(new TipoNoAdmitido());
  const respuesta = respuestaConProblema(post({ origin: ORIGEN_PERMITIDO }), PERMITIDOS, {
    ...error,
    cabeceras: { allow: 'POST, OPTIONS', 'retry-after': '600' },
  });
  assert.equal(respuesta.status, error.estado);
  assert.equal(respuesta.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  assert.equal(respuesta.headers.get('allow'), 'POST, OPTIONS');
  assert.equal(respuesta.headers.get('retry-after'), '600');
  assert.equal(respuesta.headers.get('access-control-allow-origin'), ORIGEN_PERMITIDO);
  assert.deepEqual(await respuesta.json(), error.cuerpo);
});

test('GET conserva el idioma por defecto y rechaza uno que no existe', () => {
  assert.equal(idiomaDeLaConsulta(new URL(URL_API)), 'es');
  assert.equal(idiomaDeLaConsulta(new URL(`${URL_API}?idioma=ca`)), 'ca');
  assert.equal(idiomaDeLaConsulta(new URL(`${URL_API}?idioma=es`)), 'es');
  for (const idioma of ['', 'fr', 'CA', ' ca ']) {
    assert.throws(
      () => idiomaDeLaConsulta(new URL(`${URL_API}?idioma=${encodeURIComponent(idioma)}`)),
      SolicitudInvalida,
    );
  }
});

test('la fachada reexporta la lectura de JSON y los errores con la identidad común', async () => {
  assert.deepEqual(await leerCuerpoJson(post(), { type: 'object' }, 'objeto requerido'), {});
  const fachada = await import('../../src/api/http.ts');
  const errores = await import('../../src/api/errores.ts');
  assert.equal(fachada.SolicitudInvalida, errores.SolicitudInvalida);
  assert.equal(fachada.respuestaDeError, errores.respuestaDeError);
});
