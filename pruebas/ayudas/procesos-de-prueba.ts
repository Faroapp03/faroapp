// Procesos que lanza una prueba (sus dobles). El doble escribe la identidad de sus procesos (PID y hora de inicio, tal
// como los ve `ps`) mientras están vivos; al final, la prueba termina solo los que siguen siendo los mismos. Sin una
// identidad anotada con el proceso vivo no se señala nada: así nunca se alcanza un PID reutilizado por otro proceso.

import { renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { listarConPs, type Proceso } from '../../scripts/detener-arbol.ts';

/** El núcleo (0) e init/launchd (1) nunca se anotan ni se señalan. */
const PRIMER_PID_SENALABLE = 2;

/** Si `pid` puede anotarse: entero seguro y mayor que 1. El doble puede anotarse a sí mismo. */
function pidAnotable(pid: unknown): pid is number {
  return Number.isSafeInteger(pid) && (pid as number) >= PRIMER_PID_SENALABLE;
}

/** Si `pid` es un PID que la prueba puede señalar: anotable y distinto del propio proceso, que nunca se señala. */
function pidSenalable(pid: unknown): pid is number {
  return pidAnotable(pid) && pid !== process.pid;
}

/**
 * Escribe, de una vez, la identidad de los procesos vivos de `pids` (lo llama el doble mientras viven, y puede
 * incluirse a sí mismo: quien lee las identidades descarta su propio PID).
 *
 * @param archivo - Dónde se escribe (JSON); se crea renombrando, para que nadie lo lea a medias.
 * @param pids - Los PID del doble.
 * @returns Los procesos anotados.
 * @throws {Error} Si alguno no es anotable o no está vivo: su identidad no se puede anotar.
 */
export function escribirIdentidades(archivo: string, pids: readonly number[]): Proceso[] {
  const tabla = listarConPs();
  const vistos = pids.map((pid) => {
    const visto = pidAnotable(pid) ? tabla.get(pid) : undefined;
    if (!visto || visto.terminado) {
      throw new Error(`el proceso ${pid} no está vivo o no es anotable: su identidad no se puede anotar`);
    }
    return visto;
  });
  writeFileSync(`${archivo}.tmp`, JSON.stringify(vistos));
  renameSync(`${archivo}.tmp`, archivo);
  return vistos;
}

/** Si un valor leído es la identidad de un proceso señalable. */
function esIdentidad(valor: unknown): valor is Proceso {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const { pid, pgid, inicio } = valor as Record<string, unknown>;
  return pidSenalable(pid) && Number.isSafeInteger(pgid) && typeof inicio === 'string' && inicio !== '';
}

/**
 * Las identidades que escribió el doble.
 *
 * @param archivo - El archivo de `escribirIdentidades`.
 * @returns Los procesos anotados, o undefined si el doble no llegó a escribirlas.
 * @throws {Error} Si el archivo existe pero alguna entrada no es la identidad de un proceso señalable.
 */
export async function leerIdentidades(archivo: string): Promise<Proceso[] | undefined> {
  let texto: string;
  try {
    texto = await readFile(archivo, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const vistos: unknown = JSON.parse(texto);
  if (!Array.isArray(vistos) || !vistos.every(esIdentidad)) {
    throw new Error(`${archivo} no contiene identidades de procesos señalables`);
  }
  return vistos;
}

/**
 * Termina con SIGKILL los procesos anotados que siguen vivos y son los mismos (misma hora de inicio).
 *
 * @param vistos - Las identidades anotadas con los procesos vivos.
 */
export function terminarSiSiguen(vistos: readonly Proceso[]): void {
  const tabla = listarConPs();
  for (const visto of vistos) {
    const actual = tabla.get(visto.pid);
    if (pidSenalable(visto.pid) && actual && !actual.terminado && actual.inicio === visto.inicio) {
      try {
        process.kill(visto.pid, 'SIGKILL');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
          throw error;
        }
      }
    }
  }
}

/**
 * La limpieza de un doble al final de su prueba: termina lo que anotó y siga vivo. Si el doble no llegó a anotar sus
 * procesos, no señala nada y lo informa (la limpieza falla con ese motivo).
 *
 * @param archivo - El archivo de `escribirIdentidades`.
 * @param descripcion - El doble, para el mensaje.
 * @throws {Error} Si no hay identidades anotadas.
 */
export async function terminarLoAnotado(archivo: string, descripcion: string): Promise<void> {
  const vistos = await leerIdentidades(archivo);
  if (vistos === undefined) {
    throw new Error(`${descripcion} no anotó la identidad de sus procesos: no se ha señalado ninguno`);
  }
  terminarSiSiguen(vistos);
}

/**
 * Ejecuta todos los pasos de la limpieza de una prueba, en orden, aunque falle alguno: un fallo no deja recursos
 * abiertos ni oculta otro.
 *
 * @param pasos - Los pasos de la limpieza.
 * @throws {unknown} El fallo, si solo hubo uno; si hubo varios, un AggregateError que los nombra todos en su mensaje.
 */
export async function limpiarEnOrden(pasos: readonly (() => unknown)[]): Promise<void> {
  const fallos: unknown[] = [];
  for (const paso of pasos) {
    try {
      await paso();
    } catch (error) {
      fallos.push(error);
    }
  }
  if (fallos.length === 1) {
    throw fallos[0];
  }
  if (fallos.length > 1) {
    const motivos = fallos.map((fallo) => (fallo instanceof Error ? fallo.message : String(fallo)));
    throw new AggregateError(fallos, `la limpieza falló en ${fallos.length} pasos: ${motivos.join('; ')}`);
  }
}
