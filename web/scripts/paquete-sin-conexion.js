// Prepara el paquete de datos del motor para usar Faro sin conexión: pide al service worker que guarde su copia
// (src/service-worker/paquete.js, «Paquete de datos»); que el navegador no borre lo guardado cuando le falte espacio se
// pide al pulsar «Instalar Faro» (instalacion.js), no en cada visita. La copia se pide en cada visita: con la copia
// completa no se baja nada, y si un intento anterior se cortó, sigue donde lo dejó: los archivos ya guardados no se
// vuelven a bajar (reanudación por archivos; src/service-worker/paquete.js). Mientras la página esté abierta, la sigue
// hasta que el service worker dice cómo ha quedado (seguirLaCopia), con el mismo latido y el mismo plazo sin avisos que
// «Reparar Faro» (seguirAlServiceWorker). El motor del dispositivo (motor-local/cliente.js) le pregunta además qué
// versión del paquete leer.

/**
 * El tipo del mensaje con que se pide la copia al service worker. El service worker es un script clásico y no puede
 * importar este módulo: repite el valor (src/service-worker/paquete.js).
 * pruebas/web-confianza/paquete-sin-conexion.test.js comprueba el mensaje que envía este cliente y la lectura de la
 * respuesta de estado.
 */
const PREPARAR_PAQUETE = 'PREPARAR_PAQUETE';
/** El tipo del mensaje con que el service worker responde cómo ha quedado la copia; repetido igual que el anterior. */
const ESTADO_DEL_PAQUETE = 'ESTADO_DEL_PAQUETE';
/** El tipo del mensaje con que el service worker cuenta cuántos archivos lleva guardados; repetido igual. */
const PROGRESO_DEL_PAQUETE = 'PROGRESO_DEL_PAQUETE';
/**
 * El tipo del mensaje con que el service worker cuenta a la página que pidió la copia que ya tiene guardado lo que
 * necesita el primer análisis (src/service-worker/primer-analisis.js, ARCHIVOS_DEL_PRIMER_ANALISIS); repetido igual. La
 * copia sigue.
 */
const PRIMER_ANALISIS_DEL_PAQUETE = 'PRIMER_ANALISIS_DEL_PAQUETE';

/**
 * Lo más que se espera sin ningún aviso del service worker sobre la copia (su progreso, su latido mientras recibe datos
 * o su estado). Él corta antes una descarga parada (src/service-worker/descarga.js, DESCARGA_PARADA_MS) y avisa cada
 * pocos segundos mientras llegan datos: tanto silencio es que no está trabajando (el navegador lo ha parado, por
 * ejemplo al pasar la pestaña a segundo plano en un iPhone). Si ya había contestado, antes de dejar de esperar se le
 * vuelve a pedir la copia y se espera otro plazo (seguirLaCopia).
 */
const PLAZO_SIN_AVANCE_MS = 30_000;
/**
 * Cada cuánto repite la página su petición mientras espera la copia, desde que el service worker ha contestado. Cada
 * mensaje es un evento extensible, y cada evento alarga la vida del service worker. Sin eventos nuevos, el navegador lo
 * detiene aunque siga bajando la copia, y al detenerlo corta sus descargas: Firefox, 30 s después del último evento y
 * otros 30 s para lo que aún espera (dom.serviceWorkers.idle_timeout e idle_extended_timeout). Si ya lo había
 * detenido, la petición lo vuelve a poner en marcha y la copia sigue donde se quedó. El service worker reúne las
 * peticiones repetidas en el intento en curso y contesta a cada página una vez (src/service-worker/paquete.js,
 * responderPaquete).
 */
const LATIDO_DE_LA_PAGINA_MS = 20_000;
/**
 * Lo más que se espera a que haya un service worker activo (serviceWorker.ready no rechaza nunca): su instalación baja
 * la web, que en una primera visita con red lenta puede tardar, pero no tanto.
 */
const PLAZO_DEL_SERVICE_WORKER_MS = 120_000;

/**
 * La marca de <html> y el evento con que instalacion.js cuenta que su registro del service worker ha fallado: el
 * navegador no lo deja (una ventana privada o una política) o register() ha rechazado por otro motivo. Puede seguir
 * habiendo un registro de una visita anterior: quien espera lo consulta (estadoDelPaquete).
 */
export const MARCA_REGISTRO_FALLIDO = 'registroFallido';
export const EVENTO_REGISTRO_FALLIDO = 'faro-registro-fallido';

