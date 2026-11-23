// El transporte de la web al motor del dispositivo (worker.js).
// Hace lo mismo que fetch con la API: recibe la dirección y las opciones de la petición y devuelve un Response, así que
// recorrido/api.js lee la respuesta, sus errores y el informe igual venga del servidor o del dispositivo.
// El Worker se crea con la primera petición y vive lo que la página. La carpeta del paquete es la de la versión que
// guarda el service worker (paquete-sin-conexion.js): sin conexión, el motor solo puede leer esa copia. Se le pregunta
// en cuanto el service worker ha guardado lo que necesita el primer análisis; lo que necesite el resto del paquete, el
// Worker lo devuelve (`faltaElResto`) y se le vuelve a preguntar con la copia completa.

import { urlDeGuion } from '../confianza.js';
import { esObjeto } from '../json.js';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../marcas-de-tiempo.js';
import { estadoDelPaquete } from '../paquete-sin-conexion.js';
import { MS_POR_SEGUNDO } from '../tiempo.js';

/** 204 No Content: no admite cuerpo, ni vacío (RFC 9110, apartado 15.3.5). */
const SIN_CONTENIDO = 204;
/** 205 Reset Content: no admite cuerpo (RFC 9110, apartado 15.3.6). */
const CONTENIDO_REINICIADO = 205;
/** 304 Not Modified: no admite cuerpo (RFC 9110, apartado 15.4.5). */
const SIN_CAMBIOS = 304;
/** Los estados que no admiten cuerpo, ni vacío. */
const SIN_CUERPO = Object.freeze([SIN_CONTENIDO, CONTENIDO_REINICIADO, SIN_CAMBIOS]);
/** El menor y el mayor estado que admite el constructor de Response (Fetch, «Response constructor»). */
const ESTADO_MINIMO = 200;
const ESTADO_MAXIMO = 599;
/**
 * Segundos que se espera como mucho al motor sin la señal de quien pide: el doble del plazo del recorrido
 * (recorrido/api/transporte.js), para no adelantarse nunca a él y que ninguna petición quede esperando para siempre.
 */
const SEGUNDOS_DE_PLAZO_PROPIO = 120;
/** El plazo propio, en milisegundos. */
const PLAZO_PROPIO_MS = SEGUNDOS_DE_PLAZO_PROPIO * MS_POR_SEGUNDO;
/** El identificador de las respuestas que no vienen del Worker (su caída, el plazo propio): ninguna petición lo usa. */
const SIN_PETICION = -1;

/**
 * @typedef {{ id: number, status?: number, headers?: [string, string][], body?: string | null, fallo?: true,
 *   noCoincide?: true, sinClave?: true, sinRespuesta?: true }} RespuestaDelMotor
 */

/** El Worker del motor: lo crea elWorker con la primera petición y lo suelta si se cae. @type {Worker | null} */
let worker = null;
/** El identificador de la última petición; solo lo sube preguntar. */
let siguiente = 0;
/**
 * Lo que espera cada petición en curso, por su identificador: lo pone preguntar y lo quitan la respuesta, la
 * cancelación o la caída del Worker.
 * @type {Map<number, (datos: unknown) => void>}
 */
const pendientes = new Map();
/**
 * La copia del paquete que sigue el motor (laCopia): la carpeta en cuanto sirve para el primer análisis, la carpeta con
 * la copia completa y si ya lo está. Se olvida si falla.
 * @typedef {{ primerAnalisis: Promise<string>, completa: Promise<string>, estaCompleta: boolean }} CopiaSeguida
 * @type {CopiaSeguida | null}
 */
let copia = null;
/** Si la próxima pregunta por la copia pide revisarla: después de que el motor no haya podido responder. */
let revisarLaCopia = false;
/**
 * El Worker que contesta que no tiene la clave de firma y cuándo se le mandó la primera petición que lo contestó
 * (Date.now). Si sigue así pasado PLAZO_PROPIO_MS, su almacenamiento no ha contestado o ha seguido fallando, también al
 * abrir la base, en el tiempo que se le da a cualquier respuesta: la petición siguiente lo termina y crea otro
 * (soltarSiSigueSinClave).
 * @type {{ worker: Worker, desde: number } | null}
 */
