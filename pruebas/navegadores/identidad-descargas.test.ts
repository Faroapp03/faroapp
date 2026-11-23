/** HTTP y TLS reales solo en loopback; certificados públicos de prueba, sin credenciales de una instalación. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http, { type IncomingMessage, type RequestOptions, type Server } from 'node:http';
import https from 'node:https';
import { after, before, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import '../../herramientas/red/identidad-http.cjs';

const PLAZO_MS = 10_000;
const cert = readFileSync(new URL('./tls-sintetico.pem', import.meta.url));
const key = readFileSync(new URL('./tls-clave-sintetica.pem', import.meta.url));
let origenHttp = '';
let origenTls = '';
const servidores: Server[] = [];

async function escuchar(servidor: Server): Promise<string> {
  servidores.push(servidor);
  await new Promise<void>((ok, fallo) => {
    servidor.once('error', fallo);
    servidor.listen(0, '127.0.0.1', ok);
  });
  const direccion = servidor.address();
  assert(direccion && typeof direccion !== 'string');
  return `127.0.0.1:${direccion.port}`;
}

before(async () => {
  origenTls = `https://${await escuchar(
    https.createServer({ cert, key }, (req, res) => {
      res.end(
        JSON.stringify({
          identidad: Object.fromEntries(
            Object.keys(IDENTIDAD_WEB).map((nombre) => [nombre, req.headers[nombre.toLowerCase()]]),
          ),
          propia: req.headers['x-propia'],
          ruta: req.url,
        }),
      );
    }),
  )}`;
  origenHttp = `http://${await escuchar(
    http.createServer((req, res) => {
      if (req.url === '/redireccion') {
        res.writeHead(ESTADO_HTTP.encontradoEnOtraDireccion, { location: `${origenTls}/destino` });
      }
      res.end(
        JSON.stringify({
          identidad: Object.fromEntries(
            Object.keys(IDENTIDAD_WEB).map((nombre) => [nombre, req.headers[nombre.toLowerCase()]]),
          ),
          propia: req.headers['x-propia'],
          ruta: req.url,
        }),
      );
    }),
  )}`;
});

after(async () => {
  for (const servidor of servidores) {
    servidor.closeAllConnections();
    await new Promise<void>((ok, fallo) => servidor.close((error) => (error ? fallo(error) : ok())));
  }
});

function leer(respuesta: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fallo) => {
    let texto = '';
    respuesta.setEncoding('utf8');
    respuesta.on('data', (trozo: string) => {
      texto += trozo;
    });
    respuesta.once('error', fallo);
    respuesta.once('end', () => {
      try {
        ok(JSON.parse(texto) as unknown);
      } catch (error) {
        fallo(error);
      }
    });
  });
}

test('request conserva firmas URL, string y opciones, callback y cabeceras ajenas', { timeout: PLAZO_MS }, async () => {
  const url = new URL(`${origenHttp}/firmas?q=uno`);
  const opciones: RequestOptions = { headers: { 'user-agent': 'NoDebeSalir', 'x-propia': 'conservar' }, agent: false };
  const pedir = (forma: 'url' | 'string' | 'opciones') =>
    new Promise<unknown>((ok, fallo) => {
      const callback = (respuesta: IncomingMessage): void => {
        void leer(respuesta).then(ok, fallo);
      };
      const solicitud =
        forma === 'opciones'
          ? http.request(
              { ...opciones, hostname: url.hostname, port: url.port, path: url.pathname + url.search },
              callback,
            )
          : http.request(forma === 'url' ? url : url.href, opciones, callback);
      solicitud.once('error', fallo);
      solicitud.end();
    });
  for (const forma of ['url', 'string', 'opciones'] as const) {
    assert.deepEqual(await pedir(forma), { identidad: IDENTIDAD_WEB, propia: 'conservar', ruta: '/firmas?q=uno' });
  }
  assert.equal(
    opciones.headers && 'user-agent' in opciones.headers ? opciones.headers['user-agent'] : undefined,
    'NoDebeSalir',
  );
});

test('get sigue redirección HTTP→HTTPS preservando CA, verificación TLS y callback', {
  timeout: PLAZO_MS,
}, async () => {
  const resultado = await new Promise<unknown>((ok, fallo) => {
    http
      .get(`${origenHttp}/redireccion`, { headers: { 'User-Agent': 'NoDebeSalir' } }, (respuesta) => {
        assert.equal(respuesta.statusCode, ESTADO_HTTP.encontradoEnOtraDireccion);
        assert(respuesta.headers.location);
        respuesta.resume();
        https
          .get(
            new URL(respuesta.headers.location),
            {
              ca: cert,
              rejectUnauthorized: true,
              agent: false,
              headers: { 'User-Agent': 'NoDebeSalir', 'x-propia': 'tls-verificado' },
            },
            (destino) => {
              void leer(destino).then(ok, fallo);
            },
          )
          .once('error', fallo);
      })
      .once('error', fallo);
  });
  assert.deepEqual(resultado, { identidad: IDENTIDAD_WEB, propia: 'tls-verificado', ruta: '/destino' });
});

test('el preload conserva el rechazo TLS de una CA no confiada', { timeout: PLAZO_MS }, async () => {
  await assert.rejects(
    new Promise<void>((ok, fallo) => {
      https
        .get(`${origenTls}/sin-confianza`, { rejectUnauthorized: true, agent: false }, (respuesta) => {
          respuesta.resume();
          ok();
        })
        .once('error', fallo);
    }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT',
  );
});
