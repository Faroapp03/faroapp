// Detención del árbol de procesos de un paso: tablas sintéticas con process.kill sustituido (sin señales reales) y un
// caso con un `sleep` propio cuando falla la consulta de procesos. Ningún caso deja procesos vivos.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mock, type TestContext, test } from 'node:test';
import {
  detenerArbol,
  inicioDeProcStat,
  interpretarPs,
  listarConPs,
  type Proceso,
  type TablaDeProcesos,
} from '../../scripts/detener-arbol.ts';

const INICIO = 'Mon Nov  2 10:00:00 2026';
const OTRO_INICIO = 'Mon Nov  2 10:00:07 2026';
const PROPIO: Proceso = { pid: process.pid, ppid: process.ppid, pgid: 900_000, inicio: INICIO, terminado: false };
const RAIZ = 910_000;
const ESPERA_CORTA_MS = 30;
/** Los PID sintéticos del árbol, a partir de RAIZ. */
const NAVEGADOR = 910_001;
const HIJO = 910_002;
const DESCARRIADO = 910_003;
const AJENO = 910_004;
const TARDIO = 910_005;
const NIETO_TARDIO = 910_006;
const TERCO = 910_007;
const GRUPO_AJENO = 920_000;

function tabla(...procesos: readonly Proceso[]): TablaDeProcesos {
  return new Map([PROPIO, ...procesos].map((proceso) => [proceso.pid, proceso]));
}

const proceso = (
  pid: number,
  ppid: number,
  pgid: number,
  { terminado = false, inicio = INICIO }: { terminado?: boolean; inicio?: string } = {},
): Proceso => ({ pid, ppid, pgid, inicio, terminado });

/** Sustituye process.kill: anota cada señal sin enviarla. */
function senalesAnotadas(contexto: TestContext): string[] {
  const anotadas: string[] = [];
  mock.method(process, 'kill', (destino: number, senal: NodeJS.Signals) => {
    anotadas.push(`${senal} ${destino}`);
    return true;
  });
  contexto.after(() => mock.restoreAll());
  return anotadas;
}

/** Una tabla que depende de las señales ya enviadas: la primera de `etapas` cuya señal se haya enviado, o `inicial`. */
function segunLasSenales(
  anotadas: readonly string[],
  inicial: TablaDeProcesos,
  ...etapas: readonly [string, TablaDeProcesos][]
): () => TablaDeProcesos {
  return () => [...etapas].reverse().find(([senal]) => anotadas.includes(senal))?.[1] ?? inicial;
}

test('el árbol incluye los descendientes en otros grupos y nunca el grupo propio', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const viva = tabla(
    proceso(RAIZ, process.pid, RAIZ),
    proceso(NAVEGADOR, RAIZ, NAVEGADOR), // un navegador, en su propio grupo
    proceso(HIJO, NAVEGADOR, NAVEGADOR), // su hijo
    proceso(DESCARRIADO, RAIZ, PROPIO.pgid), // un descendiente que se pasó al grupo de la verificación
    proceso(AJENO, 1, GRUPO_AJENO), // un proceso ajeno
  );
  const terminada = tabla(proceso(RAIZ, process.pid, RAIZ, { terminado: true }));
  const listar = segunLasSenales(anotadas, viva, [`SIGTERM ${RAIZ}`, terminada]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS });
  assert.deepEqual(problemas, []);
  const esperadas = [RAIZ, NAVEGADOR].map((g) => `SIGTERM -${g}`);
  esperadas.push(...[RAIZ, NAVEGADOR, HIJO, DESCARRIADO].map((pid) => `SIGTERM ${pid}`));
  assert.deepEqual([...anotadas].sort(), esperadas.sort());
  assert.ok(!anotadas.some((senal) => senal.endsWith(` -${PROPIO.pgid}`) || senal.endsWith(` ${AJENO}`)));
});

