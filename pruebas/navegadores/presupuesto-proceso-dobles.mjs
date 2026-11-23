// Los dobles con que presupuesto-proceso.test.mjs lanza presupuesto-rendimiento.mjs, el de verdad, en un proceso hijo
// sin navegador. Se precarga con `--import` y desvía, solo para presupuesto-rendimiento.mjs y presupuesto-ejecucion.mjs,
// cuatro módulos a este: el límite total y el margen de cierre pasan a ser los de la prueba, el arranque del navegador y
// la construcción servida son simulados y medir() anota un hito y después termina o se queda colgada según el modo.
// El navegador simulado es un proceso real en su propio grupo (como los de Playwright) que ignora SIGTERM, deja un
// servidor escuchando y lanza un nieto que hace lo mismo; con `colgado-preparacion`, servible() lanza otro igual (como
// un workerd) y no vuelve; con `colgado-arranque`, arrancarCon() lo lanza y no vuelve; con `colgado-cierre`, el cierre
// del navegador no vuelve. Cada proceso escribe `PROCESO <pid>` y `PUERTO <puerto>` en la salida estándar, cada uno en
// su línea (con un salto delante: con `node --test` la salida del hijo lleva también los mensajes del ensayo). Todo lo
// demás (los vigilantes, las señales, la limpieza del árbol, la escritura del JSON y del resumen, el plazo y el ensayo
// de node:test) es el código del arnés. servible() tarda un poco y escribe `PREPARANDO <fases>` (la fase que dice cada
// JSON ya escrito en la carpeta de la construcción) al empezar y `PREPARADA` al terminar; con
// PRESUPUESTO_DOBLE_ESCRITURAS=1, cada escritura y cada renombrado de archivo se anotan en la salida estándar.
//
//   PRESUPUESTO_DOBLE_MODO=normal|colgado|colgado-preparacion|colgado-arranque|colgado-cierre
//   PRESUPUESTO_DOBLE_LIMITE_MS=<ms> PRESUPUESTO_DOBLE_MARGEN_MS=<ms>
//   [PRESUPUESTO_DOBLE_PREPARACION_MS=<ms>] [PRESUPUESTO_DOBLE_ARRANQUE_MS=<ms>] [PRESUPUESTO_DOBLE_ESCRITURAS=1]
import { spawn } from 'node:child_process';
import fs, { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { ESTADO_HTTP } from '../../src/comun/estados-http.ts';
import { CONDICIONES as CONDICIONES_REALES } from './presupuesto-condiciones.mjs';
import { ESTADO } from './presupuesto-plazo.mjs';
import { construccionPrivadaSintetica } from './presupuesto-privado-sintetico.mjs';

export { argumentos, workerPrivadoDe } from './paquete-comun.mjs';
export { bytesPorSegundo, DISPOSITIVO } from './presupuesto-condiciones.mjs';
export * from './presupuesto-plazo.mjs';

const DESVIADOS = new Set([
  './paquete-comun.mjs',
  './presupuesto-condiciones.mjs',
  './presupuesto-medida.mjs',
  './presupuesto-plazo.mjs',
]);
const QUIENES_LOS_VEN_DOBLES = ['/presupuesto-rendimiento.mjs', '/presupuesto-ejecucion.mjs'].map(
  (archivo) => new URL(`.${archivo}`, import.meta.url).href,
);
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (DESVIADOS.has(especificador) && QUIENES_LOS_VEN_DOBLES.includes(contexto.parentURL)) {
      return { url: import.meta.url, shortCircuit: true };
    }
    return siguiente(especificador, contexto);
  },
});

