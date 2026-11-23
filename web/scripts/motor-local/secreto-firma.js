// El secreto con que el motor del dispositivo firma sus estimaciones (src/seguridad/firma.ts). Se crea una vez,
// al azar, y se guarda en IndexedDB: con uno nuevo en cada arranque del motor, una estimación firmada antes de recargar
// la página daría un error al pedir el informe. No sale nunca del dispositivo ni identifica a nadie: solo sirve para
// que el motor reconozca lo que firmó él mismo.
// Se guarda como clave HMAC-SHA-256 de Web Crypto que no se puede extraer: firma y comprueba, pero ningún guion, ni
// siquiera del propio origen, puede leer sus bytes. También se acepta un secreto guardado como texto: la primera vez
// que se lee se convierte en la clave que equivale a ese texto para el firmador actual (claveDelTexto), y la clave lo
// sustituye. Eso no recupera las firmas de un firmador anterior hechas con el texto: tenían otro formato y no verifican
// con ninguna conversión. Una clave ya guardada se usa tal cual, también la que convirtió un texto de otra manera.
// IndexedDB y no localStorage: se lee también desde el Worker del motor (worker.js), donde localStorage no existe, y es
// el único almacén que guarda una CryptoKey tal cual.
// El motor firma con una clave que dura lo que el Worker (src/seguridad/firma.ts) en un único caso: la base se ha
// abierto, se ha comprobado vacía (o solo con un texto que no es un secreto válido) en la transacción de escritura, y el
// navegador no deja guardar o confirmar la primera clave. Si no deja convertir el secreto antiguo en texto, se firma con
// la clave de ese mismo texto, que sigue guardado. En los demás casos no se sabe qué hay guardado, y firmar con otra
// clave rompería en silencio lo firmado antes: el motor no arranca, y el intento siguiente vuelve a abrir la base. Eso
// incluye no poder abrirla (el fallo no demuestra que esté vacía: IndexedDB también falla al abrir bases que existen),
// un valor guardado que no es una clave ni un texto, y lo guardado que cambia entre la lectura y la escritura.
// Si el almacenamiento falla, al abrir la base o después, el error es AlmacenConFallo; si no contesta, la espera acaba a
// su plazo con AlmacenSinRespuesta, y la operación sigue y la aprovecha el intento siguiente. Una clave nueva solo vale
// cuando su transacción se ha confirmado.

/** La base de IndexedDB, su almacén y la clave con que se guarda el secreto: «Borrar todo» borra la base entera. */
const BASE_DE_DATOS = 'faro-motor-local';
const ALMACEN = 'claves';
const CLAVE = 'secreto-firma';
/** La versión del esquema de la base: un único almacén. */
const VERSION_DE_LA_BASE = 1;
/** La clave: HMAC con SHA-256, que solo firma y comprueba. @type {HmacKeyGenParams} */
const ALGORITMO = { name: 'HMAC', hash: 'SHA-256' };
/** Lo que puede hacer la clave: firmar y comprobar, nada más. @type {readonly KeyUsage[]} */
const USOS = Object.freeze(['sign', 'verify']);
/**
 * La sal de HKDF-Extract con que src/seguridad/firma.ts firmaba con un secreto en texto (SAL_HKDF). Tiene que ser la
 * misma: las pruebas firman con el texto en firma.ts y comprueban con la clave convertida aquí.
 */
const SAL_DEL_TEXTO = 'faro/firma/v1';
/** Los bytes UTF-8 que firma.ts exige a un secreto en texto (MIN_SECRETO_BYTES): con uno más corto no firmaba. */
const MIN_BYTES_DEL_TEXTO = 32;
/** Cuánto se espera, en milisegundos, a que otra pestaña suelte la base al borrarla antes de seguir. */
const ESPERA_DEL_BORRADO_MS = 2000;
/**
 * Cuánto se espera, en milisegundos, a que el almacenamiento conteste al leer o guardar la clave: lo normal son
 * milésimas, y queda muy por debajo del plazo con que la página espera al motor (cliente.js).
 */
const ESPERA_DEL_ALMACEN_MS = 15_000;

/**
 * El almacenamiento no ha contestado a tiempo al leer o guardar la clave. No es un rechazo: la clave guardada puede
 * existir, y el motor no firma con otra (worker.js lo cuenta a la página).
 */
export class AlmacenSinRespuesta extends Error {
  /** @override */
  name = 'AlmacenSinRespuesta';
}

/**
 * El almacenamiento ha fallado: no ha dejado abrir la base (o no hay IndexedDB), o ha fallado después (al leer, o al
 * guardar o confirmar), o lo guardado no es una clave ni un texto, o ha cambiado entre la lectura y la escritura. La
 * clave guardada puede existir, y el motor no firma con otra (worker.js lo cuenta a la página).
 */
export class AlmacenConFallo extends Error {
  /** @override */
  name = 'AlmacenConFallo';
}

/**
 * La operación con la clave en curso en este Worker, mientras no termina: quien la pide entretanto espera la misma, y
 * no genera ni intenta guardar otra. @type {Promise<CryptoKey | undefined> | null}
 */
