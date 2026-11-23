// Adaptador worker_threads: carga el módulo de Cursos y procesa en orden los datos y consultas de su puerta.

import { parentPort, workerData } from 'node:worker_threads';
import type { MensajeAlTrabajador } from '../operaciones-de-cursos.ts';
import { iniciarTrabajadorDeCursos } from '../trabajador-de-cursos.ts';

/** La entrada pública del motor de cursos. */
const MOTOR = new URL('../../../motores/cursos/src/index.ts', import.meta.url).href;

const puerto = parentPort;
if (puerto === null) {
  throw new Error('plataforma/node/trabajador-de-cursos.ts solo corre como trabajador (worker_threads)');
}
const modulo =
  typeof workerData === 'object' && workerData !== null && typeof workerData.modulo === 'string'
    ? workerData.modulo
    : MOTOR;
const atender = iniciarTrabajadorDeCursos({
  importar: () => import(modulo),
  enviar: (mensaje) => puerto.postMessage(mensaje),
});
// Uno detrás de otro: los datos están guardados antes de atender su consulta.
let cola = Promise.resolve();
puerto.on('message', (mensaje: MensajeAlTrabajador) => {
  cola = cola.then(() => atender(mensaje));
});
