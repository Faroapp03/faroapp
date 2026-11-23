// La comprobación, en el dispositivo y antes de usar nada, del manifiesto firmado de lo que utiliza el motor local: el
// motor compilado y el paquete de datos. Lo usa el Worker del motor (motor-local/worker.js); la construcción
// puede incorporar su firma cuando disponga de las claves correspondientes.
// - La cadena es raíz → clave diaria → declaración: la raíz (Ed25519 + SLH-DSA, guardada sin conexión) certifica la
//   clave diaria (Ed25519 + ML-DSA), y la clave diaria firma la declaración del manifiesto (su tamaño, su SHA-256, la
//   versión del paquete y hasta cuándo vale). Las firmas son híbridas (firmas.js): valen las dos o no vale ninguna.
// - Se comprueban los bytes tal como llegan y solo después se leen como JSON: lo que se usa es lo que se firmó.
// - Un manifiesto viejo no pasa: la declaración nombra la versión del paquete que espera la web (la del service
//   worker) y caduca; uno de otra versión o caducado se rechaza aunque su firma fuera buena.
// - Las fechas van en orden: inicio del certificado ≤ firmada ≤ ahora, firmada < caduca ≤ fin del certificado. La
//   fecha es la del dispositivo: con el reloj adelantado se rechaza uno vigente, y se dice por qué.

import { camposDe } from '../json.js';
import { MS_POR_SEGUNDO } from '../tiempo.js';
import { CLAVES_DIARIAS_RETIRADAS, CLAVES_RAIZ } from './claves-raiz.js';
import { COMBINACIONES, clavesPublicas, FirmaRechazada, huella, TIPOS } from './firmas.js';

/** La versión del formato del manifiesto y de su firma que sabe leer el dispositivo. */
export const FORMATO_DEL_MANIFIESTO = 1;

/** Minutos que puede ir atrasado el reloj sin rechazar una firma recién hecha (solo para «aún no vale»). */
const MINUTOS_DE_TOLERANCIA = 5;
/** Segundos en un minuto. */
const SEGUNDOS_POR_MINUTO = 60;
/** Cuánto puede ir atrasado el reloj sin rechazar una firma recién hecha (solo para «aún no vale»), en ms. */
export const TOLERANCIA_DEL_RELOJ_MS = MINUTOS_DE_TOLERANCIA * SEGUNDOS_POR_MINUTO * MS_POR_SEGUNDO;

/** Una huella SHA-256 en hexadecimal, entera. */
const HUELLA = /^[0-9a-f]{64}$/;
/**
 * Una ruta de la web, relativa a su raíz, sin subir de carpeta ni salir de ella: las carpetas no llevan puntos y el
 * último segmento no puede ser «.» ni «..».
 */
const RUTA = /^(?:[a-z0-9_-]+\/)*(?!\.{1,2}$)[a-zA-Z0-9_.-]+$/;

/** UTF-8 estricto: unos bytes que no lo son lanzan en vez de sustituirse por «�». */
const LECTOR_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * JSON de unos bytes firmados, aún sin comprobar su forma; si no lo es, el archivo está mal formado.
 * @param {Uint8Array} bytes @param {string} que @returns {unknown}
 */
function leerJson(bytes, que) {
  try {
    return JSON.parse(LECTOR_UTF8.decode(bytes));
  } catch {
    throw new FirmaRechazada('formato', `${que} no es un JSON válido`);
  }
}

/**
 * Una fecha ISO de un campo firmado, en milisegundos.
 * @param {unknown} valor
 * @param {string} campo El nombre del campo, para el mensaje.
 * @returns {number}
 * @throws {FirmaRechazada} Si no es una fecha que `Date.parse` entienda.
 */
function fecha(valor, campo) {
  const milisegundos = typeof valor === 'string' ? Date.parse(valor) : Number.NaN;
  if (!Number.isFinite(milisegundos)) {
    throw new FirmaRechazada('formato', `Falta la fecha «${campo}»`);
  }
  return milisegundos;
}

/**
 * Comprueba un intervalo firmado contra `ahora`; devuelve sus extremos en milisegundos.
 * @param {unknown} desdeIso El inicio de la vigencia, como lo trae el sobre.
 * @param {unknown} hastaIso Su caducidad, como la trae el sobre.
 * @param {number} ahora En milisegundos.
 * @param {string} que Qué se comprueba, para los mensajes.
 * @returns {{ desde: number, hasta: number }}
 * @throws {FirmaRechazada} Si una fecha no vale, el intervalo está al revés, aún no vale o ya caducó.
 */
function vigencia(desdeIso, hastaIso, ahora, que) {
  const desde = fecha(desdeIso, `${que}: desde`);
  const hasta = fecha(hastaIso, `${que}: caduca`);
  if (desde >= hasta) {
    throw new FirmaRechazada('formato', `${que} caduca antes de empezar a valer`);
  }
  if (desde > ahora + TOLERANCIA_DEL_RELOJ_MS) {
    throw new FirmaRechazada('fuera-de-vigencia', `${que} aún no vale`);
  }
  if (ahora >= hasta) {
    throw new FirmaRechazada('caducada', `${que} caducó el ${hastaIso}`);
  }
  return { desde, hasta };
}

