// «Pasar a otro dispositivo»: el resultado compacto que viaja en el fragmento del enlace (#pasar=…), que el navegador
// no envía a ningún servidor. Lógica pura, sin DOM ni red: la usan el diálogo del QR (dialogo.js) y la página que lo
// recibe (recibir.js), y las pruebas (pruebas/web-recorrido-integral/transferencia.test.ts).
//
// Viaja solo lo que el informe necesita para rehacerse con el motor y el paquete de datos del otro dispositivo: el
// idioma, el grupo ISCO-08 (y el secundario), la ocupación ESCO por su código oficial, la fecha del informe y cada
// tarea oficial por su identificador de la OIT con el tiempo que le dedica la persona; y cuántas tareas contó con sus
// palabras sin tarea oficial, que no viajan. Nunca viaja texto escrito por la persona (ni el relato, ni sus tareas, ni
// la palabra con que nombró su ocupación) ni las notas: el otro dispositivo las lee de su propio paquete, así que un
// enlace manipulado no puede poner una nota que Faro no da.
//
// El formato es binario, en base64url: versión, banderas, campos de tamaño fijo y una suma CRC-16 al final que delata
// un código dañado. Con el máximo de tareas son unos 140 bytes (190 letras), para mantener pequeño el QR sin añadir
// compresión (CompressionStream). Leerlo es estricto: una versión, una bandera, un campo o un byte de más que no
// tocan, o una suma que no cuadra, y el código se rechaza entero.

import { aBase64Url, deBase64Url } from '../base64url.js';
import { MAX_TAREAS_INFORME as MAX_TAREAS } from '../protocolo-web.js';
import { diaUtc, MS_POR_DIA } from '../tiempo.js';

/** La versión del formato: un dispositivo solo lee la suya. */
const VERSION_DEL_FORMATO = 1;
/** El nombre del fragmento: #pasar=<código>. */
const CLAVE_DEL_FRAGMENTO = 'pasar';
/** El fragmento de una dirección con el código: `#pasar=<código>`. */
const FRAGMENTO = new RegExp(`^#${CLAVE_DEL_FRAGMENTO}=(.*)$`, 's');

/**
 * Las tareas de un informe como mucho: las mismas que admite el motor (MAX_TAREAS_INFORME, src/api/esquemas.ts).
 */
export { MAX_TAREAS_INFORME as MAX_TAREAS } from '../protocolo-web.js';
/** Las letras del código como mucho: el máximo que puede escribir este formato, con margen; más es un código ajeno. */
export const MAX_LETRAS_DEL_CODIGO = 400;
/** El tiempo que dedica la persona a cada tarea, en el orden en que viaja. */
export const TIEMPOS = Object.freeze(/** @type {const} */ (['mucho', 'algo', 'poco']));
/**
 * El primer día admitido para la fecha de un resultado recibido. También se rechaza una fecha posterior a mañana
 * (un día de margen por los husos horarios); estos límites no acreditan quién hizo el código.
 */
export const PRIMER_DIA_DEL_FORMATO = '2026-10-01';
/** Los idiomas del informe que caben en el formato: una bandera dice si es catalán. */
const IDIOMAS = Object.freeze(/** @type {const} */ (['es', 'ca']));
/** El año del día 0 de la fecha que viaja. */
const ANIO_DEL_DIA_CERO = 2020;
/** El día 0 de la fecha que viaja (días desde entonces, en 16 bits: hasta 2199). */
const DIA_CERO = Date.UTC(ANIO_DEL_DIA_CERO, 0, 1);
/** El mayor número de 16 bits: tope de los días de la fecha y semilla del CRC-16. */
const MAXIMO_DE_16_BITS = 0xffff;
/** Cifras de un gran grupo ISCO-08 y su tope numérico. */
const CIFRAS_DEL_GRUPO = 4;
const MAX_GRUPO = 9999;
/** El tope de cada parte de una ocupación ESCO tras las cifras del grupo. */
const MAX_PARTE_ESCO = 999;
/** El tope del número de una tarea dentro de su grupo. */
const MAX_NUMERO_DE_TAREA = 99;
/** Un código tiene, como poco, un byte de cuerpo y los dos de la suma de comprobación. */
const BYTES_MINIMOS_DEL_CODIGO = 3;
/** Bits de un byte. */
const BITS_POR_BYTE = 8;
/** Un bit del byte de banderas por cada dato opcional del resultado. */
const BANDERA = Object.freeze({ catalan: 1, esco: 2, secundario: 4, propuestoPorIa: 8, sinIa: 16 });
/** La suma de todos los bits de BANDERA: un bit fuera de ella es de otra versión. */
const BANDERAS_CONOCIDAS = Object.values(BANDERA).reduce((todas, bit) => todas | bit, 0);
/** Las partes de una ocupación ESCO tras sus cuatro cifras («4226.1.1» tiene dos), como mucho. */
const MAX_PARTES_ESCO = 4;

