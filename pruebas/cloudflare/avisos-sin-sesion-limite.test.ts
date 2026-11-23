import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import oficial from '../../src/plataforma/cloudflare/worker-oficial.ts';
import privado from '../../src/plataforma/cloudflare/worker-privado.ts';
import { crearPuntoDeAvisos, MAX_ENVIOS_POR_MINUTO } from '../../src/plataforma/punto-de-avisos.ts';

// El tope de envíos de los avisos, que ahora llegan sin sesión: es de cada instancia (este proceso carga una) y lo
// comparten las dos entradas que la usan; superado, 429 con Retry-After y sin línea, también para un cuerpo inválido.
// No es un tope global: otra instancia lleva su propia cuenta. Este archivo va solo para empezar con la ventana vacía.

const ORIGEN = 'https://ejemplo.invalid';
const RUTA = '/avisos-del-navegador';
const SIN_CONTENIDO = 204;
const DEMASIADAS = 429;
const SUCESO = 'avisos del navegador';
const informe = {
  type: 'csp-violation',
  age: 1000,
  url: `${ORIGEN}/inicio.html?consulta=secreta`,
  body: { effectiveDirective: 'script-src-elem', sample: 'texto libre secreto' },
};
const durable = { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ permitido: true }) }) };
const assets = { fetch: async () => new Response('recurso protegido') };
const entornoOficial = {
  FARO_CLAVE_GENERAL: 'clave-general-sintetica',
  FARO_SESION_PORTAL: 'firma-sintetica-independiente-de-mas-de-32-bytes',
  FARO_LIMITE_PORTAL: 'limite-sintetico-independiente-de-mas-de-32-bytes',
  REGISTRO_SOCIOS: durable,
  ASSETS: assets,
};
const entornoPrivado = {
  FARO_PRUEBAS_CLAVE: 'clave-privada-sintetica-de-al-menos-32-bytes',
  FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
  REGISTRO_SOCIOS: durable,
  ASSETS: assets,
};

function envio(cuerpo = JSON.stringify([informe])): Request {
  return new Request(ORIGEN + RUTA, {
    method: 'POST',
    headers: { 'content-type': 'application/reports+json' },
    body: cuerpo,
  });
}

test('pasado el tope de la instancia, las dos entradas responden 429 sin línea', async (t) => {
  const lineas: string[] = [];
  const espia = mock.method(console, 'log', (linea: unknown) => {
    if (typeof linea === 'string' && linea.includes(SUCESO)) {
      lineas.push(linea);
    }
  });
  t.after(() => espia.mock.restore());
  const entradas = [
    (peticion: Request) => oficial.fetch(peticion, entornoOficial),
    (peticion: Request) => privado.fetch(peticion, entornoPrivado),
  ];
  for (let i = 0; i < MAX_ENVIOS_POR_MINUTO; i += 1) {
    const responder = entradas[i % entradas.length];
    assert.ok(responder);
    assert.equal((await responder(envio())).status, SIN_CONTENIDO, `envío ${i + 1}`);
  }
  assert.equal(lineas.length, MAX_ENVIOS_POR_MINUTO);
  for (const linea of lineas) {
    assert.doesNotMatch(linea, /inicio\.html|consulta|secret|texto libre/);
  }
  for (const [responder, cuerpo] of [
    [entradas[0], JSON.stringify([informe])],
    [entradas[1], JSON.stringify([informe])],
    [entradas[0], '[{"roto"'],
    [entradas[1], JSON.stringify({ no: 'es una lista' })],
  ] as const) {
    assert.ok(responder);
    const respuesta = await responder(envio(cuerpo));
    assert.equal(respuesta.status, DEMASIADAS);
    const espera = Number(respuesta.headers.get('retry-after'));
    assert.ok(Number.isInteger(espera) && espera >= 1 && espera <= 60, String(espera));
    assert.doesNotMatch(await respuesta.text(), /inicio\.html|consulta|secret|texto libre/);
  }
  assert.equal(lineas.length, MAX_ENVIOS_POR_MINUTO);
  // Otra instancia del punto empieza con su propia ventana: el tope no es global.
  const otraInstancia = crearPuntoDeAvisos({ registrar: (linea) => lineas.push(linea) });
  assert.equal((await otraInstancia(envio())).status, SIN_CONTENIDO);
  assert.equal(lineas.length, MAX_ENVIOS_POR_MINUTO + 1);
});
