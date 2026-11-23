// La puerta del motor de cursos en Node (servidor local): sus operaciones corren en un hilo de worker_threads
// (plataforma/node/trabajador-de-cursos.ts) que la puerta termina si una no acaba a tiempo
// (plataforma/motor-de-cursos.ts, crearPuertaEnTrabajador). El hilo de la API, el del motor de ocupaciones, no espera.

import { Worker } from 'node:worker_threads';
import {
  crearPuertaEnTrabajador,
  type LanzarTrabajador,
  type PuertaConTrabajador,
  type TiemposDeLaPuerta,
} from '../motor-de-cursos.ts';
import type { MensajeDelTrabajador } from '../operaciones-de-cursos.ts';

/** El guion del trabajador. */
const TRABAJADOR = new URL('./trabajador-de-cursos.ts', import.meta.url);

/** Cómo se crea la puerta de Node: los tiempos máximos y el motor que carga el trabajador. */
export interface OpcionesDeLaPuertaNode extends TiemposDeLaPuerta {
  /** La dirección (file:) del módulo que carga el trabajador; por defecto, la entrada pública del motor. */
  readonly moduloDelTrabajador?: string;
}

/**
 * Arranca trabajadores de cursos con worker_threads.
 *
 * @param modulo - El motor que carga cada trabajador; por defecto, el suyo.
 * @returns El lanzador para crearPuertaEnTrabajador.
 */
export function lanzadorNode(modulo?: string): LanzarTrabajador {
  return (avisos) => {
    const trabajador = new Worker(TRABAJADOR, { workerData: modulo === undefined ? {} : { modulo } });
    trabajador.on('message', (mensaje: MensajeDelTrabajador) => avisos.mensaje(mensaje));
    trabajador.on('error', (error) =>
      avisos.caido(error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
    );
    trabajador.on('messageerror', (error) => avisos.caido(`mensaje ilegible: ${error.message}`));
    trabajador.on('exit', (codigo) => avisos.caido(`ha terminado con el código ${codigo}`));
    // Sin unref, un trabajador ocioso no dejaría terminar el proceso de una herramienta o una prueba. Después de los
    // escuchadores: el de 'message' vuelve a sujetar el proceso.
    trabajador.unref();
    return {
      enviar: (mensaje) => trabajador.postMessage(mensaje),
      terminar: () => {
        trabajador.removeAllListeners('exit');
        void trabajador.terminate();
      },
    };
  };
}

/**
 * La puerta del motor de cursos con su trabajador de worker_threads.
 *
 * @param opciones - El motor del trabajador y los tiempos máximos.
 * @returns La puerta.
 */
export function crearPuertaDeCursosNode({
  moduloDelTrabajador,
  ...opciones
}: OpcionesDeLaPuertaNode = {}): PuertaConTrabajador {
  return crearPuertaEnTrabajador(lanzadorNode(moduloDelTrabajador), opciones);
}
