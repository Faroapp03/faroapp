// Los tres cortes de un paso (plazo, salida excesiva e interrupción) con un doble que deja descendientes en otro grupo,
// como un navegador: el árbol entero termina, el primer fallo se conserva y lo que la limpieza no resuelve se informa
// en líneas aparte. Los dobles anotan sus PID y su identidad (hora de inicio) mientras viven, antes de colgarse, y
// cada caso termina al final, aunque falle, solo los que sigan siendo los mismos.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { FalloDeComprobacion } from '../../scripts/fallo-de-comprobacion.ts';
import { ejecutarPaso, type Paso } from '../../scripts/verificar.ts';
import { limpiarEnOrden, terminarLoAnotado } from '../ayudas/procesos-de-prueba.ts';
import { conPlazo } from '../navegadores/recursos-del-caso.mjs';

const MODULO_VERIFICAR = new URL('../../scripts/verificar.ts', import.meta.url).href;
const MODULO_PROCESOS = new URL('../ayudas/procesos-de-prueba.ts', import.meta.url).href;
/** El plazo de los pasos colgados y, menor, lo que se espera a que el doble anote sus PID. */
const PLAZO_DEL_PASO_MS = 5000;
const TOPE_DE_LAS_MARCAS_MS = 3000;
/** Lo más que puede tardar un caso en cerrarse tras su corte: dos esperas de 1 s de la limpieza y el cierre. */
const TOPE_DEL_CIERRE_MS = 10_000;
const CODIGO_DEL_FALLO = 1;
/** Lo que espera la segunda señal o el corte siguiente, dentro de la limpieza (que dura al menos 1 s si se ignora TERM). */
const DENTRO_DE_LA_LIMPIEZA_MS = 300;
const PLAZO_CORTO_MS = 500;
const PLAZO_TRAS_LA_SALIDA_MS = 1000;
const ARCHIVO_DE_PIDS = 'pids.txt';
/** Las identidades (PID y hora de inicio) que escribe el doble mientras sus procesos viven, antes de ARCHIVO_DE_PIDS. */
const ARCHIVO_DE_IDENTIDADES = 'identidades.json';
/** El paso, su hijo en otro grupo y el nieto; el escapado va después. */
const PIDS_DEL_ARBOL = 3;

/** Cómo se comporta el doble del paso. */
interface Comportamiento {
  /** El hijo del otro grupo y su nieto ignoran SIGTERM: la limpieza tiene que llegar a SIGKILL. */
  readonly hijoIgnoraTerm?: boolean;
  /** El propio paso ignora SIGTERM: no se cierra hasta SIGKILL. */
  readonly pasoIgnoraTerm?: boolean;
  /** Tras anotar sus PID, escribe más de lo que admite la comprobación. */
  readonly salidaExcesiva?: boolean;
  /** Deja además un `sleep` fuera del árbol (su padre termina enseguida) que conserva la salida del paso. */
  readonly escapado?: boolean;
}

/**
 * Un área con espacios en su nombre. Al terminar el caso, aunque falle, primero se detiene lo que el doble haya dejado
 * vivo, solo si anotó su identidad mientras vivía (terminarLoAnotado: sin ella no se señala nada y se informa), y
 * después se elimina el área.
 */
function areaDePrueba(contexto: TestContext): string {
  const area = mkdtempSync(join(tmpdir(), 'faro cortes #% '));
  contexto.after(() =>
    limpiarEnOrden([
      () => terminarLoAnotado(join(area, ARCHIVO_DE_IDENTIDADES), 'el doble del paso'),
      () => rmSync(area, { recursive: true, force: true }),
    ]),
  );
  return area;
}

/** Si el PID sigue ejecutándose (un zombi ya ha terminado). */
function sigueEnEjecucion(pid: number): boolean {
  const estado = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  return estado.status === 0 && !/^Z/u.test(estado.stdout.trim());
}

/** Los PID que anota el doble (el paso, su hijo en otro grupo, el nieto y, si lo hay, el escapado). */
function leerPids(archivo: string): number[] {
  return existsSync(archivo) ? readFileSync(archivo, 'utf8').trim().split(' ').map(Number) : [];
}

/** Espera acotada a que el doble anote sus PID. */
async function esperarPids(archivo: string): Promise<number[]> {
  const limite = Date.now() + TOPE_DE_LAS_MARCAS_MS;
  while (!existsSync(archivo)) {
    assert.ok(Date.now() < limite, 'el doble no anota sus PID a tiempo');
    await esperar(10);
  }
  return leerPids(archivo);
}

/** Un `/bin/sh` en otro grupo que deja un `sleep` y anota su PID en `marca`; con `ignora`, los dos ignoran SIGTERM. */
const hijoDeOtroGrupo = (marca: string, ignora: boolean, conserva: boolean): string =>
  `spawn('/bin/sh', ['-c', ${JSON.stringify(`${ignora ? "trap '' TERM; " : ''}sleep 300 & echo $! > "$1"${conserva ? '' : '; wait'}`)}, 'sh', ${JSON.stringify(marca)}],` +
  ` { detached: true, stdio: ${conserva ? "['ignore', 'inherit', 'inherit']" : "'ignore'"} })`;