/** Cuenta, una sola vez, que el registro del service worker ha fallado: la marca de <html> y su evento. */
export function contarElRegistroFallido() {
  const raiz = document.documentElement;
  if (raiz.dataset[MARCA_REGISTRO_FALLIDO] !== undefined) {
    return;
  }
  raiz.dataset[MARCA_REGISTRO_FALLIDO] = '';
  window.dispatchEvent(new Event(EVENTO_REGISTRO_FALLIDO));
}

/**
 * Cuándo ha contado instalacion.js que su registro ha fallado: en el acto si ya lo había contado (la marca) o cuando lo
 * cuente (el evento). La promesa nunca rechaza; `dejarDeEscuchar` quita el escuchador.
 * @returns {{ fallido: Promise<void>, dejarDeEscuchar: () => void }}
 */
function registroFallido() {
  let dejarDeEscuchar = () => {};
  /** @type {Promise<void>} */
  const fallido = new Promise((resolver) => {
    if (globalThis.document?.documentElement.dataset[MARCA_REGISTRO_FALLIDO] !== undefined) {
      resolver();
      return;
    }
    const alFallar = () => resolver();
    globalThis.addEventListener?.(EVENTO_REGISTRO_FALLIDO, alFallar, { once: true });
    dejarDeEscuchar = () => globalThis.removeEventListener?.(EVENTO_REGISTRO_FALLIDO, alFallar);
  });
  return { fallido, dejarDeEscuchar };
}

/** No hay service worker que guarde el paquete: el motor del dispositivo no sabría qué versión leer. */
export class SinServiceWorker extends Error {
  /** @override */
  name = 'SinServiceWorker';
}

/** El navegador no ofrece la API de service workers. */
export class ServiceWorkerNoDisponible extends SinServiceWorker {
  /** @override */
  name = 'ServiceWorkerNoDisponible';
}

/**
 * El service worker no ha contestado a tiempo sobre la copia (la del paquete o la de la aplicación, al repararla):
 * quien espera deja de esperar y lo dice. Es un TypeError,
 * como el fallo de red de fetch: el transporte del recorrido lo cuenta como un fallo del motor del dispositivo
 * (recorrido/api/transporte.js), y el paso de ocupación deja de reintentar (recorrido/ocupacion-local.js).
 */
export class PaqueteSinRespuesta extends TypeError {
  /** @override */
  name = 'PaqueteSinRespuesta';
}

/**
 * La misma promesa, que rechaza con PaqueteSinRespuesta si no se cumple en `ms`.
 * @template T @param {Promise<T>} promesa @param {number} ms @param {string} motivo @returns {Promise<T>}
 */
function conPlazo(promesa, ms, motivo) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plazo;
  const vencido = new Promise((_, rechazar) => {
    plazo = setTimeout(() => rechazar(new PaqueteSinRespuesta(motivo)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promesa, vencido])).finally(() => clearTimeout(plazo));
}

/**
 * Si es un aviso del service worker sobre la copia: su progreso (con cifras o sin ellas, el latido) o su estado.
 * @param {unknown} datos @returns {boolean}
 */
function esAvisoDeLaCopia(datos) {
  return (
    esEstado(datos) ||
    (esObjetoConTipo(datos) && (datos.type === PROGRESO_DEL_PAQUETE || datos.type === PRIMER_ANALISIS_DEL_PAQUETE))
  );
}

/**
 * La versión del paquete de un aviso de que ya está lo del primer análisis (PRIMER_ANALISIS_DEL_PAQUETE), o null si el
 * mensaje es otro o no la dice.
 * @param {unknown} datos @returns {string | null}
 */
function versionDelPrimerAnalisis(datos) {
  return esObjetoConTipo(datos) &&
    datos.type === PRIMER_ANALISIS_DEL_PAQUETE &&
    'version' in datos &&
    typeof datos.version === 'string'
    ? datos.version
    : null;
}

/**
 * Si el aviso dice que ya está lo del primer análisis, se lo cuenta a `alPrimerAnalisis` con la versión.
 * @param {unknown} datos @param {(version: string) => void} alPrimerAnalisis
 */
function contarElPrimerAnalisis(datos, alPrimerAnalisis) {
  const version = versionDelPrimerAnalisis(datos);
  if (version !== null) {
    alPrimerAnalisis(version);
  }
}