/**
 * Rutas de la web y huellas SHA-256 comprobadas. Devuelve un Map con contrato ReadonlyMap; no bloquea mutaciones en JS.
 * @param {unknown} archivos @returns {ReadonlyMap<string, string>}
 */
function archivosDe(archivos) {
  if (!archivos || typeof archivos !== 'object' || Array.isArray(archivos)) {
    throw new FirmaRechazada('formato', 'El manifiesto no trae archivos');
  }
  /** @type {Map<string, string>} */
  const mapa = new Map();
  for (const [ruta, sha256] of Object.entries(archivos)) {
    if (!RUTA.test(ruta) || typeof sha256 !== 'string' || !HUELLA.test(sha256)) {
      throw new FirmaRechazada('formato', `Entrada no válida en el manifiesto: ${ruta}`);
    }
    mapa.set(ruta, sha256);
  }
  return mapa;
}

/**
 * La declaración firmada: su formato, su vigencia dentro de la de la clave diaria, su paquete y la huella del
 * manifiesto que nombra.
 * @param {unknown} declaracion
 * @param {{ bytes: Uint8Array, paquete: string, diaria: { desde: number, hasta: number }, ahora: number }} contexto
 */
function comprobarDeclaracion(declaracion, { bytes, paquete, diaria, ahora }) {
  const firmada = camposDe(declaracion);
  if (firmada.formato !== FORMATO_DEL_MANIFIESTO) {
    throw new FirmaRechazada('formato', 'Declaración desconocida');
  }
  const plazo = vigencia(firmada.firmada, firmada.caduca, ahora, 'La firma del manifiesto');
  if (plazo.desde < diaria.desde || plazo.hasta > diaria.hasta) {
    throw new FirmaRechazada('fuera-de-vigencia', 'El manifiesto se firmó fuera de la vigencia de la clave diaria');
  }
  if (firmada.paquete !== paquete) {
    throw new FirmaRechazada('otra-version', `El manifiesto es del paquete ${firmada.paquete}, no del ${paquete}`);
  }
  const nombrado = camposDe(firmada.manifiesto);
  if (bytes.length !== nombrado.bytes || huella(bytes) !== nombrado.sha256) {
    throw new FirmaRechazada('alterado', 'El manifiesto no es el que se firmó');
  }
}

/**
 * Las claves diarias que certifica la raíz, con su vigencia, leídas del contenido ya comprobado del certificado: tiene
 * que estar vigente en `ahora` y ninguna de sus claves, retirada. La cadena del manifiesto las usa para comprobar
 * la firma de su declaración. Si algo no cuadra, FirmaRechazada.
 * @param {Uint8Array} bytes @param {number} ahora en milisegundos @param {readonly string[]} retiradas sus ids
 * @returns {{ claves: import('./firmas.js').ClavePublica[], desde: number, hasta: number }} sus claves públicas y su
 *   vigencia, en milisegundos
 * @throws {FirmaRechazada} Si el certificado no tiene el formato, no está vigente o una de sus claves está retirada.
 */
export function claveDiaria(bytes, ahora, retiradas) {
  const certificado = camposDe(leerJson(bytes, 'El certificado'));
  if (certificado.formato !== FORMATO_DEL_MANIFIESTO) {
    throw new FirmaRechazada('formato', 'Certificado desconocido');
  }
  const plazo = vigencia(certificado.valida_desde, certificado.caduca, ahora, 'La clave diaria');
  const claves = clavesPublicas(certificado.claves, COMBINACIONES.diaria);
  if (claves.some(({ id }) => retiradas.includes(id))) {
    throw new FirmaRechazada('retirada', 'La clave diaria de esta firma está retirada');
  }
  return { claves, ...plazo };
}

/**
 * Lo que nombra el manifiesto, leído de sus bytes y comprobado de forma: su formato, la versión del paquete (si se da
 * `paquete`, tiene que ser esa) y sus archivos, rutas de la web con su SHA-256 entera. No comprueba ninguna firma: la
 * cadena lo lee con los bytes ya firmados, y «Faro verificable» (verificable/comprobacion.js) también sin raíz, para
 * comparar las huellas sin afirmar nada de quién publicó el manifiesto. Si algo no cuadra, FirmaRechazada.
 * @param {Uint8Array} bytes los del manifiesto, tal como han llegado
 * @param {string} [paquete] la versión del paquete que se espera; sin ella, la que nombre el manifiesto
 * @returns {{ paquete: string, archivos: ReadonlyMap<string, string> }}
 * @throws {FirmaRechazada} Si no es JSON, es de otro formato o de otro paquete, o una entrada no es válida.
 */
