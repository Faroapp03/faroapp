// Lo que comprueba «Faro verificable» (verificable.html), sin pantalla: que los archivos que el dispositivo descarga
// para usar Faro sin IA (el motor compilado y el paquete de datos) son, byte a byte, los que nombra el manifiesto de
// esta versión (herramientas/web/manifiesto-del-dispositivo.ts). Cada archivo se pide sin la caché HTTP y se compara con
// cuadraConElManifiesto: la misma huella SHA-256 y la misma comparación que hace el Worker del motor antes de usarlo.
// - Con la raíz de las firmas en la web (CLAVES_RAIZ), antes se comprueba la firma del manifiesto con la misma cadena
//   que el Worker (comprobarManifiestoNativo). Si no vale, no se compara nada: un manifiesto cuya firma no vale no dice
//   nada de los archivos.
// - Sin raíz, la firma está sin activar y no se pide: lo único que se puede decir es que las huellas coinciden con el
//   manifiesto, que llega del mismo servidor que los archivos. Nunca que Faro está verificado.
// - La versión del paquete es la que nombra el manifiesto: esta página no sabe cuál espera el service worker. Con
//   firma, la declaración firmada tiene que ser de esa misma versión; que sea la que espera esta web lo exige el Worker
//   del motor antes de usar nada.
// Con el service worker delante, lo que llega es lo que él sirve de sus copias comprobadas (src/service-worker/comprobado.js,
// «Lo comprobado»): lo mismo que ejecuta el motor del dispositivo. Sin él, lo que sirve el servidor.
// La página (verificable.js) pinta el resultado; esto no toca el DOM, y la red, las claves y la fecha se le pasan.

import { CLAVES_RAIZ } from '../firmas/claves-raiz.js';
import { FirmaRechazada } from '../firmas/firmas.js';
import { cuadraConElManifiesto, leerManifiesto } from '../firmas/manifiesto-firmado.js';
import { comprobarManifiestoNativo, verificadorNativo } from '../firmas/nativa.js';
import { compararPorCodigo } from '../orden.js';

/** El manifiesto, desde la raíz de la web: lo escribe herramientas/web/manifiesto-del-dispositivo.ts. */
export const MANIFIESTO = 'firmas/manifiesto.json';
/** La firma del manifiesto, desde la raíz de la web: la publica el despliegue cuando hay raíz de confianza. */
export const FIRMA = 'firmas/manifiesto.firma.json';
/**
 * Archivos que se piden a la vez: pocos, para no ahogar una conexión móvil. Es el mismo número que usa el service
 * worker (src/service-worker/paquete.js, DESCARGAS_A_LA_VEZ); pruebas/web-diagnostico/verificable.test.ts comprueba que coinciden.
 */
export const DESCARGAS_A_LA_VEZ = 3;
/**
 * Lo que se espera cada petición, en milisegundos: una conexión que se cuelga deja ese archivo como «no disponible»
 * y la comprobación termina, en lugar de quedarse en «Comprobando…» mientras el navegador no corte.
 */
const ESPERA_MAXIMA_MS = 30_000;
/** El orden de la lista: primero lo que no coincide, después lo que no ha llegado y al final lo que coincide. */
const ORDEN = Object.freeze({ 'no-coincide': 0, 'no-disponible': 1, coincide: 2 });

/** @import { Verificador } from '../firmas/nativa.js' */

/**
 * @typedef {{ algoritmo: string, id: string, publica: string }} ClaveRaiz una clave raíz de las firmas, como la escribe
 *   CLAVES_RAIZ (firmas/claves-raiz.js)
 * @typedef {'coincide' | 'no-coincide' | 'no-disponible'} EstadoDelArchivo
 * @typedef {{ ruta: string, estado: EstadoDelArchivo }} ArchivoComprobado
 * @typedef {'comprobada' | 'sin-activar' | 'sin-comprobar' | 'no-valida'} EstadoDeLaFirma «sin-comprobar», con raíz
 *   pero sin un manifiesto válido que comprobar; «no-valida», con su motivo
 * @typedef {'verificado' | 'coinciden-sin-firma' | 'no-coinciden' | 'incompleto' | 'sin-manifiesto'
 *   | 'manifiesto-no-valido' | 'firma-no-valida'} Veredicto «verificado» solo con la firma comprobada y todos los
 *   archivos iguales
 * @typedef {{ veredicto: Veredicto, firma: EstadoDeLaFirma, motivo: string | null, paquete: string | null,
 *   archivos: ArchivoComprobado[] }} Resultado `motivo`, el de FirmaRechazada si el manifiesto o su firma no valen
 * @typedef {(direccion: URL, opciones: RequestInit) => Promise<Response>} Pedir
 * @typedef {{ pedir: Pedir, raiz: URL, raices?: ClaveRaiz[],
 *   verificador?: Verificador, ahora?: Date }} Entorno `raiz`, la de la web; lo demás, por omisión, las claves de
 *   esta web, la criptografía del navegador y su fecha
 */

