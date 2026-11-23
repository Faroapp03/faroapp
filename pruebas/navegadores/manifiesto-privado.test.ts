import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Route } from 'playwright-core';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { atenderManifiestoPrivado, peticionesDeManifiesto } from './manifiesto-privado.ts';
import { CREDENCIALES_SINTETICAS } from './privado.ts';

const ORIGEN = 'http://127.0.0.1:12345';
const ES = '/manifest.webmanifest';
const CA = '/manifest-ca.webmanifest';

function peticion(
  ajustes: {
    url?: string;
    documento?: string;
    sinMarco?: boolean;
    metodo?: string;
    destino?: string;
    cabeceraPrevia?: string;
    enlaceConCredenciales?: boolean;
    estado?: number;
  } = {},
) {
  const acciones: string[] = [];
  const respuesta = {
    status: () => ajustes.estado ?? ESTADO_HTTP.correcto,
    dispose: async () => acciones.push('liberar'),
  };
  const ruta = {
    request: () => ({
      url: () => ajustes.url ?? ORIGEN + ES,
      method: () => ajustes.metodo ?? 'GET',
      frame: () => {
        if (ajustes.sinMarco) {
          throw new Error('Un service worker no tiene frame');
        }
        return {
          url: () => ajustes.documento ?? `${ORIGEN}/recorrido.html`,
          evaluate: async () => ajustes.enlaceConCredenciales ?? true,
        };
      },
      allHeaders: async () => ({
        'sec-fetch-dest': ajustes.destino ?? 'manifest',
        ...(ajustes.cabeceraPrevia ? { authorization: ajustes.cabeceraPrevia } : {}),
      }),
    }),
    fallback: async () => acciones.push('otras reglas'),
    fetch: async (opciones: { headers: Record<string, string>; maxRedirects?: number }) => {
      assert.equal(opciones.maxRedirects, 0);
      assert.equal(opciones.headers['sec-fetch-dest'], 'manifest');
      assert.equal(
        opciones.headers.authorization,
        `Basic ${Buffer.from(`Faro:${CREDENCIALES_SINTETICAS.password}`).toString('base64')}`,
      );
      acciones.push('petición al Worker');
      return respuesta;
    },
    fulfill: async (opciones: { response: unknown }) => {
      assert.equal(opciones.response, respuesta);
      acciones.push('respuesta íntegra');
    },
  };
  return { ruta: ruta as unknown as Route, acciones };
}

test('el cargador nativo recibe la respuesta íntegra del Worker, incluido un rechazo o una redirección sin seguir', async () => {
  for (const [camino, estado] of [
    [ES, ESTADO_HTTP.correcto],
    [CA, ESTADO_HTTP.noAutenticado],
    [CA, ESTADO_HTTP.encontradoEnOtraDireccion],
  ] as const) {
    const { ruta, acciones } = peticion({ url: ORIGEN + camino, estado });
    const asistidas: { ruta: string; estado: number }[] = [];
    await atenderManifiestoPrivado(ruta, ORIGEN, CREDENCIALES_SINTETICAS, asistidas);
    assert.deepEqual(acciones, ['petición al Worker', 'respuesta íntegra', 'liberar']);
    assert.deepEqual(asistidas, [{ ruta: camino, estado }]);
  }
});

test('solo se anticipa el Basic consentido al manifiesto nativo exacto del mismo origen y documento', async () => {
  for (const ajustes of [
    { url: `https://ejemplo.invalid${ES}` },
    { url: `http://127.0.0.1:12346${ES}` },
    { documento: 'https://ejemplo.invalid/recorrido.html' },
    { url: `${ORIGEN + ES}?fuera` },
    { url: `${ORIGEN}/privada/manifest.webmanifest` },
    { metodo: 'POST' },
    { destino: 'empty', sinMarco: true },
    { destino: 'document' },
    { destino: 'prefetch' },
    { enlaceConCredenciales: false },
    { cabeceraPrevia: 'Basic invalida' },
  ]) {
    const { ruta, acciones } = peticion(ajustes);
    await atenderManifiestoPrivado(ruta, ORIGEN, CREDENCIALES_SINTETICAS, []);
    assert.deepEqual(acciones, ['otras reglas'], JSON.stringify(ajustes));
  }
});

test('el recibo conserva un 401 nativo aunque el service worker obtenga 200 para esa dirección', () => {
  const solicitudes = [
    { ruta: ES, metodo: 'GET', destino: 'manifest', estado: 401, ua: 'n' },
    { ruta: ES, metodo: 'GET', destino: 'empty', estado: 200, ua: 'n' },
    { ruta: CA, metodo: 'GET', ua: 'n' },
    { ruta: '/inicio.html', metodo: 'GET', estado: 200, ua: 'n' },
  ];
  assert.deepEqual(peticionesDeManifiesto(solicitudes), [
    { ruta: ES, destino: 'manifest', estado: 401 },
    { ruta: ES, destino: 'empty', estado: 200 },
    { ruta: CA, destino: null, estado: null },
  ]);
});
