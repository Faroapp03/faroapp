// El orden de los motores del ensayo de navegadores (ensayo.ts): cada motor se ejecuta aparte y su fallo no impide el
// siguiente, salvo una interrupción de quien ejecuta (Ctrl+C), que no es un fallo del motor: se guarda lo hecho y se
// detiene el ensayo. Sin Playwright, para poder probarlo sin navegadores.

/** El comienzo del fallo de un paso interrumpido por quien ejecuta el ensayo (scripts/ejecucion-del-paso.ts). */
export const INTERRUMPIDA = 'Comprobación interrumpida por ';

/** Lo que dio un motor. */
export interface ResultadoDelMotor {
  readonly motor: string;
  readonly correcto: boolean;
  readonly detalle: string;
}

/**
 * Ejecuta los motores en orden y guarda el resumen tras cada uno.
 *
 * @param motores - Los motores, en orden.
 * @param ensayo - `preparar` deja listo un motor (su carpeta de resultados) y, si falla, detiene el ensayo: no es un
 *   fallo del motor; `ejecutar` ejecuta un motor y devuelve su detalle, y falla si el motor falla; `guardarResumen`
 *   guarda los resultados hasta ese momento.
 * @returns Los resultados de todos los motores.
 * @throws {Error} El de `preparar`, o el de una interrupción tras guardar el resumen, sin lanzar los motores siguientes.
 */
export async function ensayarEnOrden<Motor extends string>(
  motores: readonly Motor[],
  ensayo: {
    readonly preparar: (motor: Motor) => void;
    readonly ejecutar: (motor: Motor) => Promise<string>;
    readonly guardarResumen: (resultados: readonly ResultadoDelMotor[]) => void;
  },
): Promise<readonly ResultadoDelMotor[]> {
  const { preparar, ejecutar, guardarResumen } = ensayo;
  const resultados: ResultadoDelMotor[] = [];
  for (const motor of motores) {
    preparar(motor);
    try {
      resultados.push({ motor, correcto: true, detalle: await ejecutar(motor) });
    } catch (error) {
      resultados.push({ motor, correcto: false, detalle: String(error) });
      if (error instanceof Error && error.message.startsWith(INTERRUMPIDA)) {
        guardarResumen(resultados);
        throw error;
      }
    }
    guardarResumen(resultados);
  }
  return resultados;
}
