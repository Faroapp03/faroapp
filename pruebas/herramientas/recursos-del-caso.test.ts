// Un caso de node:test que vence con recursos abiertos los deja cerrados si los registra con recursosDelCaso: lanza
// pruebas/fixtures/recursos-del-caso/caso-colgado.mjs como archivo aparte y comprueba que el archivo termina y que no
// quedan su servidor, su proceso ni su carpeta. Lo que el doble deje vivo se termina al final, aunque falle la prueba,
// solo si el doble anotó su identidad mientras vivía. Sin `ps`, forzarProcesos no señala nada y dice por qué.

import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detenerArbol } from '../../scripts/detener-arbol.ts';
import { limpiarEnOrden, terminarLoAnotado } from '../ayudas/procesos-de-prueba.ts';
import { conPlazo } from '../navegadores/recursos-del-caso.mjs';

const CASO_COLGADO = fileURLToPath(new URL('../fixtures/recursos-del-caso/caso-colgado.mjs', import.meta.url));
const CASOS_DE_CIERRE = fileURLToPath(new URL('../fixtures/recursos-del-caso/casos-de-cierre.mjs', import.meta.url));
const MODULO_RECURSOS = new URL('../navegadores/recursos-del-caso.mjs', import.meta.url).href;
/** Lo más que puede tardar `forzarProcesos` sin `ps`: no espera a ningún proceso. */
const PLAZO_SIN_PS_MS = 10_000;
/** Un PID que no existe (por encima del máximo de macOS y del habitual en Linux). */
const PID_INEXISTENTE = 2_147_483_000;
/** El archivo tiene que terminar mucho antes: su caso vence a los 500 ms y la limpieza tarda poco. */
const PLAZO_DEL_ARCHIVO_MS = 15_000;
const CODIGO_DE_UN_CASO_FALLIDO = 1;
/** El líder de grupo del navegador doble, su nieto y el hijo suelto. */
const PROCESOS_DEL_NAVEGADOR_DOBLE = 3;

/**
 * Detiene el archivo de pruebas lanzado en su propio grupo, con todo su árbol y sin señalar un PID reutilizado
 * (detener-arbol.ts); lo que no se pueda resolver hace fallar la limpieza.
 */
async function detenerElArchivo(archivo: ChildProcess): Promise<void> {
  if (archivo.pid === undefined) {
    return;
  }
  const problemas = await detenerArbol(archivo.pid, {
    raizTerminada: () => archivo.exitCode !== null || archivo.signalCode !== null,
  });
  assert.deepEqual(problemas, [], 'la limpieza del archivo de pruebas');
}

/** Si el PID sigue ejecutándose (un zombi ya ha terminado). */
function sigueVivo(pid: number): boolean {
  const estado = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  return estado.status === 0 && !/^Z/u.test(estado.stdout.trim());
}

/** Si algo acepta conexiones en el puerto. */
async function aceptaConexiones(puerto: number): Promise<boolean> {
  const socket = connect(puerto, '127.0.0.1');
  try {
    await once(socket, 'connect');
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
}

test('un caso que vence cierra su servidor, su proceso y su carpeta, y su archivo de pruebas termina', async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'faro recursos del caso '));
  const registro = join(base, 'registro.json');
  const entorno = Object.fromEntries(Object.entries(process.env).filter(([nombre]) => nombre !== 'NODE_TEST_CONTEXT'));
  // En su propio grupo: el ejecutor de node:test lanza otro proceso por archivo, y el after detiene a los dos.
  const archivo = spawn(process.execPath, ['--test', CASO_COLGADO], {
    env: { ...entorno, FARO_BASE: base, FARO_REGISTRO: registro },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let salida = '';
  archivo.stdout.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  archivo.stderr.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  t.after(() =>
    limpiarEnOrden([
      () => detenerElArchivo(archivo),
      () => terminarLoAnotado(`${registro}.procesos`, 'el caso colgado'),
      () => rmSync(base, { recursive: true, force: true }),
    ]),
  );
  const [codigo] = await conPlazo(once(archivo, 'exit'), PLAZO_DEL_ARCHIVO_MS, 'el archivo de pruebas no terminó');
  assert.equal(codigo, CODIGO_DE_UN_CASO_FALLIDO, salida);
  assert.match(salida, /test timed out after 500ms/u);
  assert.doesNotMatch(salida, /La limpieza del caso no se completó/u);
  const { carpeta, puerto, pid } = JSON.parse(readFileSync(registro, 'utf8')) as {
    carpeta: string;
    puerto: number;
    pid: number;
  };
  assert.equal(existsSync(carpeta), false, 'la carpeta del caso se retira');
  assert.equal(await aceptaConexiones(puerto), false, 'el servidor del caso deja de escuchar');
  assert.equal(sigueVivo(pid), false, 'el proceso del caso termina');
});

/**
 * Ejecuta un archivo de casos aparte, en su propio grupo, y devuelve su código, su salida y su registro. Al final
 * detiene el archivo y termina lo que hayan anotado sus dobles en `registro` + cada sufijo de `identidades`.
 */
