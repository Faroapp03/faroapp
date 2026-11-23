// El fallo de un paso de la verificación y el código con el que termina el conjunto.

/** Código de un fallo que no trae el código de un proceso: señal, plazo, salida excesiva o resumen inválido. */
export const CODIGO_FALLO = 1;
/** Los códigos de salida de un proceso caben en un byte. */
const CODIGO_MAXIMO = 255;

/** Fallo de una herramienta, su ejecución o el resultado de una suite; conserva el código del proceso que falló. */
export class FalloDeComprobacion extends Error {
  override name = 'FalloDeComprobacion';
  /** Código distinto de cero con el que terminó el proceso del paso, si terminó con código. */
  readonly codigo: number | undefined;

  constructor(mensaje: string, opciones: ErrorOptions & { readonly codigo?: number | undefined } = {}) {
    super(mensaje, opciones);
    this.codigo = opciones.codigo;
  }
}

/**
 * El código con el que termina la verificación tras un fallo: el del paso que falló, o 1 si no terminó con código.
 *
 * @param error - El fallo recibido.
 * @returns Un código distinto de cero.
 */
export function codigoDeSalida(error: unknown): number {
  const codigo = error instanceof FalloDeComprobacion ? error.codigo : undefined;
  return codigo !== undefined && Number.isSafeInteger(codigo) && codigo > 0 && codigo <= CODIGO_MAXIMO
    ? codigo
    : CODIGO_FALLO;
}
