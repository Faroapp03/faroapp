// Sin portal, /acceso-web/estado responde siempre lo mismo: no lee la cookie, no distingue sesiones y no tarda distinto.

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import worker from '../../src/plataforma/cloudflare/worker.ts';
import { CUERPO_SIN_PORTAL, RUTA_ESTADO_DEL_PORTAL } from '../../src/plataforma/estado-del-portal.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const ORIGEN = 'https://sitio.example';
const PLAZO_MS = 5000;
/** El servidor local arranca, responde a las cuatro variantes y se cierra. */
const PLAZO_DEL_SERVIDOR_MS = 10_000;
const REPETICIONES = 300;
/** Diferencia de medianas, en ms, por debajo de la cual dos variantes no se distinguen por el tiempo de respuesta. */
const MAXIMA_DIFERENCIA_MS = 0.5;
/** Las cifras de las medianas que se escriben en el mensaje de fallo. */
const DECIMALES = 3;
/** Sin cookie, con una cookie del portal inválida, con una de forma válida y firma falsa, y con otra cookie ajena. */
const COOKIES = [
  undefined,
  '__Host-faro-portal=basura',
  '__Host-faro-portal=4102444800000.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'otra=1',
];
const ENTORNO = { ASSETS: { fetch: async () => assert.fail('El estado sin portal no consulta archivos') } };

/** Una petición cuya cabecera Cookie no se puede leer: si la respuesta dependiera de ella, la prueba fallaría. */
function sinLeerLaCookie(cookie: string | undefined, metodo = 'GET'): Request {
  const peticion = new Request(`${ORIGEN}${RUTA_ESTADO_DEL_PORTAL}`, {
    method: metodo,
    headers: cookie ? { cookie } : {},
  });
  const cabeceras = peticion.headers;
  const get = cabeceras.get.bind(cabeceras);
  Object.defineProperty(cabeceras, 'get', {
    value: (nombre: string) => {
      assert.notEqual(nombre.toLowerCase(), 'cookie', 'El estado sin portal no lee la cookie');
      return get(nombre);
    },
  });
  return peticion;
}

async function descripcion(respuesta: Response) {
  return {
    estado: respuesta.status,
    cuerpo: await respuesta.text(),
    tipo: respuesta.headers.get('content-type'),
    cache: respuesta.headers.get('cache-control'),
    cookie: respuesta.headers.get('set-cookie'),
  };
}

const mediana = (valores: number[]) => [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)] ?? 0;

test('Worker sin portal: la misma respuesta con y sin cookie, sin leerla y sin diferencias de tiempo', async () => {
  const esperada = {
    estado: ESTADO_HTTP.correcto,
    cuerpo: CUERPO_SIN_PORTAL,
    tipo: 'application/json; charset=utf-8',
    cache: 'no-store',
    cookie: null,
  };
  for (const cookie of COOKIES) {
    assert.deepEqual(await descripcion(await worker.fetch(sinLeerLaCookie(cookie), ENTORNO)), esperada, String(cookie));
  }
  const head = await worker.fetch(sinLeerLaCookie(COOKIES[1], 'HEAD'), ENTORNO);
  assert.equal(head.status, ESTADO_HTTP.correcto);
  assert.equal(await head.text(), '');
  const otro = await worker.fetch(sinLeerLaCookie(undefined, 'POST'), ENTORNO);
  assert.equal(otro.status, ESTADO_HTTP.metodoNoAdmitido);
  assert.equal(otro.headers.get('allow'), 'GET, HEAD');
  assert.equal(otro.headers.get('cache-control'), 'no-store');
  const tiempos = new Map<string | undefined, number[]>(COOKIES.map((cookie) => [cookie, []]));
  for (let vuelta = 0; vuelta < REPETICIONES; vuelta++) {
    for (const cookie of COOKIES) {
      const inicio = performance.now();
      await (await worker.fetch(sinLeerLaCookie(cookie), ENTORNO)).arrayBuffer();
      tiempos.get(cookie)?.push(performance.now() - inicio);
    }
  }
  const medianas = [...tiempos.values()].map(mediana);
  assert.ok(
    Math.max(...medianas) - Math.min(...medianas) < MAXIMA_DIFERENCIA_MS,
    `Medianas (ms): ${medianas.map((valor) => valor.toFixed(DECIMALES)).join(', ')}`,
  );
});

test('servidor local: la misma respuesta con y sin cookie, sin llamar a la API', {
  timeout: PLAZO_DEL_SERVIDOR_MS,
}, async (t) => {
  const carpeta = mkdtempSync(join(tmpdir(), 'estado-del-portal-'));
  const web = join(carpeta, 'web');
  mkdirSync(web);
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    api: async () => assert.fail('El estado sin portal no llama a la API'),
    puerto: 0,
    anfitrion: '127.0.0.1',
    seguridad: null,
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(async () => {
    try {
      servidor.closeAllConnections();
      await new Promise<void>((resolver, rechazar) =>
        servidor.close((error) => (error ? rechazar(error) : resolver())),
      );
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  const vistas = [];
  for (const cookie of COOKIES) {
    const respuesta = await fetch(`http://127.0.0.1:${direccion.port}${RUTA_ESTADO_DEL_PORTAL}`, {
      headers: { ...IDENTIDAD_WEB, ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    vistas.push(await descripcion(respuesta));
  }
  for (const vista of vistas) {
    assert.deepEqual(vista, { ...vistas[0], estado: ESTADO_HTTP.correcto, cuerpo: CUERPO_SIN_PORTAL, cookie: null });
  }
  assert.equal(vistas[0]?.cache, 'no-store');
  assert.equal(vistas[0]?.tipo, 'application/json; charset=utf-8');
});