/** @param {unknown} datos @returns {datos is { type: unknown }} */
function esObjetoConTipo(datos) {
  return typeof datos === 'object' && datos !== null && 'type' in datos;
}

/**
 * Si el service worker contesta con el estado del paquete (y no con otro de sus mensajes).
 * @param {unknown} datos Los datos del mensaje recibido.
 * @returns {datos is { type: string, version?: unknown, completo?: unknown, faltaElRecorrido?: unknown }} Si es la
 *   respuesta de estado.
 */
function esEstado(datos) {
  return esObjetoConTipo(datos) && datos.type === ESTADO_DEL_PAQUETE;
}

/**
 * Pide almacenamiento persistente, si aún no lo es: sin él, el navegador puede borrar la copia cuando le falte
 * espacio. Cada navegador decide a su manera (algunos lo conceden sin preguntar, otros preguntan una vez); si lo
 * niega, Faro funciona igual y la copia se vuelve a bajar si se borra. No falla.
 * @returns {Promise<void>} Se cumple al terminar de pedirlo, se conceda o no.
 */
export async function pedirAlmacenPersistente() {
  if (!navigator.storage?.persist) {
    return;
  }
  try {
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Sin permiso para preguntarlo (un marco, un modo privado): la copia se guarda igual, sin la garantía.
  }
}

/**
 * Lo que necesita seguirAlServiceWorker de navigator.serviceWorker: escuchar sus mensajes.
 * @typedef {{ addEventListener: (tipo: 'message', oyente: (evento: MessageEvent) => void) => void,
 *   removeEventListener: (tipo: 'message', oyente: (evento: MessageEvent) => void) => void }} Escucha
 */

/**
 * Pide al service worker un trabajo largo con `pedir` y lo sigue hasta su respuesta (el mensaje con que `esFinal`): es
 * la única forma de seguirlo, la de la copia del paquete (seguirLaCopia) y la de «Reparar Faro» (recorrido/reparar.js).
 * - Desde su primer aviso (el mensaje con que `esAviso`), le repite la petición cada LATIDO_DE_LA_PAGINA_MS, para que
 *   el navegador no lo detenga a mitad del trabajo. Él reúne las peticiones repetidas en el intento en curso.
 * - Si pasa PLAZO_SIN_AVANCE_MS sin ningún aviso después de haber contestado, se lo vuelve a pedir y espera otro plazo;
 *   solo si tampoco contesta deja de esperar.
 * - Si no ha contestado nunca: con `sinPlazo`, sigue escuchando, porque la visita no espera a nadie; sin él, deja de
 *   esperar al vencer el plazo. Repetírselo no cambiaría nada: un mensaje ya pone en marcha al que estaba detenido.
 * Su oyente y sus temporizadores se retiran al acabar, de una forma o de otra. Cada aviso pasa además por `alAvisar`.
 * @param {Escucha} contenedor @param {() => void} pedir
 * @param {{ esAviso: (datos: unknown) => boolean, esFinal: (datos: unknown) => boolean, sinPlazo?: boolean,
 *   alAvisar?: (datos: unknown) => void }} opciones
 * @returns {Promise<unknown>} Los datos de la respuesta.
 * @throws {PaqueteSinRespuesta} Si deja de avisar antes de responder (la promesa rechaza).
 */
export function seguirAlServiceWorker(contenedor, pedir, { esAviso, esFinal, sinPlazo = false, alAvisar = () => {} }) {
  return new Promise((resolver, rechazar) => {
    const terminar = () => {
      relojes.parar();
      contenedor.removeEventListener('message', alResponder);
    };
    const relojes = relojesDeLaCopia(pedir, sinPlazo, () => {
      terminar();
      rechazar(new PaqueteSinRespuesta('El service worker ha dejado de avisar'));
    });
    /** @param {MessageEvent} evento */
    const alResponder = (evento) => {
      /** @type {unknown} */
      const datos = evento.data;
      if (esFinal(datos)) {
        terminar();
        resolver(datos);
      } else if (esAviso(datos)) {
        relojes.alAvisar();
        alAvisar(datos);
      }
    };
    contenedor.addEventListener('message', alResponder);
    relojes.empezar();
    pedir();
  });
}

