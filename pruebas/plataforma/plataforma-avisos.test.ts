import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
// Los avisos reducen los informes a vocabulario fijo y aplican topes sin conservar contenidos personales.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { MS_POR_MINUTO } from '../../src/comun/tiempo.ts';
import { avisoMinimo, avisosDelEnvio } from '../../src/plataforma/avisos-del-navegador.ts';
import { RUTA_DE_AVISOS, VIGENCIA_DE_LOS_AVISOS_S } from '../../src/plataforma/cabeceras-web.ts';
import {
  crearPuntoDeAvisos,
  MAX_ENVIOS_POR_MINUTO,
  MAX_INFORMES_POR_ENVIO,
  TIPO_DE_LOS_INFORMES,
} from '../../src/plataforma/punto-de-avisos.ts';
import { MAX_CUERPO_BYTES } from '../../src/seguridad/limites.ts';

const ORIGEN = 'https://sitio.example';
const AHORA = Date.parse('2026-10-11T03:27:15Z');
const HORA = '2026-10-11T03:00Z';
const MS_POR_SEGUNDO = 1000;
const HTTP_FALLO = 503;
const HTTP_RECHAZO = 422;
const EXCESO = 5;

function informe(cambios: Record<string, unknown> = {}) {
  return {
    age: 0,
    type: 'csp-violation',
    url: `${ORIGEN}/persona-sintetica?nombre=sintetico`,
    body: { effectiveDirective: 'script-src', sample: 'contenido-personal-sintetico' },
    ...cambios,
  };
}

function envio(contenido: unknown, tipo = TIPO_DE_LOS_INFORMES): Request {
  return new Request(`${ORIGEN}${RUTA_DE_AVISOS}`, {
    method: 'POST',
    headers: { 'content-type': tipo, 'user-agent': IDENTIDAD_WEB['User-Agent'], cookie: 'secreto-sintetico' },
    body: typeof contenido === 'string' ? contenido : JSON.stringify(contenido),
  });
}

test('un aviso conserva solo el tipo, vocabulario fijo, origen y hora en punto', () => {
  assert.deepEqual(avisoMinimo(informe(), ORIGEN, AHORA), {
    tipo: 'csp-violation',
    codigo: 'script-src',
    origen: ORIGEN,
    hora: HORA,
  });
  assert.deepEqual(avisoMinimo(informe({ body: { effectiveDirective: 'persona-sintetica' } }), ORIGEN, AHORA), {
    tipo: 'csp-violation',
    codigo: 'otro',
    origen: ORIGEN,
    hora: HORA,
  });
});

test('los errores HTTP de red conservan solo 5xx y nunca visitas correctas o abandonadas', () => {
  const red = (body: Record<string, unknown>) => informe({ type: 'network-error', body });
  assert.deepEqual(avisoMinimo(red({ type: 'http.error', status_code: HTTP_FALLO }), ORIGEN, AHORA), {
    tipo: 'network-error',
    codigo: 'http.error',
    estado: HTTP_FALLO,
    origen: ORIGEN,
    hora: HORA,
  });
  for (const body of [{ type: 'http.error', status_code: HTTP_RECHAZO }, { type: 'ok' }, { type: 'abandoned' }]) {
    assert.equal(avisoMinimo(red(body), ORIGEN, AHORA), 'no_es_fallo');
  }
  assert.deepEqual(avisoMinimo(red({ type: 'persona_sintetica' }), ORIGEN, AHORA), {
    tipo: 'network-error',
    codigo: 'otro',
    origen: ORIGEN,
    hora: HORA,
  });
});