async function ejecutarArchivo(
  t: TestContext,
  archivo: string,
  identidades: readonly string[],
): Promise<{ codigo: unknown; salida: string; registro: string[] }> {
  const base = mkdtempSync(join(tmpdir(), 'faro recursos del caso '));
  const registro = join(base, 'registro.txt');
  const entorno = Object.fromEntries(Object.entries(process.env).filter(([nombre]) => nombre !== 'NODE_TEST_CONTEXT'));
  const hijo = spawn(process.execPath, ['--test', archivo], {
    env: { ...entorno, FARO_REGISTRO: registro },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let salida = '';
  hijo.stdout.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  hijo.stderr.setEncoding('utf8').on('data', (texto: string) => {
    salida += texto;
  });
  t.after(() =>
    limpiarEnOrden([
      () => detenerElArchivo(hijo),
      ...identidades.map((sufijo) => () => terminarLoAnotado(`${registro}${sufijo}`, `el doble ${sufijo}`)),
      () => rmSync(base, { recursive: true, force: true }),
    ]),
  );
  const [codigo] = await conPlazo(once(hijo, 'exit'), PLAZO_DEL_ARCHIVO_MS, 'el archivo de casos no terminó');
  const lineas = existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n') : [];
  return { codigo, salida, registro: lineas };
}

test('los cierres de recursosDelCaso: tarde, vencido y forzado, una sola vez, en curso y con su proceso terminado', async (t) => {
  // El doble «forzado» anota las identidades de su navegador doble en `${registro}.forzado` mientras viven.
  const { codigo, salida, registro } = await ejecutarArchivo(t, CASOS_DE_CIERRE, ['.forzado']);
  assert.equal(codigo, CODIGO_DE_UN_CASO_FALLIDO, salida);
  // Tarde: el caso vence y el recurso, al llegar, se cierra.
  assert.ok(registro.includes('tarde: cerrado'), registro.join('\n'));
  // Vence: se fuerza el atascado y después se retira la carpeta; la limpieza falla con su motivo.
  assert.match(
    salida,
    /La limpieza del caso no se completó: el recurso atascado no se cerró \(plazo de 200 ms\); se ha forzado su cierre/u,
  );
  const vence = registro.filter((linea) => linea.startsWith('vence: '));
  assert.deepEqual(vence, ['vence: forzado', 'vence: carpeta retirada']);
  // Una vez: cerrar y el after, un solo cierre; el caso aprueba.
  assert.deepEqual(
    registro.filter((linea) => linea.startsWith('una vez: ')),
    ['una vez: cerrado'],
  );
  assert.match(salida, /✔ una vez: cerrar y después el after no cierran dos veces/u);
  // Forzado: el cierre del navegador doble vence y terminan su líder de grupo, el nieto de ese grupo y el hijo suelto.
  const forzados = (registro.find((linea) => linea.startsWith('forzado: pids '))?.slice('forzado: pids '.length) ?? '')
    .split(' ')
    .map(Number);
  assert.equal(forzados.length, PROCESOS_DEL_NAVEGADOR_DOBLE, registro.join('\n'));
  assert.match(salida, /el navegador doble no se cerró \(plazo de 200 ms\); se ha forzado su cierre/u);
  assert.deepEqual(forzados.filter(sigueVivo), [], 'los procesos del navegador doble terminan');
  // En curso: el after espera el cierre empezado por el cuerpo antes de retirar la carpeta.
  assert.deepEqual(
    registro.filter((linea) => linea.startsWith('en curso: ')),
    ['en curso: cierre empieza', 'en curso: cierre termina', 'en curso: carpeta retirada'],
  );
});

/** Ejecuta `forzarProcesos` con `procesos` en un proceso aparte sin `ps` en su PATH y devuelve su motivo de fallo. */
function forzarSinPs(procesos: readonly object[]): string {
  const codigo =
    `import { forzarProcesos } from ${JSON.stringify(MODULO_RECURSOS)};` +
    `try { await forzarProcesos(${JSON.stringify(procesos)}); process.stdout.write('sin fallo'); }` +
    'catch (error) { process.stdout.write(String(error.message)); }';
  const ejecucion = spawnSync(process.execPath, ['--input-type=module', '--eval', codigo], {
    env: { PATH: '' },
    encoding: 'utf8',
    timeout: PLAZO_SIN_PS_MS,
  });
  assert.equal(ejecucion.status, 0, ejecucion.stderr);
  return ejecucion.stdout;
}

test('si ps falla, forzarProcesos no señala nada y dice de qué proceso no pudo comprobar la identidad', () => {
  const visto = { pid: PID_INEXISTENTE, ppid: 1, inicio: 'Mon Nov  2 10:00:00 2026', terminado: false };
  const comprobacion = `no se pudo comprobar si el proceso ${PID_INEXISTENTE} sigue siendo el mismo`;
  // Un líder de grupo (un navegador detached): detenerArbol no puede saber si sigue siendo el mismo y no lo señala.
  const lider = forzarSinPs([{ ...visto, pgid: PID_INEXISTENTE }]);
  assert.ok(
    lider.includes(
      `no se sabe si el proceso principal del paso sigue sin recoger, así que no se señala: ${comprobacion}`,
    ),
    lider,
  );
  // Un proceso suelto: se deja de terminar antes de la primera señal, con el mismo motivo.
  const suelto = forzarSinPs([{ ...visto, pgid: 1 }]);
  assert.ok(suelto.startsWith(comprobacion), suelto);
});
