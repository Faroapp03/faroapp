// Aislamiento del paquete Node: las rutas listadas nunca publican destinos enlazados fuera del paquete.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';

const CONTENIDO = '{"fixture":"archivo ordinario valido"}';
const EXTERNO = '{"fixture":"destino fuera del paquete"}';
const PLAZO_MS = 2000;
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');
interface Lectura {
  estado: number;
  texto: string;
  cache: string | undefined;
}

function fixture() {
  const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'paquete-enlaces-'));
  const web = join(raiz, 'web'),
    paquete = join(raiz, 'datos');
  mkdirSync(web);
  mkdirSync(paquete);
  writeFileSync(join(web, '.assetsignore'), '.assetsignore\n');
  writeFileSync(join(paquete, 'ordinario.json'), CONTENIDO);
  writeFileSync(join(raiz, 'fuera.json'), EXTERNO);
  symlinkSync(join(raiz, 'fuera.json'), join(paquete, 'enlace.json'));
  const manifiesto = JSON.stringify({
    'ordinario.json': { sha256: sha(CONTENIDO) },
    'enlace.json': { sha256: sha(EXTERNO) },
  });
  writeFileSync(join(paquete, 'manifiesto.json'), manifiesto);
  return { raiz, web, paquete, version: versionDelPaquete(sha(manifiesto)) };
}

function pedir(puerto: number, version: string, archivo: string): Promise<Lectura> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: puerto,
        path: `/paquete/${version}/${archivo}`,
        headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => {
          texto += trozo;
        });
        res.on('end', () => resolver({ estado: res.statusCode ?? 0, texto, cache: res.headers['cache-control'] }));
      },
    );
    req.setTimeout(PLAZO_MS, () => req.destroy(new Error('plazo de prueba')));
    req.on('error', rechazar);
    req.end();
  });
}

test('paquete sirve un JSON ordinario y rechaza un enlace externo incluso si ambos tienen huella correcta', async (t) => {
  const { raiz, web, paquete, version } = fixture();
  const servidor = crearServidor({
    web,
    archivoAutoridadSecciones: join(raiz, 'autoridad-secciones.sqlite'),
    paquete,
    api: async () => new Response('API sintética'),
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise<void>((resolver, rechazar) => servidor.close((e) => (e ? rechazar(e) : resolver())));
    rmSync(raiz, { recursive: true, force: true });
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  const ordinario = await pedir(direccion.port, version, 'ordinario.json');
  assert.equal(ordinario.estado, ESTADO_HTTP.correcto);
  assert.equal(ordinario.texto, CONTENIDO);
  assert.match(ordinario.cache ?? '', /immutable/);
  const enlace = await pedir(direccion.port, version, 'enlace.json');
  assert.equal(enlace.estado, ESTADO_HTTP.noEncontrado);
  assert.ok(!enlace.texto.includes(EXTERNO));
});
