// Detención del árbol de procesos de un paso de la verificación: el grupo del paso y todos sus descendientes, también
// los que se van a otro grupo (los navegadores de Playwright se lanzan así). La relación de procesos se toma antes de
// detener al padre, porque después sus hijos pasan a depender de init y ya no se pueden asociar con el paso.
//
// Un PID puede reutilizarse en cuanto su proceso termina y se recoge. Por eso cada proceso del árbol se identifica por
// su PID y su hora de inicio y solo se señala mientras la conserva. Su grupo puede cambiar con razón (entre `fork` y
// `setsid`/`setpgid`, como al lanzar un navegador): entonces se actualiza y el grupo nuevo entra en el árbol. En Linux,
// la hora de inicio es la de /proc/<pid>/stat, que no cambia con el reloj; donde no la hay, un proceso que conserva
// grupo y padre pero cambia de hora no se señala y se informa. Un grupo solo se señala si es fiable: su número no se
// reutiliza mientras tenga miembros, así que lo es mientras su líder no esté en la tabla, haya terminado o sea el mismo
// proceso que se vio.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Un proceso de la tabla: su PID, el de su padre, su grupo, su hora de inicio y si ya ha terminado (zombi). */
export interface Proceso {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  /** La hora de inicio tal como la da `ps` (`lstart`), solo para comparar: identifica el proceso junto con su PID. */
  readonly inicio: string;
  readonly terminado: boolean;
}

/** La tabla de procesos, por PID. */
export type TablaDeProcesos = ReadonlyMap<number, Proceso>;

/** Lo que dice el sistema al pedir la tabla: la salida de `ps` o el motivo por el que no se pudo leer. */
export type ListarProcesos = () => TablaDeProcesos;

/** Cómo se detiene el árbol; los valores por defecto son los de la verificación. */
export interface OpcionesDeDetencion {
  /** Cómo se lee la tabla de procesos; `ps` por defecto. */
  readonly listar?: ListarProcesos;
  /** Lo que se espera tras cada señal a que el árbol termine. */
  readonly esperaMs?: number;
  /** Si el proceso principal ya terminó y se recogió: su PID puede estar reutilizado y no se señala. */
  readonly raizTerminada?: () => boolean;
  /** La hora de inicio estable de un PID, si el sistema la da (Linux: /proc/<pid>/stat); si no, la de `ps`. */
  readonly inicioEstable?: (pid: number) => string | undefined;
}

/** Lo que se espera a que el árbol termine tras cada señal, comprobándolo cada poco. */
const ESPERA_TRAS_SENAL_MS = 1000;
const PAUSA_DE_COMPROBACION_MS = 25;
const PLAZO_DE_PS_MS = 5000;
/** La tabla de procesos de un equipo cargado cabe holgadamente en 16 MiB. */
const MAX_SALIDA_DE_PS = 16_777_216;
/** PID, PPID, PGID, estado y hora de inicio (con espacios: va al final; un zombi puede no tenerla). */
const LINEA_DE_PS = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(\S.*?))?\s*$/;
/** En /proc/<pid>/stat, tras el nombre entre paréntesis, la hora de inicio (campo 22) es el campo 20 de los restantes. */
const POSICION_DEL_INICIO_EN_STAT = 19;
/** init/launchd (1) y el núcleo (0), sus grupos y lo que quede por debajo nunca se señalan. */
const PRIMER_PID_SENALABLE = 2;
/** Tras SIGKILL, un recorrido más para los descendientes tardíos que hayan aparecido mientras tanto. */
const RONDAS_DE_SIGKILL = 2;

/**
 * Lee la tabla de procesos con `ps -A -o pid=,ppid=,pgid=,stat=,lstart=` en el idioma C (macOS y Linux), para que la
 * hora de inicio se escriba igual en cada consulta.
 *
 * @returns Los procesos, por PID.
 * @throws {Error} Si `ps` no se puede ejecutar, termina con error o por señal, o su salida no tiene el formato esperado.
 */
export function listarConPs(): TablaDeProcesos {
  const consulta = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], {
    encoding: 'utf8',
    timeout: PLAZO_DE_PS_MS,
    maxBuffer: MAX_SALIDA_DE_PS,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (consulta.error) {
    throw new Error(`ps no se puede ejecutar (${consulta.error.message})`);
  }
  if (consulta.signal !== null || consulta.status !== 0) {
    throw new Error(
      `ps termina con ${consulta.signal === null ? `código ${consulta.status}` : `señal ${consulta.signal}`}`,
    );
  }
  const tabla = new Map(interpretarPs(consulta.stdout));
  // El propio `ps` de la consulta sale como hijo de este proceso: no es del árbol de nadie y ya ha terminado.
  tabla.delete(consulta.pid);
  return tabla;
}

