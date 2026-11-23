// El límite total de una ejecución del presupuesto de rendimiento (presupuesto-medida.mjs y presupuesto-rendimiento.mjs)
// y el cierre acotado de lo que la ejecución abre. El límite total de la condición (`limiteTotalMs`,
// presupuesto-condiciones.mjs) acota todas las esperas de un escenario juntas: cada espera recibe lo que queda del
// total, con el plazo por espera de la condición (`plazoMs`) solo como techo, y termina `ANTICIPACION_MS` antes del
// límite para que lo medido quede anotado y escrito antes de que venza. Al vencer, lo que siga abierto se cierra en
// paralelo dentro de un margen fijo; el del escenario (contexto y servidores) y el del navegador suman
// MARGEN_DE_CIERRE_MS.
import { spawnSync } from 'node:child_process';
import { ahora } from './presupuesto-servidor.mjs';

/** Lo que se cierra, como mucho, después del límite total: contexto y servidores, y después el navegador. */
export const MARGEN_DE_CIERRE_MS = 30_000;
export const CIERRE_DEL_ESCENARIO_MS = MARGEN_DE_CIERRE_MS / 2;
export const CIERRE_DEL_NAVEGADOR_MS = MARGEN_DE_CIERRE_MS - CIERRE_DEL_ESCENARIO_MS;
/** Las esperas terminan este tiempo antes del límite: lo medido se anota y se escribe antes de que venza. */
export const ANTICIPACION_MS = 5000;
/** La salida del proceso cuando el cierre no termina dentro del margen y se corta (presupuesto-rendimiento.mjs). */
export const SALIDA_POR_CIERRE_FORZADO = 3;

/**
 * El estado de una medida, legible por máquina: `completa` (todas las esperas terminaron antes del límite total),
 * `no completada dentro del plazo` (el límite total cortó alguna espera: lo anotado hasta entonces se conserva),
 * `en curso` (lo escrito mientras se mide; si queda así en disco, el proceso se cortó) y `fallo del arnés` (el ensayo
 * no pudo medir o la medida no vale: presupuesto-ejecucion.mjs).
 */
export const ESTADO = Object.freeze({
  completa: 'completa',
  fueraDePlazo: 'no completada dentro del plazo',
  enCurso: 'en curso',
  fallo: 'fallo del arnés',
});

/**
 * El estado de una medida, también en los documentos medidos antes del límite total: sin `estado`, una medida con
 * `error` es un fallo y una con cifras del servidor, completa.
 */
export function estadoDe(medida) {
  if (!medida) {
    return null;
  }
  if (medida.estado) {
    return medida.estado;
  }
  return medida.error || !medida.servidor ? ESTADO.fallo : ESTADO.completa;
}

/**
 * El límite total de un escenario, desde ahora: `para(techo)` es el plazo de una espera (lo que queda hasta
 * `ANTICIPACION_MS` antes del límite, sin pasar del techo y nunca 0, que en Playwright sería sin plazo); `vencimiento`
 * se cumple en el límite y `detener()` suelta su temporizador.
 */
export function crearPlazoTotal(
  limiteTotalMs,
  { anticipacionMs = ANTICIPACION_MS, margenDeCierreMs = CIERRE_DEL_ESCENARIO_MS } = {},
) {
  const inicio = ahora();
  const fin = inicio + limiteTotalMs;
  const corte = fin - anticipacionMs;
  let temporizador;
  const vencimiento = new Promise((ok) => {
    temporizador = setTimeout(ok, limiteTotalMs);
  });
  return {
    limiteTotalMs,
    anticipacionMs,
    margenDeCierreMs,
    inicio,
    fin,
    vencimiento,
    para: (techoMs) => Math.max(1, Math.min(techoMs, Math.ceil(corte - ahora()))),
    agotado: () => ahora() >= corte,
    usadoMs: () => ahora() - inicio,
    detener: () => clearTimeout(temporizador),
  };
}

/**
 * Cierra a la vez cada recurso (`[nombre, cerrar]`) y espera como mucho `margenMs`: lo que no ha terminado se deja y
 * se dice. Nunca rechaza.
 */
export async function cerrarAcotado(recursos, margenMs) {
  const inicio = ahora();
  const cerrados = new Set();
  const errores = [];
  const cierres = recursos.map(async ([nombre, cerrar]) => {
    try {
      await cerrar();
    } catch (error) {
      errores.push({ recurso: nombre, error: String(error).split('\n')[0] });
    }
    cerrados.add(nombre);
  });
  let temporizador;
  const margen = new Promise((ok) => {
    temporizador = setTimeout(ok, margenMs);
  });
  await Promise.race([Promise.all(cierres), margen]);
  clearTimeout(temporizador);
  return {
    margenMs,
    ms: ahora() - inicio,
    sinCerrar: recursos.map(([nombre]) => nombre).filter((nombre) => !cerrados.has(nombre)),
    errores,
  };
}

/** La preparación de una construcción (servible(), precomprimir() y lo que abran), como mucho. */
export const PREPARACION_MS = 120_000;
/** El arranque de un navegador con su sesión (arrancarCon()), como mucho. */
export const ARRANQUE_MS = 60_000;
/** La salida del proceso cuando vence el límite de la ejecución completa (presupuesto-rendimiento.mjs). */
export const SALIDA_POR_LIMITE_DE_EJECUCION = 4;

/**
 * El límite de la ejecución completa, desde que arranca el proceso: por cada construcción, su preparación y, por cada
 * condición y navegador, el arranque, el límite total de la condición y el cierre del escenario por cada escenario, y
 * el cierre del navegador. Con un escenario por proceso (la matriz) es
 * `preparacionMs + arranqueMs + limiteTotalMs + cierreDelEscenarioMs + cierreDelNavegadorMs`.
 */
