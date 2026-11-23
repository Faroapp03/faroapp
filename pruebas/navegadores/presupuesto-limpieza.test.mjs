// Ensayo sin navegador del límite de la ejecución completa del presupuesto de rendimiento y de la limpieza al cortar:
// lanza presupuesto-rendimiento.mjs, el de verdad, en procesos hijos con los dobles de presupuesto-proceso-dobles.mjs
// (límites de pocos segundos; el navegador simulado es un proceso real en su propio grupo que ignora SIGTERM, deja un
// servidor escuchando y tiene un nieto igual). Corta la ejecución en cada fase (preparación, arranque, escenario y
// cierre) y comprueba en cada una: (i) que el proceso termina dentro de su límite más el margen; (ii) que el JSON
// existe con lo medido y la fase; (iii) que no queda vivo ningún descendiente (el árbol se recorre con `ps` mientras
// el hijo vive) ni ningún puerto de los servidores aceptando conexiones; y (iv) el código de salida: 4 si vence el
// límite de la ejecución completa, 3 si corta el vigilante de un escenario o del cierre.
//
//   node --test pruebas/navegadores/presupuesto-limpieza.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listarConPs } from '../../scripts/detener-arbol.ts';
import {
  descendientesDe,
  ESTADO,
  SALIDA_POR_CIERRE_FORZADO,
  SALIDA_POR_LIMITE_DE_EJECUCION,
} from './presupuesto-plazo.mjs';
import { ahora } from './presupuesto-servidor.mjs';

/** Los plazos que los dobles dan al arnés: límite de la condición, margen de cierre, preparación y arranque. */
const LIMITE_MS = 1500;
const MARGEN_MS = 1000;
const PREPARACION_MS = 1000;
const ARRANQUE_MS = 500;
/** El límite de la ejecución completa con un escenario: preparación + arranque + límite + margen. */
const LIMITE_DE_EJECUCION_MS = PREPARACION_MS + ARRANQUE_MS + LIMITE_MS + MARGEN_MS;
/** Lo que se admite sobre lo esperado: arranque de node, temporizadores, escritura y salida. */
const HOLGURA_MS = 1500;
/** Hasta dónde se espera a un hijo antes de matarlo con su árbol: el caso falla si hay que llegar a esto. */
const TOPE_DEL_HIJO_MS = 15_000;
const ARNES = fileURLToPath(new URL('./presupuesto-rendimiento.mjs', import.meta.url));
const DOBLES = new URL('./presupuesto-proceso-dobles.mjs', import.meta.url).href;
const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const NOMBRE = 'doble';
/** Cada cuánto se recorre el árbol del hijo mientras vive. */
const RECORRIDO_MS = 50;

/** Si el proceso `pid` sigue vivo. */
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Anota la identidad (PID y hora de inicio, según `ps`) de los procesos vistos que aún no la tienen: solo esos se señalan
 * después, y solo si siguen siendo los mismos. Uno que ya no vive cuando se consulta queda anotado sin identidad (null),
 * para no consultarlo otra vez ni tomar por suyo el proceso que reciba después su PID.
 */
function anotarIdentidades(procesos, identidades) {
  const sinIdentidad = [...procesos].filter((pid) => !identidades.has(pid));
  if (!sinIdentidad.length) {
    return;
  }
  const tabla = listarConPs();
  for (const pid of sinIdentidad) {
    const visto = tabla.get(pid);
    identidades.set(pid, visto && !visto.terminado ? visto : null);
  }
}

/** Termina con SIGKILL los procesos anotados que siguen vivos y son los mismos (misma hora de inicio). */
function terminarLosMismos(identidades) {
  const tabla = listarConPs();
  for (const visto of identidades.values()) {
    if (!visto) {
      continue;
    }
    const actual = tabla.get(visto.pid);
    if (actual && !actual.terminado && actual.inicio === visto.inicio) {
      try {
        process.kill(visto.pid, 'SIGKILL');
      } catch {
        // Ya había terminado.
      }
    }
  }
}

/** Si algo acepta conexiones en `puerto` del bucle local. */
const escuchando = (puerto) =>
  new Promise((ok) => {
    const conexion = connect(puerto, '127.0.0.1');
    conexion.once('connect', () => {
      conexion.destroy();
      ok(true);
    });
    conexion.once('error', () => ok(false));
  });

/** La orden del hijo: el arnés con los dobles precargados, una sola ejecución y su salida en `salida`. */
const ordenDelHijo = (salida) => [
  `--import=${DOBLES}`,
  ARNES,
  '--artefacto',
  `${NOMBRE}=${salida}`,
  '--motor',
  'chromium',
  '--condicion',
  'escritorio',
  '--escenario',
  'inicio',
  '--salida',
  salida,
];

