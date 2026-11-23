// Métodos del servidor local en los archivos de la web y del paquete: GET y HEAD sirven; los demás, 405 como el Worker.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';
import { versionDelPaquete } from '../../src/plataforma/paquete-publicado.ts';

const PLAZO_MS = 2000;
const PAGINA = '<h1>Página pública de prueba</h1>';
const ESTILO = 'body{color:#123456}';
const DATO = '{"fixture":"archivo del paquete"}';
const OTROS_METODOS = ['POST', 'PUT', 'OPTIONS', 'TRACE', 'DELETE', 'PATCH'] as const;
const CABECERAS_DE_SEGURIDAD = ['content-security-policy', 'x-content-type-options', 'referrer-policy'] as const;
const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');

interface Lectura {
  estado: number;
  texto: string;
  cabeceras: IncomingHttpHeaders;
}

const raiz = mkdtempSync(join(realpathSync(tmpdir()), 'node-metodos-'));
const web = join(raiz, 'web');
const paquete = join(raiz, 'datos');
mkdirSync(web);
mkdirSync(paquete);
writeFileSync(join(web, '.assetsignore'), '.assetsignore\n');
writeFileSync(join(web, 'inicio.html'), PAGINA);
writeFileSync(join(web, 'estilo.css'), ESTILO);
writeFileSync(join(paquete, 'dato.json'), DATO);
const manifiesto = JSON.stringify({ 'dato.json': { sha256: sha(DATO) } });
writeFileSync(join(paquete, 'manifiesto.json'), manifiesto);
const RUTA_DEL_PAQUETE = `/paquete/${versionDelPaquete(sha(manifiesto))}/dato.json`;

let servidor: Server;
let puerto = 0;

before(async () => {
  servidor = crearServidor({
    web,
    paquete,
    archivoAutoridadSecciones: join(raiz, 'autoridad-secciones.sqlite'),
    api: async () => new Response('API sintética'),
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  puerto = direccion.port;
});

after(async () => {
  servidor.closeAllConnections();
  await new Promise<void>((resolver, rechazar) => servidor.close((e) => (e ? rechazar(e) : resolver())));
  rmSync(raiz, { recursive: true, force: true });
});

function pedir(metodo: string, ruta: string): Promise<Lectura> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: puerto,
        method: metodo,
        path: ruta,
        headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => {
          texto += trozo;
        });
        res.on('end', () => resolver({ estado: res.statusCode ?? 0, texto, cabeceras: res.headers }));
      },
    );
    req.setTimeout(PLAZO_MS, () => req.destroy(new Error('plazo de prueba')));
    req.on('error', rechazar);
    req.end();
  });
}

const ARCHIVOS = [
  { ruta: '/inicio.html', contenido: PAGINA },
  { ruta: '/estilo.css', contenido: ESTILO },
  { ruta: RUTA_DEL_PAQUETE, contenido: DATO },
] as const;

test('GET y HEAD siguen sirviendo los archivos de la web y del paquete', async () => {
  for (const { ruta, contenido } of ARCHIVOS) {
    const completa = await pedir('GET', ruta);
    assert.equal(completa.estado, ESTADO_HTTP.correcto, ruta);
    assert.equal(completa.texto, contenido, ruta);
    const cabecera = await pedir('HEAD', ruta);
    assert.equal(cabecera.estado, ESTADO_HTTP.correcto, ruta);
    assert.equal(cabecera.texto, '', ruta);
    assert.equal(cabecera.cabeceras['content-type'], completa.cabeceras['content-type'], ruta);
    assert.equal(cabecera.cabeceras['cache-control'], completa.cabeceras['cache-control'], ruta);
    // La portada se marca como pública y todos los archivos llevan las cabeceras de seguridad, también con HEAD.
    assert.equal(completa.cabeceras['x-faro-portal'], ruta === '/inicio.html' ? 'publico' : undefined, ruta);
    assert.equal(cabecera.cabeceras['x-faro-portal'], completa.cabeceras['x-faro-portal'], ruta);
    for (const nombre of CABECERAS_DE_SEGURIDAD) {
      assert.ok(completa.cabeceras[nombre], `${ruta}: ${nombre}`);
      assert.equal(cabecera.cabeceras[nombre], completa.cabeceras[nombre], `${ruta}: ${nombre}`);
    }
  }
});

test('otro método a un archivo de la web o del paquete da 405 con Allow: GET, HEAD y sin el contenido', async () => {
  const ausente = await pedir('GET', '/no-existe.html');
  assert.equal(ausente.estado, ESTADO_HTTP.noEncontrado);
  for (const { ruta, contenido } of ARCHIVOS) {
    const servida = await pedir('GET', ruta);
    for (const metodo of OTROS_METODOS) {
      const respuesta = await pedir(metodo, ruta);
      const celda = `${metodo} ${ruta}`;
      assert.equal(respuesta.estado, ESTADO_HTTP.metodoNoAdmitido, celda);
      assert.equal(respuesta.cabeceras.allow, 'GET, HEAD', celda);
      assert.ok(!respuesta.texto.includes(contenido), celda);
      assert.equal(respuesta.cabeceras['x-faro-portal'], undefined, celda);
      assert.notEqual(respuesta.cabeceras['cache-control'], servida.cabeceras['cache-control'], celda);
      for (const nombre of CABECERAS_DE_SEGURIDAD) {
        assert.equal(respuesta.cabeceras[nombre], ausente.cabeceras[nombre], `${celda}: ${nombre}`);
      }
    }
  }
});

test('otro método a un archivo inexistente sigue dando 404', async () => {
  for (const metodo of OTROS_METODOS) {
    assert.equal((await pedir(metodo, '/no-existe.html')).estado, ESTADO_HTTP.noEncontrado, metodo);
  }
});