let sinClave = null;
/** Las fases de la carga del motor que el Worker cuenta (worker.js, FaseDeLaCarga). */
const FASES_DE_LA_CARGA = new Set(['comprobado', 'motor', 'datos', 'vectores', 'clasificador']);
/** Quienes siguen la carga del motor (escucharLaCarga). @type {Set<(fase: string) => void>} */
const oyentesDeLaCarga = new Set();

/**
 * Sigue la carga del motor del dispositivo: `oyente` recibe cada fase que cuenta el Worker (worker.js, FaseDeLaCarga),
 * a medida que pasa. No crea el Worker: lo crea la primera petición.
 * @param {(fase: string) => void} oyente @returns {() => void} Deja de seguirla.
 */
export function escucharLaCarga(oyente) {
  oyentesDeLaCarga.add(oyente);
  return () => oyentesDeLaCarga.delete(oyente);
}

/**
 * Un fallo del transporte: el recorrido lo cuenta como fallo del motor del dispositivo (recorrido/api/transporte.js).
 * @returns {TypeError}
 */
function falloDelMotor() {
  return new TypeError('El motor del dispositivo no ha podido responder');
}

/**
 * El motor del dispositivo no se puede usar porque alguno de sus archivos no es el de esta versión (worker.js,
 * MotorQueNoCoincide): no es de paso, y volver a pedirlo daría lo mismo. Es un TypeError, como falloDelMotor, para que
 * quien no lo distingue lo cuente igual como un fallo del motor del dispositivo.
 */
export class MotorQueNoCoincide extends TypeError {
  /** @override */
  name = 'MotorQueNoCoincide';
}

/**
 * El motor del dispositivo se ha quedado sin arrancar con la copia ya lista: el Worker no ha respondido en
 * PLAZO_PROPIO_MS (y se ha terminado), o no ha tenido la clave de firma porque el almacenamiento no ha contestado o ha
 * fallado (worker.js, `sinClave`). Repetirlo en el acto daría lo mismo; quien pide decide cuándo volver a intentarlo.
 * Es un TypeError, como falloDelMotor, para que quien no lo distingue lo cuente igual como un fallo del motor.
 */
export class MotorBloqueado extends TypeError {
  /** @override */
  name = 'MotorBloqueado';
}

/**
 * Suelta el Worker del motor si sigue siendo `creado`: lo termina, las peticiones en curso fallan y la siguiente crea
 * otro. Así no queda ningún Worker vivo sin referencia, con su motor en memoria. `motivo` dice por qué fallan las que
 * esperaban: `sinRespuesta` si se suelta porque no ha respondido a tiempo (todas fallan por esa misma causa, como un
 * arranque bloqueado: MotorBloqueado); sin él, el fallo general, el de un Worker que se ha caído.
 * @param {Worker} creado @param {{ sinRespuesta?: true }} [motivo]
 */
function soltarElWorker(creado, motivo = {}) {
  if (worker !== creado) {
    return;
  }
  creado.terminate();
  worker = null;
  for (const resolver of pendientes.values()) {
    resolver({ id: SIN_PETICION, fallo: true, ...motivo });
  }
  pendientes.clear();
}

/**
 * El Worker del motor; si se cae (un error sin capturar o un mensaje que no se puede leer), se suelta (soltarElWorker).
 * @returns {Worker}
 */