/**
 * Pide la copia al service worker activo y la sigue (seguirAlServiceWorker) hasta que cuenta cómo ha quedado
 * (ESTADO_DEL_PAQUETE). Es la única forma de pedirla: la usan la visita (prepararPaqueteSinConexion) y el motor del
 * dispositivo (estadoDelPaquete). Si el service worker cuenta que ya tiene lo del primer análisis
 * (PRIMER_ANALISIS_DEL_PAQUETE), se lo dice a `alPrimerAnalisis` con la versión, y sigue.
 * @param {ServiceWorkerContainer} contenedor @param {ServiceWorkerRegistration} registro
 * @param {{ type: string, revisar?: true }} mensaje
 * @param {{ sinPlazo?: boolean, alPrimerAnalisis?: (version: string) => void }} [opciones]
 * @returns {Promise<{ version: string, completo: boolean }>} La versión guardada y si su copia está completa.
 * @throws {PaqueteSinRespuesta} Si deja de avisar antes de responder (la promesa rechaza).
 * @throws {TypeError} Si responde sin decir qué versión guarda (la promesa rechaza).
 */
async function seguirLaCopia(contenedor, registro, mensaje, { sinPlazo = false, alPrimerAnalisis = () => {} } = {}) {
  contenedor.startMessages();
  const datos = /** @type {{ version?: unknown, completo?: unknown }} */ (
    await seguirAlServiceWorker(contenedor, () => registro.active?.postMessage(mensaje), {
      esAviso: esAvisoDeLaCopia,
      esFinal: esEstado,
      sinPlazo,
      alAvisar: (aviso) => contarElPrimerAnalisis(aviso, alPrimerAnalisis),
    })
  );
  if (typeof datos.version !== 'string') {
    throw new TypeError('El service worker no dice qué versión guarda');
  }
  return { version: datos.version, completo: datos.completo === true };
}

/**
 * Los dos relojes de seguirAlServiceWorker: el latido, que repite la petición (`pedir`) cada LATIDO_DE_LA_PAGINA_MS desde el
 * primer aviso, y el plazo sin avisos, que al vencer la vuelve a pedir una vez si ya había contestado y si no, o a la
 * segunda, deja de esperar (`rendirse`). Con `sinPlazo`, no hay plazo hasta el primer aviso.
 * @param {() => void} pedir @param {boolean} sinPlazo @param {() => void} rendirse
 * @returns {{ empezar: () => void, alAvisar: () => void, parar: () => void }}
 */
function relojesDeLaCopia(pedir, sinPlazo, rendirse) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let plazo;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let latido;
  let haContestado = false;
  let pedidaOtraVez = false;
  const latir = () => {
    latido = setTimeout(() => {
      pedir();
      latir();
    }, LATIDO_DE_LA_PAGINA_MS);
  };
  const esperar = () => {
    clearTimeout(plazo);
    if (sinPlazo && !haContestado) {
      return;
    }
    plazo = setTimeout(() => {
      if (haContestado && !pedidaOtraVez) {
        pedidaOtraVez = true;
        pedir();
        esperar();
      } else {
        rendirse();
      }
    }, PLAZO_SIN_AVANCE_MS);
  };
  const alAvisar = () => {
    if (!haContestado) {
      haContestado = true;
      latir();
    }
    pedidaOtraVez = false;
    esperar();
  };
  const parar = () => {
    clearTimeout(plazo);
    clearTimeout(latido);
  };
  return { empezar: esperar, alAvisar, parar };
}

/**
 * Pide la copia del paquete al service worker en cuanto está activo (serviceWorker.ready no rechaza nunca) y la sigue
 * mientras la página esté abierta (seguirLaCopia), sin plazo hasta su primer aviso.
 * @returns {Promise<void>} Se cumple al enviar el mensaje, sin esperar a que la copia acabe.
 * @throws {TypeError} Si el navegador no tiene `navigator.serviceWorker` (contexto no seguro): la promesa rechaza.
 */
export async function prepararPaqueteSinConexion() {
  const contenedor = navigator.serviceWorker;
  const registro = await contenedor.ready;
  if (!registro?.active) {
    return;
  }
  seguirLaCopia(contenedor, registro, { type: PREPARAR_PAQUETE }, { sinPlazo: true }).catch(() => {
    // Nadie espera esta respuesta: si el service worker deja de contestar, la copia se vuelve a pedir en la siguiente
    // visita o cuando el motor la necesite (estadoDelPaquete).
  });
}

