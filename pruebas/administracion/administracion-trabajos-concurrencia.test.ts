import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import type { PoliticaControles } from '../../src/administracion/controles.ts';
import { crearAlmacenPublicoNode } from '../../src/plataforma/acceso-publico/node.ts';
import { abrirSesionDePrueba } from '../ayudas/sesion-de-prueba.ts';

const TAM_HUELLA = 64;
const TAM_SHA = 40;
const AHORA = Date.parse('2026-10-16T12:00:00Z');
const PLAZO_MS = 5000;
const ACCESO = { huellaSesion: 'a'.repeat(TAM_HUELLA), huellaPrincipal: 'b'.repeat(TAM_HUELLA) };
const POLITICA: PoliticaControles = {
  version: 2,
  api: 'deshabilitada',
  mcp: false,
  a2a: false,
};
const CONFIANZA = {
  audiencia: 'https://recibos.prueba',
  repositorioId: '123',
  propietarioId: '456',
  ref: 'refs/heads/main',
  workflowRef: 'equipo/fuente/.github/workflows/actualizar.yml@refs/heads/main',
  sha: 'a'.repeat(TAM_SHA),
  workflowSha: 'b'.repeat(TAM_SHA),
};
function observar(worker: Worker, senal: AbortSignal) {
  const listo = Promise.withResolvers<void>();
  const terminado = Promise.withResolvers<unknown>();
  let preparado = false;
  let resultado: unknown;
  const fallar = (error: unknown) => {
    listo.reject(error);
    terminado.reject(error);
  };
  const abortar = () => fallar(senal.reason);
  senal.addEventListener('abort', abortar, { once: true });
  worker.on('message', (mensaje: unknown) => {
    if (mensaje === 'listo') {
      preparado = true;
      listo.resolve();
    } else {
      resultado = mensaje;
    }
  });
  worker.on('error', fallar);
  worker.on('exit', (code) => {
    senal.removeEventListener('abort', abortar);
    if (code !== 0 || !preparado || resultado === undefined) {
      fallar(new Error('Trabajador incompleto'));
    } else {
      terminado.resolve(resultado);
    }
  });
  void listo.promise.catch(() => undefined);
  void terminado.promise.catch(() => undefined);
  return { worker, listo: listo.promise, terminado: terminado.promise };
}
function iniciar(archivo: string, barrera: SharedArrayBuffer, indice: number, senal: AbortSignal) {
  const modulo = new URL('../../src/plataforma/acceso-publico/node.ts', import.meta.url).href;
  const codigo = `import {parentPort,workerData} from 'node:worker_threads';
import {crearAlmacenPublicoNode} from ${JSON.stringify(modulo)};
const a=crearAlmacenPublicoNode({archivo:workerData.archivo,maxClientes:2,altasIniciales:false,ahora:()=>workerData.ahora});
parentPort.postMessage('listo');Atomics.wait(new Int32Array(workerData.barrera),0,0);
try{parentPort.postMessage(await a.trabajos.reservarTrabajoDeSesion(workerData.acceso,
{solicitudId:workerData.id,accion:'actualizar-datos',revisionEsperada:0},workerData.confianza))}finally{a.close()}`;
  const id = indice === 0 ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
  return observar(
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(codigo)}`), {
      workerData: { archivo, barrera, ahora: AHORA, acceso: ACCESO, confianza: CONFIANZA, id },
    }),
    senal,
  );
}
test('dos conexiones en aislados concurrentes reservan un único trabajo por CAS de revisión', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-trabajos-concurrentes-'));
  const archivo = join(dir, 'panel.sqlite');
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => AHORA });
  await almacen.sesion.prepararPanel(POLITICA);
  await abrirSesionDePrueba(almacen.sesion, ACCESO);
  await almacen.trabajos.prepararTrabajos();
  const cancelacion = new AbortController();
  const reloj = setTimeout(() => cancelacion.abort(new Error('Plazo de concurrencia agotado')), PLAZO_MS);
  const barrera = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const trabajos: ReturnType<typeof iniciar>[] = [];
  try {
    trabajos.push(iniciar(archivo, barrera, 0, cancelacion.signal));
    trabajos.push(iniciar(archivo, barrera, 1, cancelacion.signal));
    const todos = Promise.all(trabajos.map((t) => t.terminado));
    void todos.catch(() => undefined);
    await Promise.all(trabajos.map((t) => t.listo));
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    const resultados = await todos;
    const estados = resultados.map((r) => (r as { estado: string }).estado).sort();
    assert.deepEqual(estados, ['conflicto', 'nueva']);
    assert.equal((await almacen.trabajos.leerTrabajoPrivado()).revision, 1);
  } finally {
    clearTimeout(reloj);
    await Promise.all(trabajos.map((t) => t.worker.terminate()));
    almacen.close();
    rmSync(dir, { recursive: true });
  }
});

function iniciarCiclo(opciones: { archivo: string; barrera: SharedArrayBuffer; indice: number; senal: AbortSignal }) {
  const modulo = new URL('../../src/plataforma/acceso-publico/node.ts', import.meta.url).href;
  const codigo = `import {parentPort,workerData} from 'node:worker_threads';
import {crearAlmacenPublicoNode} from ${JSON.stringify(modulo)};
const a=crearAlmacenPublicoNode({archivo:workerData.archivo,maxClientes:2,altasIniciales:false,ahora:()=>workerData.ahora});
parentPort.postMessage('listo');Atomics.wait(new Int32Array(workerData.barrera),0,0);
try{const ref={solicitudId:'11111111-1111-4111-8111-111111111111',revisionReserva:1};
const {audiencia,...pins}=workerData.confianza;
const r=workerData.indice===0?await a.trabajos.confirmarInicio({...ref,accion:'actualizar-datos'},
{...pins,runId:'789',runAttempt:'1',jti:'jti-sintetico',emitidoEn:workerData.ahora/1000,caducaEn:workerData.ahora/1000+60})
:await a.trabajos.retirarTrabajoDeSesion(workerData.acceso,{...ref,revisionEsperada:1});
parentPort.postMessage(r)}finally{a.close()}`;
  return observar(
    new Worker(new URL(`data:text/javascript,${encodeURIComponent(codigo)}`), {
      workerData: {
        archivo: opciones.archivo,
        barrera: opciones.barrera,
        indice: opciones.indice,
        ahora: AHORA,
        acceso: ACCESO,
        confianza: CONFIANZA,
      },
    }),
    opciones.senal,
  );
}
test('inicio y retirada concurrentes en dos aislados dejan exactamente una transición autorizada', async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'faro-inicio-concurrente-'));
  const archivo = join(dir, 'panel.sqlite');
  const almacen = crearAlmacenPublicoNode({ archivo, maxClientes: 2, ahora: () => AHORA });
  const cancelacion = new AbortController();
  const reloj = setTimeout(() => cancelacion.abort(new Error('Plazo de concurrencia agotado')), PLAZO_MS);
  const barrera = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const trabajos: ReturnType<typeof iniciarCiclo>[] = [];
  try {
    await almacen.sesion.prepararPanel(POLITICA);
    await abrirSesionDePrueba(almacen.sesion, ACCESO);
    await almacen.trabajos.prepararTrabajos();
    await almacen.trabajos.reservarTrabajoDeSesion(
      ACCESO,
      { solicitudId: '11111111-1111-4111-8111-111111111111', accion: 'actualizar-datos', revisionEsperada: 0 },
      CONFIANZA,
    );
    trabajos.push(iniciarCiclo({ archivo, barrera, indice: 0, senal: cancelacion.signal }));
    trabajos.push(iniciarCiclo({ archivo, barrera, indice: 1, senal: cancelacion.signal }));
    const todos = Promise.all(trabajos.map((t) => t.terminado));
    void todos.catch(() => undefined);
    await Promise.all(trabajos.map((t) => t.listo));
    Atomics.store(new Int32Array(barrera), 0, 1);
    Atomics.notify(new Int32Array(barrera), 0);
    const resultados = (await todos) as { estado: string }[];
    const estados = resultados.map((r) => r.estado).sort();
    assert.ok(
      JSON.stringify(estados) === JSON.stringify(['aplicado', 'conflicto']) ||
        JSON.stringify(estados) === JSON.stringify(['conflicto', 'retirado']),
    );
    const estado = await almacen.trabajos.leerTrabajoPrivado();
    assert.equal(estado.revision, 2);
    assert.equal(estado.ultimoTrabajo?.inicioConfirmado, estados.includes('aplicado'));
    assert.equal(estado.ultimoTrabajo?.estado, estados.includes('retirado') ? 'terminado' : 'despachado');
  } finally {
    clearTimeout(reloj);
    await Promise.all(trabajos.map((t) => t.worker.terminate()));
    almacen.close();
    rmSync(dir, { recursive: true });
  }
});