/**
 * El resultado que viaja.
 * @typedef {{ tareaOit: string, tiempo: 'mucho' | 'algo' | 'poco' }} TareaQueViaja
 * @typedef {{ idioma: 'es' | 'ca', isco08: string, ocupacionEsco?: string, isco08Secundario?: string,
 *   grupoPropuestoPorIa?: boolean, sinIa?: boolean, fecha: string, tareas: TareaQueViaja[], sinViajar: number }}
 *   Resultado
 */

/**
 * Un código que no se puede leer: dañado, manipulado o de otra versión. El mensaje es para quien depura, no para la
 * persona.
 */
export class CodigoNoValido extends Error {}

/** Escribe bytes y números de 16 bits en orden. */
class Escritor {
  /** @type {number[]} */
  bytes = [];
  /** @param {number} valor */
  byte(valor) {
    this.bytes.push(valor & 0xff);
  }
  /** @param {number} valor */
  doble(valor) {
    this.byte(valor >> 8);
    this.byte(valor);
  }
}

/** Lee bytes y números de 16 bits en orden; rechaza leer más allá del final. */
class Lector {
  posicion = 0;
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.datos = bytes;
  }
  byte() {
    if (this.posicion >= this.datos.length) {
      rechazar('código cortado');
    }
    // El límite anterior asegura que este byte existe.
    return /** @type {number} */ (this.datos[this.posicion++]);
  }
  doble() {
    return (this.byte() << 8) | this.byte();
  }
  /** Un número entre `min` y `max`, o el rechazo. @param {number} valor @param {number} min @param {number} max */
  entre(valor, min, max) {
    if (valor < min || valor > max) {
      rechazar(`valor ${valor} fuera de [${min}, ${max}]`);
    }
    return valor;
  }
}

/**
 * Rechaza el código con su motivo. Declarada como función, no como flecha: así TypeScript sabe que tras `rechazar` el
 * código no sigue (strictNullChecks).
 * @param {string} motivo @returns {never}
 */
function rechazar(motivo) {
  throw new CodigoNoValido(motivo);
}

/** Los bytes de un código en base64url; rechaza lo que no lo es. @param {string} codigo @returns {Uint8Array} */
function bytesDelCodigo(codigo) {
  return (codigo && deBase64Url(codigo)) || rechazar('no es base64url');
}

/** Un grupo ISCO-08 de 4 cifras como número; rechaza lo demás. @param {string} grupo @returns {number} */
function grupoANumero(grupo) {
  if (!/^\d{4}$/.test(grupo)) {
    rechazar(`grupo «${grupo}»`);
  }
  return Number(grupo);
}

/** Un grupo ISCO-08 leído como número, otra vez con sus 4 cifras. @param {number} numero */
function numeroAGrupo(numero) {
  return String(numero).padStart(CIFRAS_DEL_GRUPO, '0');
}

/** La fecha AAAA-MM-DD a `dias` del día 0. @param {number} dias */
function diasAFecha(dias) {
  return diaUtc(DIA_CERO + dias * MS_POR_DIA);
}