let enCurso = null;

/**
 * Una petición de IndexedDB como promesa.
 * @template T @param {IDBRequest<T>} peticion @returns {Promise<T>}
 */
function comoPromesa(peticion) {
  return new Promise((resolver, rechazar) => {
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

/** Abre la base del secreto y la crea con su almacén la primera vez. @returns {Promise<IDBDatabase>} */
async function abrir() {
  const peticion = indexedDB.open(BASE_DE_DATOS, VERSION_DE_LA_BASE);
  peticion.onupgradeneeded = () => peticion.result.createObjectStore(ALMACEN);
  const base = await comoPromesa(peticion);
  // Si otra pestaña la borra («Borrar todo»), se suelta al momento para no bloquear el borrado.
  base.onversionchange = () => base.close();
  return base;
}

/**
 * Borra el secreto guardado (con «Borrar todo»): el motor creará otro la próxima vez que arranque. Espera a que el
 * borrado termine o notifique error; si queda bloqueado, rechaza tras ESPERA_DEL_BORRADO_MS.
 * El plazo no acredita que se haya borrado la base. Las conexiones propias se cierran al recibir el aviso.
 * @returns {Promise<void>}
 */
export function borrarSecretoDeFirma() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.deleteDatabase(BASE_DE_DATOS);
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let espera;
    const terminar = () => {
      clearTimeout(espera);
      resolver();
    };
    peticion.onsuccess = terminar;
    peticion.onerror = () => {
      clearTimeout(espera);
      rechazar(new Error('No se ha podido borrar la clave del dispositivo'));
    };
    peticion.onblocked = () => {
      espera = setTimeout(() => rechazar(new Error('La clave del dispositivo sigue bloqueada')), ESPERA_DEL_BORRADO_MS);
    };
  });
}

/** Una clave nueva, al azar y que no se puede extraer. @returns {Promise<CryptoKey>} */
function claveNueva() {
  return crypto.subtle.generateKey(ALGORITMO, false, USOS);
}

/**
 * Si `valor` es un texto que no es un secreto válido: con menos de MIN_BYTES_DEL_TEXTO bytes UTF-8, firma.ts no firmaba
 * con él, así que no hay nada firmado que conservar y cuenta como una base vacía.
 * @param {unknown} valor @returns {boolean}
 */
function esTextoSinSecreto(valor) {
  return typeof valor === 'string' && new TextEncoder().encode(valor).length < MIN_BYTES_DEL_TEXTO;
}

/**
 * La clave de un secreto guardado como texto, equivalente a ese texto para el firmador actual. Con un texto, firma.ts
 * (subclaveDelTexto) hace HKDF completo: Extract, PRK = HMAC-SHA-256(sal, texto en UTF-8), y Expand con la PRK; con una
 * clave (subclaveDeLaClave), solo Expand, con la clave como PRK. Así que la clave es esa PRK, importada sin poder
 * extraerse: da la misma subclave y el mismo kid, y lo que firma.ts firma con el texto se comprueba con ella. Sus bytes
 * solo pasan por la memoria mientras se importa, y se borran después.
 * @param {string} texto @returns {Promise<CryptoKey>}
 */
