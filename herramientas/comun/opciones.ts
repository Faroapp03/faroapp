// Opciones estrictas y salida uniforme de las herramientas propias.

import { type ParseArgsConfig, parseArgs } from 'node:util';

const SALIDA_ERROR_DE_USO = 2;
const SALIDA_FALLO = 1;

/** Lectura de opciones con ayuda y error de uso; solo se invoca desde una orden ejecutable. */
export function orden(uso: string) {
  function leer<const Configuracion extends ParseArgsConfig>(config: Configuracion) {
    const args = config.args ?? process.argv.slice(2);
    if (args.includes('--ayuda') || args.includes('-h')) {
      console.log(`Uso: ${uso}`);
      process.exit(0);
    }
    try {
      return parseArgs({ ...config, args, strict: true });
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}\nUso: ${uso}`);
      process.exit(SALIDA_ERROR_DE_USO);
    }
  }
  return { leer };
}

/** Ejecuta una orden y conserva el fallo como salida 1, sin ocultarlo ni volcar una traza. */
export async function ejecutar(principal: () => unknown, rotulo = 'Error'): Promise<void> {
  try {
    await principal();
  } catch (error) {
    console.error(`${rotulo}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = SALIDA_FALLO;
  }
}
