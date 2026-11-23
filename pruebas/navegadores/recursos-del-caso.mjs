// Recursos de un caso de node:test (servidores, navegadores, perfiles, procesos y carpetas) que se cierran también si
// el caso vence. Al vencer, node:test da el caso por fallido y ejecuta sus `after`, pero no cancela su cuerpo: un
// `finally` del cuerpo que espera algo colgado no llega a ejecutarse. Por eso cada recurso registra su cierre al
// crearse, y el `after` del caso los cierra en orden inverso, cada uno con su plazo. Las esperas del caso usan
// `conPlazo`, con un plazo menor que el del caso y un mensaje que dice en qué paso se quedó. Los navegadores arrancan con
// `lanzarConPlazo`: Playwright recibe el plazo y, si vence, su error (con el registro de las fases del arranque) es la
// causa del fallo, que dice qué motor y en qué prueba; si ni Playwright responde, un respaldo poco posterior falla igual
// y termina los procesos que dejó el arranque. Si el caso vence a mitad de un arranque, su after dice en qué paso estaba.

import { detenerArbol, listarConPs } from '../../scripts/detener-arbol.ts';

/** @typedef {import('../../scripts/detener-arbol.ts').Proceso} Proceso */
/** @typedef {import('../../scripts/detener-arbol.ts').TablaDeProcesos} TablaDeProcesos */

/**
 * Lo que puede tardar un navegador en arrancar (con o sin perfil persistente), común a todos los ensayos: menor que el
 * plazo de un caso de la verificación (120 s) y con margen para un arranque en frío.
 */
export const PLAZO_DE_ARRANQUE_MS = 90_000;
/**
 * Lo que se espera, vencido el plazo de arranque, a que Playwright dé su propio error antes de dar el arranque por
 * colgado. El plazo de arranque más este margen sigue por debajo del de un caso.
 */
export const MARGEN_DE_RESPALDO_MS = 5_000;
/** Lo que puede tardar en cerrarse un recurso antes de darlo por atascado. */
export const PLAZO_DE_CIERRE_MS = 20_000;
/** El after del caso cierra varios recursos, cada uno con PLAZO_DE_CIERRE_MS; su propio plazo los abarca. */
const PLAZO_DEL_AFTER_MS = 90_000;

/**
 * Espera `promesa` como mucho `ms`; si vence, rechaza con «`paso` (plazo de `ms` ms)». No cancela lo esperado: un
 * recurso registrado con `recursosDelCaso` se cierra después de todos modos.
 *
 * @template T
 * @param {Promise<T>} promesa - Lo que se espera.
 * @param {number} ms - El plazo, menor que el del caso.
 * @param {string} paso - Qué no llegó a pasar, en una frase («el service worker no llegó a estar listo»).
 * @returns {Promise<T>} Lo que da la promesa, si llega a tiempo.
 */