function elWorker() {
  if (worker) {
    return worker;
  }
  const creado = new Worker(urlDeGuion(new URL('./worker.js', import.meta.url)), { type: 'module' });
  creado.addEventListener('message', (/** @type {MessageEvent<unknown>} */ { data }) => {
    if (esObjeto(data) && typeof data.fase === 'string' && FASES_DE_LA_CARGA.has(data.fase)) {
      for (const oyente of oyentesDeLaCarga) {
        oyente(data.fase);
      }
      return;
    }
    if (!esObjeto(data) || typeof data.id !== 'number') {
      return;
    }
    pendientes.get(data.id)?.(data);
    pendientes.delete(data.id);
  });
  const caido = () => soltarElWorker(creado);
  creado.addEventListener('error', caido);
  creado.addEventListener('messageerror', caido);
  worker = creado;
  return creado;
}

/** La carpeta del paquete de la versión `version`. @param {string} version */
function carpetaDe(version) {
  return new URL(`../../paquete/${version}/`, import.meta.url).href;
}

/**
 * La copia del paquete que guarda el service worker, seguida una vez para todas las peticiones. El service worker solo
 * sirve el paquete de su copia comprobada, nunca de la red (src/service-worker/comprobado.js, «Lo comprobado»), y lo
 * que necesita el primer análisis lo sirve antes de tener la copia entera. `primerAnalisis` se cumple cuando lo cuenta,
 * o con la copia completa; `completa`, cuando la copia está entera. Si no llega a estarlo, o el service worker deja de
 * contestar (estadoDelPaquete rechaza al vencer su plazo), las dos fallan y la copia se olvida: la siguiente petición
 * la vuelve a pedir.
 * @returns {CopiaSeguida}
 */
function laCopia() {
  if (copia) {
    return copia;
  }
  const revisar = revisarLaCopia;
  revisarLaCopia = false;
  /** @type {(carpeta: string) => void} */
  let alPrimerAnalisis = () => {};
  /** @type {Promise<string>} */
  const primerAnalisis = new Promise((resolver) => {
    alPrimerAnalisis = resolver;
  });
  const completa = estadoDelPaquete({
    revisar,
    alPrimerAnalisis: (version) => alPrimerAnalisis(carpetaDe(version)),
  }).then(({ version, completo }) => {
    if (!completo) {
      throw falloDelMotor();
    }
    seguida.estaCompleta = true;
    return carpetaDe(version);
  });
  /** @type {CopiaSeguida} */
  const seguida = { primerAnalisis: Promise.race([primerAnalisis, completa]), completa, estaCompleta: false };
  completa.catch(() => {
    if (copia === seguida) {
      copia = null;
    }
  });
  copia = seguida;
  return seguida;
}

/**
 * La misma promesa, que además rechaza con el motivo de la señal si se cancela antes. Su oyente de la señal se retira
 * al acabar la promesa: una señal de vida larga (la de la conversación) no acumula un oyente por petición.
 * @template T @param {Promise<T>} promesa @param {AbortSignal | undefined} signal @returns {Promise<T>}
 */
function hastaQueSeCancele(promesa, signal) {
  if (!signal) {
    return promesa;
  }
  /** @type {() => void} */
  let alCancelar = () => {};
  /** @type {Promise<never>} */
  const cancelada = new Promise((_, rechazar) => {
    alCancelar = () => rechazar(signal.reason);
    if (signal.aborted) {
      alCancelar();
      return;
    }
    signal.addEventListener('abort', alCancelar, { once: true });
  });
  return Promise.race([promesa, cancelada]).finally(() => signal.removeEventListener('abort', alCancelar));
}

/**
 * Cuándo empieza una espera de la copia del paquete y cuándo está lista: quien pide puede no contar ese tiempo, que
 * depende de la red (recorrido/espera-del-motor.js).
 * @typedef {{ alEsperarLaCopia?: () => void, alTenerLaCopia?: () => void }} AvisosDeLaCopia
 */

/**
 * La copia de `copia` (primerAnalisis o completa de CopiaSeguida), esperada hasta que se cancele `signal`, con sus
 * `avisos` al empezar la espera y al tenerla. @param {Promise<string>} copia @param {AbortSignal | undefined} signal
 * @param {AvisosDeLaCopia} avisos @returns {Promise<string>}
 */
