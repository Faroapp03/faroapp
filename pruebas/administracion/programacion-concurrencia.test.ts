/** Dos aislados compiten con BEGIN IMMEDIATE sobre el mismo archivo real. */
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const AHORA = Date.parse('2026-10-17T03:00:00Z');
const PLAZO_MS = 5000;
const TAM_HASH = 64;
const TAM_SHA = 40;
const TICK = { eventoEn: AHORA, cron: '0 3 * * *' };
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HASH), huellaPrincipal: 'b'.repeat(TAM_HASH) };
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
const POLITICA = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
} as const;
function iniciar(archivo: string, barrera: SharedArrayBuffer, manual: boolean) {
  const modulo = new URL('../../src/plataforma/acceso-publico/node.ts', import.meta.url).href;
  const codigo = `import {parentPort,workerData as d} from 'node:worker_threads';
import {crearAlmacenPublicoNode} from ${JSON.stringify(modulo)};
const a=crearAlmacenPublicoNode({archivo:d.archivo,maxClientes:2,altasIniciales:false,ahora:()=>d.ahora});
parentPort.postMessage('listo');Atomics.wait(new Int32Array(d.barrera),0,0);
try{const r=d.manual?await a.trabajos.reservarTrabajoDeSesion(d.acceso,{solicitudId:'11111111-1111-4111-8111-111111111111',accion:'actualizar-datos',revisionEsperada:0},d.confianza):await a.trabajos.reservarTrabajoProgramado(d.tick,d.confianza);parentPort.postMessage(r.estado)}finally{a.close()}`;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(codigo)}`), {
    workerData: { archivo, barrera, manual, ahora: AHORA, acceso: ACCESO, confianza: CONFIANZA, tick: TICK },
  });
  const listo = Promise.withResolvers<void>();
  const terminado = Promise.withResolvers<string>();
  let estado: string | undefined;
  worker.on('message', (mensaje: string) => {
    if (mensaje === 'listo') {
      listo.resolve();
    } else {
      estado = mensaje;
    }
  });
  worker.on('error', (error) => {
    listo.reject(error);
    terminado.reject(error);
  });
  worker.on('exit', (code) => {
    if (code === 0 && estado) {
      terminado.resolve(estado);
    } else {
      const error = new Error('Worker incompleto');
      listo.reject(error);
      terminado.reject(error);
    }
  });
  void listo.promise.catch(() => undefined);
  void terminado.promise.catch(() => undefined);
  return { worker, listo: listo.promise, terminado: terminado.promise };
}
async function competir(manual: boolean) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'programacion-concurrente-'));
  const archivo = join(dir, 'panel.sqlite');
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => AHORA });
  const barrera = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const workers: ReturnType<typeof iniciar>[] = [];
  let reloj: ReturnType<typeof setTimeout> | undefined;
  try {
    await almacen.sesion.prepararPanel(POLITICA);
    await abrirSesionDePrueba(almacen.sesion, ACCESO);
    await almacen.trabajos.prepararTrabajos();
    await almacen.activacion.prepararActivacion();
    workers.push(iniciar(archivo, barrera, manual), iniciar(archivo, barrera, false));
    const plazo = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error('Concurrencia agotada')), PLAZO_MS);
    });
    await Promise.race([Promise.all(workers.map((w) => w.listo)), plazo]);
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    const estados = await Promise.race([Promise.all(workers.map((w) => w.terminado)), plazo]);
    assert.equal(estados.filter((estado) => estado === 'nueva').length, 1);
    assert.equal((await almacen.trabajos.leerTrabajoPrivado()).revision, 1);
    assert.equal((await almacen.trabajos.reservarTrabajoProgramado(TICK, CONFIANZA)).estado, 'repetida');
    return estados.sort();
  } finally {
    clearTimeout(reloj);
    await Promise.all(workers.map((w) => w.worker.terminate()));
    almacen.close();
    rmSync(dir, { recursive: true });
  }
}
test('mismo tick concurrente en dos conexiones reales solo concede un despacho', async () => {
  assert.deepEqual(await competir(false), ['nueva', 'repetida']);
});
test('cron y petición manual concurrentes comparten la única reserva y consumen el tick omitido', async () => {
  const estados = await competir(true);
  assert.ok(
    JSON.stringify(estados) === JSON.stringify(['conflicto', 'nueva']) ||
      JSON.stringify(estados) === JSON.stringify(['nueva', 'omitida-ocupado']),
  );
});