/**
 * Interpreta la salida de `ps -o pid=,ppid=,pgid=,stat=,lstart=`. Un zombi sin hora de inicio no invalida la tabla:
 * ya ha terminado y no se señala.
 *
 * @param salida - Lo que escribió `ps`.
 * @returns Los procesos, por PID.
 * @throws {Error} Si una línea no tiene el formato esperado, un proceso vivo no tiene hora o falta el propio proceso.
 */
export function interpretarPs(salida: string): TablaDeProcesos {
  const tabla = new Map<number, Proceso>();
  for (const linea of salida.split('\n')) {
    if (!linea.trim()) {
      continue;
    }
    const partes = LINEA_DE_PS.exec(linea);
    const terminado = partes?.[4]?.startsWith('Z') === true;
    if (!partes || (partes[5] === undefined && !terminado)) {
      throw new Error(`ps devuelve una línea sin el formato esperado: «${linea.trim()}»`);
    }
    const [pid, ppid, pgid] = [partes[1], partes[2], partes[3]].map(Number) as [number, number, number];
    tabla.set(pid, { pid, ppid, pgid, inicio: partes[5] ?? '', terminado });
  }
  if (!tabla.has(process.pid)) {
    throw new Error('ps no incluye el propio proceso de la verificación');
  }
  return tabla;
}

/**
 * La hora de inicio de /proc/<pid>/stat (campo 22, en tics desde el arranque): no cambia si se ajusta el reloj.
 *
 * @param texto - El contenido de /proc/<pid>/stat.
 * @returns El campo, o undefined si el texto no tiene ese formato.
 */
export function inicioDeProcStat(texto: string): string | undefined {
  const cierre = texto.lastIndexOf(')');
  const campo =
    cierre < 0
      ? undefined
      : texto
          .slice(cierre + 1)
          .trim()
          .split(/\s+/u)[POSICION_DEL_INICIO_EN_STAT];
  return campo !== undefined && /^\d+$/u.test(campo) ? campo : undefined;
}

