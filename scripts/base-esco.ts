// Etapa «Base ESCO local» de la verificación: la base ESCO preparada en esta instalación tiene la huella que fija la
// entrega de datos, y su validación registra esa base y la captura de las huellas versionadas. Solo lee: no prepara,
// no repara ni escribe nada.

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';

/** La base ESCO local, relativa a la raíz de la instalación (fuera de Git: `var/` no se versiona). */
export const BASE_ESCO = 'var/actualizacion/validados/esco/biblioteca-esco.sqlite';
/** El informe que escribe `lector validar` junto a la base (`INFORME` en `piezas/constantes_esco.py`). */
export const VALIDACION_ESCO = 'var/actualizacion/validados/esco/validacion.json';
/** La captura oficial de la que se prepara la base (`ARCHIVO` en `piezas/constantes_esco.py`). */
export const CAPTURA_ESCO = 'var/actualizacion/originales/esco/biblioteca-api.zip';
/** Las huellas versionadas de la captura, en el formato de `shasum -a 256 -c`. */
export const HUELLAS_DE_LA_CAPTURA = 'plataforma_datos/ocupaciones/fuentes/esco/captura.sha256';
/** El manifiesto de la entrega de datos, relativo a la raíz. */
export const MANIFIESTO = 'datos/manifiesto.json';
/** La entrada del manifiesto que declara la base ESCO entre sus orígenes. */
const ENTRADA = 'esco.json';
const NOMBRE = 'Base ESCO local';
const INSTRUCCIONES = 'como indica README.md, «Base ESCO para la verificación»';
const PREPARAR = `Prepárala desde la captura ESCO comprobada, ${INSTRUCCIONES}.`;
const VALIDAR = `Vuelve a preparar y validar la base desde la captura ESCO comprobada, ${INSTRUCCIONES}.`;
const RECUPERAR = 'Recupera ese archivo de la versión instalada.';
const RELANZAR = 'vuelve a lanzar la verificación.';
const HUELLA_SHA256 = /^[0-9a-f]{64}$/;
/** Una línea de `shasum -a 256 -c`: la huella, un espacio, la marca de modo (espacio o «*») y la ruta. */
const LINEA_DE_HUELLA = /^([0-9a-f]{64}) [ *](.+)$/;
const CIFRAS_ABREVIADAS = 12;

