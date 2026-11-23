// Las firmas de Faro en un solo sitio: qué algoritmos admite, qué combinación firma cada cosa, cómo se forma el
// mensaje firmado y cómo se comprueba una firma híbrida. Una firma híbrida son dos firmas del mismo mensaje, una
// clásica (Ed25519) y una poscuántica (ML-DSA, FIPS 204, o SLH-DSA, FIPS 205), y solo vale si valen las dos: un fallo
// en la biblioteca poscuántica, más joven, no basta para colar una firma mientras la clásica resista, y cuando un
// ordenador cuántico rompa la clásica la poscuántica sigue cerrando la puerta.
// Cambiar de algoritmo es añadirlo a ALGORITMOS y ponerlo en una combinación de COMBINACIONES: ninguna otra parte del
// código nombra un algoritmo. La combinación la decide quien comprueba, nunca el archivo firmado: quitar una de las dos
// firmas no rebaja la exigencia, se rechaza.
// El mensaje firmado se forma con la codificación PAE de DSSE (Dead Simple Signing Envelope, la de in-toto y
// Sigstore): el tipo del contenido va dentro de lo firmado, así que la firma de un certificado no sirve como firma de
// una instalación. El mensaje, el base64 y los tipos tienen su fuente única en el motor (sobre-dsse.js, la copia de
// src/comun/sobre-dsse.ts), que también firma las respuestas del servidor MCP; este módulo los ofrece a quien lo
// usa: el dispositivo, para comprobar (firmas/manifiesto-firmado.js), y las herramientas de firma.
// Cada algoritmo lleva dos implementaciones que tienen que dar lo mismo: `verificar`, la de noble, en JavaScript
// puro y síncrona, y `nativo`, el
// nombre con que lo conoce Web Crypto, que usa nativa.js cuando la plataforma lo trae. Lo que aquí se lee de un sobre
// (firmasDelSobre) es común a las dos: solo cambia quién comprueba cada firma.

import { ed25519 } from '../../terceros/noble/curves/ed25519.js';
import { sha256 } from '../../terceros/noble/hashes/sha2.js';
import { ml_dsa65 } from '../../terceros/noble/post-quantum/ml-dsa.js';
import { slh_dsa_shake_192s } from '../../terceros/noble/post-quantum/slh-dsa.js';
import { camposDe } from '../json.js';
import { bytesDeBase64, mensajeAFirmar } from './sobre-dsse.js';

export { aBase64, mensajeAFirmar, TIPOS } from './sobre-dsse.js';

/**
 * @typedef {(firma: Uint8Array, mensaje: Uint8Array, publica: Uint8Array) => boolean} Verificar
 * @typedef {{ nombre: string, formatoDeClave: 'raw' | 'raw-public' }} AlgoritmoNativo el nombre del algoritmo en Web
 *   Crypto y el formato con que se importa su clave pública (Ed25519, «raw»; ML-DSA, «raw-public», de la especificación
 *   «Modern Algorithms in WebCrypto» del WICG)
 * @typedef {{ norma: string, bytesDeLaClave: number, bytesDeLaFirma: number, verificar: Verificar,
 *   nativo: AlgoritmoNativo | null }} Algoritmo
 * @typedef {{ algoritmo: string, id: string, publica: Uint8Array }} ClavePublica
 * @typedef {{ algoritmo: string, clave: string, firma: string }} FirmaDelSobre
 * @typedef {{ tipo: string, contenido: string, firmas: FirmaDelSobre[] }} Sobre
 * @typedef {{ algoritmo: string, firma: Uint8Array, publica: Uint8Array }} FirmaAComprobar una firma del sobre ya
 *   leída, del tamaño de su algoritmo y de una clave de confianza; falta comprobarla
 * @typedef {{ tipo: string, combinacion: readonly string[], claves: ClavePublica[] }} Esperado lo que debe cumplir un
 *   sobre: su tipo, la combinación de algoritmos y las claves de confianza
 */

/**
 * Los algoritmos admitidos, por su id (el mismo nombre que les da OpenSSL). Las firmas son las «puras», sin contexto.
 * SLH-DSA no está en Web Crypto en ninguna plataforma: solo lo comprueba noble.
 */