// Las escrituras y los renombrados de archivos del arnés, anotados con su ruta: `ESCRITO <ruta>` y
// `RENOMBRADO <de> <a>`, en JSON.
if (process.env.PRESUPUESTO_DOBLE_ESCRITURAS === '1') {
  const { writeFileSync, renameSync } = fs;
  fs.writeFileSync = (ruta, ...resto) => {
    process.stdout.write(`\nESCRITO ${JSON.stringify(String(ruta))}\n`);
    return writeFileSync(ruta, ...resto);
  };
  fs.renameSync = (de, a) => {
    process.stdout.write(`\nRENOMBRADO ${JSON.stringify([String(de), String(a)])}\n`);
    return renameSync(de, a);
  };
  syncBuiltinESMExports();
}

const MODO = process.env.PRESUPUESTO_DOBLE_MODO ?? 'normal';
const LIMITE_MS = Number(process.env.PRESUPUESTO_DOBLE_LIMITE_MS);
const MARGEN_MS = Number(process.env.PRESUPUESTO_DOBLE_MARGEN_MS);
if (!(LIMITE_MS > 0 && MARGEN_MS > 0)) {
  throw new Error('Faltan PRESUPUESTO_DOBLE_LIMITE_MS y PRESUPUESTO_DOBLE_MARGEN_MS');
}

/** El margen de cierre de la prueba, repartido como en presupuesto-plazo.mjs. */
export const MARGEN_DE_CIERRE_MS = MARGEN_MS;
/** La preparación y el arranque acotados de la prueba (por omisión, 1 s y 0,5 s). */
const PREPARACION_POR_OMISION_MS = 1000;
const ARRANQUE_POR_OMISION_MS = 500;
export const PREPARACION_MS = Number(process.env.PRESUPUESTO_DOBLE_PREPARACION_MS ?? PREPARACION_POR_OMISION_MS);
export const ARRANQUE_MS = Number(process.env.PRESUPUESTO_DOBLE_ARRANQUE_MS ?? ARRANQUE_POR_OMISION_MS);
export const CIERRE_DEL_ESCENARIO_MS = MARGEN_MS / 2;
export const CIERRE_DEL_NAVEGADOR_MS = MARGEN_MS - CIERRE_DEL_ESCENARIO_MS;
/** Solo escritorio, con el límite total de la prueba. */
export const CONDICIONES = Object.freeze({
  escritorio: { ...CONDICIONES_REALES.escritorio, limiteTotalMs: LIMITE_MS },
});
export const ESCENARIOS = [{ nombre: 'inicio', ruta: '/inicio.html', serviceWorker: true }];

/**
 * Un proceso que ignora SIGTERM y SIGINT, deja un servidor escuchando, dice su PID y su puerto y, en el primer nivel,
 * lanza un nieto igual.
 */