export function leerManifiesto(bytes, paquete) {
  const manifiesto = camposDe(leerJson(bytes, 'El manifiesto'));
  const nombrado = manifiesto.paquete;
  const esperado = paquete ?? nombrado;
  if (manifiesto.formato !== FORMATO_DEL_MANIFIESTO || typeof nombrado !== 'string' || nombrado !== esperado) {
    throw new FirmaRechazada('otra-version', 'El manifiesto no es de este paquete');
  }
  return { paquete: nombrado, archivos: archivosDe(manifiesto.archivos) };
}

/**
 * @typedef {{ paquete: string, raices?: readonly Readonly<{ algoritmo: string, id: string, publica: string }>[],
 *   retiradas?: readonly string[], ahora?: Date }} OpcionesDelManifiesto `paquete`, la versión del paquete que espera
 *   esta web; lo demás, por omisión, las claves de la web y la fecha del dispositivo
 * @typedef {{ sobre: unknown, esperado: import('./firmas.js').Esperado }} SobreAComprobar un sobre de la cadena y lo
 *   que debe cumplir; quien recorre la cadena lo comprueba y devuelve su contenido
 */

/**
 * Lo que vale por omisión en OpcionesDelManifiesto: la raíz y las retiradas de esta web y la fecha del dispositivo.
 * @returns {Omit<Required<OpcionesDelManifiesto>, 'paquete'>}
 */
export function OPCIONES_DEL_MANIFIESTO() {
  return {
    raices: CLAVES_RAIZ,
    retiradas: CLAVES_DIARIAS_RETIRADAS,
    ahora: new Date(),
  };
}

/**
 * La cadena de comprobación del manifiesto, paso a paso: pide comprobar el certificado y luego la declaración (cada
 * `yield` es un sobre con lo que debe cumplir, y recibe su contenido ya comprobado) y, entre medias y al final, hace
 * todo lo que no es comprobar una firma. La comprobación en nativa.js usa esta cadena para la firma nativa o noble.
 * Si algo no cuadra, FirmaRechazada con su `motivo`:
 * formato, sin-raiz, tipo, combinacion, clave-desconocida, retirada, firma-no-valida, caducada, fuera-de-vigencia,
 * otra-version o alterado.
 * @param {Uint8Array} bytes los del manifiesto, tal como han llegado
 * @param {unknown} firma su firma, ya leída como JSON
 * @param {Required<OpcionesDelManifiesto>} esperado
 * @returns {Generator<SobreAComprobar, ReadonlyMap<string, string>, Uint8Array>}
 * @throws {FirmaRechazada} Si un paso de la cadena no cuadra, con su `motivo`.
 */
export function* cadenaDelManifiesto(bytes, firma, { paquete, raices, retiradas, ahora }) {
  const { formato, certificado, declaracion } = camposDe(firma);
  if (formato !== FORMATO_DEL_MANIFIESTO) {
    throw new FirmaRechazada('formato', 'Formato de la firma desconocido');
  }
  const momento = ahora.getTime();
  if (!Number.isFinite(momento)) {
    throw new FirmaRechazada('formato', 'La fecha del dispositivo no es válida');
  }
  const raiz = raices.length === 0 ? [] : clavesPublicas(raices, COMBINACIONES.raiz);
  if (!raiz.length) {
    throw new FirmaRechazada('sin-raiz', 'Esta copia de Faro no lleva las claves de la raíz');
  }
  const bytesDelCertificado = yield {
    sobre: certificado,
    esperado: { tipo: TIPOS.certificado, combinacion: COMBINACIONES.raiz, claves: raiz },
  };
  const diaria = claveDiaria(bytesDelCertificado, momento, retiradas);
  const bytesDeLaDeclaracion = yield {
    sobre: declaracion,
    esperado: { tipo: TIPOS.manifiesto, combinacion: COMBINACIONES.diaria, claves: diaria.claves },
  };
  comprobarDeclaracion(leerJson(bytesDeLaDeclaracion, 'La declaración'), { bytes, paquete, diaria, ahora: momento });
  return leerManifiesto(bytes, paquete).archivos;
}

/**
 * Comprueba que unos bytes son los que nombra el manifiesto para `ruta`; una ruta que no está en él no se usa.
 * @param {ReadonlyMap<string, string>} archivos @param {string} ruta @param {Uint8Array} bytes
 * @returns {void}
 * @throws {FirmaRechazada} Con motivo «alterado», si la ruta no está en el manifiesto o los bytes no son los firmados.
 */
export function cuadraConElManifiesto(archivos, ruta, bytes) {
  const esperada = archivos.get(ruta);
  if (!esperada) {
    throw new FirmaRechazada('alterado', `${ruta} no está en el manifiesto firmado`);
  }
  if (huella(bytes) !== esperada) {
    throw new FirmaRechazada('alterado', `${ruta} no es el que se firmó`);
  }
}
