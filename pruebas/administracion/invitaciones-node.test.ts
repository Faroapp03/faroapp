// Transporte HTTP real de bucle local: la invitación conserva el origen validado, no acepta Host arbitrario.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { RUTA_ACTIVAR_INVITACION } from '../../src/api/socios/metadatos.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const ESTADO = { creado: 200, prohibido: 403, host: 421, correcto: 200 };
const PLAZO_MS = 2000;

function pedir(puerto: number, host: string, ruta: string, origen = `http://${host}`) {
  return new Promise<{ estado: number; cabeceras: import('node:http').IncomingHttpHeaders; texto: string }>(
    (resolver, rechazar) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: puerto,
          path: ruta,
          method: ruta === RUTA_ACTIVAR_INVITACION ? 'POST' : 'GET',
          headers: { host, origin: origen, 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
        },
        (res) => {
          let texto = '';
          res.setEncoding('utf8');
          res.on('data', (trozo: string) => {
            texto += trozo;
          });
          res.on('error', rechazar);
          res.on('end', () => resolver({ estado: res.statusCode ?? 0, cabeceras: res.headers, texto }));
        },
      );
      req.on('error', rechazar);
      req.setTimeout(PLAZO_MS, () => req.destroy(new Error('Plazo de ensayo local')));
      req.end();
    },
  );
}

test('invitación admite alias locales validados y conserva el rechazo de otro Host u Origin', async () => {
  const carpeta = mkdtempSync(join(tmpdir(), 'autoridad-secciones-prueba-'));
  const servidor = crearServidor({
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    web: fileURLToPath(new URL('../../web/', import.meta.url)),
    puerto: 0,
    anfitrion: '127.0.0.1',
    api: async (req) =>
      new Response(new URL(req.url).origin, {
        status: req.headers.get('origin') === new URL(req.url).origin ? ESTADO.creado : ESTADO.prohibido,
      }),
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  const puerto = direccion.port;
  try {
    for (const alias of ['127.0.0.1', 'localhost', '[::1]']) {
      const host = `${alias}:${puerto}`;
      assert.equal((await pedir(puerto, host, RUTA_ACTIVAR_INVITACION)).estado, ESTADO.creado, alias);
    }
    assert.equal((await pedir(puerto, `ajeno.example:${puerto}`, RUTA_ACTIVAR_INVITACION)).estado, ESTADO.host);
    assert.equal(
      (await pedir(puerto, `localhost:${puerto}`, RUTA_ACTIVAR_INVITACION, 'https://ajeno.example')).estado,
      ESTADO.prohibido,
    );
    const pagina = await pedir(puerto, `localhost:${puerto}`, '/activar-acceso.html');
    assert.equal(pagina.estado, ESTADO.correcto);
    assert.equal(pagina.cabeceras['cache-control'], 'no-store');
    assert.equal(pagina.cabeceras.nel, undefined);
    assert.equal(pagina.cabeceras['speculation-rules'], undefined);
  } finally {
    servidor.closeAllConnections();
    await new Promise<void>((resolve, reject) => servidor.close((error) => (error ? reject(error) : resolve())));
    rmSync(carpeta, { recursive: true, force: true });
  }
});