async function esperarLaCopia(copia, signal, { alEsperarLaCopia, alTenerLaCopia }) {
  alEsperarLaCopia?.();
  const carpeta = await hastaQueSeCancele(copia, signal);
  alTenerLaCopia?.();
  return carpeta;
}

/**
 * Espera la respuesta del Worker a una petición, su cancelación o el plazo propio (PLAZO_PROPIO_MS). Al vencer el
 * plazo, el Worker que no ha respondido se termina (soltarElWorker): sus peticiones fallan y la siguiente crea otro.
 * Cancelar no retira el plazo de una petición ya enviada: un Worker que no contesta se termina igual aunque quien
 * preguntaba ya no espere (el plazo del recorrido, api/transporte.js, o el límite del paso, recorrido/espera-del-motor.js).
 * Si el Worker no se puede crear o no acepta el mensaje, también es un fallo, y la petición no queda pendiente.
 * @param {Omit<import('./worker.js').PeticionAlMotor, 'id'>} peticion @param {AbortSignal | undefined} signal
 * @returns {Promise<unknown>}
 */
function preguntar(peticion, signal) {
  const id = ++siguiente;
  return new Promise((resolver, rechazar) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let plazo;
    const terminar = () => {
      clearTimeout(plazo);
      pendientes.delete(id);
      signal?.removeEventListener('abort', alCancelar);
    };
    const alCancelar = () => {
      signal?.removeEventListener('abort', alCancelar);
      rechazar(signal?.reason);
    };
    if (signal?.aborted) {
      rechazar(signal.reason);
      return;
    }
    signal?.addEventListener('abort', alCancelar, { once: true });
    pendientes.set(id, (datos) => {
      terminar();
      resolver(datos);
    });
    try {
      const atiende = elWorker();
      plazo = setTimeout(() => soltarElWorker(atiende, { sinRespuesta: true }), PLAZO_PROPIO_MS);
      atiende.postMessage({ id, ...peticion });
    } catch {
      terminar();
      rechazar(falloDelMotor());
    }
  });
}

/**
 * Si lo que ha devuelto el Worker se puede convertir en un Response: un estado entero que admite Response, cabeceras
 * en pares de texto y un cuerpo de texto (o ninguno).
 * @param {unknown} datos @returns {datos is RespuestaDelMotor & { status: number }}
 */
function esRespuestaDelMotor(datos) {
  if (!esObjeto(datos)) {
    return false;
  }
  const { status, headers, body } = datos;
  return (
    Number.isInteger(status) &&
    Number(status) >= ESTADO_MINIMO &&
    Number(status) <= ESTADO_MAXIMO &&
    (headers === undefined ||
      (Array.isArray(headers) &&
        headers.every(
          (par) => Array.isArray(par) && par.length === 2 && par.every((parte) => typeof parte === 'string'),
        ))) &&
    (body === undefined || body === null || typeof body === 'string')
  );
}

/**
 * Pregunta al Worker (preguntar), con su tramo de ida y vuelta en la línea temporal.
 * @param {Omit<import('./worker.js').PeticionAlMotor, 'id'>} peticion @param {AbortSignal | undefined} signal
 * @returns {Promise<unknown>}
 */
async function preguntarMedido(peticion, signal) {
  const inicio = inicioDelTramo();
  const datos = await preguntar(peticion, signal);
  medirTramo(MEDIDAS.idaYVuelta, inicio, { ruta: new URL(peticion.url).pathname });
  return datos;
}

/**
 * Termina el Worker que lleva más de PLAZO_PROPIO_MS contestando que no tiene la clave de firma (sinClave): la
 * siguiente petición la pide un Worker nuevo, que vuelve a leer la clave guardada.
 */
function soltarSiSigueSinClave() {
  if (sinClave && sinClave.worker === worker && Date.now() - sinClave.desde >= PLAZO_PROPIO_MS) {
    soltarElWorker(sinClave.worker);
    sinClave = null;
  }
}