/** El entorno del hijo: los dobles en `modo` con los plazos de la prueba y sin navegadores reales a mano. */
const entornoDelHijo = (modo, salida) => ({
  ...process.env,
  PRESUPUESTO_DOBLE_MODO: modo,
  PRESUPUESTO_DOBLE_LIMITE_MS: String(LIMITE_MS),
  PRESUPUESTO_DOBLE_MARGEN_MS: String(MARGEN_MS),
  PRESUPUESTO_DOBLE_PREPARACION_MS: String(PREPARACION_MS),
  PRESUPUESTO_DOBLE_ARRANQUE_MS: String(ARRANQUE_MS),
  PLAYWRIGHT_BROWSERS_PATH: join(salida, 'sin-navegadores'),
});

/**
 * Lanza el arnés con los dobles en `modo`. Mientras vive, recorre su árbol con `ps` cada 50 ms y junta todos los
 * descendientes vistos y los PID y puertos que dicen los dobles, con la identidad de cada proceso mientras vive. `fin`
 * se cumple con el código, el tiempo desde el lanzamiento, si hubo que matarlo y lo visto. La carpeta de salida se
 * retira al acabar el caso `prueba`.
 */
function lanzar(modo, prueba) {
  const salida = mkdtempSync(join(tmpdir(), 'faro-presupuesto-limpieza-'));
  prueba.after(() => rmSync(salida, { recursive: true, force: true }));
  const inicio = ahora();
  const hijo = spawn(process.execPath, ordenDelHijo(salida), {
    cwd: RAIZ,
    env: entornoDelHijo(modo, salida),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const procesos = new Set();
  /** PID → su identidad, anotada mientras vivía (null si ya no vivía al consultarlo). */
  const identidades = new Map();
  const puertos = new Set();
  let texto = '';
  let errores = '';
  hijo.stdout.on('data', (trozo) => {
    texto += trozo;
    for (const [, clase, numero] of texto.matchAll(/^(PROCESO|PUERTO) (\d+)$/gmu)) {
      (clase === 'PROCESO' ? procesos : puertos).add(Number(numero));
    }
    anotarIdentidades(procesos, identidades);
  });
  hijo.stderr.on('data', (trozo) => {
    errores += trozo;
  });
  const recorrido = setInterval(() => {
    for (const pid of descendientesDe(hijo.pid)) {
      procesos.add(pid);
    }
    anotarIdentidades(procesos, identidades);
  }, RECORRIDO_MS);
  let matado = false;
  const tope = setTimeout(() => {
    matado = true;
    // También los ya huérfanos que se vieron colgar del hijo, si siguen siendo los mismos: el caso falla, pero no deja
    // restos.
    for (const pid of descendientesDe(hijo.pid)) {
      procesos.add(pid);
    }
    anotarIdentidades(procesos, identidades);
    terminarLosMismos(identidades);
    hijo.kill('SIGKILL');
  }, TOPE_DEL_HIJO_MS);
  const fin = new Promise((ok) => {
    hijo.once('exit', (codigo, senal) => {
      clearTimeout(tope);
      clearInterval(recorrido);
      ok({ codigo, senal, ms: ahora() - inicio, matado, errores, procesos, identidades, puertos });
    });
  });
  return { hijo, fin, salida };
}

/** El documento JSON que el arnés ha escrito. */
function documentoDe(salida) {
  const ruta = join(salida, `presupuesto-${NOMBRE}.json`);
  assert.ok(existsSync(ruta), 'El arnés ha escrito el JSON');
  assert.ok(existsSync(join(salida, `presupuesto-${NOMBRE}.md`)), 'El arnés ha escrito el resumen');
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/** Ningún proceso del árbol del arnés vivo ni ningún puerto de sus servidores aceptando conexiones; sin restos. */
async function sinNadaVivo({ procesos, identidades, puertos }, hijo, { navegador = true } = {}) {
  assert.equal(vivo(hijo.pid), false, 'El proceso del arnés ya no existe');
  if (navegador) {
    assert.ok(procesos.size >= 2, `Se han visto el navegador simulado y su nieto: ${[...procesos]}`);
  }
  const vivos = [...procesos].filter(vivo);
  if (vivos.length) {
    terminarLosMismos(identidades);
  }
  assert.deepEqual(vivos, [], 'Ningún descendiente del arnés sigue vivo');
  assert.ok(puertos.size >= 1, 'Se han visto los servidores');
  const abiertos = [];
  for (const puerto of puertos) {
    if (await escuchando(puerto)) {
      abiertos.push(puerto);
    }
  }
  assert.deepEqual(abiertos, [], 'Ningún puerto de los servidores acepta conexiones');
}

for (const [modo, fase, dicho] of [
  ['colgado-preparacion', `preparación ${NOMBRE}`, 'la preparación'],
  ['colgado-arranque', 'arranque chromium · escritorio', 'el arranque'],
]) {
  test(`colgada en ${dicho}, vence el límite de la ejecución completa: JSON con la fase, salida 4 y nada vivo`, async (prueba) => {
    const { hijo, fin, salida } = lanzar(modo, prueba);
    const terminado = await fin;
    prueba.diagnostic(
      `salida a los ${Math.round(terminado.ms)} ms (límite de la ejecución: ${LIMITE_DE_EJECUCION_MS} ms)`,
    );
    assert.equal(
      terminado.matado,
      false,
      `El proceso termina dentro del límite de la ejecución más el margen: ${terminado.errores}`,
    );
    assert.ok(terminado.ms >= LIMITE_DE_EJECUCION_MS, `No corta antes del límite de la ejecución: ${terminado.ms} ms`);
    assert.ok(
      terminado.ms <= LIMITE_DE_EJECUCION_MS + MARGEN_MS + HOLGURA_MS,
      `Corta al pasar el límite de la ejecución más el margen: ${terminado.ms} ms`,
    );
    assert.equal(terminado.codigo, SALIDA_POR_LIMITE_DE_EJECUCION, 'Sale con el código del límite de la ejecución');
    const documento = documentoDe(salida);
    assert.equal(documento.limiteDeEjecucionVencido?.fase, fase, 'El JSON dice en qué fase venció');
    assert.equal(documento.fase, fase);
    assert.equal(documento.plazo.limiteDeEjecucionMs, LIMITE_DE_EJECUCION_MS);
    assert.ok(documento.limpieza.procesosTerminados.length >= 2, 'El JSON dice qué procesos se terminaron');
    await sinNadaVivo(terminado, hijo);
  });
}

test('colgada en el escenario, el vigilante del escenario corta: JSON con lo medido, salida 3 y nada vivo', async (prueba) => {
  const { hijo, fin, salida } = lanzar('colgado', prueba);
  const terminado = await fin;
  prueba.diagnostic(`salida a los ${Math.round(terminado.ms)} ms`);
  assert.equal(terminado.matado, false, `El proceso termina dentro del límite más el margen: ${terminado.errores}`);
  assert.ok(terminado.ms <= LIMITE_DE_EJECUCION_MS + HOLGURA_MS, `Corta a tiempo: ${terminado.ms} ms`);
  assert.equal(terminado.codigo, SALIDA_POR_CIERRE_FORZADO, 'Sale con el código del cierre forzado');
  const documento = documentoDe(salida);
  assert.equal(documento.fase, 'escenario inicio', 'El JSON dice en qué fase se cortó');
  assert.equal(documento.cierreForzado, 'escenario inicio');
  const medida = documento.resultados.escritorio.chromium.inicio;
  assert.equal(medida?.estado, ESTADO.enCurso, 'Lo medido hasta el corte queda escrito, «en curso»');
  assert.equal(medida.hitos.interfaz.alcanzado, true, 'Con el hito alcanzado');
  await sinNadaVivo(terminado, hijo);
});

test('colgada en el cierre del navegador, el vigilante del cierre corta: JSON con la medida, salida 3 y nada vivo', async (prueba) => {
  const { hijo, fin, salida } = lanzar('colgado-cierre', prueba);
  const terminado = await fin;
  prueba.diagnostic(`salida a los ${Math.round(terminado.ms)} ms`);
  assert.equal(terminado.matado, false, `El proceso termina dentro del límite más el margen: ${terminado.errores}`);
  assert.ok(terminado.ms <= LIMITE_DE_EJECUCION_MS + HOLGURA_MS, `Corta a tiempo: ${terminado.ms} ms`);
  assert.equal(terminado.codigo, SALIDA_POR_CIERRE_FORZADO, 'Sale con el código del cierre forzado');
  const documento = documentoDe(salida);
  assert.equal(documento.fase, 'cierre chromium', 'El JSON dice en qué fase se cortó');
  assert.equal(documento.cierreForzado, 'navegador chromium');
  assert.equal(documento.resultados.escritorio.chromium.inicio?.estado, ESTADO.completa, 'La medida queda completa');
  await sinNadaVivo(terminado, hijo);
});

test('termina normal: salida 0 y ni el navegador simulado ni su nieto huérfano quedan vivos', async (prueba) => {
  const { hijo, fin, salida } = lanzar('normal', prueba);
  const terminado = await fin;
  assert.equal(terminado.matado, false, terminado.errores);
  assert.equal(terminado.codigo, 0, `Sale con 0: ${terminado.errores}`);
  const documento = documentoDe(salida);
  assert.equal(documento.resultados.escritorio.chromium.inicio?.estado, ESTADO.completa);
  assert.ok(documento.limpieza.procesosTerminados.length >= 1, 'El nieto huérfano se termina al acabar');
  await sinNadaVivo(terminado, hijo);
});
