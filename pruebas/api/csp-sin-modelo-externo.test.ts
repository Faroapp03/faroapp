/** Las variables de una rama de modelo externo (`FARO_RAMA_LLM`) no publican un destino ni abren la CSP. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { registerHooks } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { POLITICA_DE_CONTENIDOS, PORTADA } from '../../src/plataforma/cabeceras-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const ORIGEN_MODELO_EXTERNO = 'https://modelo.example';
const VARIABLES_MODELO_EXTERNO = { FARO_RAMA_LLM: 'si', FARO_RAMA_LLM_ORIGEN: ORIGEN_MODELO_EXTERNO };
const PUERTO_SINTETICO = 80;

class RespuestaSintetica {
  estado = 0;
  cuerpo = '';
  readonly cabeceras: OutgoingHttpHeaders = {};
  getHeader(nombre: string) {
    return this.cabeceras[nombre];
  }
  setHeader(nombre: string, valor: string) {
    this.cabeceras[nombre] = valor;
    return this;
  }
  writeHead(estado: number, cabeceras: OutgoingHttpHeaders) {
    this.estado = estado;
    Object.assign(this.cabeceras, cabeceras);
    return this;
  }
  end(cuerpo = '') {
    this.cuerpo = cuerpo;
    return this;
  }
}

test('Node redirige la raíz a la portada con la CSP base sin invocar la API ni la inferencia', (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'Modelo externo Año 2026 '));
  const web = join(carpeta, 'web');
  mkdirSync(web);
  t.after(() => rmSync(carpeta, { recursive: true, force: true }));
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    puerto: PUERTO_SINTETICO,
    anfitrion: '127.0.0.1',
    api: async () => assert.fail('No se debe invocar API ni inferencia'),
  });
  assert.equal(servidor.listening, false);
  const socket = new Socket();
  t.after(() => socket.destroy());
  const peticion = new IncomingMessage(socket);
  peticion.headers.host = '127.0.0.1';
  peticion.method = 'GET';
  peticion.url = '/';
  const respuesta = new RespuestaSintetica();
  servidor.emit('request', peticion, respuesta);
  assert.equal(respuesta.cabeceras['content-security-policy'], POLITICA_DE_CONTENIDOS);
  assert.equal(respuesta.cabeceras.location, PORTADA);
});

test('Worker real conserva CSP y configuración sin leer paquete operativo ni consultar inferencia', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('No se permite red de inferencia'));
  const paquete = new URL('../../src/plataforma/cloudflare/paquete.ts', import.meta.url).href;
  const hooks = registerHooks({
    load(url, contexto, siguiente) {
      if (url === paquete) {
        return {
          format: 'module',
          shortCircuit: true,
          source: `export const PAQUETE = {esco:{ocupaciones:{}},clasificaciones:{isco08_a_cno11:{},cno11:{}},vectores:{modelo:'sintetico',dimensiones:1,ids:[],escalas:[],datos:''}};`,
        };
      }
      return siguiente(url, contexto);
    },
  });
  t.after(() => hooks.deregister());
  const { default: worker } = await import('../../src/plataforma/cloudflare/worker.ts');
  const env = { ...VARIABLES_MODELO_EXTERNO, ASSETS: { fetch: async () => new Response('HTML sintético') } };
  for (const ruta of ['/', '/inicio.html']) {
    const respuesta = await worker.fetch(new Request(`https://faro.example${ruta}`), env);
    assert.equal(respuesta.headers.get('content-security-policy'), POLITICA_DE_CONTENIDOS);
  }
});
