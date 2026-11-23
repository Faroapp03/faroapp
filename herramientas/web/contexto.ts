import type { ResumenDelGrafo } from './empaquetado.ts';

/** Entradas explícitas de una construcción web, estables durante su preparación y comprobación. */
export interface ContextoWeb {
  readonly web: string;
  readonly paquete: string;
  /**
   * Los bytes del motor que se publica, por rutas motor/…: en una construcción, los del empaquetado (empaquetado.ts),
   * nunca leídos de la salida que se comprueba.
   */
  readonly motor: ReadonlyMap<string, Uint8Array>;
  /**
   * Los bytes de cada archivo del paquete del navegador (empaquetado.ts), por su ruta desde web/: las entradas y los
   * trozos de las páginas, los diccionarios, el Worker del motor y el motor. Solo en una construcción.
   */
  readonly paqueteNavegador?: ReadonlyMap<string, Uint8Array>;
  /** El resumen del grafo emitido: por página, su entrada, sus trozos y sus bytes. Solo en una construcción. */
  readonly grafoEmitido?: ResumenDelGrafo;
}