export const ALGORITMOS = Object.freeze(
  /** @type {Record<string, Algoritmo>} */ ({
    ed25519: {
      norma: 'RFC 8032',
      bytesDeLaClave: 32,
      bytesDeLaFirma: 64,
      verificar: (firma, mensaje, publica) => ed25519.verify(firma, mensaje, publica, { zip215: false }),
      nativo: { nombre: 'Ed25519', formatoDeClave: 'raw' },
    },
    'ml-dsa-65': {
      norma: 'FIPS 204',
      bytesDeLaClave: 1952,
      bytesDeLaFirma: 3309,
      verificar: (firma, mensaje, publica) => ml_dsa65.verify(firma, mensaje, publica),
      nativo: { nombre: 'ML-DSA-65', formatoDeClave: 'raw-public' },
    },
    'slh-dsa-shake-192s': {
      norma: 'FIPS 205',
      bytesDeLaClave: 48,
      bytesDeLaFirma: 16224,
      verificar: (firma, mensaje, publica) => slh_dsa_shake_192s.verify(firma, mensaje, publica),
      nativo: null,
    },
  }),
);

/**
 * Qué firma cada clave. La raíz, guardada sin conexión y usada una vez al año, firma con SLH-DSA, que solo depende de
 * la solidez de una función resumen; la clave diaria, que firma cada instalación, con ML-DSA, más rápida y de firmas
 * más cortas. Las dos, de la categoría 3 de seguridad del NIST, junto con Ed25519.
 */
export const COMBINACIONES = Object.freeze({
  raiz: Object.freeze(['ed25519', 'slh-dsa-shake-192s']),
  diaria: Object.freeze(['ed25519', 'ml-dsa-65']),
});

/** Por qué se rechaza una firma: `motivo` es estable (las pruebas y la pantalla lo leen) y el mensaje lo explica. */
export class FirmaRechazada extends Error {
  /** @param {string} motivo @param {string} mensaje */
  constructor(motivo, mensaje) {
    super(mensaje);
    this.name = 'FirmaRechazada';
    this.motivo = motivo;
  }
}

/** El proveedor de un algoritmo admitido; una configuración ajena también se rechaza por contrato.
 * @param {string} id @returns {Algoritmo}
 */
function algoritmoDe(id) {
  const algoritmo = Object.hasOwn(ALGORITMOS, id) ? ALGORITMOS[id] : undefined;
  if (!algoritmo) {
    throw new FirmaRechazada('combinacion', `El algoritmo ${id} no es de ninguna combinación de Faro`);
  }
  return algoritmo;
}

/** La base del sistema hexadecimal. */
const BASE_HEXADECIMAL = 16;
/** Cifras hexadecimales de un byte. */
const CIFRAS_HEXADECIMALES_POR_BYTE = 2;

/**
 * Unos bytes en hexadecimal, en minúsculas, dos cifras por byte.
 * @param {Uint8Array} bytes @returns {string}
 */
function hexadecimal(bytes) {
  return Array.from(bytes, (byte) => byte.toString(BASE_HEXADECIMAL).padStart(CIFRAS_HEXADECIMALES_POR_BYTE, '0')).join(
    '',
  );
}

/**
 * La huella SHA-256 de unos bytes, en hexadecimal.
 * @param {Uint8Array} bytes @returns {string} 64 caracteres hexadecimales
 */
export function huella(bytes) {
  return hexadecimal(sha256(bytes));
}

/**
 * El id de una clave pública: la SHA-256 de sus bytes, en hexadecimal.
 * @param {Uint8Array} publica @returns {string} 64 caracteres hexadecimales
 */
export function idDeLaClave(publica) {
  return huella(publica);
}

/**
 * Base64 estricto a bytes (bytesDeBase64): cualquier otro carácter es un archivo mal formado, y se rechaza.
 * @param {unknown} codificado @returns {Uint8Array} los bytes descodificados
 * @throws {FirmaRechazada} de motivo `formato` si no es base64 estricto
 */
export function desdeBase64(codificado) {
  const bytes = bytesDeBase64(codificado);
  if (!bytes) {
    throw new FirmaRechazada('formato', 'La firma no está en base64');
  }
  return bytes;
}

/**
 * Lo que hay que comprobar de un sobre, leído y validado pero aún sin comprobar ninguna firma: tiene que ser del
 * `tipo` esperado y llevar exactamente una firma de cada algoritmo de la combinación, de la clave de confianza de ese
 * algoritmo y del tamaño de su algoritmo. Es la parte común a las dos implementaciones (comprobarSobre, con noble;
 * nativa.js, con Web Crypto): lo que se lee del sobre se decide una sola vez. Si algo falla, FirmaRechazada.
 * @param {unknown} sobre un `Sobre` leído de JSON, aún sin comprobar
 * @param {Esperado} esperado
 * @returns {{ bytes: Uint8Array, mensaje: Uint8Array, firmas: FirmaAComprobar[] }}
 * @throws {FirmaRechazada} con el motivo `tipo`, `formato`, `combinacion`, `clave-desconocida` o `firma-no-valida`
 */
