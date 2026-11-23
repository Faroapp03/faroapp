// La comprobación de firmas con la criptografía nativa de la plataforma (Web Crypto: Ed25519 y, con la
// especificación «Modern Algorithms in WebCrypto» del WICG, ML-DSA-65), y con noble donde la plataforma no la trae.
// Es la criptoagilidad del dispositivo: el formato de las firmas y las claves no cambia; cambia quién comprueba, y las
// dos implementaciones se contrastan con sobres firmados por OpenSSL (pruebas/web-firmas/firmas.test.js).
// Lo que se lee de un sobre y la cadena del manifiesto son los de firmas.js y manifiesto-firmado.js, compartidos con la
// comprobación síncrona de noble: aquí solo se decide, algoritmo a algoritmo, si lo comprueba Web Crypto o noble.
// Con qué se decide: `SubtleCrypto.supports` (la consulta que define esa especificación) si existe; si no, probando a
// importar la clave pública, que en una plataforma sin el algoritmo falla con NotSupportedError. La decisión de cada
// algoritmo se toma una vez por verificador y se recuerda. Lo usan el Worker del motor (motor-local/worker.js), que
// comprueba el manifiesto antes de cargar nada, la página «Faro verificable» (verificable/comprobacion.js) y, en las
// pruebas, la comprobación de las respuestas firmadas del servidor MCP.

import { ALGORITMOS, FirmaRechazada, firmasDelSobre, verificarConNoble } from './firmas.js';
import { cadenaDelManifiesto, OPCIONES_DEL_MANIFIESTO } from './manifiesto-firmado.js';

/**
 * @import { AlgoritmoNativo, Esperado, FirmaAComprobar } from './firmas.js'
 * @import { OpcionesDelManifiesto, SobreAComprobar } from './manifiesto-firmado.js'
 */

/**
 * @typedef {'nativa' | 'noble'} Implementacion
 * @typedef {{ verificar: (algoritmo: string, firma: Uint8Array, mensaje: Uint8Array, publica: Uint8Array)
 *   => Promise<boolean>, implementaciones: ReadonlyMap<string, Implementacion> }} Verificador quién comprueba cada
 *   algoritmo; `implementaciones` se va rellenando con lo decidido
 * @typedef {{ importKey: (formato: string, clave: Uint8Array<ArrayBuffer>, algoritmo: { name: string },
 *   extraible: boolean, usos: string[]) => Promise<CryptoKey>, verify: (algoritmo: { name: string },
 *   clave: CryptoKey, firma: Uint8Array<ArrayBuffer>, mensaje: Uint8Array<ArrayBuffer>) => Promise<boolean> }}
 *   SubtleParaFirmas lo que se usa de Web Crypto, con el formato de clave «raw-public» de ML-DSA, que los tipos de
 *   TypeScript aún no declaran
 */

/** Las operaciones de Web Crypto que tiene que admitir un algoritmo para comprobar con él. */
/** @type {readonly string[]} */
const OPERACIONES = Object.freeze(['importKey', 'verify']);

/**
 * Si un error de Web Crypto dice que el algoritmo o el formato de clave no existen en esta plataforma (y no que la
 * clave sea mala): NotSupportedError según Web Crypto, y TypeError en los navegadores que no conocen el formato.
 * @param {unknown} error
 */
function esFaltaDeSoporte(error) {
  return (error instanceof DOMException && error.name === 'NotSupportedError') || error instanceof TypeError;
}

/**
 * Si `SubtleCrypto.supports` (estático, de la especificación del WICG) existe y dice que el algoritmo se admite; null
 * si esta plataforma no tiene la consulta y hay que probar.
 * @param {string} nombre
 * @returns {boolean | null}
 */
function segunSupports(nombre) {
  /** @type {unknown} */
  const claseSubtle = globalThis.SubtleCrypto;
  if (typeof claseSubtle !== 'function' || !('supports' in claseSubtle)) {
    return null;
  }
  const consulta = claseSubtle.supports;
  if (typeof consulta !== 'function') {
    return null;
  }
  return OPERACIONES.every((operacion) => consulta.call(claseSubtle, operacion, { name: nombre }) === true);
}

/**
 * Una copia de los bytes en un ArrayBuffer propio, que es lo que Web Crypto admite.
 * @param {Uint8Array} bytes @returns {Uint8Array<ArrayBuffer>}
 */
function copia(bytes) {
  return new Uint8Array(bytes);
}

/**
 * El verificador de este entorno: Web Crypto para cada algoritmo que la plataforma trae, noble para el resto. Con
 * null (un entorno sin Web Crypto, o a propósito), todo con noble.
 * @param {SubtleCrypto | null | undefined} [subtle] el de la plataforma; las pruebas pasan otro o null
 * @returns {Verificador}
 */
