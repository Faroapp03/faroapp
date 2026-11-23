/**
 * Sonda de la guardia de red: no forma parte de la batería (no se llama `*.test.ts`). La ejecuta `guardia-red-pruebas.test.ts`
 * con la orden real de `scripts/verificar.ts` y comprueba cada vía de salida en este proceso, en un hijo y en workers.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import dns, { lookup } from 'node:dns';
import net from 'node:net';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

const BLOQUEO = 'ECONEXIONEXTERNAPROHIBIDA';
const DESTINO = '192.0.2.10';
const PUERTO = 443;
const PLAZO_HIJO_MS = 20_000;
const PUERTO_DNS = 53;

function codigoDe(intento: () => unknown): string {
  try {
    intento();
    return 'salio';
  } catch (fallo) {
    return (fallo as { code?: string }).code ?? 'otro';
  }
}

function enWorker(programa: string | URL, evaluar: boolean): Promise<string> {
  return new Promise((resolver) => {
    const worker = new Worker(programa, { eval: evaluar });
    worker.on('message', (mensaje) => {
      resolver(String(mensaje));
      void worker.terminate();
    });
    worker.on('error', (fallo: Error) => resolver(`error ${fallo.message}`));
  });
}

test('ninguna vía sale de este proceso: net, dns, udp y fetch', async () => {
  assert.equal(
    codigoDe(() => net.connect({ host: DESTINO, port: PUERTO })),
    BLOQUEO,
  );
  assert.equal(
    codigoDe(() => lookup('ejemplo.invalid', () => undefined)),
    BLOQUEO,
  );
  assert.equal(
    codigoDe(() => dns.resolve4('ejemplo.invalid', () => undefined)),
    BLOQUEO,
  );
  assert.equal(
    codigoDe(() => new dns.Resolver().resolveTxt('ejemplo.invalid', () => undefined)),
    BLOQUEO,
  );
  await assert.rejects(dns.promises.resolve('ejemplo.invalid'), { code: BLOQUEO });
  assert.equal(
    codigoDe(() => dgram.createSocket('udp4').send(Buffer.from('x'), PUERTO_DNS, DESTINO)),
    BLOQUEO,
  );
  await assert.rejects(
    fetch(`https://${DESTINO}/`),
    (fallo: { cause?: { code?: string } }) => fallo.cause?.code === BLOQUEO,
  );
});

test('un proceso Node hijo hereda la guardia', () => {
  const hijo = execFileSync(
    process.execPath,
    [
      '-e',
      `try { require('node:net').connect({ host: '${DESTINO}', port: ${PUERTO} }); console.log('salio') } catch (e) { console.log(e.code) }`,
    ],
    { encoding: 'utf8', timeout: PLAZO_HIJO_MS },
  ).trim();
  assert.equal(hijo, BLOQUEO, 'un proceso Node hijo hereda la guardia');
});

test('los workers con eval y de módulo heredan la guardia', async () => {
  const intento = `try { net.connect({ host: '${DESTINO}', port: ${PUERTO} }); parentPort.postMessage('salio') } catch (e) { parentPort.postMessage(e.code) }`;
  const cjs = `const { parentPort } = require('node:worker_threads'); const net = require('node:net'); ${intento}`;
  const esm = `import { parentPort } from 'node:worker_threads'; import net from 'node:net'; ${intento}`;
  assert.equal(await enWorker(cjs, true), BLOQUEO, 'un worker con eval');
  assert.equal(
    await enWorker(new URL(`data:text/javascript,${encodeURIComponent(esm)}`), false),
    BLOQUEO,
    'un worker de módulo',
  );
});
