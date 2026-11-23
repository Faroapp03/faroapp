// Cotejo directo del artefacto construido antes de firmar o desplegar, sin reparar sus archivos.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { MANIFIESTO } from '../../src/plataforma/archivos-del-paquete.ts';
import { paqueteDeManifiesto } from '../../src/plataforma/node/paquete-publicado.ts';
import { CARPETA_DEL_PAQUETE } from '../../src/plataforma/paquete-publicado.ts';
import { huella } from '../../web/scripts/firmas/firmas.js';
import { CARPETA_DEL_MOTOR } from './carpeta-del-motor.ts';
import {
  MANIFIESTO_PUBLICADO,
  manifiestoConElPaqueteDeOrigen,
  manifiestoDelDispositivo,
} from './manifiesto-del-dispositivo.ts';

/** Una carpeta generada que no es una carpeta propia o que contiene enlaces o entradas especiales. */
export class CarpetaNoPropia extends Error {
  override name = 'CarpetaNoPropia';
  /** Si la carpeta no existe, en lugar de existir y no ser propia. */
  readonly falta: boolean;
  constructor(mensaje: string, falta = false) {
    super(mensaje);
    this.falta = falta;
  }
}

/**
 * El inventario estricto de una carpeta generada: sus archivos, con su ruta desde ella separada por «/», en orden.
 *
 * @param carpeta - La carpeta; debe ser una carpeta propia, no un enlace.
 * @returns Las rutas de sus archivos.
 * @throws {CarpetaNoPropia} Si no existe, no es una carpeta o contiene un enlace o una entrada especial.
 * @throws {Error} Si no se puede consultar por otra causa que su ausencia, con esa causa.
 */
export function archivosPropios(carpeta: string): string[] {
  let esCarpeta: boolean;
  try {
    esCarpeta = lstatSync(carpeta).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CarpetaNoPropia(`Falta la carpeta ${carpeta}`, true);
    }
    throw new Error(`No se puede comprobar la carpeta ${carpeta}`, { cause: error });
  }
  if (!esCarpeta) {
    throw new CarpetaNoPropia(`Se requiere una carpeta propia: ${carpeta}`);
  }
  const archivos: string[] = [];
  for (const entrada of readdirSync(carpeta, { recursive: true, withFileTypes: true })) {
    const ruta = join(entrada.parentPath, entrada.name);
    if (entrada.isFile()) {
      archivos.push(relative(carpeta, ruta).split(sep).join('/'));
    } else if (!entrada.isDirectory()) {
      throw new CarpetaNoPropia(`No se admiten enlaces ni entradas especiales: ${ruta}`);
    }
  }
  return archivos.sort();
}

/**
 * Lo que separa una carpeta generada de su referencia exacta: la lista de archivos y los bytes de cada uno.
 *
 * @param carpeta - La carpeta que se coteja.
 * @param esperados - Cada archivo que debe tener, por su ruta desde la carpeta, con sus bytes.
 * @returns Un problema por diferencia; vacío si coinciden.
 */
export function diferenciasConLaReferencia(carpeta: string, esperados: ReadonlyMap<string, Uint8Array>): string[] {
  let actuales: string[];
  try {
    actuales = archivosPropios(carpeta);
  } catch (error) {
    if (error instanceof CarpetaNoPropia) {
      return [error.message];
    }
    throw error;
  }
  const faltan = [...esperados.keys()].filter((archivo) => !actuales.includes(archivo)).sort();
  const sobran = actuales.filter((archivo) => !esperados.has(archivo));
  const problemas = [
    ...faltan.map((archivo) => `Falta en ${carpeta}: ${archivo}`),
    ...sobran.map((archivo) => `Sobra en ${carpeta}: ${archivo}`),
  ];
  for (const [archivo, bytes] of [...esperados].sort(([a], [b]) => a.localeCompare(b))) {
    if (actuales.includes(archivo) && !readFileSync(join(carpeta, archivo)).equals(bytes)) {
      problemas.push(`Contenido distinto en ${join(carpeta, archivo)}`);
    }
  }
  return problemas;
}

/** Lista exacta y bytes exactos: un archivo sobrante también hace fallar el artefacto. */
function cotejar(carpeta: string, esperados: ReadonlyMap<string, Uint8Array>): void {
  const problemas = diferenciasConLaReferencia(carpeta, esperados);
  if (problemas.length) {
    throw new Error(`Artefacto desactualizado: ${problemas.join('; ')}`);
  }
}

/**
 * Comprueba el motor final, la copia publicada del paquete y su manifiesto local, sin escribir.
 *
 * @param web - Web candidata, fuera de una carpeta que esté sirviendo tráfico.
 * @param paquete - Paquete de origen, estable durante todo el cotejo.
 * @param motorEsperado - La captura del empaquetado del motor (ContextoWeb.motor): rutas `motor/…` y todos sus bytes.
 * No es un inventario del motor que se está comprobando.
 * @returns Versión del paquete comprobado.
 * @throws {Error} Si faltan archivos, sobran, discrepan o son enlaces/entradas especiales.
 * Solo admite el artefacto local sin firmas: web/firmas contiene únicamente manifiesto.json.
 */
export function comprobarArtefactos(
  web: string,
  paquete: string,
  motorEsperado: ReadonlyMap<string, Uint8Array>,
): string {
  const delMotor = new Map<string, Uint8Array>();
  for (const [ruta, bytes] of motorEsperado) {
    if (!ruta.startsWith(`${CARPETA_DEL_MOTOR}/`)) {
      throw new Error(`La referencia del motor requiere rutas motor/: ${ruta}`);
    }
    delMotor.set(ruta.slice(CARPETA_DEL_MOTOR.length + 1), bytes);
  }
  cotejar(join(web, CARPETA_DEL_MOTOR), delMotor);

  const bytesDelManifiesto = readFileSync(join(paquete, MANIFIESTO));
  const { version, archivos } = paqueteDeManifiesto(paquete, bytesDelManifiesto);
  const manifiesto = JSON.parse(bytesDelManifiesto.toString('utf8')) as Record<string, { sha256: string }>;
  const publicados = new Map<string, Uint8Array>();
  for (const archivo of archivos) {
    const bytes = archivo === MANIFIESTO ? bytesDelManifiesto : readFileSync(join(paquete, archivo));
    if (archivo !== MANIFIESTO && huella(bytes) !== manifiesto[archivo]?.sha256) {
      throw new Error(`El origen no coincide con su huella: ${join(paquete, archivo)}`);
    }
    publicados.set(`${version}/${archivo}`, bytes);
  }
  cotejar(join(web, CARPETA_DEL_PAQUETE), publicados);

  const esperado = manifiestoConElPaqueteDeOrigen(web, paquete);
  if (!Buffer.from(manifiestoDelDispositivo(web, version)).equals(esperado)) {
    throw new Error('El manifiesto del dispositivo difiere entre el origen y el paquete publicado');
  }
  cotejar(join(web, dirname(MANIFIESTO_PUBLICADO)), new Map([[basename(MANIFIESTO_PUBLICADO), esperado]]));
  return version;
}
