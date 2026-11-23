// Carga en el navegador el paquete de datos publicado, para que el motor funcione en el
// dispositivo, también sin conexión. Cada archivo se pide con fetch: con conexión, de la web; sin ella, de la copia
// que guarda el service worker, que es quien decide de dónde sale (web/service-worker.js). Antes de usarlo se comprueba
// contra su huella SHA-256 de manifiesto.json, como en Node (plataforma/node/datos.ts): un archivo a medio descargar o
// de otra versión del paquete no llega al motor. La huella se calcula con la Web Crypto del navegador, que es nativa.

import { esObjeto } from '../../comun/json.ts';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../../comun/marcas-de-tiempo.ts';
import { MS_POR_SEGUNDO } from '../../comun/tiempo.ts';
import type { Datos } from '../../dominio/tipos-paquete.ts';
import {
  ARCHIVO_DE_CADA_PARTE,
  esDeCursos,
  esObligatoria,
  MANIFIESTO,
  PARTES,
  prepararParte,
} from '../archivos-del-paquete.ts';
import { anotarDatosDeCursosAveriados } from '../motor-de-cursos.ts';

/** El manifiesto, un objeto por nombre de archivo; cada entrada se comprueba al usarla. */
type Manifiesto = Record<string, unknown>;

/** La base y las cifras de cada byte de una huella escrita en hexadecimal. */
const BASE_HEXADECIMAL = 16;
const CIFRAS_POR_BYTE = 2;

/** Descodifica UTF-8 sin sustituciones: unos bytes que no son UTF-8 fallan, no se leen con «\uFFFD» donde no valen. */
const UTF8_ESTRICTO = new TextDecoder('utf-8', { fatal: true });

/**
 * Lo que se espera a cada archivo del paquete, cuerpo incluido: un minuto. Da para el archivo más grande en una
 * conexión móvil lenta; más allá, la red o la copia sin conexión se han quedado colgadas y el motor falla con un mensaje
 * en vez de no arrancar nunca.
 */
const PLAZO_DE_UN_ARCHIVO_MS = 60 * MS_POR_SEGUNDO;

/**
 * La huella SHA-256 de unos bytes.
 *
 * @param bytes - Los bytes.
 * @returns La huella, en hexadecimal en minúsculas.
 */
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(resumen, (byte) => byte.toString(BASE_HEXADECIMAL).padStart(CIFRAS_POR_BYTE, '0')).join('');
}

/**
 * La huella SHA-256 de un archivo del paquete, con su tramo en la línea temporal (MEDIDAS.huella).
 *
 * @param bytes - Los bytes del archivo.
 * @param archivo - Su nombre.
 * @returns La huella, en hexadecimal en minúsculas.
 */
async function huellaDe(bytes: ArrayBuffer, archivo: string): Promise<string> {
  const inicio = inicioDelTramo();
  const huella = await sha256(bytes);
  medirTramo(MEDIDAS.huella, inicio, { archivo });
  return huella;
}

/**
 * El JSON de unos bytes en UTF-8; lo que llega de fuera entra como unknown.
 *
 * @param bytes - Los bytes de un archivo del paquete.
 * @param archivo - Su nombre, para identificar una descarga defectuosa.
 * @returns El JSON, sin validar su forma.
 * @throws {TypeError} Con el nombre y la causa original si los bytes no son UTF-8.
 * @throws {SyntaxError} Con el nombre y la causa original si el texto no es JSON.
 */
function leerJson(bytes: ArrayBuffer, archivo: string): unknown {
  try {
    return JSON.parse(UTF8_ESTRICTO.decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      const ErrorDeLectura = error instanceof SyntaxError ? SyntaxError : TypeError;
      throw new ErrorDeLectura(`${archivo} no es JSON UTF-8 válido: vuelve a descargar el paquete`, { cause: error });
    }
    throw error;
  }
}

/**
 * Pide un archivo del paquete, con su plazo.
 *
 * @param base - La carpeta publicada del paquete.
 * @param archivo - El nombre del archivo.
 * @returns Sus bytes.
 * @throws {Error} Con el nombre del archivo, si no responde bien, no llega dentro de PLAZO_DE_UN_ARCHIVO_MS o falla la
 *   red.
 */