/**
 * Los días de una fecha desde el día 0; rechaza la que no existe o no cabe.
 * @param {string} fecha AAAA-MM-DD @returns {number}
 */
function fechaADias(fecha) {
  const ms = Date.parse(`${fecha}T00:00:00Z`);
  const dias = (ms - DIA_CERO) / MS_POR_DIA;
  // Un día que no existe («2026-02-30») no vuelve igual: Date lo pasa al mes siguiente.
  const real = Number.isInteger(dias) && dias >= 0 && dias <= MAXIMO_DE_16_BITS && diasAFecha(dias) === fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !real) {
    rechazar(`fecha «${fecha}»`);
  }
  return dias;
}

/** La ocupación ESCO («4226.1.1»): sus cuatro cifras y de 1 a 4 partes de hasta 3 cifras. @param {string} codigo */
function partesEsco(codigo) {
  if (!/^\d{4}(\.\d{1,3}){1,4}$/.test(codigo)) {
    rechazar(`ocupación ESCO «${codigo}»`);
  }
  const [grupo, ...partes] = codigo.split('.');
  // Un cero a la izquierda («4226.01») no se podría devolver igual: no es un código ESCO.
  if (partes.some((parte) => parte !== String(Number(parte)))) {
    rechazar(`ocupación ESCO «${codigo}»`);
  }
  return { grupo: Number(grupo), partes: partes.map(Number) };
}

/** Una tarea oficial de la OIT («4226-3»): su grupo y su número (1 a 99). @param {string} id */
function partesTarea(id) {
  const encaja = /^(\d{4})-([1-9]\d?)$/.exec(id);
  if (!encaja) {
    rechazar(`tarea «${id}»`);
  }
  return { grupo: Number(encaja[1]), numero: Number(encaja[2]) };
}

/** El byte de banderas de un resultado. @param {Resultado} resultado */
function banderasDe(resultado) {
  let banderas = resultado.idioma === 'ca' ? BANDERA.catalan : 0;
  if (resultado.ocupacionEsco) {
    banderas |= BANDERA.esco;
  }
  if (resultado.isco08Secundario) {
    banderas |= BANDERA.secundario;
  }
  if (resultado.grupoPropuestoPorIa) {
    banderas |= BANDERA.propuestoPorIa;
  }
  if (resultado.sinIa) {
    banderas |= BANDERA.sinIa;
  }
  return banderas;
}

/** Emisor y receptor deben aceptar las mismas combinaciones de campos. @param {Resultado} resultado */
function comprobarCoherencia(resultado) {
  if (resultado.isco08Secundario === resultado.isco08) {
    rechazar('el mismo grupo dos veces');
  }
  if (!resultado.tareas.length && !(resultado.sinViajar ?? 0)) {
    rechazar('sin tareas');
  }
}

/** Lo que el formato no puede escribir: otro idioma, demasiadas tareas o una repetida. @param {Resultado} resultado */
function comprobarAntesDeCodificar(resultado) {
  if (!IDIOMAS.includes(resultado.idioma)) {
    rechazar(`idioma «${resultado.idioma}»`);
  }
  if (resultado.tareas.length > MAX_TAREAS) {
    rechazar('demasiadas tareas');
  }
  if (new Set(resultado.tareas.map((tarea) => tarea.tareaOit)).size !== resultado.tareas.length) {
    rechazar('repetida');
  }
  const sinViajar = resultado.sinViajar ?? 0;
  if (!Number.isInteger(sinViajar) || sinViajar < 0 || sinViajar + resultado.tareas.length > MAX_TAREAS) {
    rechazar('tareas sin viajar');
  }
  comprobarCoherencia(resultado);
}