/** El paso doble: lanza el hijo de otro grupo (y el escapado), anota los PID de una vez y se cuelga. */
function doble(area: string, comportamiento: Comportamiento): { paso: Paso; pids: string } {
  const pids = join(area, ARCHIVO_DE_PIDS);
  const nieto = join(area, 'nieto.txt');
  const escapado = join(area, 'escapado.txt');
  const marcas = [nieto, ...(comportamiento.escapado ? [escapado] : [])];
  const codigo = [
    "import { spawn } from 'node:child_process'; import fs from 'node:fs';",
    comportamiento.pasoIgnoraTerm ? "process.on('SIGTERM', () => {});" : '',
    `const hijo = ${hijoDeOtroGrupo(nieto, comportamiento.hijoIgnoraTerm === true, false)}; hijo.unref();`,
    comportamiento.escapado ? `${hijoDeOtroGrupo(escapado, false, true)}.unref();` : '',
    `const marcas = ${JSON.stringify(marcas)};`,
    'const leidas = () => marcas.map((m) => (fs.existsSync(m) ? fs.readFileSync(m, "utf8").trim() : ""));',
    `const { escribirIdentidades } = await import(${JSON.stringify(MODULO_PROCESOS)});`,
    'const listo = () => {',
    '  const valores = leidas(); if (valores.some((v) => !v)) { setTimeout(listo, 10); return; }',
    '  const todos = [process.pid, hijo.pid, ...valores.map(Number)];',
    `  escribirIdentidades(${JSON.stringify(join(area, ARCHIVO_DE_IDENTIDADES))}, todos);`,
    `  fs.writeFileSync(${JSON.stringify(`${pids}.tmp`)}, todos.join(' '));`,
    `  fs.renameSync(${JSON.stringify(`${pids}.tmp`)}, ${JSON.stringify(pids)});`,
    comportamiento.salidaExcesiva ? "  process.stdout.write('x'.repeat(2_000_000));" : '',
    '};',
    'listo(); setInterval(() => {}, 1000);',
  ].join('\n');
  return {
    paso: { nombre: 'Caso local', comando: process.execPath, argumentos: ['--input-type=module', '--eval', codigo] },
    pids,
  };
}

