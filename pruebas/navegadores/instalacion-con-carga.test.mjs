// La espera de la instalación del service worker (instalarServiceWorker, paquete-comun.mjs) no depende de la carga de
// la máquina: con un proceso al 100 % de CPU por núcleo, recorrido-en-la-copia.test.mjs pasa entero en los tres motores
// y cada instalación termina (estado `activated`) dentro de lo medido: PEOR_INSTALACION_MEDIDA_MS con el margen de
// VARIACION_ENTRE_REPETICIONES. Si no, la medida escrita en paquete-comun.mjs ha dejado de valer. Escribe lo que tardó
// cada instalación y la peor.
// Los procesos de carga se lanzan con su PID y se terminan por él al acabar, también si el caso vence
// (recursos-del-caso.mjs). Con orden propia (npm run probar:instalacion-con-carga): satura la CPU y no cabe en verificar.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { availableParallelism } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webConstruida } from '../ayudas/web-construida.ts';
import { PEOR_INSTALACION_MEDIDA_MS, TOPE_DE_INSTALACION_MS } from './paquete-comun.mjs';
import { recursosDelCaso } from './recursos-del-caso.mjs';

// Sin la web local construida de estas fuentes, se dice ya, antes de cargar la máquina.
webConstruida();
const PRUEBA = fileURLToPath(new URL('recorrido-en-la-copia.test.mjs', import.meta.url));
/** Las precargas con que verificar ejecuta las pruebas (scripts/verificar.ts): sin red y con el motor construido. */
const PRECARGAS = ['../ayudas/sin-red.ts', '../ayudas/motor-construido.ts'].map(
  (ruta) => `--import=${new URL(ruta, import.meta.url).href}`,
);
/** Un proceso al 100 % por núcleo: la máquina entera ocupada mientras corre la prueba. */
const PROCESOS_DE_CARGA = availableParallelism();
/** Las instalaciones de recorrido-en-la-copia: dos casos por base, dos bases y tres motores. */
const INSTALACIONES = 12;
/** El plazo del caso: la prueba entera con la CPU saturada tardó como mucho 66 s al medir (20 procesos). */
const PLAZO_DEL_CASO_MS = 300_000;
/**
 * Lo que varió la peor instalación entre repeticiones con la misma carga al medir (de 131 a 354 ms, casi ×3): el
 * margen sobre PEOR_INSTALACION_MEDIDA_MS antes de dar la medida por superada.
 */
const VARIACION_ENTRE_REPETICIONES = 3;
const LIMITE_MEDIDO_MS = PEOR_INSTALACION_MEDIDA_MS * VARIACION_ENTRE_REPETICIONES;
const INSTALADO = /^(\S+ \S+): el service worker se instaló en (\d+) ms$/gmu;

/** Termina `proceso` por su PID si sigue vivo, y espera a que salga. @param {import('node:child_process').ChildProcess} proceso */
function terminar(proceso) {
  if (proceso.exitCode === null && proceso.signalCode === null) {
    const salida = once(proceso, 'exit');
    process.kill(proceso.pid, 'SIGTERM');
    return salida;
  }
}

/** Los PROCESOS_DE_CARGA procesos al 100 % de CPU, registrados en los recursos del caso, que los termina por su PID. */
async function cargarLaMaquina(recursos) {
  const carga = [];
  for (let i = 0; i < PROCESOS_DE_CARGA; i++) {
    carga.push(await recursos.abrir(`el proceso de carga ${i + 1}`, () => spawn('yes', { stdio: 'ignore' }), terminar));
  }
  return carga;
}

test(`con ${PROCESOS_DE_CARGA} procesos al 100 % de CPU, cada instalación del service worker termina dentro de lo medido`, {
  timeout: PLAZO_DEL_CASO_MS,
}, async (t) => {
  const recursos = recursosDelCaso(t);
  const carga = await cargarLaMaquina(recursos);
  const prueba = await recursos.abrir(
    'recorrido-en-la-copia.test.mjs',
    () =>
      spawn(process.execPath, ['--test', '--test-concurrency=1', PRUEBA], {
        env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, ...PRECARGAS].filter(Boolean).join(' ') },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (proceso) => {
      if (proceso.exitCode === null && proceso.signalCode === null) {
        process.kill(proceso.pid, 'SIGTERM');
      }
    },
  );
  let salida = '';
  prueba.stdout.setEncoding('utf8').on('data', (trozo) => (salida += trozo));
  prueba.stderr.setEncoding('utf8').on('data', (trozo) => (salida += trozo));
  const [codigo] = await once(prueba, 'exit');

  assert.ok(
    carga.every((proceso) => proceso.exitCode === null && proceso.signalCode === null),
    'la carga siguió durante toda la prueba',
  );
  assert.equal(codigo, 0, `recorrido-en-la-copia.test.mjs falló con la CPU saturada:\n${salida}`);
  const medidas = [...salida.matchAll(INSTALADO)].map(([, caso, ms]) => ({ caso, ms: Number(ms) }));
  assert.equal(medidas.length, INSTALACIONES, `no están todas las instalaciones:\n${salida}`);
  for (const { caso, ms } of medidas) {
    assert.ok(
      ms <= LIMITE_MEDIDO_MS,
      `${caso}: ${ms} ms, más de ${LIMITE_MEDIDO_MS} ms (${PEOR_INSTALACION_MEDIDA_MS} ms medidos × ${VARIACION_ENTRE_REPETICIONES})`,
    );
  }
  const peor = Math.max(...medidas.map(({ ms }) => ms));
  console.log(
    `${medidas.map(({ caso, ms }) => `${caso}: ${ms} ms`).join('\n')}\n` +
      `Peor instalación con ${PROCESOS_DE_CARGA} procesos de carga: ${peor} ms (peor medida escrita: ` +
      `${PEOR_INSTALACION_MEDIDA_MS} ms; tope: ${TOPE_DE_INSTALACION_MS} ms)`,
  );
});
