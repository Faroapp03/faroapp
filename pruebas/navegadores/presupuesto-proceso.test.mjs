// Ensayo sin navegador del proceso del presupuesto de rendimiento: lanza presupuesto-rendimiento.mjs, el de verdad, en
// procesos hijos con los dobles de presupuesto-proceso-dobles.mjs (límite total y margen de cierre de pocos segundos,
// navegador y medir() simulados). Comprueba que, si la medida se cuelga y no cierra, el vigilante escribe el JSON con
// `cierreForzado` y lo medido hasta entonces y el proceso sale con el código 3 al pasar el límite más el margen; que,
// cortado con SIGTERM o SIGINT a mitad, el JSON queda escrito con `interrumpido` y los hitos alcanzados y el proceso
// termina; y que, si termina normal, el JSON queda con la medida completa y el proceso sale con 0. En los tres casos,
// sin ningún proceso ni servidor del hijo vivo al acabar. Si el caso acaba antes que el hijo, su after detiene el hijo,
// toma su árbol de procesos con `ps` y lo mata; cuando ha leído su salida entera, termina con su grupo los procesos
// tercos que anotó (los que dijo y los de ese árbol), aunque no hayan llegado a anunciarse. Con dos construcciones,
// las dos se preparan antes de medir ninguna y cada documento lleva solo su fase; y los JSON y resúmenes, también los
// parciales, se escriben en un temporal de su misma carpeta y se renombran, sin escribir nunca a medias sobre el
// archivo final.
//
//   node --test pruebas/navegadores/presupuesto-proceso.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detenerArbol, listarConPs } from '../../scripts/detener-arbol.ts';
import { limpiarEnOrden, terminarSiSiguen } from '../ayudas/procesos-de-prueba.ts';
import { ESTADO, SALIDA_POR_CIERRE_FORZADO } from './presupuesto-plazo.mjs';
import { ahora } from './presupuesto-servidor.mjs';

/** El límite total y el margen de cierre que los dobles dan al arnés. */
const LIMITE_MS = 1500;
const MARGEN_MS = 1000;
/** Lo que se admite de retraso sobre lo esperado (temporizadores, escritura del JSON, salida del proceso). */
const HOLGURA_MS = 700;
/** Hasta dónde se espera a un hijo antes de matarlo: el caso falla si hay que llegar a esto. */
const TOPE_DEL_HIJO_MS = 15_000;
/** Lo que se espera, tras matar al hijo, a que su salida se cierre (con todo lo que escribió, leído). */
const PLAZO_DEL_CIERRE_DEL_HIJO_MS = 5000;
const ARNES = fileURLToPath(new URL('./presupuesto-rendimiento.mjs', import.meta.url));
const DOBLES = new URL('./presupuesto-proceso-dobles.mjs', import.meta.url).href;
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const NOMBRE = 'doble';

/**
 * La orden del hijo: el arnés con los dobles precargados, una construcción por cada nombre de `nombres` (todas en
 * `salida`), una sola ejecución por construcción y su salida en `salida`.
 */
const ordenDelHijo = (salida, nombres) => [
  `--import=${DOBLES}`,
  ARNES,
  ...nombres.flatMap((nombre) => ['--artefacto', `${nombre}=${salida}`]),
  '--motor',
  'chromium',
  '--condicion',
  'escritorio',
  '--escenario',
  'inicio',
  '--salida',
  salida,
];

/**
 * Anota la identidad (PID y hora de inicio, según `ps`) de los procesos tercos de `pids` que el hijo `hijo` acaba de
 * decir: los suyos (su padre es el hijo) y los de su grupo (el nieto, aunque su padre ya haya terminado). Un PID que ya
 * no está vivo o que no es de ese árbol no se anota, así que nunca se señala un PID reutilizado por otro proceso.
 */
