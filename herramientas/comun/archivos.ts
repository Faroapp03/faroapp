// Formato de publicaciones con las herramientas instaladas en este producto, independiente del directorio actual.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));
const BIOME = fileURLToPath(new URL('../../node_modules/@biomejs/biome/bin/biome', import.meta.url));
/** Límite del formateador local; no deja un proceso detenido indefinidamente. */
const PLAZO_FORMATO_MS = 30_000;
/** Límite del único reintento, más holgado: si el primer intento agotó el plazo, el equipo va cargado. */
const PLAZO_REINTENTO_MS = 120_000;

/** La publicación no puede prepararse con el formato exigido. */
export class FormatoNoDisponible extends Error {
  override name = 'FormatoNoDisponible';
}

/** Ejecuta Biome con los argumentos y el texto de entrada; devuelve su salida o lanza el error de execFileSync. */
export type EjecutorDeBiome = (argumentos: readonly string[], entrada: string, plazoMs: number) => string;

const ejecutarBiome: EjecutorDeBiome = (argumentos, entrada, plazoMs) =>
  execFileSync(process.execPath, [BIOME, ...argumentos], {
    cwd: RAIZ,
    input: entrada,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: plazoMs,
  });

/** Si el proceso de Biome se cortó por agotar el plazo (execFileSync lo termina con SIGTERM y marca ETIMEDOUT). */
function plazoAgotado(error: unknown): boolean {
  const { code, signal } = (error ?? {}) as { code?: unknown; signal?: unknown };
  return code === 'ETIMEDOUT' || signal === 'SIGTERM';
}

/** El diagnóstico de stderr (la línea marcada con ×) o, si no lo hay, su primera línea con contenido, sin colores. */
function primeraLineaUtil(stderr: unknown): string | undefined {
  if (!(Buffer.isBuffer(stderr) || typeof stderr === 'string')) {
    return undefined;
  }
  const lineas = stripVTControlCharacters(stderr.toString())
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !/^[━─\s]+$/.test(linea));
  const diagnostico = lineas.find((linea) => linea.startsWith('×'));
  return diagnostico ? diagnostico.slice(1).trim() : lineas[0];
}

/** La causa legible del fallo: plazo agotado, señal, código de salida o error del sistema, con stderr si lo hay. */
function causaDelFallo(error: unknown, plazoMs: number): string {
  const { code, signal, status, stderr, message } = (error ?? {}) as {
    code?: unknown;
    signal?: unknown;
    status?: unknown;
    stderr?: unknown;
    message?: unknown;
  };
  const linea = primeraLineaUtil(stderr);
  const detalle = linea ? `: ${linea}` : '';
  if (plazoAgotado(error)) {
    return `plazo de ${plazoMs} ms agotado (${String(code ?? 'sin código')}, ${String(signal ?? 'sin señal')})`;
  }
  if (typeof signal === 'string') {
    return `Biome terminó por la señal ${signal}${detalle}`;
  }
  if (typeof status === 'number') {
    return `Biome salió con el código ${status}${detalle}`;
  }
  if (typeof code === 'string') {
    return `no se pudo ejecutar Biome (${code})${detalle}`;
  }
  return typeof message === 'string' ? message : String(error);
}

/**
 * Formatea sin escribir; el nombre selecciona el lenguaje. Repite una sola vez si Biome agota el plazo, con aviso en
 * stderr; cualquier otro fallo no se repite.
 *
 * @throws {FormatoNoDisponible} Si Biome falla; el mensaje dice la causa y `cause` guarda el error original.
 */
export function formatearTextoConBiome(
  texto: string,
  archivo: string,
  ejecutar: EjecutorDeBiome = ejecutarBiome,
): string {
  const argumentos = ['format', `--config-path=${RAIZ}`, `--stdin-file-path=${archivo}`];
  try {
    return ejecutar(argumentos, texto, PLAZO_FORMATO_MS);
  } catch (error) {
    if (!plazoAgotado(error)) {
      throw new FormatoNoDisponible(
        `No se puede formatear ${archivo} con Biome: ${causaDelFallo(error, PLAZO_FORMATO_MS)}`,
        {
          cause: error,
        },
      );
    }
    process.stderr.write(
      `Aviso: se repite el formato de ${archivo} con Biome: ${causaDelFallo(error, PLAZO_FORMATO_MS)}\n`,
    );
  }
  try {
    return ejecutar(argumentos, texto, PLAZO_REINTENTO_MS);
  } catch (error) {
    throw new FormatoNoDisponible(
      `No se puede formatear ${archivo} con Biome tras repetirlo: ${causaDelFallo(error, PLAZO_REINTENTO_MS)}`,
      { cause: error },
    );
  }
}