async function pedir(base: URL, archivo: string, plazo = PLAZO_DE_UN_ARCHIVO_MS): Promise<ArrayBuffer> {
  try {
    const inicio = inicioDelTramo();
    const respuesta = await fetch(new URL(archivo, base), { signal: AbortSignal.timeout(plazo) });
    if (!respuesta.ok) {
      throw new Error(`No se ha podido cargar ${archivo} del paquete (${respuesta.status})`);
    }
    const bytes = await respuesta.arrayBuffer();
    medirTramo(MEDIDAS.lectura, inicio, { archivo, bytes: bytes.byteLength });
    return bytes;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`No se ha podido cargar ${archivo} del paquete (sin respuesta en el plazo)`, { cause: error });
    }
    throw error;
  }
}

/**
 * Lee un archivo del paquete y comprueba su huella; lo que llega de fuera entra como unknown.
 *
 * @param base - La carpeta publicada del paquete.
 * @param manifiesto - El manifiesto, ya leído.
 * @param archivo - El nombre del archivo.
 * @returns El JSON del archivo, sin validar su forma.
 * @throws {Error} Si no llega, no coincide con su huella o no es JSON en UTF-8.
 */
async function leerComprobado(
  base: URL,
  manifiesto: Manifiesto,
  archivo: string,
  plazo = PLAZO_DE_UN_ARCHIVO_MS,
): Promise<unknown> {
  const bytes = await pedir(base, archivo, plazo);
  const entrada = manifiesto[archivo];
  const esperada = esObjeto(entrada) ? entrada.sha256 : undefined;
  if (typeof esperada !== 'string' || (await huellaDe(bytes, archivo)) !== esperada) {
    throw new Error(`${archivo} no coincide con su huella en ${MANIFIESTO}: vuelve a descargar el paquete`);
  }
  const inicioDelJson = inicioDelTramo();
  const leido = leerJson(bytes, archivo);
  medirTramo(MEDIDAS.json, inicioDelJson, { archivo });
  return leido;
}

/** El mensaje de un fallo de lectura de `archivo`, con su nombre, para el detalle del motor de cursos averiado. */
function mensajeDe(error: unknown, archivo: string): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  return mensaje.includes(archivo) ? mensaje : `${archivo}: ${mensaje}`;
}

/** Qué partes del paquete se cargan y en qué datos (cargarPaquete). */
export interface CargaDelPaquete {
  /** Las partes que se cargan; las demás no se piden. */
  readonly partes?: readonly (keyof Datos)[];
  /** Los datos que completan; se devuelven los mismos, con esas partes añadidas. */
  readonly en?: Partial<Datos>;
}

/**
 * Carga el paquete desde `base` (la carpeta publicada del paquete, con su manifiesto): cada parte de su archivo
 * (plataforma/archivos-del-paquete.ts), todas a la vez, cada una comprobada y preparada para ocupar poca memoria, como
 * en el Worker. Una parte opcional cuyo archivo no nombra el manifiesto no se pide: el motor funciona sin ella. (Node
 * decide al revés: lee la parte opcional si el archivo existe, y falla si el manifiesto no lo nombra.) Un archivo que
 * solo es de cursos (esDeCursos) no tumba la carga: si no llega, no coincide con su huella o no se puede preparar, el
 * paquete sale sin él y su puerta da el motor de cursos por averiado (plataforma/motor-de-cursos.ts).
 * Con `carga`, solo unas partes y en unos datos ya empezados: el motor del navegador carga primero las del primer
 * análisis y después, en el mismo objeto, el resto (motor.ts).
 *
 * @param base - La carpeta publicada del paquete.
 * @param carga - Qué partes y en qué datos; por omisión, todas en unos datos nuevos.
 * @returns Los datos del motor y la huella del manifiesto, que identifica la versión del paquete guardada: su SHA-256
 *   entera (64 cifras), no el prefijo corto que publica el servidor como versión (plataforma/paquete-publicado.ts).
 * @throws {Error} Si un archivo del núcleo no llega a tiempo o no coincide con su huella, o el manifiesto no es un
 *   objeto.
 */