/** Una verificación aparte que ejecuta el paso y escribe su fallo en stderr, para poder interrumpirla con señales. */
function verificacionAparte(area: string, paso: Paso, plazoMs: number): ChildProcess {
  const codigo =
    `import { ejecutarPaso } from ${JSON.stringify(MODULO_VERIFICAR)};` +
    `try { await ejecutarPaso(${JSON.stringify(paso)}, ${JSON.stringify(area)}, ${plazoMs}); }` +
    'catch (error) { process.stderr.write(String(error.message)); process.exitCode = 1; }';
  return spawn(process.execPath, ['--input-type=module', '--eval', codigo], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Espera a que termine la verificación aparte y devuelve su código, su señal y lo que escribió en stderr. */
async function finDeLaVerificacion(
  verificacion: ChildProcess,
): Promise<{ codigo: unknown; senal: unknown; error: string }> {
  let error = '';
  verificacion.stderr?.setEncoding('utf8').on('data', (texto: string) => {
    error += texto;
  });
  const [codigo, senal] = await conPlazo(
    once(verificacion, 'exit'),
    PLAZO_DEL_PASO_MS + TOPE_DEL_CIERRE_MS,
    'la verificación no terminó',
  );
  return { codigo, senal, error };
}

/** Detiene la verificación aparte si el caso falla antes de que termine. */
function detenerAlFinal(contexto: TestContext, verificacion: ChildProcess): void {
  contexto.after(() => {
    if (verificacion.exitCode === null && verificacion.signalCode === null) {
      verificacion.kill('SIGKILL');
    }
  });
}

function sinVivos(pids: readonly number[]): void {
  const vivos = pids.filter(sigueEnEjecucion);
  assert.deepEqual(vivos, [], `siguen vivos: ${vivos.join(', ')}`);
}

/** El fallo del paso, con su primera línea. */
async function falloDelPaso(promesa: Promise<string>): Promise<FalloDeComprobacion> {
  const error = await conPlazo(
    promesa.then(
      () => null,
      (fallo: unknown) => fallo,
    ),
    PLAZO_DEL_PASO_MS + TOPE_DEL_CIERRE_MS,
    'el paso no terminó',
  );
  assert.ok(error instanceof FalloDeComprobacion, String(error));
  return error;
}

test('el plazo detiene también los descendientes que el paso lanza en otro grupo, como un navegador', async (contexto) => {
  const area = areaDePrueba(contexto);
  const { paso, pids } = doble(area, {});
  const ejecucion = ejecutarPaso(paso, area, PLAZO_DEL_PASO_MS);
  const anotados = await esperarPids(pids);
  const fallo = await falloDelPaso(ejecucion);
  assert.match(fallo.message, new RegExp(`^Caso local: supera el plazo de ${PLAZO_DEL_PASO_MS} ms$`, 'mu'));
  assert.equal(fallo.codigo, undefined);
  sinVivos(anotados);
});

test('una salida excesiva detiene también los descendientes de otro grupo', async (contexto) => {
  const area = areaDePrueba(contexto);
  const { paso, pids } = doble(area, { salidaExcesiva: true });
  const ejecucion = ejecutarPaso(paso, area, PLAZO_DEL_PASO_MS);
  const anotados = await esperarPids(pids);
  const fallo = await falloDelPaso(ejecucion);
  assert.match(fallo.message, /^La salida supera el límite de la comprobación/u);
  sinVivos(anotados);
});

test('una interrupción detiene también los descendientes de otro grupo y termina con su fallo', async (contexto) => {
  const area = areaDePrueba(contexto);
  const { paso, pids } = doble(area, {});
  const verificacion = verificacionAparte(area, paso, PLAZO_DEL_PASO_MS);
  detenerAlFinal(contexto, verificacion);
  const fin = finDeLaVerificacion(verificacion);
  const anotados = await esperarPids(pids);
  verificacion.kill('SIGINT');
  const { codigo, senal, error } = await fin;
  assert.equal(senal, null);
  assert.equal(codigo, CODIGO_DEL_FALLO);
  assert.match(error, /^Comprobación interrumpida por SIGINT/u);
  sinVivos(anotados);
});

test('una segunda señal durante la limpieza no interrumpe la verificación a medias', async (contexto) => {
  const area = areaDePrueba(contexto);
  // El paso termina con SIGTERM, pero su hijo de otro grupo lo ignora: la limpieza sigue tras el cierre del paso.
  const { paso, pids } = doble(area, { hijoIgnoraTerm: true });
  const verificacion = verificacionAparte(area, paso, PLAZO_DEL_PASO_MS);
  detenerAlFinal(contexto, verificacion);
  const fin = finDeLaVerificacion(verificacion);
  const anotados = await esperarPids(pids);
  verificacion.kill('SIGINT');
  await esperar(DENTRO_DE_LA_LIMPIEZA_MS);
  verificacion.kill('SIGINT');
  const { codigo, senal, error } = await fin;
  assert.equal(senal, null, 'la segunda señal no mata la verificación');
  assert.equal(codigo, CODIGO_DEL_FALLO);
  assert.match(error, /^Comprobación interrumpida por SIGINT/u);
  sinVivos(anotados);
});

test('una interrupción después del plazo no sustituye el fallo del plazo', async (contexto) => {
  const area = areaDePrueba(contexto);
  const { paso, pids } = doble(area, { pasoIgnoraTerm: true, hijoIgnoraTerm: true });
  const verificacion = verificacionAparte(area, paso, PLAZO_CORTO_MS);
  detenerAlFinal(contexto, verificacion);
  const fin = finDeLaVerificacion(verificacion);
  const anotados = await esperarPids(pids);
  await esperar(PLAZO_CORTO_MS + DENTRO_DE_LA_LIMPIEZA_MS);
  verificacion.kill('SIGINT');
  const { codigo, senal, error } = await fin;
  assert.equal(senal, null);
  assert.equal(codigo, CODIGO_DEL_FALLO);
  assert.match(error, new RegExp(`^Caso local: supera el plazo de ${PLAZO_CORTO_MS} ms`, 'u'));
  sinVivos(anotados);
});

test('un plazo que vence durante la limpieza de una salida excesiva no sustituye su fallo', async (contexto) => {
  const area = areaDePrueba(contexto);
  // El paso ignora SIGTERM: sigue vivo, y su plazo corriendo, durante el primer segundo de la limpieza.
  const { paso, pids } = doble(area, { salidaExcesiva: true, pasoIgnoraTerm: true });
  const ejecucion = ejecutarPaso(paso, area, PLAZO_TRAS_LA_SALIDA_MS);
  const anotados = await esperarPids(pids);
  const fallo = await falloDelPaso(ejecucion);
  assert.match(fallo.message, /^La salida supera el límite de la comprobación/u);
  sinVivos(anotados);
});

test('una salida que sigue abierta tras la limpieza se cierra y se informa sin cambiar la primera línea', async (contexto) => {
  const area = areaDePrueba(contexto);
  // El escapado no es descendiente cuando se toma la tabla (su padre ya terminó) y conserva la salida del paso.
  const { paso, pids } = doble(area, { escapado: true });
  const ejecucion = ejecutarPaso(paso, area, PLAZO_CORTO_MS);
  const anotados = await esperarPids(pids);
  const fallo = await falloDelPaso(ejecucion);
  const [primera, ...resto] = fallo.message.split('\n');
  assert.equal(primera, `Caso local: supera el plazo de ${PLAZO_CORTO_MS} ms`);
  assert.ok(
    resto.some((linea) => linea.includes('la salida del paso sigue abierta tras la limpieza')),
    fallo.message,
  );
  sinVivos(anotados.slice(0, PIDS_DEL_ARBOL));
});
