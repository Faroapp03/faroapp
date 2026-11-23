// La puerta del motor de cursos en el navegador: sus operaciones corren en un Web Worker propio
// (plataforma/navegador/trabajador-de-cursos.ts), que crea quien lo sabe arrancar con la política de Trusted Types de
// la web (web/scripts/motor-local/worker.js, con urlDeGuion) y que la puerta termina si una no acaba a tiempo. El
// trabajador del motor local, el que responde el recorrido, no espera.

import { crearPuertaEnTrabajador, type LanzarTrabajador, type PuertaDelMotor } from '../motor-de-cursos.ts';
import type { MensajeDelTrabajador } from '../operaciones-de-cursos.ts';

/**
 * Lo que la puerta usa de un Web Worker, con tipos propios: la comprobación general (tsconfig.json) no lleva los del
 * DOM.
 */
export interface WorkerDeCursos {
  postMessage(mensaje: unknown): void;
  terminate(): void;
  addEventListener(
    tipo: 'message' | 'error' | 'messageerror',
    escuchar: (evento: { readonly data?: unknown; readonly message?: string; preventDefault(): void }) => void,
  ): void;
}

/** Lo que arranca un Web Worker de cursos nuevo; lo da web/scripts/motor-local/worker.js. */
export type CrearWorkerDeCursos = () => WorkerDeCursos;

/**
 * Arranca trabajadores de cursos con Web Workers.
 *
 * @param crear - Lo que crea cada Worker.
 * @returns El lanzador para crearPuertaEnTrabajador.
 */
function lanzadorWeb(crear: CrearWorkerDeCursos): LanzarTrabajador {
  return (avisos) => {
    const trabajador = crear();
    trabajador.addEventListener('message', (evento) => avisos.mensaje(evento.data as MensajeDelTrabajador));
    trabajador.addEventListener('error', (evento) => {
      evento.preventDefault();
      avisos.caido(evento.message || 'error del Worker');
    });
    trabajador.addEventListener('messageerror', () => avisos.caido('mensaje ilegible'));
    return {
      enviar: (mensaje) => trabajador.postMessage(mensaje),
      terminar: () => trabajador.terminate(),
    };
  };
}

/**
 * La puerta del motor de cursos con su Web Worker.
 *
 * @param crear - Lo que crea cada Worker.
 * @returns La puerta.
 */
export function crearPuertaDeCursosWeb(crear: CrearWorkerDeCursos): PuertaDelMotor {
  return crearPuertaEnTrabajador(lanzadorWeb(crear));
}