function anotarTercos(hijo, pids, tercos) {
  const tabla = listarConPs();
  for (const pid of pids) {
    const visto = tabla.get(pid);
    const delArbol =
      visto &&
      (visto.ppid === hijo.pid || tercos.some((terco) => terco.pid === terco.pgid && terco.pid === visto.pgid));
    if (delArbol && !visto.terminado) {
      tercos.push(visto);
    }
  }
}

/**
 * Añade a `lista` los descendientes vivos de `hijo` en `tabla` que no estén ya: su árbol por PID del padre. Solo se
 * llama con el hijo sin recoger (detenido o vivo), así que su PID no puede ser de otro proceso.
 */
function anotarDescendientes(hijo, tabla, lista) {
  const delArbol = new Set([hijo.pid]);
  let crece = true;
  while (crece) {
    crece = false;
    for (const proceso of tabla.values()) {
      if (!proceso.terminado && delArbol.has(proceso.ppid) && !delArbol.has(proceso.pid)) {
        delArbol.add(proceso.pid);
        crece = true;
        if (!lista.some(({ pid, inicio }) => pid === proceso.pid && inicio === proceso.inicio)) {
          lista.push(proceso);
        }
      }
    }
  }
}

/**
 * Termina los procesos de `lista` que siguen siendo los mismos: los líderes de grupo, con todo su grupo y su árbol
 * (detenerArbol, que solo señala un grupo si su líder no está, ha terminado o es el mismo proceso), y todos, por su PID
 * (terminarSiSiguen). Devuelve lo que no se pudo resolver.
 */
async function terminarConSuGrupo(lista) {
  const problemas = [];
  for (const visto of lista.filter(({ pid, pgid }) => pid === pgid)) {
    problemas.push(...(await detenerArbol(visto.pid, { raizTerminada: () => siguenVivos([visto]).length === 0 })));
  }
  terminarSiSiguen(lista);
  return problemas;
}

/**
 * Los procesos tercos del navegador simulado que dice el hijo `hijo` (`PROCESO <pid>`), anotados con su identidad al
 * leerlos (anotarTercos). `leer` toma la salida del hijo hasta ahora; `lista` son las identidades; `vistos(n)` se
 * cumple al haber `n`; `anotarArbol` añade el árbol del hijo detenido (anotarDescendientes); `terminar` termina, con su
 * grupo, los que siguen siendo los mismos (terminarConSuGrupo) y falla si alguno no se pudo anotar o terminar, o si al
 * empezar la salida del hijo no se había leído entera (podría faltar un `PROCESO`).
 */
function procesosTercos(hijo) {
  /** @type {import('../../scripts/detener-arbol.ts').Proceso[]} */
  const lista = [];
  const leidos = new Set();
  /** @type {unknown} */
  let sinIdentidad;
  /** @type {{ n: number, ok: () => void }[]} */
  const esperas = [];
  return {
    lista,
    leer(texto) {
      const nuevos = [...texto.matchAll(/^PROCESO (\d+)\n/gmu)]
        .map(([, pid]) => Number(pid))
        .filter((pid) => !leidos.has(pid));
      if (!nuevos.length) {
        return;
      }
      for (const pid of nuevos) {
        leidos.add(pid);
      }
      try {
        anotarTercos(hijo, nuevos, lista);
      } catch (error) {
        sinIdentidad ??= error;
      }
      for (const espera of esperas.filter(({ n }) => lista.length >= n)) {
        espera.ok();
      }
    },
    vistos: (n) =>
      new Promise((ok) => {
        esperas.push({ n, ok });
        if (lista.length >= n) {
          ok();
        }
      }),
    anotarArbol() {
      anotarDescendientes(hijo, listarConPs(), lista);
    },
    async terminar() {
      const leidaEntera = hijo.stdout.readableEnded;
      const problemas = await terminarConSuGrupo(lista);
      if (!leidaEntera) {
        problemas.push('la salida del hijo no se había leído entera: puede quedar un proceso terco sin anotar');
      }
      if (sinIdentidad) {
        problemas.push(`no se pudo anotar la identidad de los procesos tercos del hijo: ${sinIdentidad}`);
      }
      if (problemas.length) {
        throw new Error(`Los procesos tercos del hijo: ${problemas.join('; ')}`, { cause: sinIdentidad });
      }
    },
  };
}

