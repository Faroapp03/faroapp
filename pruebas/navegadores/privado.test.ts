import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { responderAccesoPrivado } from '../../src/plataforma/cloudflare/acceso-privado.ts';
import { adaptarSolicitud } from './fixture.ts';
import { CLAVE_SINTETICA, comprobarPuertaPrivada } from './privado.ts';

const TOTAL_PETICIONES = 9;
const PETICIONES_CON_CLAVE = 6;

test('el puente adapta a HTTPS y la puerta rechaza anónimo, clave incorrecta y panel tras Basic', async () => {
  const observadas: { protocolo: string; autorizacion: string | null }[] = [];
  const pedir = (async (url, opciones) => {
    const entrada = new URL(String(url));
    const headers = { ...Object.fromEntries(new Headers(opciones?.headers)), 'cf-connecting-ip': '127.0.0.1' };
    const req = { url: `${entrada.pathname}${entrada.search}`, method: 'GET', headers } as unknown as IncomingMessage;
    const peticion = adaptarSolicitud(req, entrada.origin);
    observadas.push({ protocolo: new URL(peticion.url).protocol, autorizacion: peticion.headers.get('authorization') });
    const entorno = {
      FARO_PRUEBAS_CLAVE: CLAVE_SINTETICA,
      FARO_PRUEBAS_LIMITE: 'limite-privado-sintetico-distinto-de-32-bytes',
      REGISTRO_SOCIOS: {
        idFromName: () => 'id',
        get: () => ({ fetch: async () => Response.json({ permitido: true }) }),
      },
      FARO_ADMINISTRACION: 'si',
      ASSETS: { fetch: async () => new Response() },
    };
    return responderAccesoPrivado(peticion, entorno, async (p, e) => {
      assert.equal(p.headers.get('authorization'), null);
      assert.equal(e.FARO_ADMINISTRACION, 'no');
      return new Response(null, {
        status: new URL(p.url).pathname.startsWith('/administracion') ? ESTADO_HTTP.noEncontrado : ESTADO_HTTP.correcto,
      });
    });
  }) as typeof fetch;
  assert.deepEqual(await comprobarPuertaPrivada('http://127.0.0.1:12345', pedir), {
    sinBasic: 401,
    claveIncorrecta: 401,
    panelConBasic: 404,
    aplicacionConBasic: 200,
  });
  assert.equal(observadas.length, TOTAL_PETICIONES);
  assert.ok(observadas.every((p) => p.protocolo === 'https:'));
  assert.equal(observadas.filter((p) => p.autorizacion !== null).length, PETICIONES_CON_CLAVE);
});

test('sin clave configurada no se abre incluso con credencial sintética', async () => {
  const autorizacion = `Basic ${Buffer.from(`Faro:${CLAVE_SINTETICA}`).toString('base64')}`;
  const peticion = new Request('https://ejemplo.invalid/recorrido.html', { headers: { authorization: autorizacion } });
  const respuesta = await responderAccesoPrivado(
    peticion,
    { ASSETS: { fetch: async () => new Response() } },
    async () => {
      throw new Error('No debe pasar la puerta');
    },
  );
  assert.equal(respuesta.status, ESTADO_HTTP.noDisponible);
});
