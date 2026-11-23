// Contratos del adaptador HTTP local, con entradas sintéticas y sin proveedores.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { type ClientRequest, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';
import { crearServidor } from '../../src/plataforma/node/servidor.ts';

const PLAZO_MS = 1000;
// Tope para un evento que no llega: holgado para un equipo cargado, porque solo decide cuándo se declara el fallo.
const PLAZO_DE_CANCELACION_MS = 5000;
const carpeta = mkdtempSync(join(tmpdir(), 'node-c26-'));
const web = join(carpeta, 'web Año 2026');
const HTTP = { correcto: 200, mal: 400, ausente: 404, host: 421 } as const;
mkdirSync(web);
writeFileSync(join(web, 'inicio.html'), '<h1>Año 2026</h1>');
writeFileSync(join(web, '.assetsignore'), '*.md\nprivado/\n.assetsignore\n');
mkdirSync(join(web, 'privado'));
writeFileSync(join(web, 'privado', 'x.txt'), 'secreto');
writeFileSync(join(carpeta, 'fuera.txt'), 'secreto');
symlinkSync(join(carpeta, 'fuera.txt'), join(web, 'enlace.txt'));
after(() => rmSync(carpeta, { recursive: true, force: true }));

async function arrancar(api: (peticion: Request) => Promise<Response>): Promise<{ servidor: Server; puerto: number }> {
  const servidor = crearServidor({
    web,
    api,
    archivoAutoridadSecciones: join(carpeta, 'autoridad-secciones.sqlite'),
    puerto: 0,
    anfitrion: '127.0.0.1',
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const direccion = servidor.address();
  assert.ok(direccion && typeof direccion === 'object');
  return { servidor, puerto: direccion.port };
}

async function cerrar(servidor: Server): Promise<void> {
  servidor.closeAllConnections();
  await new Promise<void>((resolver, rechazar) => servidor.close((error) => (error ? rechazar(error) : resolver())));
}

function pedir(
  puerto: number,
  ruta: string,
  host?: string,
): Promise<{ estado: number; texto: string; headers: unknown }> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        port: puerto,
        host: '127.0.0.1',
        path: ruta,
        headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'], ...(host ? { host } : {}) },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => {
          texto += trozo;
        });
        res.on('end', () => resolver({ estado: res.statusCode ?? 0, texto, headers: res.headers }));
      },
    );
    req.setTimeout(PLAZO_MS, () => req.destroy(new Error('plazo de prueba')));
    req.on('error', rechazar);
    req.end();
  });
}

/** El plazo solo limita el fallo: el avance depende del evento esperado, no de una pausa. */
async function esperar<T>(resultado: Promise<T>): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<never>((_resolver, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('No llegó el evento esperado')), PLAZO_DE_CANCELACION_MS);
  });
  try {
    return await Promise.race([resultado, plazo]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Un cliente que la prueba corta a propósito: el corte solo puede dar ECONNRESET o «socket hang up». Cualquier otro
 * error se guarda y la prueba lo declara al final, en vez de perderlo.
 */
function clienteCortable(puerto: number): { req: ClientRequest; erroresAjenos: Error[] } {
  const erroresAjenos: Error[] = [];
  const req = request({
    host: '127.0.0.1',
    port: puerto,
    path: '/api/salud',
    headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'] },
  });
  req.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ECONNRESET' && error.message !== 'socket hang up') {
      erroresAjenos.push(error);
    }
  });
  return { req, erroresAjenos };
}

test('rutas codificadas, exclusiones, enlaces y Host ajeno no exponen archivos', async () => {
  const { servidor, puerto } = await arrancar(async () => new Response('API'));
  try {
    for (const ruta of ['/../fuera.txt', '/%2e%2e%2ffuera.txt', '/privado/x.txt', '/enlace.txt']) {
      assert.equal((await pedir(puerto, ruta)).estado, HTTP.ausente, ruta);
    }
    assert.equal((await pedir(puerto, '/%E0%A4%A')).estado, HTTP.mal);
    assert.equal((await pedir(puerto, '/inicio.html', 'otro.example')).estado, HTTP.host);
    const inicio = await pedir(puerto, '/inicio.html');
    assert.equal(inicio.texto, '<h1>Año 2026</h1>');
    assert.equal((inicio.headers as Record<string, unknown>)['x-faro-portal'], 'publico');
    assert.equal((await pedir(puerto, '/api/salud')).texto, 'API');
  } finally {
    await cerrar(servidor);
  }
});