export async function conPlazo(promesa, ms, paso) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let temporizador;
  const vencida = new Promise((_resolver, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`${paso} (plazo de ${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([promesa, vencida]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Los cierres de recursosDelCaso, que ya llevan su plazo y su forzado: cerrarSinSustituir no les pone otro encima. */
const CON_PLAZO_PROPIO = new WeakSet();

/**
 * @typedef {{ nombre: string, recurso: unknown, cerrar: () => unknown, forzar: (() => unknown) | undefined,
 *   cierre: Promise<void> | undefined }} Entrada
 */

/**
 * Cierra una entrada con su plazo; si vence y la entrada sabe forzarse, la fuerza antes de informar.
 *
 * @param {Entrada} entrada - El recurso.
 * @param {number} plazoMs - El plazo del cierre.
 */
async function cerrarConPlazo(entrada, plazoMs) {
  try {
    await conPlazo(Promise.resolve().then(entrada.cerrar), plazoMs, `${entrada.nombre} no se cerró`);
  } catch (error) {
    if (!entrada.forzar) {
      throw error;
    }
    try {
      await entrada.forzar();
    } catch (fallo) {
      throw new AggregateError(
        [error, fallo],
        `${errorComoTexto(error)}; tampoco se pudo forzar: ${errorComoTexto(fallo)}`,
      );
    }
    throw new Error(`${errorComoTexto(error)}; se ha forzado su cierre`, { cause: error });
  }
}

/**
 * Cierra las entradas en orden inverso, esperando cada una antes de la siguiente, y falla con todos los fallos.
 *
 * @param {readonly Entrada[]} abiertos - Las entradas, en el orden en que se abrieron.
 * @param {(entrada: Entrada) => Promise<void>} cerrarEntrada - El cierre único de cada una.
 */
async function cerrarTodas(abiertos, cerrarEntrada) {
  const fallos = [];
  for (const entrada of [...abiertos].reverse()) {
    try {
      await cerrarEntrada(entrada);
    } catch (error) {
      fallos.push(error);
    }
  }
  if (fallos.length) {
    throw new AggregateError(fallos, `La limpieza del caso no se completó: ${fallos.map(errorComoTexto).join('; ')}`);
  }
}

/**
 * Si el caso venció o se canceló con pasos en curso, los escribe en stderr: node:test solo dice que venció.
 *
 * @param {import('node:test').TestContext} t - El caso.
 * @param {ReadonlySet<{ paso: string }>} enCurso - Los pasos en curso.
 */
function decirLoQueSeguiaEnCurso(t, enCurso) {
  if (t.signal.aborted && enCurso.size) {
    const pasos = [...enCurso].map(({ paso }) => paso).join('; ');
    console.error(`el caso «${t.name}» venció o se canceló durante: ${pasos}`);
  }
}

/**
 * Registra el after del caso: da la limpieza por empezada, fija los procesos de los arranques en curso (vigilarHijos),
 * dice qué pasos seguían en curso si el caso venció y cierra lo que quede.
 *
 * @param {import('node:test').TestContext} t - El caso.
 * @param {{ limpiado: boolean, enCurso: ReadonlySet<{ paso: string }>, vigilancias: ReadonlySet<Vigilancia> }} estado -
 *   El del caso.
 * @param {() => Promise<void>} cerrarLoQueQuede - El cierre de los recursos abiertos.
 */
function limpiarAlTerminar(t, estado, cerrarLoQueQuede) {
  t.after(
    () => {
      estado.limpiado = true;
      for (const vigilancia of estado.vigilancias) {
        vigilancia.fijar();
      }
      decirLoQueSeguiaEnCurso(t, estado.enCurso);
      return cerrarLoQueQuede();
    },
    { timeout: PLAZO_DEL_AFTER_MS },
  );
}

/**
 * Los recursos del caso `t`. `abrir` crea un recurso y registra su cierre; `cerrar` lo cierra antes (una sola vez);
 * el `after` del caso cierra lo que quede, en orden inverso, aunque el cuerpo siga colgado. Cada cierre se guarda como
 * promesa: si el cuerpo ya lo empezó, el `after` lo espera en vez de saltarlo, así que el recurso siguiente (por
 * ejemplo, la carpeta del perfil) no se retira mientras el anterior sigue cerrándose. Si un cierre vence y el recurso
 * tiene `forzar`, se fuerza antes de seguir. Un recurso que termine de crearse después de la limpieza se cierra en
 * cuanto llega; uno que se pida después (`abrir` o `durante`, cuando el cuerpo de un caso vencido sigue) ya no se crea.
 * Los dos fallan, y su fallo se anota además con avisarDelCierre, porque llega a un cuerpo que node:test ya no escucha.
 * Los fallos de cierre no se ocultan: el `after` falla con todos ellos. `durante` anota un paso en curso
 * (un arranque): si el caso vence o se cancela mientras tanto, el `after` lo escribe en stderr, porque node:test solo dice
 * que el caso venció. El `after` fija también los procesos de los arranques en curso (vigilarHijos): los que aparezcan
 * después ya no se atribuyen a este caso y no se fuerzan.
 *
 * @param {import('node:test').TestContext} t - El caso.
 * @param {{ plazoDeCierreMs?: number }} [opciones] - El plazo de cada cierre (PLAZO_DE_CIERRE_MS por defecto).
 */
export function recursosDelCaso(t, { plazoDeCierreMs = PLAZO_DE_CIERRE_MS } = {}) {
  /** @type {Entrada[]} */
  const abiertos = [];
  /** @type {{ limpiado: boolean, enCurso: Set<{ paso: string }>, vigilancias: Set<Vigilancia> }} */
  const estado = { limpiado: false, enCurso: new Set(), vigilancias: new Set() };

  /** El cierre de la entrada, una sola vez: quien llega después espera el mismo. @param {Entrada} entrada */
  const cerrarEntrada = (entrada) => {
    entrada.cierre ??= cerrarConPlazo(entrada, plazoDeCierreMs);
    return entrada.cierre;
  };

  limpiarAlTerminar(t, estado, () => cerrarTodas(abiertos, cerrarEntrada));

  const recursos = {
    /**
     * Crea un recurso y registra su cierre.
     *
     * @template R
     * @param {string} nombre - El recurso, para los mensajes («el servidor de ensayo»).
     * @param {() => R | Promise<R>} crear - Cómo se crea.
     * @param {(recurso: R) => unknown} cerrar - Cómo se cierra.
     * @param {{ forzar?: (recurso: R) => unknown }} [opciones] - Qué hacer si el cierre vence (terminar su proceso).
     * @returns {Promise<R>} El recurso creado.
     */
    async abrir(nombre, crear, cerrar, { forzar } = {}) {
      rechazarSiTermino(estado, `${nombre} no se abrió`);
      const recurso = await crear();
      /** @type {Entrada} */
      const entrada = {
        nombre,
        recurso,
        cerrar: () => cerrar(recurso),
        forzar: forzar && (() => forzar(recurso)),
        cierre: undefined,
      };
      abiertos.push(entrada);
      if (estado.limpiado) {
        await cerrarLaQueLlegoTarde(entrada, cerrarEntrada);
      }
      return recurso;
    },
    /**
     * Cierra ya un recurso abierto con `abrir`; el after no lo vuelve a cerrar, pero espera a que termine.
     *
     * @param {unknown} recurso - El recurso que devolvió `abrir`.
     * @returns {Promise<void>} Cuando termina su cierre, con su plazo y, si vence, su forzado.
     */
    cerrar(recurso) {
      const entrada = abiertos.find((abierto) => abierto.recurso === recurso);
      const cierre = entrada
        ? cerrarEntrada(entrada)
        : Promise.reject(new Error('El recurso no se abrió con recursosDelCaso'));
      CON_PLAZO_PROPIO.add(cierre);
      return cierre;
    },
    /**
     * Hace un paso anotándolo como en curso: si el caso vence mientras tanto, su after dice cuál era.
     *
     * @template R
     * @param {string} paso - Lo que se está haciendo («arrancando el navegador chromium en «…»»).
     * @param {() => Promise<R>} hacer - El paso.
     * @returns {Promise<R>} Lo que da el paso.
     */
    async durante(paso, hacer) {
      rechazarSiTermino(estado, `no se empezó: ${paso}`);
      const marca = { paso };
      estado.enCurso.add(marca);
      try {
        return await hacer();
      } finally {
        estado.enCurso.delete(marca);
      }
    },
  };
  ESTADOS_DEL_CASO.set(recursos, estado);
  return recursos;
}

/**
 * Falla, sin crear nada, si el after del caso ya hizo su limpieza: lo que se creara ahora nacería mientras corre el caso
 * siguiente, solo se cerraría al terminar de crearse (como lo que llega tarde a `abrir`) y sus procesos no se
 * distinguirían de los de ese caso. El fallo se anota también con avisarDelCierre.
 *
 * @param {{ limpiado: boolean }} estado - El del caso.
 * @param {string} que - Lo que no se hace («el navegador chromium no se abrió»).
 */
function rechazarSiTermino(estado, que) {
  if (estado.limpiado) {
    const motivo = `${que}: el caso ya había terminado`;
    avisarDelCierre(motivo);
    throw new Error(motivo);
  }
}

/**
 * Cierra un recurso que terminó de crearse después de la limpieza del caso y falla diciéndolo; el fallo, también el de
 * su cierre, se anota con avisarDelCierre, porque llega a un cuerpo que node:test ya no escucha.
 *
 * @param {Entrada} entrada - El recurso.
 * @param {(entrada: Entrada) => Promise<void>} cerrarEntrada - Su cierre único.
 * @returns {Promise<never>} Siempre falla.
 */
async function cerrarLaQueLlegoTarde(entrada, cerrarEntrada) {
  await cerrarEntrada(entrada).catch((error) => {
    avisarDelCierre(`${entrada.nombre} llegó cuando el caso ya había terminado: ${errorComoTexto(error)}`);
    throw error;
  });
  const motivo = `${entrada.nombre} llegó cuando el caso ya había terminado; se ha cerrado`;
  avisarDelCierre(motivo);
  throw new Error(motivo);
}

/** El mensaje de un error, o su texto. @param {unknown} error */
function errorComoTexto(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Los procesos hijos de este proceso en una tabla de `ps`. @param {TablaDeProcesos} tabla */
const hijosEn = (tabla) => [...tabla.values()].filter((proceso) => proceso.ppid === process.pid && !proceso.terminado);

/** La identidad de un proceso: su PID y su hora de inicio. @param {Proceso} proceso */
const identidad = (proceso) => `${proceso.pid} ${proceso.inicio}`;

/** @typedef {{ fijar: () => void, nuevos: () => Proceso[], dejar: () => void }} Vigilancia */

/**
 * El estado de cada caso de recursosDelCaso: si su after ya limpió y las vigilancias abiertas, que ese after fija.
 *
 * @type {WeakMap<object, { limpiado: boolean, vigilancias: Set<Vigilancia> }>}
 */
const ESTADOS_DEL_CASO = new WeakMap();

/**
 * Vigila los procesos hijos de este proceso que aparecen desde ahora (`nuevos`). Un caso que vence deja su cuerpo vivo y
 * node:test pasa al siguiente del archivo, que lanza los suyos: con los recursos del caso, su after fija la lista al
 * terminar (`fijar`), y lo que aparezca después ya no se atribuye a este caso; si el after ya limpió, la lista queda
 * fijada vacía desde el principio. Sin ellos, supone que mientras tanto este proceso no lanza otros hijos. `dejar` la
 * retira del caso cuando ya no hace falta.
 *
 * @param {ReturnType<typeof recursosDelCaso> | undefined} [recursos] - Los recursos del caso, si lo hay.
 * @returns {Vigilancia} La vigilancia.
 * @throws {Error} Si `ps` no responde al empezar.
 */
function vigilarHijos(recursos) {
  const estadoDelCaso = recursos && ESTADOS_DEL_CASO.get(recursos);
  /** @type {{ procesos: Proceso[] } | { error: unknown } | undefined} */
  let fijada = estadoDelCaso?.limpiado ? { procesos: [] } : undefined;
  const antes = new Set(fijada ? [] : hijosEn(listarConPs()).map(identidad));
  const leer = () => hijosEn(listarConPs()).filter((proceso) => !antes.has(identidad(proceso)));
  const delCaso = estadoDelCaso?.vigilancias;
  /** @type {Vigilancia} */
  const vigilancia = {
    fijar() {
      try {
        fijada ??= { procesos: leer() };
      } catch (error) {
        fijada = { error };
      }
    },
    nuevos() {
      if (!fijada) {
        return leer();
      }
      if ('error' in fijada) {
        throw new Error(`ps no respondió al terminar el caso: ${errorComoTexto(fijada.error)}`, {
          cause: fijada.error,
        });
      }
      return fijada.procesos;
    },
    dejar() {
      delCaso?.delete(vigilancia);
    },
  };
  delCaso?.add(vigilancia);
  return vigilancia;
}

/**
 * Crea un recurso que lanza procesos hijos (un navegador de Playwright) y devuelve también esos procesos, tal como se
 * vieron al aparecer, para poder terminarlos si su cierre vence. Con los recursos del caso, si el caso termina mientras
 * se crea, solo cuentan los procesos que había al terminar, y si ya había terminado, ninguno (vigilarHijos); sin ellos,
 * supone que mientras se crea este proceso no lanza otros hijos. Si después de crearlo no se pueden ver sus procesos, lo
 * cierra (con PLAZO_DE_CIERRE_MS) antes de fallar, para no dejarlo abierto sin nadie que lo cierre.
 *
 * @template {{ close: () => unknown }} R
 * @param {() => R | Promise<R>} crear - Cómo se crea.
 * @param {ReturnType<typeof recursosDelCaso> | undefined} [recursos] - Los recursos del caso, si lo hay.
 * @returns {Promise<{ recurso: R, procesos: Proceso[] }>} El recurso y sus procesos nuevos.
 */
export async function conSusProcesos(crear, recursos) {
  const vigilancia = vigilarHijos(recursos);
  let recurso;
  try {
    recurso = await crear();
  } finally {
    vigilancia.dejar();
  }
  let procesos;
  try {
    procesos = vigilancia.nuevos();
  } catch (error) {
    try {
      await conPlazo(
        Promise.resolve().then(() => recurso.close()),
        PLAZO_DE_CIERRE_MS,
        'lo creado no se cerró',
      );
    } catch (fallo) {
      throw new AggregateError(
        [error, fallo],
        `no se pudieron ver los procesos de lo creado: ${errorComoTexto(error)}; tampoco se pudo cerrar: ${errorComoTexto(fallo)}`,
      );
    }
    throw new Error(`no se pudieron ver los procesos de lo creado, así que se ha cerrado: ${errorComoTexto(error)}`, {
      cause: error,
    });
  }
  return { recurso, procesos };
}

/** Lo que se espera a que un proceso termine tras cada señal, comprobándolo cada poco. */
const ESPERA_TRAS_SENAL_MS = 1000;
const PAUSA_DE_COMPROBACION_MS = 25;

/** Si el proceso que se vio sigue vivo y es el mismo (mismo PID y misma hora de inicio). @param {Proceso} visto */
function sigueSiendo(visto) {
  let tabla;
  try {
    tabla = listarConPs();
  } catch (error) {
    throw new Error(`no se pudo comprobar si el proceso ${visto.pid} sigue siendo el mismo: ${errorComoTexto(error)}`, {
      cause: error,
    });
  }
  const actual = tabla.get(visto.pid);
  return Boolean(actual && !actual.terminado && actual.inicio === visto.inicio);
}

/**
 * Termina un proceso por su PID mientras siga siendo el que se vio: SIGTERM, una espera breve y SIGKILL.
 *
 * @param {Proceso} visto - El proceso, tal como se vio al aparecer.
 * @returns {Promise<string[]>} Lo que no se pudo resolver.
 */
async function terminarPorPid(visto) {
  for (const senal of /** @type {const} */ (['SIGTERM', 'SIGKILL'])) {
    if (!sigueSiendo(visto)) {
      return [];
    }
    try {
      process.kill(visto.pid, senal);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') {
        return [`no se puede enviar ${senal} al proceso ${visto.pid} (${errorComoTexto(error)})`];
      }
    }
    const limite = Date.now() + ESPERA_TRAS_SENAL_MS;
    while (sigueSiendo(visto) && Date.now() < limite) {
      await new Promise((resolver) => setTimeout(resolver, PAUSA_DE_COMPROBACION_MS));
    }
  }
  return sigueSiendo(visto) ? [`sigue vivo el proceso ${visto.pid} tras SIGTERM y SIGKILL`] : [];
}

/**
 * Termina los procesos de un recurso cuyo cierre venció. Los que lideran su grupo (un navegador lanzado con
 * `detached`) se terminan con todo su árbol (detener-arbol.ts); los demás, solo por su PID. En los dos casos, un proceso
 * que ya no es el que se vio (terminó o su PID es de otro) no se señala.
 *
 * @param {readonly Proceso[]} procesos - Los que devolvió `conSusProcesos`.
 * @throws {Error} Si alguno sigue vivo o no se pudo comprobar.
 */
export async function forzarProcesos(procesos) {
  const problemas = [];
  for (const visto of procesos) {
    if (visto.pgid === visto.pid) {
      problemas.push(...(await detenerArbol(visto.pid, { raizTerminada: () => !sigueSiendo(visto) })));
    } else {
      problemas.push(...(await terminarPorPid(visto)));
    }
  }
  if (problemas.length) {
    throw new Error(`no se pudieron terminar sus procesos: ${problemas.join('; ')}`);
  }
}

/**
 * Termina los procesos que se vieron al crear un recurso (forzarProcesos). Si no se vio ninguno, falla diciéndolo: no
 * hay nada que forzar y el cierre no se puede dar por forzado.
 *
 * @param {readonly Proceso[]} procesos - Los que devolvió `conSusProcesos`.
 */
export async function forzarLosVistos(procesos) {
  if (!procesos.length) {
    throw new Error('no se vieron procesos que forzar');
  }
  await forzarProcesos(procesos);
}

/**
 * Abre un navegador o un perfil persistente de Playwright (lo que dé `crear`, que se cierra con `close()`) como recurso
 * del caso: si su cierre vence, se terminan los procesos que lanzó al crearse, con todo su árbol.
 *
 * @template {{ close: () => Promise<void> }} N
 * @param {ReturnType<typeof recursosDelCaso>} recursos - Los recursos del caso.
 * @param {string} nombre - El navegador, para los mensajes.
 * @param {() => Promise<N>} crear - Cómo se arranca, con su plazo.
 * @returns {Promise<N>} El navegador o el perfil.
 */
export function abrirNavegador(recursos, nombre, crear) {
  /** @type {Proceso[]} */
  let procesos = [];
  return recursos.abrir(
    nombre,
    async () => {
      const creado = await conSusProcesos(crear, recursos);
      procesos = creado.procesos;
      return creado.recurso;
    },
    (navegador) => navegador.close(),
    { forzar: () => forzarLosVistos(procesos) },
  );
}

/**
 * Arranca un navegador de Playwright (`tipo.launch`) con el plazo común, que recibe también Playwright, en vez de sus
 * 180 s por defecto, que superan el plazo de un caso. Si no arranca, también por su plazo, falla con «el navegador
 * `motor` no llegó a arrancar en «`prueba`»», seguido del fallo de Playwright, que queda además como causa (el de un
 * plazo vencido trae el registro de las fases del arranque). Si Playwright no responde ni con el margen de respaldo, lo
 * resuelve arrancarConPlazo. Con `recursos`, el navegador es un recurso del caso (abrirNavegador): se cierra en el after
 * aunque el caso venza, y si el caso vence mientras arranca, su after lo dice.
 *
 * @template {{ close: () => Promise<void> }} N
 * @template {object} O
 * @param {{ name(): string, launch(opciones: O & { timeout: number }): Promise<N> }} tipo - El motor (chromium…).
 * @param {O} opciones - Las de `launch`, sin plazo: se añade aquí.
 * @param {string} prueba - El caso (su `t.name`) o el ensayo que lo arranca, para el mensaje.
 * @param {{ recursos?: ReturnType<typeof recursosDelCaso>, plazoMs?: number, margenMs?: number }} [registro] - Los
 *   recursos del caso, el plazo (PLAZO_DE_ARRANQUE_MS por defecto) y el margen de respaldo (MARGEN_DE_RESPALDO_MS).
 * @returns {Promise<N>} El navegador.
 */
export function lanzarConPlazo(
  tipo,
  opciones,
  prueba,
  { recursos, plazoMs = PLAZO_DE_ARRANQUE_MS, margenMs = MARGEN_DE_RESPALDO_MS } = {},
) {
  const motor = tipo.name();
  const paso = `el navegador ${motor} no llegó a arrancar en «${prueba}»`;
  const lanzar = () =>
    arrancarConPlazo(() => tipo.launch({ ...opciones, timeout: plazoMs }), paso, plazoMs, { margenMs, recursos });
  return recursos
    ? recursos.durante(`arrancando el navegador ${motor} en «${prueba}»`, () =>
        abrirNavegador(recursos, `el navegador ${motor}`, lanzar),
      )
    : lanzar();
}

/**
 * La vigilancia de los hijos de un arranque (vigilarHijos), o undefined si `ps` no responde.
 *
 * @param {ReturnType<typeof recursosDelCaso> | undefined} recursos - Los recursos del caso, si lo hay.
 */
function vigilarSiSePuede(recursos) {
  try {
    return vigilarHijos(recursos);
  } catch {
    return undefined;
  }
}

/**
 * El fallo de un arranque colgado, después de terminar (forzarProcesos) los procesos hijos que aparecieron mientras
 * arrancaba: los de un navegador a medio arrancar. Si no se pudieron ver o terminar, el mensaje lo dice.
 *
 * @param {Error} fallo - El vencimiento.
 * @param {Vigilancia | undefined} vigilancia - La de los hijos del arranque (vigilarSiSePuede).
 * @returns {Promise<Error>} El fallo que se lanza.
 */
async function trasTerminarLoArrancado(fallo, vigilancia) {
  try {
    if (!vigilancia) {
      throw new Error('no se pudieron ver los procesos de antes del arranque');
    }
    await forzarProcesos(vigilancia.nuevos());
    return fallo;
  } catch (error) {
    return new AggregateError(
      [fallo, error],
      `${fallo.message}; sus procesos pueden seguir vivos: ${errorComoTexto(error)}`,
    );
  }
}

/**
 * Espera el arranque `lanzar`, que lleva su propio plazo `plazoMs` (el de Playwright). Si falla, también por ese plazo,
 * el fallo se informa con `paso` delante y queda como causa. Si a los `plazoMs` más `margenMs` no ha respondido (un
 * arranque colgado de verdad), falla con el plazo después de terminar los procesos hijos que aparecieron durante el
 * arranque; si el navegador llega después, se cierra entonces con PLAZO_DE_CIERRE_MS, y un fallo de ese cierre se anota
 * con avisarDelCierre. Con los recursos del caso, si el caso vence antes que el respaldo, solo se terminan los procesos
 * que había al vencer (vigilarHijos): los que aparezcan después ya no se atribuyen a este caso; sin ellos, supone que
 * mientras arranca este proceso no lanza otros hijos.
 *
 * @template {{ close: () => Promise<void> }} N
 * @param {() => Promise<N>} lanzar - El arranque.
 * @param {string} paso - Qué no llegó a pasar.
 * @param {number} plazoMs - El plazo del arranque.
 * @param {{ margenMs?: number, recursos?: ReturnType<typeof recursosDelCaso> | undefined }} [respaldo] - Lo que se espera tras el
 *   plazo (MARGEN_DE_RESPALDO_MS por defecto) y los recursos del caso, si lo hay.
 * @returns {Promise<N>} El navegador.
 */
export async function arrancarConPlazo(lanzar, paso, plazoMs, { margenMs = MARGEN_DE_RESPALDO_MS, recursos } = {}) {
  const vigilancia = vigilarSiSePuede(recursos);
  let respondio = false;
  const arranque = Promise.resolve().then(lanzar);
  const marcar = () => {
    respondio = true;
  };
  arranque.then(marcar, marcar);
  const conMotivo = arranque.catch((error) => {
    throw new Error(`${paso}: ${errorComoTexto(error)}`, { cause: error });
  });
  try {
    return await conPlazo(conMotivo, plazoMs + margenMs, paso);
  } catch (error) {
    if (respondio) {
      throw error;
    }
    arranque.then(
      (tardio) =>
        conPlazo(
          Promise.resolve().then(() => tardio.close()),
          PLAZO_DE_CIERRE_MS,
          'no terminó de cerrarse',
        ).catch((fallo) => avisarDelCierre(`${paso}; llegó tarde y no se cerró: ${errorComoTexto(fallo)}`)),
      () => undefined,
    );
    throw await trasTerminarLoArrancado(
      new Error(`${paso} (plazo de ${plazoMs} ms; Playwright no respondió en ${margenMs} ms más)`),
      vigilancia,
    );
  } finally {
    vigilancia?.dejar();
  }
}

/**
 * Anota un fallo de cierre sin lanzarlo, para no sustituir el error del cuerpo que haya: lo escribe en stderr y deja el
 * proceso con código de error, así que se ven los dos.
 *
 * @param {string} motivo - Qué no se pudo cerrar y por qué.
 */
export function avisarDelCierre(motivo) {
  console.error(motivo);
  process.exitCode = 1;
}

/**
 * Cierra algo desde un `finally` sin sustituir el error del cuerpo: con plazo y, si falla o vence, con `avisarDelCierre`.
 * El cierre de un recurso del caso (`recursos.cerrar`) ya lleva su plazo y su forzado: se espera sin otro plazo encima,
 * para que el forzado termine y su mensaje llegue antes de seguir.
 *
 * @param {() => unknown} cerrar - El cierre.
 * @param {string} paso - Qué no llegó a cerrarse («la pestaña del ensayo no se cerró»).
 * @param {number} [plazoMs] - El plazo del cierre (PLAZO_DE_CIERRE_MS por defecto).
 */
export async function cerrarSinSustituir(cerrar, paso, plazoMs = PLAZO_DE_CIERRE_MS) {
  try {
    const cierre = cerrar();
    await (cierre instanceof Promise && CON_PLAZO_PROPIO.has(cierre)
      ? cierre
      : conPlazo(Promise.resolve(cierre), plazoMs, paso));
  } catch (error) {
    avisarDelCierre(errorComoTexto(error));
  }
}

/**
 * Cierra un servidor HTTP sin esperar a que terminen sus conexiones (una abierta y colgada impediría `close`).
 *
 * @param {import('node:http').Server} servidor - El servidor.
 * @returns {Promise<void>} Cuando deja de escuchar.
 */
export function cerrarServidor(servidor) {
  return new Promise((resolver, rechazar) => {
    servidor.close((error) =>
      error && /** @type {NodeJS.ErrnoException} */ (error).code !== 'ERR_SERVER_NOT_RUNNING'
        ? rechazar(error)
        : resolver(),
    );
    servidor.closeAllConnections();
  });
}
