// El sello del motor de ocupaciones: la huella SHA-256 de cada archivo que se ejecuta (código y datos de src/ y los
// modelos de modelos/; no la documentación), en motores/ocupaciones/sello.json. pruebas/sello.test.ts exige que coincida, así
// que ningún archivo del motor cambia sin que alguien vuelva a sellarlo a propósito. Solo se sella de nuevo con la
// autorización explícita y la medición del banco de 2.473 personas idéntica o aprobada (motores/ocupaciones/README.md).
// Uso: node motores/ocupaciones/herramientas/sellar.ts [--comprobar]

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** La carpeta del motor. */
export const MOTOR = fileURLToPath(new URL('../', import.meta.url));
/** El archivo del sello, en la carpeta del motor. */
export const SELLO = join(MOTOR, 'sello.json');
/** Las carpetas con lo que se ejecuta. */
const CARPETAS = ['src', 'modelos'];

/** Lo que guarda el sello: la huella de cada archivo de ejecución, por su ruta desde la carpeta del motor. */
export interface Sello {
  algoritmo: 'sha256';
  archivos: Record<string, string>;
}

/** Si un archivo se ejecuta: todo lo de src/ y modelos/ salvo la documentación. */
function seEjecuta(ruta: string): boolean {
  return !ruta.endsWith('.md');
}

/**
 * El sello que corresponde a los archivos de hoy, en orden.
 *
 * @param motor - La carpeta del motor; por omisión, esta.
 * @returns La huella de cada archivo de ejecución.
 */
export function selloActual(motor: string = MOTOR): Sello {
  const rutas = CARPETAS.flatMap((carpeta) =>
    readdirSync(join(motor, carpeta), { recursive: true, withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => relative(motor, join(entrada.parentPath, entrada.name)).split(sep).join('/')),
  )
    .filter(seEjecuta)
    .sort();
  const archivos: Record<string, string> = {};
  for (const ruta of rutas) {
    archivos[ruta] = createHash('sha256')
      .update(readFileSync(join(motor, ruta)))
      .digest('hex');
  }
  return { algoritmo: 'sha256', archivos };
}

/** El texto del sello tal como se guarda. */
export function textoDelSello(sello: Sello): string {
  return `${JSON.stringify(sello, null, 2)}\n`;
}

if (import.meta.main) {
  const texto = textoDelSello(selloActual());
  if (process.argv.includes('--comprobar')) {
    if (readFileSync(SELLO, 'utf8') !== texto) {
      console.error('El sello del motor de ocupaciones no coincide con sus archivos (motores/ocupaciones/README.md)');
      process.exitCode = 1;
    }
  } else {
    writeFileSync(SELLO, texto);
  }
}