test('el informe rechaza forma, tipo, origen y edad fuera de contrato', () => {
  assert.equal(avisoMinimo(null, ORIGEN, AHORA), 'forma');
  assert.equal(avisoMinimo(informe({ body: null }), ORIGEN, AHORA), 'forma');
  assert.equal(avisoMinimo(informe({ type: 'deprecation' }), ORIGEN, AHORA), 'tipo');
  assert.equal(avisoMinimo(informe({ url: 'https://ajeno.example/ruta' }), ORIGEN, AHORA), 'origen');
  for (const age of [-1, Number.NaN, Number.POSITIVE_INFINITY, VIGENCIA_DE_LOS_AVISOS_S * MS_POR_SEGUNDO + 1]) {
    assert.equal(avisoMinimo(informe({ age }), ORIGEN, AHORA), 'edad');
  }
  assert.equal(avisoMinimo(informe({ body: { effectiveDirective: '<script>' } }), ORIGEN, AHORA), 'forma');
});

test('un envío solo examina el máximo de informes y cuenta el exceso sin leerlo', () => {
  const informes: unknown[] = Array.from({ length: MAX_INFORMES_POR_ENVIO }, () => informe());
  const noLeido = {
    get body(): never {
      return assert.fail('no lee el exceso');
    },
  };
  informes.push(...Array.from({ length: EXCESO }, () => noLeido));
  const resultado = avisosDelEnvio(informes, ORIGEN, AHORA, MAX_INFORMES_POR_ENVIO);
  assert.equal(resultado?.avisos.length, MAX_INFORMES_POR_ENVIO);
  assert.deepEqual(resultado?.descartados, { exceso: EXCESO });
  assert.equal(avisosDelEnvio({}, ORIGEN, AHORA, MAX_INFORMES_POR_ENVIO), null);
});

test('el punto registra una línea reducida exacta y acepta vacíos sin dejar contenido', async () => {
  const lineas: string[] = [];
  const recibir = crearPuntoDeAvisos({ ahora: () => AHORA, registrar: (linea) => lineas.push(linea) });
  assert.equal((await recibir(envio([informe()]))).status, ESTADO_HTTP.sinContenido);
  assert.deepEqual(lineas, [
    JSON.stringify({
      suceso: 'avisos del navegador',
      avisos: [{ tipo: 'csp-violation', codigo: 'script-src', origen: ORIGEN, hora: HORA }],
      descartados: {},
    }),
  ]);
  assert.equal((await recibir(envio([]))).status, ESTADO_HTTP.sinContenido);
  assert.equal(lineas.length, 1);
});

test('el punto rechaza métodos, tipos, JSON defectuoso y cuerpos desbordados sin registrarlos', async () => {
  const lineas: string[] = [];
  const recibir = crearPuntoDeAvisos({ ahora: () => AHORA, registrar: (linea) => lineas.push(linea) });
  const lectura = await recibir(new Request(`${ORIGEN}${RUTA_DE_AVISOS}`));
  assert.equal(lectura.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(lectura.headers.get('allow'), 'POST');
  assert.equal((await recibir(envio([], 'application/json'))).status, ESTADO_HTTP.tipoNoAdmitido);
  for (const contenido of ['{', { informes: [] }, `["${'x'.repeat(MAX_CUERPO_BYTES)}"]`]) {
    const respuesta = await recibir(envio(contenido));
    assert.equal(respuesta.status, ESTADO_HTTP.solicitudIncorrecta);
    assert.equal(respuesta.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  }
  assert.deepEqual(lineas, []);
});

test('el tope por minuto no registra exceso y se libera al empezar el siguiente minuto', async () => {
  let ahora = AHORA;
  const recibir = crearPuntoDeAvisos({ ahora: () => ahora, registrar: () => assert.fail('envíos vacíos') });
  for (let i = 0; i < MAX_ENVIOS_POR_MINUTO; i++) {
    assert.equal((await recibir(envio([]))).status, ESTADO_HTTP.sinContenido);
  }
  const limitada = await recibir(envio([]));
  assert.equal(limitada.status, ESTADO_HTTP.demasiadasPeticiones);
  assert.equal(limitada.headers.get('retry-after'), '60');
  ahora += MS_POR_MINUTO;
  assert.equal((await recibir(envio([]))).status, ESTADO_HTTP.sinContenido);
});