const abreviar = (huella: string): string => `${huella.slice(0, CIFRAS_ABREVIADAS)}…`;
const fallo = (mensaje: string, causa?: unknown): FalloDeComprobacion =>
  new FalloDeComprobacion(`${NOMBRE}: ${mensaje}`, causa === undefined ? {} : { cause: causa });

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function codigoDeError(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

/** El código del sistema entre paréntesis, tras un espacio, o nada si el error no trae ninguno. */
function conCodigo(error: unknown): string {
  const codigo = codigoDeError(error);
  return codigo === undefined ? '' : ` (${codigo})`;
}

/**
 * La huella de la base ESCO que fija la entrega de datos.
 *
 * @param raiz - Raíz de la instalación.
 * @returns La huella sha256 en hexadecimal.
 * @throws {FalloDeComprobacion} Si el manifiesto no se puede leer o no fija esa huella.
 */
export function huellaFijada(raiz: string): string {
  let manifiesto: unknown;
  try {
    manifiesto = JSON.parse(readFileSync(join(raiz, MANIFIESTO), 'utf8'));
  } catch (error) {
    throw fallo(`no se puede leer ${MANIFIESTO}. ${RECUPERAR}`, error);
  }
  const entrada = esObjeto(manifiesto) ? manifiesto[ENTRADA] : undefined;
  const origenes = esObjeto(entrada) ? entrada.origenes : undefined;
  const huella = esObjeto(origenes) ? origenes[BASE_ESCO] : undefined;
  if (typeof huella !== 'string' || !HUELLA_SHA256.test(huella)) {
    throw fallo(`${MANIFIESTO} no fija la huella de ${BASE_ESCO} en «${ENTRADA}». ${RECUPERAR}`);
  }
  return huella;
}

/**
 * La huella de la captura ESCO que fija `captura.sha256`.
 *
 * @param raiz - Raíz de la instalación.
 * @returns La huella sha256 de `biblioteca-api.zip`.
 * @throws {FalloDeComprobacion} Si el archivo no se puede leer o no fija esa huella exactamente una vez.
 */
export function huellaDeLaCaptura(raiz: string): string {
  let texto: string;
  try {
    texto = readFileSync(join(raiz, HUELLAS_DE_LA_CAPTURA), 'utf8');
  } catch (error) {
    throw fallo(`no se puede leer ${HUELLAS_DE_LA_CAPTURA}. ${RECUPERAR}`, error);
  }
  const huellas = texto.split('\n').flatMap((linea) => {
    const partes = LINEA_DE_HUELLA.exec(linea);
    return partes?.[1] && partes[2] === CAPTURA_ESCO ? [partes[1]] : [];
  });
  const [huella] = huellas;
  if (huellas.length !== 1 || huella === undefined) {
    throw fallo(`${HUELLAS_DE_LA_CAPTURA} no fija una única huella para ${CAPTURA_ESCO}. ${RECUPERAR}`);
  }
  return huella;
}

/** Un archivo de la etapa que se alcanza por un enlace: dice dónde está de verdad, dentro o fuera de la instalación. */
function falloDeLaRuta(relativa: string, queHacer: string, raizReal: string, real: string): FalloDeComprobacion {
  const desdeLaRaiz = relative(raizReal, real);
  const fuera = desdeLaRaiz === '..' || desdeLaRaiz.startsWith(`..${sep}`) || isAbsolute(desdeLaRaiz);
  const lugar = fuera
    ? 'fuera de esta instalación'
    : `en ${desdeLaRaiz.split(sep).join('/')}, otra ruta de esta instalación`;
  return fallo(
    `${relativa} se alcanza por un enlace y el archivo está ${lugar}. Tiene que ser un archivo propio en esa misma ruta: retira el enlace. ${queHacer}`,
  );
}

/** Comprueba lo abierto: un archivo regular con un solo nombre, en su ruta propia y el mismo que hay en esa ruta. */
function exigirPropio(descriptor: number, raiz: string, relativa: string, queHacer: string): void {
  const abierto = fstatSync(descriptor);
  if (!abierto.isFile()) {
    throw fallo(`${relativa} no es un archivo. Retíralo. ${queHacer}`);
  }
  if (abierto.nlink === 0) {
    throw fallo(
      `${relativa} ha cambiado mientras se comprobaba: se ha borrado tras abrirlo. Espera a que termine lo que lo modifica y ${RELANZAR}`,
    );
  }
  if (abierto.nlink > 1) {
    throw fallo(
      `${relativa} es un enlace duro: el mismo archivo tiene ${abierto.nlink} nombres y puede pertenecer a otra instalación. Tiene que ser un archivo propio: retíralo. ${queHacer}`,
    );
  }
  const raizReal = realpathSync(raiz);
  const real = realpathSync(join(raiz, relativa));
  if (relative(raizReal, real) !== relativa.split('/').join(sep)) {
    throw falloDeLaRuta(relativa, queHacer, raizReal, real);
  }
  const enLaRuta = statSync(real);
  if (enLaRuta.dev !== abierto.dev || enLaRuta.ino !== abierto.ino) {
    throw fallo(
      `${relativa} ha cambiado mientras se comprobaba. Espera a que termine lo que lo modifica y ${RELANZAR}`,
    );
  }
}

/**
 * Abre un archivo de la etapa sin seguir un enlace en su último tramo y sin bloquearse ante una FIFO, y exige que sea
 * un archivo regular propio de la instalación.
 *
 * @returns El descriptor abierto; quien lo recibe lo cierra.
 */
function abrirPropio(raiz: string, relativa: string, queHacer: string): number {
  let descriptor: number;
  try {
    descriptor = openSync(join(raiz, relativa), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const codigo = codigoDeError(error);
    if (codigo === 'ENOENT' || codigo === 'ENOTDIR') {
      throw fallo(`falta ${relativa}. ${queHacer}`, error);
    }
    if (codigo === 'ELOOP' || codigo === 'EMLINK') {
      throw fallo(
        `${relativa} es un enlace simbólico. Tiene que ser un archivo propio de esta instalación: retira el enlace. ${queHacer}`,
        error,
      );
    }
    throw fallo(
      `no se puede abrir ${relativa}${conCodigo(error)}. Comprueba que tu usuario puede leer ese archivo y sus carpetas y ${RELANZAR}`,
      error,
    );
  }
  try {
    exigirPropio(descriptor, raiz, relativa, queHacer);
  } catch (error) {
    closeSync(descriptor);
    throw error instanceof FalloDeComprobacion
      ? error
      : fallo(`no se puede comprobar ${relativa}${conCodigo(error)}. Comprueba sus carpetas y ${RELANZAR}`, error);
  }
  return descriptor;
}

/** El sha256 de la base, leído por partes desde su descriptor, que se cierra al terminar. */
async function huellaDeLaBase(raiz: string): Promise<string> {
  const descriptor = abrirPropio(raiz, BASE_ESCO, PREPARAR);
  const resumen = createHash('sha256');
  try {
    await pipeline(createReadStream('', { fd: descriptor, autoClose: true }), resumen);
  } catch (error) {
    throw fallo(
      `no se puede leer ${BASE_ESCO}${conCodigo(error)}. Comprueba el disco y los permisos y ${RELANZAR} Si el error se repite, vuelve a prepararla desde la captura ESCO comprobada, ${INSTRUCCIONES}.`,
      error,
    );
  }
  return resumen.digest('hex');
}

/** Las dos huellas que registra `validacion.json`, con los nombres que escribe `lector validar` (`_informe`). */
function huellasValidadas(raiz: string): { readonly sqlite: unknown; readonly original: unknown } {
  const descriptor = abrirPropio(raiz, VALIDACION_ESCO, VALIDAR);
  let informe: unknown;
  try {
    informe = JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch (error) {
    throw fallo(`no se puede leer ${VALIDACION_ESCO} como JSON${conCodigo(error)}. ${VALIDAR}`, error);
  } finally {
    closeSync(descriptor);
  }
  return esObjeto(informe)
    ? { sqlite: informe.sha256_sqlite, original: informe.sha256_original }
    : { sqlite: undefined, original: undefined };
}

/** Exige que una huella registrada en `validacion.json` sea la que fija su origen versionado. */
function exigirRegistrada(registrada: unknown, esperada: string, campo: string, origen: string): void {
  if (registrada === esperada) {
    return;
  }
  const leida = typeof registrada === 'string' ? `registra ${abreviar(registrada)}` : 'no registra ninguna huella';
  throw fallo(`en ${VALIDACION_ESCO}, «${campo}» ${leida}, y ${origen} fija ${abreviar(esperada)}. ${VALIDAR}`);
}

/**
 * Comprueba que la base ESCO local existe, es un archivo propio de la instalación y tiene la huella fijada en el
 * manifiesto de datos, y que `validacion.json` registra esa base (`sha256_sqlite`) y la captura que fija
 * `captura.sha256` (`sha256_original`).
 *
 * @param raiz - Raíz de la instalación.
 * @returns La huella comprobada de la base.
 * @throws {FalloDeComprobacion} Si falta una huella fijada, la base o su validación, si alguna es un enlace o no se
 *   puede leer, o si alguna huella no coincide.
 */
export async function comprobarBaseEsco(raiz: string): Promise<string> {
  const esperada = huellaFijada(raiz);
  const captura = huellaDeLaCaptura(raiz);
  const obtenida = await huellaDeLaBase(raiz);
  if (obtenida !== esperada) {
    throw fallo(
      `la huella de ${BASE_ESCO} (${abreviar(obtenida)}) no coincide con la fijada en ${MANIFIESTO} (${abreviar(esperada)}). ${VALIDAR}`,
    );
  }
  const registradas = huellasValidadas(raiz);
  exigirRegistrada(registradas.sqlite, esperada, 'sha256_sqlite', MANIFIESTO);
  exigirRegistrada(registradas.original, captura, 'sha256_original', HUELLAS_DE_LA_CAPTURA);
  return obtenida;
}

/** El resumen de la etapa correcta, para la salida de la verificación. */
export function resumenDeLaBaseEsco(huella: string): string {
  return `${NOMBRE}: correcto (${abreviar(huella)}, la huella fijada en ${MANIFIESTO}, y su validación registra la captura de ${HUELLAS_DE_LA_CAPTURA})`;
}