/**
 * La versión del paquete que guarda el service worker y si su copia está completa. La pide como la copia: si falta
 * algo, responde cuando el intento acaba (bajar el paquete por una red lenta puede tardar), también si la copia falla
 * (completo: false). Mientras tanto avisa de su progreso, y la página lo sigue (seguirLaCopia): deja de esperar y
 * rechaza si no contesta a tiempo, o si pasa PLAZO_DEL_SERVICE_WORKER_MS sin un service worker activo (la espera cubre
 * también el registro que aún no ha hecho instalacion.js).
 * Con `revisar`, el service worker vuelve a calcular la huella de cada archivo de una copia completa y vuelve a bajar
 * los que faltan o no cuadran: lo pide el motor del dispositivo después de no haber podido leerla (motor-local/cliente.js).
 * Con `alPrimerAnalisis`, sabe antes cuándo está guardado lo que necesita el primer análisis (seguirLaCopia).
 * @param {{ revisar?: boolean, alPrimerAnalisis?: (version: string) => void }} [opciones]
 * @returns {Promise<{ version: string, completo: boolean }>} La versión guardada y si su copia está completa.
 * @throws {SinServiceWorker} Si el navegador no tiene service worker, si el registro falla y no hay ninguno
 *   (contarElRegistroFallido), o
 *   si al vencer el plazo sigue sin registro.
 * @throws {PaqueteSinRespuesta} Si el service worker no se activa o deja de avisar antes de responder.
 * @throws {TypeError} Si el service worker responde sin decir qué versión guarda (la promesa rechaza).
 */
export async function estadoDelPaquete({ revisar = false, alPrimerAnalisis = () => {} } = {}) {
  const contenedor = navigator.serviceWorker;
  if (!contenedor) {
    throw new ServiceWorkerNoDisponible('El navegador no ofrece service workers');
  }
  // En la primera visita, instalacion.js lo registra al cargar la página, quizá después de esta llamada: la misma
  // espera cubre el registro pendiente. Si cuenta que su registro ha fallado y no hay ninguno, deja de esperar en el
  // acto; si hay uno (de una visita anterior, o que aún se activa), sigue esperando a `ready` dentro del mismo
  // plazo. Si el plazo vence sin registro, es que no hay service worker.
  const { fallido, dejarDeEscuchar } = registroFallido();
  const trasElFallo = fallido.then(async () => {
    if (!(await contenedor.getRegistration())) {
      throw new SinServiceWorker('No hay service worker que guarde el paquete');
    }
    return contenedor.ready;
  });
  const registro = await conPlazo(
    Promise.race([contenedor.ready, trasElFallo]),
    PLAZO_DEL_SERVICE_WORKER_MS,
    'No hay ningún service worker activo que guarde el paquete',
  )
    .catch(async (motivo) => {
      if (motivo instanceof SinServiceWorker) {
        throw motivo;
      }
      if (!(await contenedor.getRegistration())) {
        throw new SinServiceWorker('No hay service worker que guarde el paquete');
      }
      throw motivo;
    })
    .finally(dejarDeEscuchar);
  return seguirLaCopia(
    contenedor,
    registro,
    revisar ? { type: PREPARAR_PAQUETE, revisar: true } : { type: PREPARAR_PAQUETE },
    { alPrimerAnalisis },
  );
}

/**
 * Cómo va la copia del paquete, según el service worker: los archivos que nombra su manifiesto y los ya guardados, los
 * bytes guardados y los totales (con `exacto` si todos los archivos tienen su tamaño; si no, los que faltan cuentan por
 * su parte proporcional: src/service-worker/paquete.js, pesosDelPaquete) y si ha quedado completa. Las cifras son null
 * cuando solo se sabe cómo ha quedado (ESTADO_DEL_PAQUETE); los bytes, también con un service worker que no los cuenta.
 * `primerAnalisis` cuenta aparte lo que necesita el primer análisis, que es otro estado: con él guardado, la copia
 * completa aún no lo está (null si el service worker no lo cuenta o solo se sabe cómo ha quedado).
 * @typedef {{ archivos: number, guardados: number, bytes: number | null, bytesTotales: number | null }}
 *   AvanceDelPrimerAnalisis
 * @typedef {{ archivos: number | null, guardados: number | null, bytes: number | null, bytesTotales: number | null,
 *   exacto: boolean, completo: boolean, primerAnalisis: AvanceDelPrimerAnalisis | null }} AvanceDeLaCopia
 */