export function limiteDeEjecucion(
  { construcciones, motores, limitesDeCondicion, escenarios },
  {
    preparacionMs = PREPARACION_MS,
    arranqueMs = ARRANQUE_MS,
    cierreDelEscenarioMs = CIERRE_DEL_ESCENARIO_MS,
    cierreDelNavegadorMs = CIERRE_DEL_NAVEGADOR_MS,
  } = {},
) {
  const porSesion = limitesDeCondicion.reduce(
    (suma, limite) => suma + arranqueMs + escenarios * (limite + cierreDelEscenarioMs) + cierreDelNavegadorMs,
    0,
  );
  return construcciones * (preparacionMs + motores * porSesion);
}

/** La tabla de procesos: PID → `{ padre, orden }` (`ps -A -o pid=,ppid=,comm=`), sin el propio `ps`. */
function tablaDeProcesos() {
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (ps.status !== 0) {
    throw new Error(`No se pudo leer la tabla de procesos: ${ps.error ?? `salida ${ps.status}`}`);
  }
  const tabla = new Map();
  for (const linea of ps.stdout.split('\n')) {
    const encontrado = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(linea);
    if (encontrado && Number(encontrado[1]) !== ps.pid) {
      tabla.set(Number(encontrado[1]), { padre: Number(encontrado[2]), orden: encontrado[3] });
    }
  }
  return tabla;
}

/** Los descendientes vivos de `pid` (hijos, nietos…), con su orden: `[[pid, orden], …]`. */
export function descendientesConOrden(pid, tabla = tablaDeProcesos()) {
  const hijos = new Map();
  for (const [hijo, { padre }] of tabla) {
    hijos.set(padre, [...(hijos.get(padre) ?? []), hijo]);
  }
  const encontrados = [];
  const pendientes = [pid];
  while (pendientes.length > 0) {
    for (const hijo of hijos.get(pendientes.pop()) ?? []) {
      encontrados.push([hijo, tabla.get(hijo).orden]);
      pendientes.push(hijo);
    }
  }
  return encontrados;
}

/** Los PID de los descendientes vivos de `pid`. */
export const descendientesDe = (pid) => descendientesConOrden(pid).map(([hijo]) => hijo);

/**
 * Lo que matarArbol() tiene que terminar según `tabla`: los descendientes de `pid` y cada uno de `vistos` (PID → orden)
 * que siga huérfano con la misma orden, con sus descendientes. `[[pid, orden], …]`.
 */
function arbolVivo(pid, vistos, tabla) {
  const objetivo = new Map(descendientesConOrden(pid, tabla));
  for (const [visto, orden] of vistos) {
    const actual = tabla.get(visto);
    if (actual && actual.padre === 1 && actual.orden === orden) {
      objetivo.set(visto, orden);
      for (const [descendiente, suya] of descendientesConOrden(visto, tabla)) {
        objetivo.set(descendiente, suya);
      }
    }
  }
  return [...objetivo];
}

/**
 * Las vueltas de congelación que da matarArbol() como mucho: cada una solo encuentra lo lanzado entre su toma de `ps`
 * y la congelación de la vuelta anterior.
 */
const VUELTAS_DEL_ARBOL = 10;

/** Envía `senal` a `proceso`; devuelve si la recibió (falla si ya había terminado). */
function enviar(proceso, senal) {
  try {
    process.kill(proceso, senal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Termina con SIGKILL todo el árbol de procesos que cuelga de `pid`, sin `pid` (los navegadores de Playwright van en
 * su propio grupo de procesos: matar el grupo del arnés no los alcanza). `conocidos` (`Map` PID → orden, anotado antes
 * con descendientesConOrden) recoge los que ya quedaron huérfanos al cerrar su padre (pasan a colgar de launchd, PID
 * 1): se alcanzan solo si siguen huérfanos y con la misma orden, para no tocar un PID reutilizado, y con ellos sus
 * descendientes. Primero congela el árbol: cada vuelta lo recorre con `ps` y detiene con SIGSTOP lo nuevo; un proceso
 * detenido no lanza hijos ni termina, así que lo que lanzó antes de detenerse sigue colgando de él y la vuelta
 * siguiente lo encuentra. Cuando una vuelta no encuentra nada nuevo (o se agotan las vueltas), termina con SIGKILL todo
 * lo congelado. Solo escapa el hijo que lance un proceso que termine por sí mismo entre la toma de `ps` y su
 * congelación. Devuelve los PID terminados.
 */
export function matarArbol(pid = process.pid, conocidos = new Map()) {
  const congelados = new Map();
  try {
    for (let vuelta = 0; vuelta < VUELTAS_DEL_ARBOL; vuelta++) {
      const vistos = new Map([...conocidos, ...congelados]);
      const nuevos = arbolVivo(pid, vistos, tablaDeProcesos()).filter(([proceso]) => !congelados.has(proceso));
      if (nuevos.length === 0) {
        break;
      }
      for (const [proceso, orden] of nuevos) {
        if (enviar(proceso, 'SIGSTOP')) {
          congelados.set(proceso, orden);
        }
      }
    }
  } finally {
    // También si falla la lectura de la tabla a media congelación: nada queda detenido sin terminar.
    for (const proceso of congelados.keys()) {
      if (!enviar(proceso, 'SIGKILL')) {
        congelados.delete(proceso);
      }
    }
  }
  return [...congelados.keys()];
}