const PROCESO_TERCO = `
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
process.on('SIGTERM', () => undefined);
process.on('SIGINT', () => undefined);
const servidor = createServer((_req, res) => res.end());
servidor.listen(0, '127.0.0.1', () => {
  process.stdout.write('\\nPROCESO ' + process.pid + '\\nPUERTO ' + servidor.address().port + '\\n');
  if (process.argv[1] === 'padre') {
    spawn(process.execPath, ['-e', process.argv[2], 'nieto'], { stdio: ['ignore', 'inherit', 'ignore'] });
  }
});
`;
/** Lanza el proceso terco con su nieto, en su propio grupo de procesos, y espera a que escuche. */
function lanzarTerco() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const proceso = spawn(process.execPath, ['-e', PROCESO_TERCO, 'padre', PROCESO_TERCO], {
    detached: true,
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  proceso.stdout.on('data', (trozo) => process.stdout.write(trozo));
  return new Promise((ok) => proceso.stdout.once('data', () => ok(proceso)));
}
const colgada = () => new Promise(() => undefined);

/**
 * Un navegador simulado: un proceso terco con su nieto. Su cierre lo termina con SIGKILL (el nieto queda huérfano,
 * como un proceso auxiliar del navegador); con `colgado-cierre`, no vuelve.
 */
export async function arrancarCon() {
  const proceso = await lanzarTerco();
  if (MODO === 'colgado-arranque') {
    return colgada();
  }
  return {
    navegador: { version: () => 'doble' },
    cerrar: () => (MODO === 'colgado-cierre' ? colgada() : Promise.resolve(proceso.kill('SIGKILL'))),
  };
}
/** Lo que tarda la preparación simulada de una construcción. */
const PREPARACION_SIMULADA_MS = 200;
/** La fase que dice cada JSON del arnés ya escrito en `carpeta`: `{ nombre: fase }`. */
const fasesEscritas = (carpeta) =>
  Object.fromEntries(
    readdirSync(carpeta)
      .filter((archivo) => /^presupuesto-.+\.json$/u.test(archivo))
      .map((archivo) => JSON.parse(readFileSync(join(carpeta, archivo), 'utf8')))
      .map(({ nombre, fase }) => [nombre, fase]),
  );

/**
 * Una construcción privada sintética sin archivos de web (precomprimir() no tiene nada que comprimir), preparada en un
 * momento y retirada al salir. Con `colgado-preparacion`, deja un servidor en el proceso y un proceso terco escuchando
 * y no vuelve.
 */
export async function servible(carpeta) {
  process.stdout.write(`\nPREPARANDO ${JSON.stringify(fasesEscritas(carpeta))}\n`);
  if (MODO === 'colgado-preparacion') {
    const servidor = createServer((_req, res) => res.end());
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    process.stdout.write(`\nPUERTO ${servidor.address().port}\n`);
    await lanzarTerco();
    return colgada();
  }
  await new Promise((ok) => setTimeout(ok, PREPARACION_SIMULADA_MS));
  const construccion = await construccionPrivadaSintetica();
  process.once('exit', construccion.retirar);
  process.stdout.write('\nPREPARADA\n');
  return construccion;
}

const HITO_INTERFAZ = { alcanzado: true, ms: 120, peticiones: 3, bytesServidos: 4096 };
const PENDIENTE = { pendiente: true };
const SERVIDOR = {
  sinIdentidadEsperada: 0,
  get: { bytesServidos: 4096, bytesSinComprimir: 8192, peticiones: 3, direcciones: 3, repetidas: 0, autenticacion: 0 },
  javascriptAlCorte: { peticiones: 1, direcciones: 1, autenticacion: 0 },
  mismoContenido: { bytesDuplicadosSinComprimir: 0, grupos: [] },
  compresion: {},
};

/**
 * medir() simulada. Anota un hito con `estado: en curso` y escribe en la salida estándar `HITO <puerto>`, con el
 * puerto de un servidor que deja escuchando (el servidor del ensayo). En el modo `normal` cierra el servidor y
 * devuelve una medida completa; en el modo `colgado` no vuelve nunca y el servidor sigue escuchando.
 */
export async function medir({ plazoTotal, alAvanzar }) {
  const servidor = createServer((_req, res) => res.end());
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const plazo = { limiteTotalMs: plazoTotal.limiteTotalMs, usadoMs: plazoTotal.usadoMs() };
  const hitos = { interfaz: HITO_INTERFAZ, analisis: PENDIENTE, copiaWeb: PENDIENTE, copiaCompleta: PENDIENTE };
  alAvanzar({ estado: ESTADO.enCurso, plazo, hitos });
  process.stdout.write(`\nHITO ${servidor.address().port}\n`);
  if (MODO === 'colgado') {
    return colgada();
  }
  await new Promise((ok) => servidor.close(ok));
  return {
    estado: ESTADO.completa,
    plazo: { ...plazo, usadoMs: plazoTotal.usadoMs() },
    errores: [],
    estadoNavegacion: ESTADO_HTTP.correcto,
    cotaMs: 0,
    hitos: { interfaz: HITO_INTERFAZ, analisis: null, copiaWeb: HITO_INTERFAZ, copiaCompleta: HITO_INTERFAZ },
    servidor: SERVIDOR,
  };
}