test('tras SIGTERM vuelve a recorrer el árbol y mata con SIGKILL a los tardíos y a lo que sigue vivo', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ));
  // El padre ha muerto; su hijo tardío, ya colgado de init, sigue en el grupo del paso y otro, nuevo, en el suyo.
  const tardia = tabla(
    proceso(RAIZ, process.pid, RAIZ, { terminado: true }),
    proceso(TARDIO, 1, RAIZ),
    proceso(NIETO_TARDIO, TARDIO, NIETO_TARDIO),
  );
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${RAIZ}`, tardia], [`SIGKILL ${TARDIO}`, tabla()]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS });
  assert.deepEqual(problemas, []);
  for (const esperada of [
    `SIGKILL ${TARDIO}`,
    `SIGKILL ${NIETO_TARDIO}`,
    `SIGKILL -${NIETO_TARDIO}`,
    `SIGKILL -${RAIZ}`,
  ]) {
    assert.ok(anotadas.includes(esperada), `${esperada} en ${anotadas.join(', ')}`);
  }
});

test('después del SIGKILL vuelve a recorrer el árbol: un tardío de esa ventana también recibe SIGKILL', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ));
  // La raíz ignora SIGTERM; al recibir SIGKILL ya ha dejado un hijo tardío en su grupo, colgado de init.
  const tardia = tabla(proceso(RAIZ, process.pid, RAIZ, { terminado: true }), proceso(TARDIO, 1, RAIZ));
  const listar = segunLasSenales(anotadas, inicial, [`SIGKILL ${RAIZ}`, tardia], [`SIGKILL ${TARDIO}`, tabla()]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS });
  assert.deepEqual(problemas, []);
  assert.ok(anotadas.includes(`SIGKILL ${TARDIO}`), anotadas.join(', '));
  assert.ok(anotadas.indexOf(`SIGKILL ${RAIZ}`) < anotadas.indexOf(`SIGKILL ${TARDIO}`));
});

test('un PID del árbol reutilizado por otro proceso (otra hora de inicio) no recibe ninguna señal, ni su grupo', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const reutilizado = proceso(NAVEGADOR, 1, NAVEGADOR, { inicio: OTRO_INICIO });
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(NAVEGADOR, RAIZ, NAVEGADOR));
  // Tras SIGTERM el navegador terminó y su PID lo tiene ahora otro proceso; la raíz ignora SIGTERM.
  const tras = tabla(proceso(RAIZ, process.pid, RAIZ), reutilizado);
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${RAIZ}`, tras], [`SIGKILL ${RAIZ}`, tabla(reutilizado)]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS, inicioEstable: () => undefined });
  assert.deepEqual(problemas, []);
  const despuesDelTerm = anotadas.filter((senal) => senal.startsWith('SIGKILL'));
  assert.deepEqual(despuesDelTerm.sort(), [`SIGKILL -${RAIZ}`, `SIGKILL ${RAIZ}`]);
});

test('un proceso del árbol que cambia de grupo (setsid tras fork) se sigue señalando, y su grupo nuevo también', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  // Visto entre su fork y su setsid: aún en el grupo de la raíz. Tras SIGTERM ya está en su grupo propio y lo ignora.
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(NAVEGADOR, RAIZ, RAIZ));
  const enSuGrupo = tabla(proceso(RAIZ, process.pid, RAIZ, { terminado: true }), proceso(NAVEGADOR, 1, NAVEGADOR));
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${RAIZ}`, enSuGrupo], [`SIGKILL ${NAVEGADOR}`, tabla()]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS, inicioEstable: () => undefined });
  assert.deepEqual(problemas, []);
  assert.ok(anotadas.includes(`SIGKILL ${NAVEGADOR}`), anotadas.join(', '));
  assert.ok(anotadas.includes(`SIGKILL -${NAVEGADOR}`), anotadas.join(', '));
});

test('sin hora estable, un proceso que conserva grupo y padre pero cambia de hora no se señala y se informa', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(HIJO, RAIZ, HIJO));
  // Como tras un salto del reloj: mismo grupo, mismo padre y otra hora de inicio.
  const saltado = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(HIJO, RAIZ, HIJO, { inicio: OTRO_INICIO }));
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${RAIZ}`, saltado], [`SIGKILL ${RAIZ}`, tabla()]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS, inicioEstable: () => undefined });
  assert.deepEqual(problemas, [
    `el proceso ${HIJO} conserva su grupo y su padre pero cambió su hora de inicio (${INICIO} → ${OTRO_INICIO}); no se ha señalado`,
  ]);
  assert.ok(!anotadas.some((senal) => senal.startsWith('SIGKILL') && senal.endsWith(`${HIJO}`)), anotadas.join(', '));
});