export function verificadorNativo(subtle = globalThis.crypto?.subtle ?? null) {
  /** @type {Map<string, Implementacion>} */
  const implementaciones = new Map();
  // Los tipos de TypeScript de Web Crypto no conocen «raw-public» (ML-DSA); lo que existe en la plataforma lo deciden
  // segunSupports y el NotSupportedError de la importación, en ejecución.
  const nativa = /** @type {SubtleParaFirmas | null | undefined} */ (/** @type {unknown} */ (subtle));

  /**
   * Comprueba con Web Crypto, o null si la plataforma no trae el algoritmo (y hay que ir a noble). Con Web Crypto ya
   * decidida para el algoritmo, no se vuelve a consultar ni a decidir: un error es una clave o una firma que no valen.
   * @param {SubtleParaFirmas} webCrypto @param {AlgoritmoNativo} nativo @param {Uint8Array} mensaje
   * @param {FirmaAComprobar} aComprobar
   * @returns {Promise<boolean | null>}
   */
  async function conWebCrypto(webCrypto, nativo, mensaje, { algoritmo: id, firma, publica }) {
    const decidida = implementaciones.get(id) === 'nativa';
    if (!decidida && segunSupports(nativo.nombre) === false) {
      return null;
    }
    const algoritmo = { name: nativo.nombre };
    try {
      const clave = await webCrypto.importKey(nativo.formatoDeClave, copia(publica), algoritmo, false, ['verify']);
      return (await webCrypto.verify(algoritmo, clave, copia(firma), copia(mensaje))) === true;
    } catch (error) {
      // Sin el algoritmo o el formato en esta plataforma se decide noble; cualquier otro error es una clave o una
      // firma que no valen.
      return !decidida && esFaltaDeSoporte(error) ? null : false;
    }
  }

  return {
    implementaciones,
    async verificar(algoritmo, firma, mensaje, publica) {
      const admitido = Object.hasOwn(ALGORITMOS, algoritmo) ? ALGORITMOS[algoritmo] : undefined;
      if (!admitido) {
        throw new FirmaRechazada('combinacion', `El algoritmo ${algoritmo} no es de ninguna combinación de Faro`);
      }
      const { nativo } = admitido;
      if (nativa && nativo && implementaciones.get(algoritmo) !== 'noble') {
        const resultado = await conWebCrypto(nativa, nativo, mensaje, { algoritmo, firma, publica });
        if (resultado !== null) {
          implementaciones.set(algoritmo, 'nativa');
          return resultado;
        }
      }
      implementaciones.set(algoritmo, 'noble');
      return verificarConNoble(algoritmo, firma, mensaje, publica);
    },
  };
}

/**
 * Comprueba un sobre como comprobarSobre (firmas.js), pero cada firma con el verificador dado: Web Crypto si la
 * plataforma trae el algoritmo, noble si no. Devuelve el contenido firmado; si algo falla, FirmaRechazada.
 * @param {unknown} sobre un `Sobre` leído de JSON, aún sin comprobar
 * @param {Esperado} esperado
 * @param {Verificador} [verificador]
 * @returns {Promise<Uint8Array>}
 * @throws {FirmaRechazada} si el sobre no cumple lo esperado o alguna firma no vale
 */
export async function comprobarSobreNativo(sobre, esperado, verificador = verificadorNativo()) {
  const { bytes, mensaje, firmas } = firmasDelSobre(sobre, esperado);
  for (const { algoritmo, firma, publica } of firmas) {
    if (!(await verificador.verificar(algoritmo, firma, mensaje, publica))) {
      throw new FirmaRechazada('firma-no-valida', `La firma ${algoritmo} no corresponde a lo firmado`);
    }
  }
  return bytes;
}

/**
 * Comprueba el manifiesto firmado con la cadena de manifiesto-firmado.js, paso a paso, con
 * cada sobre comprobado por el verificador dado. Devuelve sus archivos (ruta → SHA-256); si algo no cuadra,
 * FirmaRechazada con su `motivo`.
 * @param {Uint8Array} bytes los del manifiesto, tal como han llegado
 * @param {unknown} firma su firma, ya leída como JSON
 * @param {OpcionesDelManifiesto} esperado
 * @param {Verificador} [verificador]
 * @returns {Promise<ReadonlyMap<string, string>>}
 */
export async function comprobarManifiestoNativo(bytes, firma, esperado, verificador = verificadorNativo()) {
  const pasos = cadenaDelManifiesto(bytes, firma, { ...OPCIONES_DEL_MANIFIESTO(), ...esperado });
  let paso = pasos.next();
  // La cadena pide comprobar exactamente dos sobres, el certificado y la declaración, y termina.
  while (paso.done !== true) {
    /** @type {SobreAComprobar} */
    const { sobre, esperado: delSobre } = paso.value;
    paso = pasos.next(await comprobarSobreNativo(sobre, delSobre, verificador));
  }
  return paso.value;
}