/** Los bytes del código, con la suma comprobada y sin ella. @param {string} codigo @returns {Uint8Array} */
function bytesComprobados(codigo) {
  if (typeof codigo !== 'string' || !codigo || codigo.length > MAX_LETRAS_DEL_CODIGO) {
    rechazar('longitud');
  }
  const bytes = bytesDelCodigo(codigo);
  if (bytes.length < BYTES_MINIMOS_DEL_CODIGO) {
    rechazar('código cortado');
  }
  const cuerpo = bytes.subarray(0, -2);
  // Con 3 bytes o más, los dos últimos existen: se leen por su índice, que no puede quedar fuera.
  const alto = /** @type {number} */ (bytes[bytes.length - 2]);
  const bajo = /** @type {number} */ (bytes[bytes.length - 1]);
  if (crc16(cuerpo) !== ((alto << 8) | bajo)) {
    rechazar('la suma no cuadra');
  }
  return cuerpo;
}

/** La ocupación ESCO que viaja, ya leída. @param {Lector} lector */
function leerEsco(lector) {
  const grupo = lector.entre(lector.doble(), 0, MAX_GRUPO);
  const cuantas = lector.entre(lector.byte(), 1, MAX_PARTES_ESCO);
  const partes = Array.from({ length: cuantas }, () => lector.entre(lector.doble(), 0, MAX_PARTE_ESCO));
  return [numeroAGrupo(grupo), ...partes].join('.');
}

/** Las tareas que viajan, ya leídas. @param {Lector} lector @returns {TareaQueViaja[]} */
function leerTareas(lector) {
  const cuantas = lector.entre(lector.byte(), 0, MAX_TAREAS);
  const tareas = Array.from({ length: cuantas }, () => {
    const grupo = numeroAGrupo(lector.entre(lector.doble(), 0, MAX_GRUPO));
    const numero = lector.entre(lector.byte(), 1, MAX_NUMERO_DE_TAREA);
    // entre limita el índice a los tres tiempos que existen.
    const tiempo = /** @type {TareaQueViaja['tiempo']} */ (TIEMPOS[lector.entre(lector.byte(), 0, TIEMPOS.length - 1)]);
    return { tareaOit: `${grupo}-${numero}`, tiempo };
  });
  if (new Set(tareas.map((tarea) => tarea.tareaOit)).size !== tareas.length) {
    rechazar('tarea repetida');
  }
  return tareas;
}

/** El polinomio de CRC-16/CCITT-FALSE y su bit alto, el que decide si el desplazamiento lleva la resta. */
const POLINOMIO_CRC16 = 0x1021;
const BIT_ALTO_DEL_CRC = 0x8000;

/** CRC-16/CCITT-FALSE de unos bytes. @param {Uint8Array} bytes @returns {number} */
export function crc16(bytes) {
  let crc = MAXIMO_DE_16_BITS;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < BITS_POR_BYTE; bit++) {
      const desplazado = (crc << 1) & MAXIMO_DE_16_BITS;
      crc = crc & BIT_ALTO_DEL_CRC ? desplazado ^ POLINOMIO_CRC16 : desplazado;
    }
  }
  return crc;
}

/**
 * El código del resultado, en base64url. Lanza CodigoNoValido si el resultado no cabe en el formato (un dato con otra
 * forma, más tareas de las que admite el motor o una tarea repetida): mejor no ofrecer el QR que ofrecer uno que el
 * otro dispositivo rechazaría.
 * @param {Resultado} resultado @returns {string}
 */
export function codificar(resultado) {
  comprobarAntesDeCodificar(resultado);
  const sinViajar = resultado.sinViajar ?? 0;
  const escritor = new Escritor();
  escritor.byte(VERSION_DEL_FORMATO);
  escritor.byte(banderasDe(resultado));
  escritor.doble(grupoANumero(resultado.isco08));
  escritor.doble(fechaADias(resultado.fecha));
  if (resultado.ocupacionEsco) {
    const { grupo, partes } = partesEsco(resultado.ocupacionEsco);
    escritor.doble(grupo);
    escritor.byte(partes.length);
    for (const parte of partes) {
      escritor.doble(parte);
    }
  }
  if (resultado.isco08Secundario) {
    escritor.doble(grupoANumero(resultado.isco08Secundario));
  }
  escritor.byte(resultado.tareas.length);
  for (const { tareaOit, tiempo } of resultado.tareas) {
    const { grupo, numero } = partesTarea(tareaOit);
    if (!TIEMPOS.includes(tiempo)) {
      rechazar(`tiempo «${tiempo}»`);
    }
    escritor.doble(grupo);
    escritor.byte(numero);
    escritor.byte(TIEMPOS.indexOf(tiempo));
  }
  escritor.byte(sinViajar);
  escritor.doble(crc16(Uint8Array.from(escritor.bytes)));
  return aBase64Url(Uint8Array.from(escritor.bytes));
}