/** En Linux, la hora de inicio estable del proceso; en macOS (sin /proc) o si ya no existe, undefined. */
function leerInicioEstable(pid: number): string | undefined {
  try {
    return inicioDeProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Un proceso del árbol tal como se vio la primera vez, con su hora de inicio estable si el sistema la da. */
interface Guardado {
  readonly proceso: Proceso;
  readonly estable: string | undefined;
}

/** El árbol del paso: sus procesos, sus grupos, el grupo propio y los procesos de identidad dudosa. */
interface Arbol {
  readonly conocidos: Map<number, Guardado>;
  readonly grupos: Set<number>;
  readonly propio: number;
  readonly inicioEstable: (pid: number) => string | undefined;
  /** Procesos que conservan grupo y padre pero cambiaron de hora sin hora estable: no se señalan y se informan. */
  readonly dudosos: Map<number, string>;
}

/** Guarda un proceso del árbol con su hora estable y añade su grupo, si es señalable. */
function guardar(arbol: Arbol, proceso: Proceso): void {
  arbol.conocidos.set(proceso.pid, { proceso, estable: arbol.inicioEstable(proceso.pid) });
  if (proceso.pgid !== arbol.propio && proceso.pgid >= PRIMER_PID_SENALABLE) {
    arbol.grupos.add(proceso.pgid);
  }
}

/** Si el proceso de la tabla es el guardado: misma hora estable o, sin ella, la misma hora de `ps`. */
function mismoProceso(arbol: Arbol, guardado: Guardado, actual: Proceso): boolean {
  const estable = guardado.estable === undefined ? undefined : arbol.inicioEstable(actual.pid);
  if (estable !== undefined) {
    return estable === guardado.estable;
  }
  if (actual.inicio === guardado.proceso.inicio) {
    return true;
  }
  if (actual.pgid === guardado.proceso.pgid && actual.ppid === guardado.proceso.ppid) {
    arbol.dudosos.set(actual.pid, `${guardado.proceso.inicio} → ${actual.inicio}`);
  }
  return false;
}

/**
 * El proceso `pid` de la tabla, si está vivo y es el mismo que se guardó (no un PID reutilizado). Si ha cambiado de
 * grupo, se actualiza y su grupo nuevo entra en el árbol.
 */
function verificado(arbol: Arbol, tabla: TablaDeProcesos, pid: number): Proceso | undefined {
  const guardado = arbol.conocidos.get(pid);
  const actual = tabla.get(pid);
  if (!guardado || !actual || actual.terminado || !mismoProceso(arbol, guardado, actual)) {
    return undefined;
  }
  if (actual.pgid !== guardado.proceso.pgid) {
    arbol.conocidos.set(pid, { proceso: actual, estable: guardado.estable });
    if (actual.pgid !== arbol.propio && actual.pgid >= PRIMER_PID_SENALABLE) {
      arbol.grupos.add(actual.pgid);
    }
  }
  return actual;
}

/** Los grupos del árbol que siguen siendo del paso: su líder no está, ha terminado o es el mismo proceso. */
function gruposFiables(arbol: Arbol, tabla: TablaDeProcesos): Set<number> {
  return new Set(
    [...arbol.grupos].filter((grupo) => {
      const lider = tabla.get(grupo);
      return !lider || lider.terminado || verificado(arbol, tabla, grupo) !== undefined;
    }),
  );
}

/** Incorpora un proceso vivo del árbol (hijo de uno verificado o de un grupo fiable) y su grupo; dice si lo añadió. */
function incorporar(arbol: Arbol, tabla: TablaDeProcesos, fiables: Set<number>, proceso: Proceso): boolean {
  const senalable = !proceso.terminado && proceso.pid >= PRIMER_PID_SENALABLE && proceso.pid !== process.pid;
  const delArbol = verificado(arbol, tabla, proceso.ppid) !== undefined || fiables.has(proceso.pgid);
  if (!senalable || !delArbol || arbol.conocidos.has(proceso.pid)) {
    return false;
  }
  guardar(arbol, proceso);
  if (arbol.grupos.has(proceso.pgid)) {
    fiables.add(proceso.pgid);
  }
  return true;
}

/** Amplía el árbol con los descendientes vivos y los miembros vivos de sus grupos fiables, hasta que deja de crecer. */
function ampliar(arbol: Arbol, tabla: TablaDeProcesos): void {
  for (const pid of arbol.conocidos.keys()) {
    verificado(arbol, tabla, pid);
  }
  const fiables = gruposFiables(arbol, tabla);
  let crece = true;
  while (crece) {
    crece = false;
    for (const proceso of tabla.values()) {
      crece = incorporar(arbol, tabla, fiables, proceso) || crece;
    }
  }
}

/** Los procesos del árbol que siguen vivos y son los mismos que se vieron. */
function vivos(arbol: Arbol, tabla: TablaDeProcesos): number[] {
  return [...arbol.conocidos.keys()].filter((pid) => verificado(arbol, tabla, pid)).sort((a, b) => a - b);
}

/** Envía una señal a un destino; uno que ya no existe no es un problema. */
function enviar(destino: number, senal: NodeJS.Signals, descripcion: string, problemas: string[]): void {
  try {
    process.kill(destino, senal);
  } catch (error) {
    const codigo = error instanceof Error && 'code' in error ? error.code : undefined;
    if (codigo !== 'ESRCH') {
      problemas.push(`no se puede enviar ${senal} a ${descripcion} (${String(codigo ?? error)})`);
    }
  }
}

/** Señala los grupos fiables que aún tienen miembros vivos y los procesos verificados vivos. */
function senalarVerificados(arbol: Arbol, tabla: TablaDeProcesos, senal: NodeJS.Signals, problemas: string[]): void {
  const conMiembros = new Set([...tabla.values()].filter((p) => !p.terminado).map((p) => p.pgid));
  for (const grupo of gruposFiables(arbol, tabla)) {
    if (conMiembros.has(grupo)) {
      enviar(-grupo, senal, `el grupo ${grupo}`, problemas);
    }
  }
  for (const pid of vivos(arbol, tabla)) {
    enviar(pid, senal, `el proceso ${pid}`, problemas);
  }
}

/** Espera, comprobando cada poco, a que no quede vivo ninguno de los procesos del árbol. */
async function esperarFin(listar: ListarProcesos, arbol: Arbol, esperaMs: number): Promise<TablaDeProcesos> {
  const limite = Date.now() + esperaMs;
  let tabla = listar();
  while (vivos(arbol, tabla).length && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, PAUSA_DE_COMPROBACION_MS));
    tabla = listar();
  }
  return tabla;
}

/** El árbol del paso en la primera tabla: la raíz, si no se ha recogido ya, y su grupo, si no es el propio. */
function arbolInicial(
  raiz: number,
  tabla: TablaDeProcesos,
  { raizTerminada, inicioEstable }: Required<Pick<OpcionesDeDetencion, 'raizTerminada' | 'inicioEstable'>>,
): Arbol {
  const propio = tabla.get(process.pid)?.pgid ?? -1;
  const arbol: Arbol = { conocidos: new Map(), grupos: new Set(), propio, inicioEstable, dudosos: new Map() };
  if (raiz >= PRIMER_PID_SENALABLE && raiz !== propio) {
    arbol.grupos.add(raiz);
  }
  const principal = tabla.get(raiz);
  if (!raizTerminada() && principal && !principal.terminado && raiz !== process.pid) {
    guardar(arbol, principal);
  }
  ampliar(arbol, tabla);
  return arbol;
}

