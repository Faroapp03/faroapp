// La ayuda de los dobles de las pruebas: solo se señala lo que el doble anotó con el proceso vivo, nunca un PID no
// señalable (0, 1, el propio proceso) ni uno cuya hora de inicio haya cambiado; la limpieza ejecuta todos sus pasos sin
// ocultar ningún fallo. Con `process.kill` sustituido, salvo el caso del `sleep` propio, que se termina de verdad.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, type TestContext, test } from 'node:test';
import { listarConPs } from '../../scripts/detener-arbol.ts';
import {
  escribirIdentidades,
  leerIdentidades,
  limpiarEnOrden,
  terminarLoAnotado,
  terminarSiSiguen,
} from '../ayudas/procesos-de-prueba.ts';

const INICIO = 'Mon Nov  2 10:00:00 2026';
/** Un PID que no existe (por encima del máximo de macOS y del habitual en Linux). */
const PID_INEXISTENTE = 2_147_483_000;
/** Un PID que no es entero. */
const PID_NO_ENTERO = 1.5;

function carpeta(t: TestContext): string {
  const ruta = mkdtempSync(join(tmpdir(), 'faro procesos de prueba '));
  t.after(() => rmSync(ruta, { recursive: true, force: true }));
  return ruta;
}

function senalesAnotadas(t: TestContext): string[] {
  const anotadas: string[] = [];
  mock.method(process, 'kill', (destino: number, senal: NodeJS.Signals) => {
    anotadas.push(`${senal} ${destino}`);
    return true;
  });
  t.after(() => mock.restoreAll());
  return anotadas;
}

test('un proceso anotado vivo se termina; tras terminar, no se vuelve a señalar', async (t) => {
  const dormido = spawn('sleep', ['300'], { stdio: 'ignore' });
  t.after(() => dormido.kill('SIGKILL'));
  await once(dormido, 'spawn');
  const archivo = join(carpeta(t), 'identidades.json');
  assert.ok(dormido.pid !== undefined);
  const [visto] = escribirIdentidades(archivo, [dormido.pid]);
  assert.equal(visto?.pid, dormido.pid);
  const cierre = once(dormido, 'exit');
  await terminarLoAnotado(archivo, 'el doble');
  assert.deepEqual(await cierre, [null, 'SIGKILL']);
  const anotadas = senalesAnotadas(t);
  terminarSiSiguen((await leerIdentidades(archivo)) ?? []);
  assert.deepEqual(anotadas, []);
});

test('no se anota la identidad de un proceso que no está vivo o no es anotable', (t) => {
  const archivo = join(carpeta(t), 'identidades.json');
  for (const pid of [0, 1, PID_NO_ENTERO, Number.NaN, PID_INEXISTENTE]) {
    assert.throws(() => escribirIdentidades(archivo, [pid]), /no está vivo o no es anotable/u);
  }
});

test('el doble puede anotarse a sí mismo, pero quien lee no acepta su propio PID', async (t) => {
  const archivo = join(carpeta(t), 'identidades.json');
  const [propio] = escribirIdentidades(archivo, [process.pid]);
  assert.equal(propio?.pid, process.pid);
  await assert.rejects(leerIdentidades(archivo), /no contiene identidades de procesos señalables/u);
});

test('un proceso cuya hora de inicio no es la anotada no se señala (su PID es de otro)', async (t) => {
  const dormido = spawn('sleep', ['300'], { stdio: 'ignore' });
  t.after(() => dormido.kill('SIGKILL'));
  await once(dormido, 'spawn');
  assert.ok(dormido.pid !== undefined);
  const archivo = join(carpeta(t), 'identidades.json');
  const [visto] = escribirIdentidades(archivo, [dormido.pid]);
  assert.ok(visto);
  writeFileSync(archivo, JSON.stringify([{ ...visto, inicio: INICIO }]));
  const anotadas = senalesAnotadas(t);
  await terminarLoAnotado(archivo, 'el doble');
  assert.deepEqual(anotadas, []);
});

test('las identidades leídas solo admiten PID señalables, con grupo y hora de inicio', async (t) => {
  const archivo = join(carpeta(t), 'identidades.json');
  for (const entrada of [
    { pid: 0, pgid: 0, inicio: INICIO },
    { pid: 1, pgid: 1, inicio: INICIO },
    { pid: process.pid, pgid: 1, inicio: INICIO },
    { pid: PID_NO_ENTERO, pgid: 1, inicio: INICIO },
    { pid: 910_000, pgid: 910_000, inicio: '' },
    { pid: 910_000, pgid: 'grupo', inicio: INICIO },
  ]) {
    writeFileSync(archivo, JSON.stringify([entrada]));
    await assert.rejects(leerIdentidades(archivo), /no contiene identidades de procesos señalables/u);
  }
});

test('sin identidades anotadas no se señala nada y se informa', async (t) => {
  const anotadas = senalesAnotadas(t);
  await assert.rejects(
    terminarLoAnotado(join(carpeta(t), 'no-existe.json'), 'el doble del caso'),
    /el doble del caso no anotó la identidad de sus procesos: no se ha señalado ninguno/u,
  );
  assert.deepEqual(anotadas, []);
});

test('terminarSiSiguen no señala un PID no señalable aunque llegue en la lista con su identidad real', (t) => {
  // Con la hora de inicio real (la de `ps`): solo la guarda de PID señalable impide la señal.
  const tabla = listarConPs();
  const propio = tabla.get(process.pid);
  const launchd = tabla.get(1);
  assert.ok(propio && launchd);
  const anotadas = senalesAnotadas(t);
  terminarSiSiguen([{ pid: 0, ppid: 0, pgid: 0, inicio: INICIO, terminado: false }, launchd, propio]);
  assert.deepEqual(anotadas, []);
});

test('la limpieza ejecuta todos sus pasos aunque fallen y no oculta ningún fallo', async () => {
  const hechos: string[] = [];
  await assert.rejects(
    limpiarEnOrden([
      () => {
        hechos.push('primero');
        throw new Error('el primero falla');
      },
      () => {
        hechos.push('segundo');
      },
    ]),
    { message: 'el primero falla' },
  );
  assert.deepEqual(hechos, ['primero', 'segundo']);
  await assert.rejects(
    limpiarEnOrden([
      () => Promise.reject(new Error('uno')),
      () => {
        throw new Error('dos');
      },
    ]),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.length === 2 &&
      error.message === 'la limpieza falló en 2 pasos: uno; dos',
  );
  await limpiarEnOrden([() => undefined]);
});