export async function cargarPaquete(
  base: URL,
  { partes: pedidas = PARTES, en = {} }: CargaDelPaquete = {},
): Promise<{ datos: Datos; version: string }> {
  const inicio = inicioDelTramo();
  const bytesManifiesto = await pedir(base, MANIFIESTO);
  const manifiesto = leerJson(bytesManifiesto, MANIFIESTO);
  if (!esObjeto(manifiesto)) {
    throw new Error(`${MANIFIESTO} no es un objeto: vuelve a descargar el paquete`);
  }
  const partes = PARTES.filter(
    (parte) =>
      pedidas.includes(parte) && (esObligatoria(parte) || Object.hasOwn(manifiesto, ARCHIVO_DE_CADA_PARTE[parte])),
  );
  const fallosDeCursos: string[] = [];
  const leidas = await Promise.all(
    partes.map(async (parte) => {
      const leer = leerComprobado(base, manifiesto, ARCHIVO_DE_CADA_PARTE[parte]);
      if (!esDeCursos(parte)) {
        return [parte, await leer] as const;
      }
      try {
        return [parte, await leer] as const;
      } catch (error) {
        fallosDeCursos.push(mensajeDe(error, ARCHIVO_DE_CADA_PARTE[parte]));
        return null;
      }
    }),
  );
  // Se prepara cuando han llegado todas: un fallo de lectura se anuncia antes que uno de forma.
  const datos: Partial<Record<keyof Datos, unknown>> = en;
  for (const [parte, contenido] of leidas.filter((leida) => leida !== null)) {
    try {
      const inicioDeLaParte = inicioDelTramo();
      datos[parte] = prepararParte(parte, contenido, datos.esco as Datos['esco'] | undefined);
      medirTramo(MEDIDAS.preparacion, inicioDeLaParte, { archivo: ARCHIVO_DE_CADA_PARTE[parte] });
    } catch (error) {
      if (!esDeCursos(parte)) {
        throw error;
      }
      const causa = error instanceof Error ? error.message : String(error);
      fallosDeCursos.push(`${ARCHIVO_DE_CADA_PARTE[parte]} no tiene la forma esperada: ${causa}`);
    }
  }
  if (fallosDeCursos.length > 0) {
    const detalle = `no se han podido cargar los datos de cursos: ${fallosDeCursos.join('; ')}`;
    console.warn(`Faro: ${detalle}. El motor de ocupaciones funciona; el de cursos queda averiado.`);
    anotarDatosDeCursosAveriados(datos, detalle);
  }
  // Cada archivo ha pasado su huella del manifiesto: es, byte a byte, el que exportó y validó la cadena de datos, y
  // su forma es la de Datos sin volver a validarla aquí campo a campo (como en Node, plataforma/node/datos.ts).
  const version = await sha256(bytesManifiesto);
  medirTramo(MEDIDAS.paquete, inicio, { partes: partes.length });
  return { datos: datos as Datos, version };
}

/**
 * Lo que se espera a un archivo extra del paquete: cinco minutos. La tabla de vectores del móvil pesa unos 11 MB
 * comprimidos y se pide sin que nadie espere: en una conexión lenta puede tardar más que un archivo del arranque.
 */
const MINUTOS_PARA_UN_ARCHIVO_EXTRA = 5;
export const PLAZO_DE_UN_ARCHIVO_EXTRA_MS = MINUTOS_PARA_UN_ARCHIVO_EXTRA * PLAZO_DE_UN_ARCHIVO_MS;

/**
 * Lee un archivo extra del paquete (ARCHIVOS_EXTRA_DEL_PAQUETE), comprobado contra su huella del manifiesto, o null si
 * el manifiesto no lo nombra. Lo pide quien lo usa, cuando el motor ya funciona.
 *
 * @param base - La carpeta publicada del paquete.
 * @param archivo - El nombre del archivo extra.
 * @returns Su JSON, sin validar su forma, o null si este paquete no lo trae.
 * @throws {Error} Si no llega a tiempo, no coincide con su huella o no es JSON en UTF-8.
 */
export async function leerExtraDelPaquete(base: URL, archivo: string): Promise<unknown> {
  const manifiesto = leerJson(await pedir(base, MANIFIESTO), MANIFIESTO);
  if (!(esObjeto(manifiesto) && Object.hasOwn(manifiesto, archivo))) {
    return null;
  }
  return leerComprobado(base, manifiesto, archivo, PLAZO_DE_UN_ARCHIVO_EXTRA_MS);
}