test('con hora estable (Linux, /proc), un salto del reloj no hace pasar al proceso por otro', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const inicial = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(HIJO, RAIZ, HIJO));
  const saltado = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(HIJO, RAIZ, HIJO, { inicio: OTRO_INICIO }));
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${RAIZ}`, saltado], [`SIGKILL ${RAIZ}`, tabla()]);
  const inicioEstable = (pid: number): string => `tics-${pid}`;
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS, inicioEstable });
  assert.deepEqual(problemas, []);
  assert.ok(anotadas.includes(`SIGKILL ${HIJO}`), anotadas.join(', '));
});

test('la hora estable sale del campo 22 de /proc/<pid>/stat, aunque el nombre tenga espacios y paréntesis', () => {
  // Campos 1 a 23 de un /proc/<pid>/stat real; el 22 (starttime) es 987654.
  const texto = '4242 (navegador (web) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 1 0 987654 123\n';
  assert.equal(inicioDeProcStat(texto), '987654');
  assert.equal(inicioDeProcStat('sin paréntesis'), undefined);
  assert.equal(inicioDeProcStat('1 (corto) S 1 2'), undefined);
});

test('un zombi sin hora de inicio no invalida la tabla; un proceso vivo sin ella, sí', () => {
  const propio = `${process.pid} ${process.ppid} 900000 S+ ${INICIO}`;
  const tablaConZombi = interpretarPs(`${propio}\n  ${RAIZ}     1 ${RAIZ} Z\n`);
  assert.equal(tablaConZombi.get(RAIZ)?.terminado, true);
  assert.equal(tablaConZombi.get(RAIZ)?.inicio, '');
  assert.throws(() => interpretarPs(`${propio}\n${RAIZ} 1 ${RAIZ} S\n`), /sin el formato esperado/u);
});

test('una raíz ya recogida cuyo PID tiene otro proceso no se señala, ni su grupo', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const otro = tabla(proceso(RAIZ, 1, RAIZ, { inicio: OTRO_INICIO }));
  const problemas = await detenerArbol(RAIZ, {
    listar: () => otro,
    esperaMs: ESPERA_CORTA_MS,
    raizTerminada: () => true,
  });
  assert.deepEqual(problemas, []);
  assert.deepEqual(anotadas, []);
});

test('una raíz ya recogida no se señala, pero sí los miembros que quedan en su grupo', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const inicial = tabla(proceso(TARDIO, 1, RAIZ));
  const listar = segunLasSenales(anotadas, inicial, [`SIGTERM ${TARDIO}`, tabla()]);
  const problemas = await detenerArbol(RAIZ, { listar, esperaMs: ESPERA_CORTA_MS, raizTerminada: () => true });
  assert.deepEqual(problemas, []);
  assert.deepEqual([...anotadas].sort(), [`SIGTERM -${RAIZ}`, `SIGTERM ${TARDIO}`]);
});

test('un superviviente queda en los problemas, no se da por terminado', async (contexto) => {
  senalesAnotadas(contexto);
  const terca = tabla(proceso(RAIZ, process.pid, RAIZ), proceso(TERCO, RAIZ, TERCO));
  const problemas = await detenerArbol(RAIZ, { listar: () => terca, esperaMs: ESPERA_CORTA_MS });
  assert.deepEqual(problemas, [`siguen vivos los procesos ${RAIZ}, ${TERCO} del paso tras SIGTERM y SIGKILL`]);
});

test('una señal rechazada por algo distinto de ESRCH queda en los problemas', async (contexto) => {
  let enviadas = 0;
  mock.method(process, 'kill', () => {
    enviadas += 1;
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
  });
  contexto.after(() => mock.restoreAll());
  const viva = tabla(proceso(RAIZ, process.pid, RAIZ));
  const terminada = tabla(proceso(RAIZ, process.pid, RAIZ, { terminado: true }));
  const problemas = await detenerArbol(RAIZ, { listar: () => (enviadas ? terminada : viva), esperaMs: 1 });
  assert.ok(problemas.includes(`no se puede enviar SIGTERM a el grupo ${RAIZ} (EPERM)`), problemas.join('\n'));
});

test('una consulta de procesos fallida no es «sin procesos»: lo dice y detiene al menos el grupo del paso', async (contexto) => {
  const dormido = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
  const pid = dormido.pid;
  assert.ok(pid !== undefined);
  // ChildProcess.kill no señala un proceso que Node ya ha recogido: no puede alcanzar un PID reutilizado.
  contexto.after(() => dormido.kill('SIGKILL'));
  const cierre = new Promise((resolver) => dormido.once('exit', resolver));
  const problemas = await detenerArbol(pid, {
    listar: () => {
      throw new Error('ps termina con código 1');
    },
  });
  assert.deepEqual(problemas, ['no se puede comprobar el árbol de procesos del paso: ps termina con código 1']);
  assert.equal(await cierre, null);
  assert.equal(dormido.signalCode, 'SIGKILL');
});

test('si falla la consulta de procesos, una raíz no señalable (0, 1 o este proceso) no se señala, ni su grupo', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  for (const raiz of [0, 1, process.pid]) {
    const problemas = await detenerArbol(raiz, {
      listar: () => {
        throw new Error('ps termina con código 1');
      },
    });
    assert.deepEqual(problemas, ['no se puede comprobar el árbol de procesos del paso: ps termina con código 1']);
  }
  assert.deepEqual(anotadas, []);
});

test('la tabla real de ps incluye la propia verificación con su grupo y su hora de inicio estable', () => {
  const real = listarConPs();
  const propio = real.get(process.pid);
  assert.ok(propio && !propio.terminado);
  const grupo = spawnSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' });
  assert.equal(propio.pgid, Number(grupo.stdout.trim()));
  assert.match(propio.inicio, /\d{4}$/u);
  assert.equal(listarConPs().get(process.pid)?.inicio, propio.inicio);
});

test('la tabla de ps no incluye el propio ps de la consulta (sin otros hijos, este proceso no tiene ninguno)', () => {
  const hijos = [...listarConPs().values()].filter((visto) => visto.ppid === process.pid && !visto.terminado);
  assert.deepEqual(hijos, []);
});

test('si no se puede saber si la raíz se recogió, no se señala y se dice por qué', async (contexto) => {
  const anotadas = senalesAnotadas(contexto);
  const problemas = await detenerArbol(RAIZ, {
    listar: () => {
      throw new Error('ps termina con código 1');
    },
    raizTerminada: () => {
      throw new Error('no se pudo comprobar si el proceso 910000 sigue siendo el mismo: ps termina con código 1');
    },
  });
  assert.deepEqual(anotadas, []);
  assert.ok(
    problemas.some((problema) => problema.startsWith('no se sabe si el proceso principal del paso sigue sin recoger')),
    problemas.join('\n'),
  );
  assert.ok(problemas.includes('no se puede comprobar el árbol de procesos del paso: ps termina con código 1'));
});