/**
 * El error con que falla una petición que el motor no ha podido responder (`datos`, lo que ha llegado en su lugar),
 * mandada en `enviada` (Date.now).
 * @param {unknown} datos @param {number} enviada @returns {TypeError}
 */
function errorDelFallo(datos, enviada) {
  if (esObjeto(datos) && datos.sinClave === true) {
    // La copia no tiene que ver: no se revisa.
    if (worker && sinClave?.worker !== worker) {
      sinClave = { worker, desde: enviada };
    }
    return new MotorBloqueado('El motor del dispositivo no ha podido leer ni guardar su clave');
  }
  // La siguiente petición vuelve a preguntar al service worker por la copia y le pide que la revise: si le falta un
  // archivo o alguno no cuadra con su huella, lo vuelve a bajar (src/service-worker/paquete.js, leFaltaAlgo), en vez
  // de que el motor falle igual en cada reintento.
  copia = null;
  revisarLaCopia = true;
  if (esObjeto(datos) && datos.noCoincide === true) {
    return new MotorQueNoCoincide('El motor del dispositivo no es el de esta versión');
  }
  if (esObjeto(datos) && datos.sinRespuesta === true) {
    return new MotorBloqueado('El motor del dispositivo no ha respondido a tiempo');
  }
  return falloDelMotor();
}

/**
 * Manda una petición a la API del motor del dispositivo y devuelve su respuesta, como fetch. Se cancela con la señal de
 * sus opciones (rechaza con su motivo, como fetch); sin respuesta en PLAZO_PROPIO_MS, o si el motor no puede responder
 * o responde algo que no es una respuesta, rechaza con un TypeError (MotorQueNoCoincide si el fallo no es de paso;
 * MotorBloqueado si el motor no ha respondido a tiempo o no ha podido usar el almacenamiento). `avisos` dice cuándo
 * empieza cada espera de la copia del paquete (`alEsperarLaCopia`) y cuándo la copia está lista (`alTenerLaCopia`).
 * @param {string} direccion @param {RequestInit} opciones @param {AvisosDeLaCopia} [avisos]
 * @returns {Promise<Response>}
 * @throws {TypeError} Si el motor no puede responder, no responde a tiempo o su respuesta no es válida.
 * @throws {unknown} El motivo de la señal, si se cancela.
 */
export async function pedirAlMotorLocal(direccion, opciones, avisos = {}) {
  const signal = opciones.signal ?? undefined;
  const seguida = laCopia();
  const inicioDeLaEspera = inicioDelTramo();
  const paquete = await esperarLaCopia(seguida.primerAnalisis, signal, avisos);
  medirTramo(MEDIDAS.esperaDeLaCopia, inicioDeLaEspera, { copia: 'primer-analisis' });
  soltarSiSigueSinClave();
  const enviada = Date.now();
  const url = new URL(direccion, location.href);
  const peticion = {
    url: url.href,
    method: opciones.method ?? 'GET',
    headers: [...new Headers(opciones.headers)],
    body: typeof opciones.body === 'string' ? opciones.body : null,
  };
  let datos = await preguntarMedido({ ...peticion, paquete, completo: seguida.estaCompleta }, signal);
  if (esObjeto(datos) && datos.faltaElResto === true) {
    const inicioDelResto = inicioDelTramo();
    const entera = await esperarLaCopia(seguida.completa, signal, avisos);
    medirTramo(MEDIDAS.esperaDeLaCopia, inicioDelResto, { copia: 'completa' });
    datos = await preguntarMedido({ ...peticion, paquete: entera, completo: true }, signal);
  }
  if (!esRespuestaDelMotor(datos) || datos.fallo) {
    throw errorDelFallo(datos, enviada);
  }
  sinClave = null;
  const cuerpo = SIN_CUERPO.includes(datos.status) ? null : datos.body;
  return new Response(cuerpo, {
    status: datos.status,
    ...(datos.headers === undefined ? {} : { headers: datos.headers }),
  });
}