/** Si `bytes` de `total` son cifras de bytes posibles. @param {unknown} bytes @param {unknown} total */
function sonBytes(bytes, total) {
  return (
    Number.isInteger(bytes) &&
    Number.isInteger(total) &&
    Number(total) > 0 &&
    Number(bytes) >= 0 &&
    Number(bytes) <= Number(total)
  );
}

/**
 * Lee un mensaje del service worker sobre la copia: su progreso o cómo ha quedado; null si es otro mensaje o no se
 * entiende. Un progreso con cifras imposibles (negativas, más guardados que archivos) no se cuenta.
 * @param {unknown} datos Los datos del mensaje recibido.
 * @returns {AvanceDeLaCopia | null}
 */
export function leerAvanceDeLaCopia(datos) {
  if (esEstado(datos)) {
    return typeof datos.version === 'string'
      ? {
          archivos: null,
          guardados: null,
          bytes: null,
          bytesTotales: null,
          exacto: false,
          // Sin la página del recorrido (faltaElRecorrido), la copia sin conexión no está completa aunque lo esté el
          // paquete (src/service-worker/paquete.js, responderPaquete).
          completo: datos.completo === true && datos.faltaElRecorrido !== true,
          primerAnalisis: null,
        }
      : null;
  }
  if (typeof datos !== 'object' || datos === null || !('type' in datos) || datos.type !== PROGRESO_DEL_PAQUETE) {
    return null;
  }
  const { archivos, guardados, bytes, bytesTotales, exacto, primerAnalisis } =
    /** @type {{ archivos?: unknown, guardados?: unknown, bytes?: unknown, bytesTotales?: unknown, exacto?: unknown,
     *   primerAnalisis?: unknown }} */ (datos);
  if (
    !Number.isInteger(archivos) ||
    !Number.isInteger(guardados) ||
    Number(archivos) <= 0 ||
    Number(guardados) < 0 ||
    Number(guardados) > Number(archivos)
  ) {
    return null;
  }
  const conBytes = sonBytes(bytes, bytesTotales);
  return {
    archivos: Number(archivos),
    guardados: Number(guardados),
    bytes: conBytes ? Number(bytes) : null,
    bytesTotales: conBytes ? Number(bytesTotales) : null,
    exacto: conBytes && exacto === true,
    completo: false,
    primerAnalisis: leerAvanceDelPrimerAnalisis(primerAnalisis),
  };
}

/**
 * El avance de lo que necesita el primer análisis dentro de un progreso de la copia, o null si no viene o sus cifras
 * son imposibles. Los bytes, solo si son posibles.
 * @param {unknown} avance @returns {AvanceDelPrimerAnalisis | null}
 */
function leerAvanceDelPrimerAnalisis(avance) {
  if (typeof avance !== 'object' || avance === null) {
    return null;
  }
  const { archivos, guardados, bytes, bytesTotales } =
    /** @type {{ archivos?: unknown, guardados?: unknown, bytes?: unknown, bytesTotales?: unknown }} */ (avance);
  if (
    !Number.isInteger(archivos) ||
    !Number.isInteger(guardados) ||
    Number(archivos) <= 0 ||
    Number(guardados) < 0 ||
    Number(guardados) > Number(archivos)
  ) {
    return null;
  }
  const conBytes = sonBytes(bytes, bytesTotales);
  return {
    archivos: Number(archivos),
    guardados: Number(guardados),
    bytes: conBytes ? Number(bytes) : null,
    bytesTotales: conBytes ? Number(bytesTotales) : null,
  };
}

/**
 * Escucha lo que cuenta el service worker sobre la copia del paquete (PROGRESO_DEL_PAQUETE y ESTADO_DEL_PAQUETE). No
 * pide la copia ni falla: sin service worker, o con uno anterior que no cuenta su progreso, no llama nunca a `oyente`.
 * @param {(avance: AvanceDeLaCopia) => void} oyente Recibe cada avance.
 * @returns {() => void} Deja de escuchar.
 */
export function escucharLaCopia(oyente) {
  const contenedor = globalThis.navigator?.serviceWorker;
  if (!contenedor) {
    return () => {};
  }
  /** @param {MessageEvent} evento */
  const alRecibir = (evento) => {
    const avance = leerAvanceDeLaCopia(evento.data);
    if (avance) {
      oyente(avance);
    }
  };
  contenedor.addEventListener('message', alRecibir);
  contenedor.startMessages();
  return () => contenedor.removeEventListener('message', alRecibir);
}