/** Lo que comparten los pasos de una detención: el árbol, la última tabla leída, cómo leerla y lo que no se resolvió. */
interface Detencion {
  readonly arbol: Arbol;
  ultima: TablaDeProcesos;
  readonly listar: ListarProcesos;
  readonly esperaMs: number;
  readonly problemas: string[];
}

/** Tras SIGTERM, cada ronda amplía el árbol (los tardíos) y envía SIGKILL a lo que siga vivo. */
async function rondasDeSigkill(detencion: Detencion): Promise<void> {
  const { arbol, listar, esperaMs, problemas } = detencion;
  for (let ronda = 0; ronda < RONDAS_DE_SIGKILL; ronda += 1) {
    ampliar(arbol, detencion.ultima);
    if (!vivos(arbol, detencion.ultima).length) {
      return;
    }
    senalarVerificados(arbol, detencion.ultima, 'SIGKILL', problemas);
    detencion.ultima = await esperarFin(listar, arbol, esperaMs);
  }
}

/** Tras las rondas, amplía una vez más y anota los supervivientes y los procesos de identidad dudosa. */
function informar(arbol: Arbol, tabla: TablaDeProcesos, problemas: string[]): void {
  ampliar(arbol, tabla);
  const quedan = vivos(arbol, tabla);
  if (quedan.length) {
    problemas.push(`siguen vivos los procesos ${quedan.join(', ')} del paso tras SIGTERM y SIGKILL`);
  }
  for (const [pid, cambio] of arbol.dudosos) {
    problemas.push(
      `el proceso ${pid} conserva su grupo y su padre pero cambió su hora de inicio (${cambio}); no se ha señalado`,
    );
  }
}

/**
 * Si se sabe que el proceso principal sigue sin recoger (su PID no puede estar reutilizado). Si no se puede saber, no se
 * señala y se anota el motivo.
 */
function raizSinRecoger(raizTerminada: () => boolean, problemas: string[]): boolean {
  try {
    return !raizTerminada();
  } catch (error) {
    problemas.push(
      `no se sabe si el proceso principal del paso sigue sin recoger, así que no se señala: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Detiene el paso cuyo proceso principal es `raiz`, lanzado en su propio grupo, con todos sus descendientes: SIGTERM
 * a los grupos y procesos del árbol, una espera breve, nuevos recorridos para atrapar descendientes tardíos y SIGKILL
 * a lo que siga vivo. Nunca señala el grupo de la propia verificación ni un PID reutilizado.
 *
 * @param raiz - PID del proceso principal del paso.
 * @param opciones - La tabla, la espera y si la raíz ya se ha recogido.
 * @returns Lo que no se pudo resolver (supervivientes, consultas fallidas o señales rechazadas); vacío si todo terminó.
 */
export async function detenerArbol(raiz: number, opciones: OpcionesDeDetencion = {}): Promise<readonly string[]> {
  const { listar = listarConPs, esperaMs = ESPERA_TRAS_SENAL_MS, raizTerminada = () => false } = opciones;
  const inicioEstable = opciones.inicioEstable ?? (process.platform === 'linux' ? leerInicioEstable : () => undefined);
  const problemas: string[] = [];
  let detencion: Detencion | undefined;
  try {
    const inicial = listar();
    const arbol = arbolInicial(raiz, inicial, { raizTerminada, inicioEstable });
    detencion = { arbol, ultima: inicial, listar, esperaMs, problemas };
    senalarVerificados(arbol, inicial, 'SIGTERM', problemas);
    detencion.ultima = await esperarFin(listar, arbol, esperaMs);
    await rondasDeSigkill(detencion);
    informar(arbol, detencion.ultima, problemas);
  } catch (error) {
    // Sin una tabla nueva no se conoce el árbol entero: se detiene lo verificado en la última que se leyó (o, sin
    // ninguna, el paso mientras no se haya recogido y sea señalable: nunca init, el núcleo ni este proceso) y se dice qué
    // no se pudo comprobar.
    if (detencion) {
      senalarVerificados(detencion.arbol, detencion.ultima, 'SIGKILL', problemas);
    } else if (raiz >= PRIMER_PID_SENALABLE && raiz !== process.pid && raizSinRecoger(raizTerminada, problemas)) {
      enviar(-raiz, 'SIGKILL', `el grupo ${raiz}`, problemas);
      enviar(raiz, 'SIGKILL', `el proceso ${raiz}`, problemas);
    }
    problemas.push(
      `no se puede comprobar el árbol de procesos del paso: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return problemas;
}
