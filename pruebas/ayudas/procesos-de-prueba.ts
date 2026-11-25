// Procesos que lanza una prueba (sus dobles). El doble escribe la identidad de sus procesos (PID y hora de inicio, tal
// como los ve `ps`) mientras están vivos; al final, la prueba termina solo los que siguen siendo los mismos. Sin una
// identidad anotada con el proceso vivo no se señala nada: así nunca se alcanza un PID reutilizado por otro proceso.
//
// Aparte, la recogida sin `ps` (registrarProceso, leerRegistro, terminarGrupos, gruposVivos): el doble anota el PID de
// cada proceso que lanza, en su propio grupo, en cuanto lo lanza; al final la prueba termina esos grupos (SIGTERM y,
// tras una gracia, SIGKILL) y comprueba que ninguno queda. Solo usa señales a un PID o a su grupo, así que funciona
// donde `ps` falla (un sandbox con `spawnSync ps EPERM`). Un grupo no se reutiliza mientras tenga miembros; los
// doble ignoran SIGTERM y no terminan solos, de modo que su PID no se libera hasta que los termina esta recogida.

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** Lo que se espera tras SIGTERM, antes de SIGKILL, y lo que se espera tras SIGKILL a que el grupo desaparezca. */
const GRACIA_POR_OMISION_MS = 250;
const ESPERA_TRAS_SIGKILL_MS = 3000;
const PAUSA_DE_COMPROBACION_MS = 20;

/**
 * Anota, en una línea del registro, el PID de un proceso que el doble acaba de lanzar en su propio grupo. Se escribe
 * de forma síncrona justo después de lanzarlo: así consta aunque el doble muera enseguida.
 *
 * @param archivo - El registro (texto, un PID por línea).
 * @param pid - El PID del proceso lanzado, líder de su grupo.
 * @throws {Error} Si `pid` no es un PID anotable.
 */
export function registrarProceso(archivo: string, pid: number | undefined): void {
  if (!pidAnotable(pid)) {
    throw new Error(`el PID ${String(pid)} no es anotable en el registro de procesos`);
  }
  appendFileSync(archivo, `${pid}\n`);
}

/**
 * Los PID del registro, sin repetir y solo los senalables. Un registro que no existe (el doble no llegó a lanzar nada)
 * no tiene ninguno.
 *
 * @param archivo - El registro de `registrarProceso`.
 * @returns Los PID anotados.
 */
export function leerRegistro(archivo: string): number[] {
  let texto: string;
  try {
    texto = readFileSync(archivo, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return pidsDeLineas(texto.split('\n'));
}

/** Los PID senalables de las líneas de un texto con un PID cada una, sin repetir. */
export function pidsDeLineas(lineas: readonly string[]): number[] {
  const pids = lineas.filter((linea) => /^\d+$/u.test(linea)).map(Number);
  return [...new Set(pids)].filter(pidSenalable);
}

/** Si el PID o su grupo (si fuera líder de uno) tienen algún miembro: una señal 0 no mata y dice si existe. */
function existe(pid: number): boolean {
  for (const destino of [-pid, pid]) {
    try {
      process.kill(destino, 0);
      return true;
    } catch (error) {
      // EPERM: existe pero no es nuestro; solo ESRCH dice que no hay nada.
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Los de `pids` cuyo proceso o grupo siguen existiendo, sin consultar `ps`. Un PID no señalable no cuenta.
 *
 * @param pids - Los PID de los dobles (cada uno, líder de su grupo).
 * @returns Los que siguen vivos.
 */
export function gruposVivos(pids: readonly number[]): number[] {
  return pids.filter((pid) => pidSenalable(pid) && existe(pid));
}

/** Envía `senal` al grupo de cada PID de `pids` y al propio PID; un destino que ya no existe no es un problema. */
function senalarGrupos(pids: readonly number[], senal: NodeJS.Signals): void {
  for (const pid of pids) {
    for (const destino of [-pid, pid]) {
      try {
        process.kill(destino, senal);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
          throw error;
        }
      }
    }
  }
}

/** Espera, como mucho `ms`, a que ninguno de `pids` exista; devuelve los que siguen. */
async function esperarQueDesaparezcan(pids: readonly number[], ms: number): Promise<number[]> {
  const limite = Date.now() + ms;
  let quedan = gruposVivos(pids);
  while (quedan.length && Date.now() < limite) {
    await new Promise((ok) => setTimeout(ok, PAUSA_DE_COMPROBACION_MS));
    quedan = gruposVivos(pids);
  }
  return quedan;
}

/**
 * Termina los grupos de `pids`, sin `ps`: SIGTERM a cada grupo y a cada PID, una gracia para que salgan y SIGKILL a lo
 * que siga. Nunca señala un PID no señalable (0, 1, el propio proceso).
 *
 * @param pids - Los PID de los dobles, cada uno líder de su grupo.
 * @param graciaMs - Lo que se espera tras SIGTERM.
 * @returns Los PID cuyo grupo sigue existiendo tras SIGKILL y su espera (vacío si todo terminó).
 * @throws {Error} Si una señal se rechaza por otro motivo que no existir el destino.
 */
export async function terminarGrupos(pids: readonly number[], graciaMs = GRACIA_POR_OMISION_MS): Promise<number[]> {
  const senalables = pids.filter(pidSenalable);
  senalarGrupos(senalables, 'SIGTERM');
  const resistentes = await esperarQueDesaparezcan(senalables, graciaMs);
  senalarGrupos(resistentes, 'SIGKILL');
  return esperarQueDesaparezcan(resistentes, ESPERA_TRAS_SIGKILL_MS);
}