export function firmasDelSobre(sobre, { tipo, combinacion, claves }) {
  const { tipo: tipoDelSobre, contenido, firmas } = camposDe(sobre);
  if (tipoDelSobre !== tipo) {
    throw new FirmaRechazada('tipo', `Se esperaba una firma de ${tipo}`);
  }
  if (!Array.isArray(firmas)) {
    throw new FirmaRechazada('formato', 'El sobre no trae firmas');
  }
  /** @type {readonly unknown[]} */
  const delSobre = firmas;
  const algoritmos = delSobre.map((firma) => camposDe(firma).algoritmo);
  const exactos = algoritmos.length === combinacion.length && combinacion.every((id) => algoritmos.includes(id));
  if (!exactos) {
    throw new FirmaRechazada('combinacion', `Hacen falta las firmas ${combinacion.join(' y ')}, y solo esas`);
  }
  const bytes = desdeBase64(contenido);
  const aComprobar = delSobre.map((entrada) => {
    const { algoritmo, clave, firma } = camposDe(entrada);
    const deConfianza = claves.find((publica) => publica.algoritmo === algoritmo && publica.id === clave);
    if (!deConfianza) {
      throw new FirmaRechazada('clave-desconocida', `La firma ${algoritmo} es de una clave desconocida`);
    }
    // El algoritmo de la clave de confianza es el de la firma: la búsqueda de arriba los ha igualado.
    const { bytesDeLaFirma, bytesDeLaClave } = algoritmoDe(deConfianza.algoritmo);
    const bytesDeFirma = desdeBase64(firma);
    if (bytesDeFirma.length !== bytesDeLaFirma || deConfianza.publica.length !== bytesDeLaClave) {
      throw new FirmaRechazada('firma-no-valida', `La firma ${algoritmo} no corresponde a lo firmado`);
    }
    return { algoritmo: deConfianza.algoritmo, firma: bytesDeFirma, publica: deConfianza.publica };
  });
  return { bytes, mensaje: mensajeAFirmar(tipo, bytes), firmas: aComprobar };
}

/**
 * Comprueba un sobre firmado con una combinación de algoritmos (firmasDelSobre) y que valen todas sus firmas, con
 * noble. Devuelve el contenido firmado; si algo falla, FirmaRechazada. También sirve para verificar los sobres de
 * respuestas MCP con las claves y el tipo correspondientes.
 * @param {unknown} sobre un `Sobre` leído de JSON, aún sin comprobar
 * @param {Esperado} esperado
 * @returns {Uint8Array}
 * @throws {FirmaRechazada} si el sobre no cumple lo esperado o alguna firma no vale
 */
export function comprobarSobre(sobre, esperado) {
  const { bytes, mensaje, firmas } = firmasDelSobre(sobre, esperado);
  for (const { algoritmo, firma, publica } of firmas) {
    if (!verificarConNoble(algoritmo, firma, mensaje, publica)) {
      throw new FirmaRechazada('firma-no-valida', `La firma ${algoritmo} no corresponde a lo firmado`);
    }
  }
  return bytes;
}

/**
 * Si la firma vale según noble; un error de la biblioteca es una firma que no vale. La firma y la clave ya tienen el
 * tamaño de su algoritmo (firmasDelSobre).
 * @param {string} algoritmo @param {Uint8Array} firma @param {Uint8Array} mensaje @param {Uint8Array} publica
 * @returns {boolean} true solo si la firma vale
 */
export function verificarConNoble(algoritmo, firma, mensaje, publica) {
  try {
    return algoritmoDe(algoritmo).verificar(firma, mensaje, publica) === true;
  } catch {
    return false;
  }
}

/**
 * Las claves públicas de un archivo ({ algoritmo, id, publica en base64 }), comprobadas: un algoritmo de la
 * combinación cada una, del tamaño de su algoritmo y con el id que les corresponde.
 * @param {unknown} lista @param {readonly string[]} combinacion @returns {ClavePublica[]}
 * @throws {FirmaRechazada} de motivo `formato` si una clave no vale, o `combinacion` si el algoritmo no se admite
 */
export function clavesPublicas(lista, combinacion) {
  if (!Array.isArray(lista) || lista.length !== combinacion.length) {
    throw new FirmaRechazada('formato', `Hacen falta las claves ${combinacion.join(' y ')}`);
  }
  /** @type {readonly unknown[]} */
  const candidatas = lista;
  return combinacion.map((algoritmo) => {
    const clave = camposDe(candidatas.find((candidata) => camposDe(candidata).algoritmo === algoritmo));
    const publica = desdeBase64(clave.publica);
    const id = idDeLaClave(publica);
    if (publica.length !== algoritmoDe(algoritmo).bytesDeLaClave || clave.id !== id) {
      throw new FirmaRechazada('formato', `La clave ${algoritmo} no es válida`);
    }
    return { algoritmo, id, publica };
  });
}