test('un corte del cliente cancela también el cuerpo de respuesta pendiente', async () => {
  const recibido = Promise.withResolvers<void>();
  const cancelado = Promise.withResolvers<void>();
  const { servidor, puerto } = await arrancar(
    async () =>
      new Response(
        new ReadableStream({
          start(controlador) {
            controlador.enqueue(new TextEncoder().encode('primero'));
            recibido.resolve();
          },
          cancel() {
            cancelado.resolve();
          },
        }),
      ),
  );
  const { req, erroresAjenos } = clienteCortable(puerto);
  try {
    req.end();
    await esperar(recibido.promise);
    req.destroy();
    await esperar(cancelado.promise);
    assert.deepEqual(erroresAjenos, []);
  } finally {
    req.destroy();
    await cerrar(servidor);
  }
});

test('el cierre normal del cuerpo recibido no aborta la API ni cambia bytes o cabeceras repetidas', async () => {
  const cuerpoCerrado = Promise.withResolvers<void>();
  const respuestaCerrada = Promise.withResolvers<void>();
  let senal: AbortSignal | undefined;
  const { servidor, puerto } = await arrancar(async (peticion) => {
    senal = peticion.signal;
    const texto = await peticion.text();
    await esperar(cuerpoCerrado.promise);
    assert.equal(peticion.signal.aborted, false);
    return new Response(`${texto}:${peticion.headers.get('x-prueba')}`, { headers: { 'content-type': 'text/plain' } });
  });
  servidor.once('request', (req, res) => {
    req.once('close', cuerpoCerrado.resolve);
    res.once('close', respuestaCerrada.resolve);
  });
  try {
    const recibido = await new Promise<string>((resolver, rechazar) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: puerto,
          path: '/api/informe',
          method: 'POST',
          headers: { 'User-Agent': IDENTIDAD_WEB['User-Agent'], 'x-prueba': ['a', 'b'] },
        },
        (res) => {
          let texto = '';
          res.setEncoding('utf8');
          res.on('data', (trozo: string) => {
            texto += trozo;
          });
          res.on('end', () => resolver(texto));
        },
      );
      req.setTimeout(PLAZO_MS, () => req.destroy(new Error('plazo')));
      req.on('error', rechazar);
      req.end('Año 2026');
    });
    await esperar(respuestaCerrada.promise);
    assert.equal(recibido, 'Año 2026:a, b');
    assert.ok(senal);
    assert.equal(senal.aborted, false, 'El cierre completo de la respuesta tampoco cancela la API');
  } finally {
    await cerrar(servidor);
  }
});

test('el cuerpo de una API que responde después de la desconexión se cancela', async () => {
  const recibida = Promise.withResolvers<void>();
  const abortada = Promise.withResolvers<void>();
  const liberar = Promise.withResolvers<void>();
  const cancelado = Promise.withResolvers<void>();
  const esperaDeAborto = new AbortController();
  const { servidor, puerto } = await arrancar(async (peticion) => {
    const retirada = once(peticion.signal, 'abort', { signal: esperaDeAborto.signal });
    recibida.resolve();
    await retirada;
    abortada.resolve();
    await liberar.promise;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelado.resolve();
        },
      }),
    );
  });
  const { req, erroresAjenos } = clienteCortable(puerto);
  try {
    req.end();
    await esperar(recibida.promise);
    req.destroy();
    await esperar(abortada.promise);
    liberar.resolve();
    await esperar(cancelado.promise);
    assert.deepEqual(erroresAjenos, []);
  } finally {
    esperaDeAborto.abort();
    liberar.resolve();
    req.destroy();
    await cerrar(servidor);
  }
});