async function claveDelTexto(texto) {
  const codificador = new TextEncoder();
  const sal = await crypto.subtle.importKey('raw', codificador.encode(SAL_DEL_TEXTO), ALGORITMO, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', sal, codificador.encode(texto)));
  try {
    return await crypto.subtle.importKey('raw', prk, ALGORITMO, false, USOS);
  } finally {
    prk.fill(0);
  }
}

/**
 * La clave de este dispositivo: la guardada o, la primera vez, una nueva que se guarda. Devuelve undefined solo si la
 * base, abierta y comprobada sin clave, no deja guardar la primera (leerOGuardar), y el motor usa una que dura lo que el
 * Worker. Si el almacenamiento no contesta en ESPERA_DEL_ALMACEN_MS, rechaza con AlmacenSinRespuesta; la operación sigue
 * en curso y la siguiente llamada la espera (enCurso). Si falla, o lo guardado no se entiende o cambia mientras tanto
 * (leerOGuardar), rechaza con AlmacenConFallo, y la siguiente llamada lo vuelve a intentar desde el principio. Un valor
 * guardado que no se entiende (ni una clave ni un texto) no se sustituye: sigue guardado y cada intento vuelve a
 * rechazar con AlmacenConFallo, hasta que «Borrar todo» vacía la base y el intento siguiente guarda una clave nueva.
 * @returns {Promise<CryptoKey | undefined>}
 * @throws {AlmacenSinRespuesta | AlmacenConFallo} Si el almacenamiento no contesta a tiempo, o falla al abrir la base o
 *   después, o lo guardado no se entiende o cambia mientras tanto.
 */
export function secretoDeFirma() {
  if (!enCurso) {
    const esta = leerOGuardar();
    enCurso = esta;
    const soltar = () => {
      if (enCurso === esta) {
        enCurso = null;
      }
    };
    esta.then(soltar, soltar);
  }
  const operacion = enCurso;
  return new Promise((resolver, rechazar) => {
    const plazo = setTimeout(
      () => rechazar(new AlmacenSinRespuesta('El almacenamiento no ha contestado al leer o guardar la clave de firma')),
      ESPERA_DEL_ALMACEN_MS,
    );
    operacion.then(resolver, rechazar).finally(() => clearTimeout(plazo));
  });
}

/**
 * Lee la clave guardada o, la primera vez, guarda una nueva. Una primera lectura, en una transacción de solo lectura,
 * evita generar una clave si ya existe. Si no existe, la comprobación y la escritura van juntas en una misma
 * transacción de lectura y escritura, así que dos arranques a la vez (dos pestañas) acaban con la misma; la clave se
 * prepara antes, porque una transacción de IndexedDB se cierra si espera a otra cosa. Solo se escribe sobre lo que se
 * leyó: nada, un texto que no es un secreto válido o el secreto antiguo en texto, sin cambios entre las dos lecturas.
 * @returns {Promise<CryptoKey | undefined>} undefined solo si no deja guardar la primera clave con la base comprobada
 *   vacía en la misma transacción (guardar): entonces no hay ninguna clave guardada.
 * @throws {AlmacenConFallo} Si no se puede abrir la base; si lo guardado no es una clave ni un texto, o ha cambiado
 *   entre las dos lecturas sin ser una clave; o si falla después, salvo ese caso y el del secreto antiguo (guardar).
 */
async function leerOGuardar() {
  /** @type {IDBDatabase} */
  let base;
  try {
    base = await abrir();
  } catch (error) {
    // No poder abrir la base no dice qué hay guardado: puede haber una clave, y firmar con otra rompería lo firmado.
    throw new AlmacenConFallo('El almacenamiento no ha dejado abrir la base de la clave de firma', { cause: error });
  }
  try {
    const leida = await comoPromesa(base.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(CLAVE));
    if (leida instanceof CryptoKey) {
      return leida;
    }
    if (leida !== undefined && typeof leida !== 'string') {
      throw new Error('Lo guardado como clave de firma no es una clave ni un texto');
    }
    const propuesta =
      typeof leida === 'string' && !esTextoSinSecreto(leida) ? await claveDelTexto(leida) : await claveNueva();
    const transaccion = base.transaction(ALMACEN, 'readwrite');
    const confirmada = confirmacionDe(transaccion);
    const almacen = transaccion.objectStore(ALMACEN);
    const guardada = await comoPromesa(almacen.get(CLAVE));
    // Otra pestaña ha guardado ya su clave entre la lectura previa y esta transacción: vale esa.
    if (guardada instanceof CryptoKey) {
      return guardada;
    }
    // Cualquier otro cambio: `propuesta` corresponde a lo leído, no a lo que hay ahora.
    if (guardada !== leida) {
      throw new Error('La clave de firma guardada ha cambiado entre la lectura y la escritura');
    }
    return await guardar({ almacen, confirmada }, propuesta, leida);
  } catch (error) {
    throw new AlmacenConFallo('No se ha podido leer o guardar la clave de firma', { cause: error });
  } finally {
    base.close();
  }
}

/**
 * Cuándo se confirma `transaccion`: se cumple con `complete` y rechaza si aborta (la cuota se puede comprobar al
 * confirmar, después de que la escritura haya contestado bien). Su rechazo se atiende aunque nadie lo espere.
 * @param {IDBTransaction} transaccion @returns {Promise<void>}
 */
function confirmacionDe(transaccion) {
  /** @type {Promise<void>} */
  const confirmada = new Promise((resolver, rechazar) => {
    transaccion.oncomplete = () => resolver();
    transaccion.onabort = () => rechazar(transaccion.error ?? new Error('La transacción de la clave se ha abortado'));
  });
  confirmada.catch(() => {});
  return confirmada;
}

/**
 * Guarda la clave `propuesta` en lugar de lo que había en la misma transacción (`guardada`, igual a lo leído antes) y
 * espera a que la transacción se confirme: hasta entonces no está guardada. Si el navegador no deja (la cuota, al
 * escribir o al confirmar), depende de `guardada`:
 * - nada, o un texto que no es un secreto válido (esTextoSinSecreto): no se pierde ninguna firma; undefined, y el motor
 *   usa una que dura lo que el Worker;
 * - el secreto antiguo en texto: sigue guardado, porque la transacción no se ha confirmado, y `propuesta` es la clave
 *   convertida de ese mismo texto (claveDelTexto), que se vuelve a obtener igual en cada arranque; vale esa, sin
 *   sustituir nada.
 * @param {{ almacen: IDBObjectStore, confirmada: Promise<void> }} escritura @param {CryptoKey} propuesta
 * @param {string | undefined} guardada @returns {Promise<CryptoKey | undefined>}
 */
async function guardar({ almacen, confirmada }, propuesta, guardada) {
  try {
    await comoPromesa(almacen.put(propuesta, CLAVE));
    await confirmada;
    return propuesta;
  } catch {
    return guardada === undefined || esTextoSinSecreto(guardada) ? undefined : propuesta;
  }
}