/**
 * Si el hijo sigue vivo, lo detiene con SIGSTOP (ya no lanza nada), anota su árbol (`tercos.anotarArbol`) y lo mata
 * con SIGKILL. Después espera, con su plazo, a que se cierre su salida (`cerrado`, el evento `close`): con `exit`, lo
 * último que escribió podría leerse después de terminar los tercos.
 */
async function terminarElHijo(hijo, tercos, cerrado) {
  if (hijo.exitCode === null && hijo.signalCode === null) {
    hijo.kill('SIGSTOP');
    try {
      tercos.anotarArbol();
    } finally {
      hijo.kill('SIGKILL');
    }
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let temporizador;
  const vencido = new Promise((_ok, mal) => {
    temporizador = setTimeout(
      () => mal(new Error(`La salida del hijo no se cerró en ${PLAZO_DEL_CIERRE_DEL_HIJO_MS} ms`)),
      PLAZO_DEL_CIERRE_DEL_HIJO_MS,
    );
  });
  try {
    await Promise.race([cerrado, vencido]);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * El after del caso `prueba`: termina el hijo si sigue vivo (terminarElHijo), después sus procesos tercos
 * (procesosTercos) y retira las `carpetas` del hijo, cada paso aunque falle otro (limpiarEnOrden). Se llama justo
 * después de lanzar el hijo, para no perder su `close`.
 */
function limpiarAlAcabar(prueba, hijo, tercos, carpetas) {
  const cerrado = new Promise((ok) => {
    hijo.once('close', ok);
  });
  prueba.after(() =>
    limpiarEnOrden([
      () => terminarElHijo(hijo, tercos, cerrado),
      tercos.terminar,
      ...carpetas.map((carpeta) => () => rmSync(carpeta, { recursive: true, force: true })),
    ]),
  );
}

/**
 * Lanza el arnés en un hijo con los dobles en `modo` y su salida en una carpeta nueva. `hito` se cumple con el puerto
 * del servidor que medir() simulada deja escuchando y el momento en que lo dice; `fin`, con el código, la señal, el
 * momento de la salida y si hubo que matarlo al llegar al tope. `nombres` son las construcciones y `entorno`, más
 * variables para los dobles. Al acabar el caso `prueba`, también si falla o vence, su after termina el hijo si sigue
 * vivo, para que no vuelva a escribir; termina los procesos tercos que dijo y los de su árbol, con su grupo, si
 * siguen siendo los mismos (procesosTercos, que devuelve en `tercos`), porque matar al hijo con SIGKILL impide que su
 * vigilante lo haga; y retira la carpeta de salida y la temporal del hijo (su TMPDIR: lo que deja al morir con
 * SIGKILL, como la construcción sintética, que retiraría al salir, se retira con ella). `texto()` es la salida del hijo
 * hasta ahora.
 */
function lanzar(modo, prueba, { nombres = [NOMBRE], entorno = {} } = {}) {
  const salida = mkdtempSync(join(tmpdir(), 'faro-presupuesto-proceso-'));
  const temporal = mkdtempSync(join(tmpdir(), 'faro-presupuesto-proceso-tmp-'));
  const hijo = spawn(process.execPath, ordenDelHijo(salida, nombres), {
    cwd: RAIZ,
    env: {
      ...process.env,
      ...entorno,
      PRESUPUESTO_DOBLE_MODO: modo,
      PRESUPUESTO_DOBLE_LIMITE_MS: String(LIMITE_MS),
      PRESUPUESTO_DOBLE_MARGEN_MS: String(MARGEN_MS),
      TMPDIR: temporal,
      // Si un desvío de los dobles dejara de aplicarse, el arranque real no encontraría ningún navegador y fallaría.
      PLAYWRIGHT_BROWSERS_PATH: join(salida, 'sin-navegadores'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tercos = procesosTercos(hijo);
  limpiarAlAcabar(prueba, hijo, tercos, [salida, temporal]);
  let texto = '';
  let errores = '';
  let avisar;
  const hito = new Promise((ok) => {
    avisar = ok;
  });
  hijo.stdout.on('data', (trozo) => {
    texto += trozo;
    const encontrado = /^HITO (\d+)$/mu.exec(texto);
    if (encontrado) {
      avisar({ puerto: Number(encontrado[1]), t: ahora() });
    }
    tercos.leer(texto);
  });
  hijo.stderr.on('data', (trozo) => {
    errores += trozo;
  });
  let matado = false;
  const tope = setTimeout(() => {
    matado = true;
    hijo.kill('SIGKILL');
  }, TOPE_DEL_HIJO_MS);
  const fin = new Promise((ok) => {
    hijo.once('exit', (codigo, senal) => {
      clearTimeout(tope);
      ok({ codigo, senal, t: ahora(), matado, texto, errores });
    });
  });
  return { hijo, hito, fin, salida, tercos, texto: () => texto };
}

/** El documento JSON que el arnés ha escrito para la construcción `nombre`, y la medida del escenario. */
function documentoDe(salida, nombre = NOMBRE) {
  const ruta = join(salida, `presupuesto-${nombre}.json`);
  assert.ok(existsSync(ruta), 'El arnés ha escrito el JSON');
  const documento = JSON.parse(readFileSync(ruta, 'utf8'));
  assert.ok(existsSync(join(salida, `presupuesto-${nombre}.md`)), 'El arnés ha escrito el resumen');
  return { documento, medida: documento.resultados?.escritorio?.chromium?.inicio };
}

/** Si el proceso `pid` sigue vivo. */
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Si algo escucha en `puerto` del bucle local. */
const escuchando = (puerto) =>
  new Promise((ok) => {
    const conexion = connect(puerto, '127.0.0.1');
    conexion.once('connect', () => {
      conexion.destroy();
      ok(true);
    });
    conexion.once('error', () => ok(false));
  });

/** Lo que tiene que quedar tras cualquier salida: ni el hijo vivo ni su servidor escuchando. */
async function sinNadaVivo(hijo, puerto) {
  assert.equal(vivo(hijo.pid), false, 'El proceso del arnés ya no existe');
  assert.equal(await escuchando(puerto), false, 'El servidor que dejó medir() ya no escucha');
}

/** Lo medido hasta el hito: la interfaz alcanzada y el resto pendiente, con el estado «en curso». */
function conservaElHito(medida) {
  assert.equal(medida?.estado, ESTADO.enCurso, 'Lo medido hasta el corte consta «en curso»');
  assert.equal(medida.hitos.interfaz.alcanzado, true, 'Consta el hito alcanzado');
  assert.equal(medida.hitos.copiaCompleta.pendiente, true, 'Consta el hito sin llegar');
  assert.equal(medida.plazo.limiteTotalMs, LIMITE_MS, 'Con el límite total de la condición');
}

test('si la medida se cuelga, el vigilante escribe lo medido con cierreForzado y sale con 3 en límite + margen', async (prueba) => {
  const { hijo, hito, fin, salida } = lanzar('colgado', prueba);
  const terminado = await fin;
  const { puerto, t } = await Promise.race([hito, Promise.reject(new Error(`Sin hito: ${terminado.errores}`))]);
  const ms = terminado.t - t;
  prueba.diagnostic(`del hito a la salida: ${Math.round(ms)} ms (límite + margen: ${LIMITE_MS + MARGEN_MS} ms)`);
  assert.equal(terminado.matado, false, `El proceso sale solo antes del tope de ${TOPE_DEL_HIJO_MS} ms`);
  assert.equal(terminado.codigo, SALIDA_POR_CIERRE_FORZADO, `Sale con el código del cierre forzado (${ms} ms)`);
  assert.ok(ms >= LIMITE_MS + MARGEN_MS - HOLGURA_MS, `No corta antes del límite más el margen: ${ms} ms`);
  assert.ok(ms <= LIMITE_MS + MARGEN_MS + HOLGURA_MS, `Corta al pasar el límite más el margen: ${ms} ms`);
  const { documento, medida } = documentoDe(salida);
  assert.equal(documento.cierreForzado, 'escenario inicio', 'El JSON dice que el cierre se forzó y en qué escenario');
  assert.equal(documento.interrumpido, undefined);
  conservaElHito(medida);
  await sinNadaVivo(hijo, puerto);
});

for (const senal of ['SIGTERM', 'SIGINT']) {
  test(`cortado con ${senal} a mitad, el JSON queda con interrumpido y los hitos alcanzados`, async (prueba) => {
    const { hijo, hito, fin, salida } = lanzar('colgado', prueba);
    const { puerto } = await Promise.race([
      hito,
      fin.then(({ errores }) => Promise.reject(new Error(`Sin hito: ${errores}`))),
    ]);
    const enviada = ahora();
    hijo.kill(senal);
    const terminado = await fin;
    const ms = terminado.t - enviada;
    prueba.diagnostic(`de la señal a la salida: ${Math.round(ms)} ms (tope: ${HOLGURA_MS} ms)`);
    assert.equal(terminado.matado, false, `El proceso termina antes del tope de ${TOPE_DEL_HIJO_MS} ms`);
    assert.ok(ms <= HOLGURA_MS, `Termina enseguida tras la señal: ${ms} ms`);
    assert.ok(ms < LIMITE_MS + MARGEN_MS, 'Termina por la señal, no por el vigilante');
    const { documento, medida } = documentoDe(salida);
    assert.equal(documento.interrumpido, senal, 'El JSON dice qué señal lo cortó');
    assert.equal(documento.cierreForzado, undefined);
    assert.equal(terminado.codigo, SALIDA_POR_CIERRE_FORZADO, 'Sale con el código del corte, no con 0');
    conservaElHito(medida);
    await sinNadaVivo(hijo, puerto);
  });
}

test('si la medida termina, el JSON queda con la medida completa y el proceso sale con 0', async (prueba) => {
  const { hijo, hito, fin, salida } = lanzar('normal', prueba);
  const terminado = await fin;
  const { puerto, t } = await Promise.race([hito, Promise.reject(new Error(`Sin hito: ${terminado.errores}`))]);
  const ms = terminado.t - t;
  prueba.diagnostic(`del hito a la salida: ${Math.round(ms)} ms (tope: el límite, ${LIMITE_MS} ms)`);
  assert.equal(terminado.matado, false, `El proceso sale solo antes del tope de ${TOPE_DEL_HIJO_MS} ms`);
  assert.equal(terminado.codigo, 0, `Sale con 0 (${ms} ms): ${terminado.errores}`);
  assert.ok(ms < LIMITE_MS, `Sale en cuanto termina, sin esperar al límite: ${ms} ms`);
  const { documento, medida } = documentoDe(salida);
  assert.equal(medida?.estado, ESTADO.completa, 'La medida consta completa');
  assert.equal(medida.hitos.copiaCompleta.alcanzado, true);
  assert.equal(documento.cierreForzado, undefined);
  assert.equal(documento.interrumpido, undefined);
  assert.ok(documento.cierreDelNavegador['escritorio · chromium'], 'Consta el cierre del navegador');
  await sinNadaVivo(hijo, puerto);
});

/** Los procesos de `vistos` que siguen vivos y son los mismos (mismo PID y misma hora de inicio). */
function siguenVivos(vistos) {
  const tabla = listarConPs();
  return vistos.filter((visto) => {
    const actual = tabla.get(visto.pid);
    return actual && !actual.terminado && actual.inicio === visto.inicio;
  });
}

/** Lo que se comprueba, cada poco, si los procesos señalados ya han terminado. */
const PAUSA_DE_COMPROBACION_MS = 25;

test('si el caso acaba antes que el hijo, su after termina también los procesos tercos y sus servidores', async (prueba) => {
  /** @type {ReturnType<typeof lanzar> | undefined} */
  let lanzado;
  // Si el after del caso no los termina, se terminan aquí, para no dejarlos vivos.
  prueba.after(() => terminarSiSiguen(lanzado?.tercos.lista ?? []));
  await prueba.test('el caso que acaba antes que el hijo', async (caso) => {
    lanzado = lanzar('colgado', caso);
    await Promise.race([
      lanzado.tercos.vistos(2),
      lanzado.fin.then(({ errores }) => Promise.reject(new Error(`Sin procesos tercos: ${errores}`))),
    ]);
  });
  assert.ok(lanzado);
  assert.equal(lanzado.tercos.lista.length, 2, 'Constan el navegador simulado y su nieto');
  const limite = ahora() + HOLGURA_MS;
  while (siguenVivos(lanzado.tercos.lista).length && ahora() < limite) {
    await new Promise((ok) => setTimeout(ok, PAUSA_DE_COMPROBACION_MS));
  }
  assert.deepEqual(siguenVivos(lanzado.tercos.lista), [], 'Ningún proceso terco del hijo sigue vivo');
  const puertos = lineasCon(lanzado.texto(), 'PUERTO').map(Number);
  assert.equal(puertos.length, 2, 'Constan los servidores de los dos procesos tercos');
  for (const puerto of puertos) {
    assert.equal(await escuchando(puerto), false, `El servidor del puerto ${puerto} ya no escucha`);
  }
});

/** Un proceso que ignora SIGTERM y no termina nunca. */
const TERCO_MUDO = "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000);";
/**
 * Un terco que comparte la salida del hijo y la cierra en cuanto el hijo muere (cambia su padre): hasta entonces, la
 * salida del hijo sigue abierta aunque el hijo ya haya salido (`exit` llega antes que `close`).
 */
const RETENEDOR_DE_LA_SALIDA = `
const { closeSync } = require('node:fs');
const padre = process.ppid;
let abierta = true;
process.on('SIGTERM', () => undefined);
setInterval(() => {
  if (abierta && process.ppid !== padre) {
    abierta = false;
    closeSync(1);
  }
}, 25);
`;
/**
 * Un hijo propio de la prueba siguiente, sin el arnés: lanza, en su propio grupo, un líder que anuncia su `PROCESO`
 * después de lanzar en su grupo un nieto terco que no se anuncia, y termina poco después (el nieto queda sin padre:
 * solo su grupo lo alcanza); un terco suelto, también en su grupo, que no se anuncia (solo el árbol del hijo lo
 * alcanza); y el retenedor de su salida, que tampoco. Los mudos se dicen como `OCULTO <pid>`, que el after no lee.
 */
const LIDER_CON_NIETO_MUDO = `
const nieto = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(TERCO_MUDO)}], {
  stdio: 'ignore',
});
nieto.once('spawn', () => {
  process.stdout.write('\\nOCULTO ' + nieto.pid + '\\nPROCESO ' + process.pid + '\\n');
  setTimeout(() => process.exit(), 300);
});
`;
const HIJO_CON_MUDOS = `
const { spawn } = require('node:child_process');
const lider = spawn(process.execPath, ['-e', ${JSON.stringify(LIDER_CON_NIETO_MUDO)}], {
  detached: true,
  stdio: ['ignore', 'pipe', 'ignore'],
});
lider.stdout.on('data', (trozo) => process.stdout.write(trozo));
const suelto = spawn(process.execPath, ['-e', ${JSON.stringify(TERCO_MUDO)}], { detached: true, stdio: 'ignore' });
suelto.once('spawn', () => process.stdout.write('\\nOCULTO ' + suelto.pid + '\\n'));
const retenedor = spawn(process.execPath, ['-e', ${JSON.stringify(RETENEDOR_DE_LA_SALIDA)}], {
  detached: true,
  stdio: ['ignore', 'inherit', 'ignore'],
});
retenedor.once('spawn', () => process.stdout.write('\\nOCULTO ' + retenedor.pid + '\\n'));
setInterval(() => undefined, 1000);
`;

/** Anota la identidad (según `ps`) de los `OCULTO <pid>` de `texto` que siguen vivos y no están ya en `mudos`. */
function anotarMudos(texto, mudos) {
  const tabla = listarConPs();
  for (const [, pid] of texto.matchAll(/^OCULTO (\d+)\n/gmu)) {
    const visto = tabla.get(Number(pid));
    if (visto && !visto.terminado && !mudos.some((mudo) => mudo.pid === visto.pid)) {
      mudos.push(visto);
    }
  }
}

/** Espera, como mucho `ms`, a que ninguno de `vistos` siga vivo y siendo el mismo; devuelve los que siguen. */
async function esperarQueTerminen(vistos, ms) {
  const limite = ahora() + ms;
  while (siguenVivos(vistos).length && ahora() < limite) {
    await new Promise((ok) => setTimeout(ok, PAUSA_DE_COMPROBACION_MS));
  }
  return siguenVivos(vistos);
}

/** El nieto mudo del líder, el terco suelto y el retenedor de la salida. */
const MUDOS_DEL_HIJO = 3;

test('el after termina también lo que el hijo no llegó a anunciar: su árbol y el grupo de un terco anotado', async (prueba) => {
  /** @type {import('../../scripts/detener-arbol.ts').Proceso[]} */
  const mudos = [];
  /** @type {ReturnType<typeof procesosTercos> | undefined} */
  let tercos;
  // Si el after del caso no los termina, se terminan aquí, para no dejarlos vivos.
  prueba.after(() => terminarSiSiguen([...mudos, ...(tercos?.lista ?? [])]));
  await prueba.test('el caso que acaba antes que el hijo', async (caso) => {
    const { NODE_OPTIONS: _opciones, NODE_TEST_CONTEXT: _contexto, ...env } = process.env;
    const hijo = spawn(process.execPath, ['-e', HIJO_CON_MUDOS], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    tercos = procesosTercos(hijo);
    limpiarAlAcabar(caso, hijo, tercos, []);
    const anotados = tercos;
    let texto = '';
    await new Promise((ok, mal) => {
      const tope = setTimeout(() => mal(new Error(`Sin los procesos del hijo: ${texto}`)), TOPE_DEL_HIJO_MS);
      hijo.once('exit', () => mal(new Error(`El hijo terminó antes de tiempo: ${texto}`)));
      hijo.stdout.on('data', (trozo) => {
        texto += trozo;
        anotados.leer(texto);
        anotarMudos(texto, mudos);
        if (mudos.length === MUDOS_DEL_HIJO && anotados.lista.length === 1) {
          clearTimeout(tope);
          ok();
        }
      });
    });
    // El líder anotado termina por sí mismo: su nieto queda sin padre, y solo su grupo lo alcanza.
    assert.deepEqual(await esperarQueTerminen(anotados.lista, TOPE_DEL_HIJO_MS), [], 'El líder anotado ha terminado');
  });
  assert.ok(tercos);
  assert.equal(mudos.length, MUDOS_DEL_HIJO, 'Constan el nieto mudo del líder, el terco suelto y el retenedor');
  assert.deepEqual(await esperarQueTerminen(mudos, HOLGURA_MS), [], 'Ningún proceso mudo del hijo sigue vivo');
  assert.deepEqual(siguenVivos(tercos.lista), [], 'Ningún proceso anotado sigue vivo');
});

/** Las líneas de la salida del hijo que empiezan por `marca`, con lo que sigue a la marca. */
const lineasCon = (texto, marca) =>
  texto
    .split('\n')
    .filter((linea) => linea.startsWith(`${marca} `) || linea === marca)
    .map((linea) => linea.slice(marca.length + 1));

test('con dos construcciones, las dos se preparan antes de medir ninguna y cada documento lleva su fase', async (prueba) => {
  const { hijo, fin, salida } = lanzar('normal', prueba, { nombres: ['a', 'b'] });
  const terminado = await fin;
  assert.equal(terminado.matado, false, terminado.errores);
  assert.equal(terminado.codigo, 0, `Sale con 0: ${terminado.errores}`);
  const lineas = terminado.texto.split('\n');
  const ultimaPreparada = lineas.lastIndexOf('PREPARADA');
  const primerHito = lineas.findIndex((linea) => linea.startsWith('HITO '));
  assert.ok(ultimaPreparada >= 0 && primerHito >= 0, `Constan las preparaciones y las medidas: ${terminado.texto}`);
  assert.ok(ultimaPreparada < primerHito, 'Ninguna construcción se prepara mientras se mide otra');
  const fases = lineasCon(terminado.texto, 'PREPARANDO').map((linea) => JSON.parse(linea));
  assert.deepEqual(fases.at(-1), { a: 'preparación a', b: 'preparación b' }, 'Cada documento lleva solo su fase');
  for (const nombre of ['a', 'b']) {
    assert.equal(documentoDe(salida, nombre).medida?.estado, ESTADO.completa, `La medida de ${nombre} consta completa`);
  }
  assert.ok(existsSync(join(salida, 'presupuesto-comparacion.md')), 'Consta la comparación');
  assert.equal(vivo(hijo.pid), false);
});

test('los JSON y los resúmenes, también los parciales, se escriben en un temporal y se renombran', async (prueba) => {
  const { hijo, fin, salida } = lanzar('normal', prueba, { entorno: { PRESUPUESTO_DOBLE_ESCRITURAS: '1' } });
  const terminado = await fin;
  assert.equal(terminado.codigo, 0, `Sale con 0: ${terminado.errores}`);
  const finales = readdirSync(salida)
    .filter((archivo) => /^presupuesto-.+\.(?:json|md)$/u.test(archivo))
    .map((archivo) => join(salida, archivo));
  assert.ok(finales.length >= 2, 'Constan el JSON y el resumen');
  const escritos = lineasCon(terminado.texto, 'ESCRITO').map((linea) => JSON.parse(linea));
  const renombrados = lineasCon(terminado.texto, 'RENOMBRADO').map((linea) => JSON.parse(linea));
  assert.deepEqual(
    escritos.filter((ruta) => finales.includes(ruta)),
    [],
    'Nunca se escribe directamente sobre un archivo final',
  );
  for (const final of finales) {
    const hacia = renombrados.filter(([, a]) => a === final);
    assert.ok(hacia.length >= 2, `${final}: se escribe varias veces (los parciales), siempre renombrando`);
    for (const [de] of hacia) {
      assert.equal(dirname(de), salida, 'El temporal está en la misma carpeta que el archivo final');
      assert.ok(escritos.includes(de), 'Lo renombrado es el temporal escrito');
    }
  }
  assert.deepEqual(
    readdirSync(salida).filter((archivo) => !/^presupuesto-.+\.(?:json|md)$/u.test(archivo)),
    [],
    'No queda ningún temporal',
  );
  assert.equal(vivo(hijo.pid), false);
});