/**
 * Los bytes de un archivo de la web, sin la caché HTTP y con ESPERA_MAXIMA_MS de plazo; null si no llegan (sin red,
 * pasado el plazo o una respuesta que no es 2xx): no haberlo podido descargar no es lo mismo que no coincidir.
 * @param {Pedir} pedir @param {URL} direccion @returns {Promise<Uint8Array | null>}
 */
async function bytesDe(pedir, direccion) {
  /** @type {AbortSignal | undefined} */
  let senal;
  try {
    senal = AbortSignal.timeout(ESPERA_MAXIMA_MS);
    const respuesta = await pedir(direccion, { cache: 'no-store', signal: senal });
    return respuesta.ok ? new Uint8Array(await respuesta.arrayBuffer()) : null;
  } catch (error) {
    // fetch rechaza con TypeError cuando no hay respuesta (sin red, o cortada a medias) y con TimeoutError cuando vence
    // el plazo. Un cuerpo ya recibido puede rechazar con AbortError al cortarse la señal; lo demás es un fallo.
    if (
      error instanceof TypeError ||
      (error instanceof DOMException &&
        (error.name === 'TimeoutError' || (error.name === 'AbortError' && senal?.aborted === true)))
    ) {
      return null;
    }
    throw error;
  }
}

/** La firma leída como JSON, aún sin comprobar; si no lo es, está mal formada. @param {Uint8Array} bytes */
function leerFirma(bytes) {
  try {
    return /** @type {unknown} */ (JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new FirmaRechazada('formato', 'La firma del manifiesto no es un JSON válido');
  }
}

/**
 * Lo que devuelve `paso`, o el motivo de la FirmaRechazada con que falla: lo esperable (un manifiesto o una firma que
 * no valen) lo dice el resultado; cualquier otro error es un fallo y se propaga.
 * @template Valor @param {() => Valor | Promise<Valor>} paso @returns {Promise<{ valor: Valor } | { motivo: string }>}
 */
async function motivoSiFalla(paso) {
  try {
    return { valor: await paso() };
  } catch (error) {
    if (error instanceof FirmaRechazada) {
      return { motivo: error.motivo };
    }
    throw error;
  }
}

/**
 * Lo que nombra el manifiesto (leerManifiesto), sin comprobar su firma; uno que no nombra ningún archivo no deja nada
 * que comparar y se rechaza como mal formado. @param {Uint8Array} bytes
 */
function manifiestoConArchivos(bytes) {
  const leido = leerManifiesto(bytes);
  if (!leido.archivos.size) {
    throw new FirmaRechazada('formato', 'El manifiesto no nombra ningún archivo');
  }
  return leido;
}

/**
 * Los archivos del manifiesto según su firma, comprobada con la misma cadena que el Worker del motor. La versión
 * esperada es la que nombra el propio manifiesto (ver la cabecera): la declaración firmada tiene que ser de ella.
 * FirmaRechazada si la firma falta o no vale.
 * @param {Required<Entorno>} entorno @param {Uint8Array} bytes @param {string} paquete
 * @returns {Promise<ReadonlyMap<string, string>>}
 */
async function archivosFirmados(entorno, bytes, paquete) {
  const { pedir, raiz, raices, verificador, ahora } = entorno;
  const bytesDeLaFirma = await bytesDe(pedir, new URL(FIRMA, raiz));
  if (!bytesDeLaFirma) {
    throw new FirmaRechazada('sin-firma', 'Falta la firma del manifiesto');
  }
  return comprobarManifiestoNativo(bytes, leerFirma(bytesDeLaFirma), { paquete, raices, ahora }, verificador);
}

/**
 * Pide un archivo y lo compara con su huella del manifiesto.
 * @param {Required<Entorno>} entorno @param {ReadonlyMap<string, string>} archivos @param {string} ruta
 * @returns {Promise<ArchivoComprobado>}
 */
async function comprobarArchivo(entorno, archivos, ruta) {
  const { pedir, raiz } = entorno;
  const bytes = await bytesDe(pedir, new URL(ruta, raiz));
  if (!bytes) {
    return { ruta, estado: 'no-disponible' };
  }
  try {
    cuadraConElManifiesto(archivos, ruta, bytes);
    return { ruta, estado: 'coincide' };
  } catch (error) {
    if (error instanceof FirmaRechazada) {
      return { ruta, estado: 'no-coincide' };
    }
    throw error;
  }
}

/**
 * Cada archivo del manifiesto comparado con su huella, unos pocos a la vez, en el orden de ORDEN y por ruta.
 * @param {Required<Entorno>} entorno @param {ReadonlyMap<string, string>} archivos
 * @returns {Promise<ArchivoComprobado[]>}
 */
async function comprobarArchivos(entorno, archivos) {
  const rutas = [...archivos.keys()];
  let siguiente = 0;
  /** @type {ArchivoComprobado[]} */
  const comprobados = [];
  const trabajar = async () => {
    // Cada vuelta toma la siguiente ruta de una lista finita: el bucle acaba cuando se agota.
    while (siguiente < rutas.length) {
      const ruta = /** @type {string} */ (rutas[siguiente]);
      siguiente += 1;
      comprobados.push(await comprobarArchivo(entorno, archivos, ruta));
    }
  };
  await Promise.all(Array.from({ length: DESCARGAS_A_LA_VEZ }, trabajar));
  return comprobados.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || compararPorCodigo(a.ruta, b.ruta));
}