/**
 * El resultado de un código, comprobado entero: la versión, cada bandera, cada campo dentro de sus límites, nada de
 * más y la suma. Lanza CodigoNoValido si algo no cuadra. Que los grupos, la ocupación y las tareas existan lo comprueba
 * quien lo recibe con su paquete de datos (recibir.js).
 * @param {string} codigo @returns {Resultado}
 */
export function decodificar(codigo) {
  const lector = new Lector(bytesComprobados(codigo));
  if (lector.byte() !== VERSION_DEL_FORMATO) {
    rechazar('otra versión');
  }
  const banderas = lector.byte();
  if (banderas & ~BANDERAS_CONOCIDAS) {
    rechazar('bandera desconocida');
  }
  /** @type {Resultado} */
  const resultado = {
    idioma: banderas & BANDERA.catalan ? 'ca' : 'es',
    isco08: numeroAGrupo(lector.entre(lector.doble(), 0, MAX_GRUPO)),
    fecha: diasAFecha(lector.doble()),
    tareas: [],
    sinViajar: 0,
  };
  if (banderas & BANDERA.esco) {
    resultado.ocupacionEsco = leerEsco(lector);
  }
  if (banderas & BANDERA.secundario) {
    resultado.isco08Secundario = numeroAGrupo(lector.entre(lector.doble(), 0, MAX_GRUPO));
  }
  if (banderas & BANDERA.propuestoPorIa) {
    resultado.grupoPropuestoPorIa = true;
  }
  if (banderas & BANDERA.sinIa) {
    resultado.sinIa = true;
  }
  resultado.tareas = leerTareas(lector);
  resultado.sinViajar = lector.entre(lector.byte(), 0, MAX_TAREAS - resultado.tareas.length);
  if (lector.posicion !== lector.datos.length) {
    rechazar('bytes de más');
  }
  comprobarCoherencia(resultado);
  return resultado;
}

/**
 * Comprueba que la fecha de un resultado leído es creíble frente a `ahora`: el formato admite de 2020 a 2199, pero el
 * informe rehecho solo admite desde PRIMER_DIA_DEL_FORMATO hasta mañana. Lanza CodigoNoValido fuera de ese intervalo.
 * Las marcas de IA (grupo propuesto por la IA, hecho sin IA) no se pueden comprobar en el receptor: viajan como las
 * puso el dispositivo de origen y el informe rehecho las repite.
 * @param {Resultado} resultado @param {Date} [ahora]
 */
export function comprobarFecha(resultado, ahora = new Date()) {
  const manana = diaUtc(ahora.getTime() + MS_POR_DIA);
  if (resultado.fecha < PRIMER_DIA_DEL_FORMATO || resultado.fecha > manana) {
    rechazar(`fecha «${resultado.fecha}»`);
  }
}

/**
 * El código del fragmento de una dirección (#pasar=<código>), o null si no lo lleva.
 * @param {string} fragmento @returns {string | null}
 */
export function codigoDelFragmento(fragmento) {
  const encaja = FRAGMENTO.exec(fragmento);
  return encaja ? /** @type {string} */ (encaja[1]) : null;
}

/**
 * El enlace que abre el resultado en otro dispositivo: el recorrido con el código en el fragmento.
 * @param {string} base la dirección de una página de Faro @param {string} codigo @returns {string}
 */
export function enlaceConCodigo(base, codigo) {
  const enlace = new URL('recorrido.html', base);
  enlace.hash = `${CLAVE_DEL_FRAGMENTO}=${codigo}`;
  return enlace.href;
}