/**
 * El veredicto de unos archivos ya comparados: «verificado» solo con la firma comprobada y todos iguales.
 * @param {EstadoDeLaFirma} firma @param {ArchivoComprobado[]} archivos @returns {Veredicto}
 */
function veredictoDe(firma, archivos) {
  if (archivos.some(({ estado }) => estado === 'no-coincide')) {
    return 'no-coinciden';
  }
  if (archivos.some(({ estado }) => estado === 'no-disponible')) {
    return 'incompleto';
  }
  return firma === 'comprobada' ? 'verificado' : 'coinciden-sin-firma';
}

/**
 * Compara cada archivo con su huella y da el resultado, con el veredicto que corresponde a la firma.
 * @param {Required<Entorno>} entorno @param {EstadoDeLaFirma} firma @param {string} paquete
 * @param {ReadonlyMap<string, string>} archivos
 * @returns {Promise<Resultado>}
 */
async function comparar(entorno, firma, paquete, archivos) {
  const comprobados = await comprobarArchivos(entorno, archivos);
  return { veredicto: veredictoDe(firma, comprobados), firma, motivo: null, paquete, archivos: comprobados };
}

/**
 * Un resultado sin archivos comparados: falta el manifiesto, no vale o no vale su firma.
 * @param {Veredicto} veredicto @param {EstadoDeLaFirma} firma @param {string | null} [motivo] @returns {Resultado}
 */
function sinComparar(veredicto, firma, motivo = null) {
  return { veredicto, firma, motivo, paquete: null, archivos: [] };
}

/**
 * Lo que la página necesita para pedir archivos de la web: el fetch del navegador y su raíz (este archivo está en
 * scripts/verificable/).
 * @returns {Entorno}
 */
export function entornoDelNavegador() {
  return {
    pedir: (direccion, opciones) => globalThis.fetch(direccion, opciones),
    raiz: new URL('../../', import.meta.url),
  };
}

/**
 * Comprueba lo que sirve Faro al dispositivo contra el manifiesto de esta versión (y su firma, si la web lleva la
 * raíz) y devuelve el resultado. No lanza por lo esperable (sin red, sin manifiesto, una firma o una huella que no
 * valen): lo dice el resultado.
 * @param {Entorno} entorno @returns {Promise<Resultado>}
 */
export async function comprobarLoServido(entorno) {
  /** @type {Required<Entorno>} */
  const completo = { raices: CLAVES_RAIZ, verificador: verificadorNativo(), ahora: new Date(), ...entorno };
  const conRaiz = completo.raices.length > 0;
  /** @type {EstadoDeLaFirma} */
  const sinFirma = conRaiz ? 'sin-comprobar' : 'sin-activar';
  const bytes = await bytesDe(completo.pedir, new URL(MANIFIESTO, completo.raiz));
  if (!bytes) {
    return sinComparar('sin-manifiesto', sinFirma);
  }
  const leido = await motivoSiFalla(() => manifiestoConArchivos(bytes));
  if ('motivo' in leido) {
    return sinComparar('manifiesto-no-valido', sinFirma, leido.motivo);
  }
  const { paquete, archivos } = leido.valor;
  if (!conRaiz) {
    return comparar(completo, 'sin-activar', paquete, archivos);
  }
  const firmados = await motivoSiFalla(() => archivosFirmados(completo, bytes, paquete));
  if ('motivo' in firmados) {
    return sinComparar('firma-no-valida', 'no-valida', firmados.motivo);
  }
  return comparar(completo, 'comprobada', paquete, firmados.valor);
}
