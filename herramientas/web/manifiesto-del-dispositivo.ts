// El manifiesto de lo que descarga el motor del dispositivo: el motor (motor/) y los datos publicados
// (paquete/<versión>/), cada archivo con su SHA-256. En una construcción, el motor son los bytes empaquetados que lleva
// el contexto (empaquetado.ts), los mismos de COMPROBADOS. La construcción lo escribe en firmas/manifiesto.json de la
// web construida; el lector del dispositivo admite comparar estas huellas sin raíz o comprobar además la cadena de
// firmas cuando esté configurada. El cotejo del artefacto lo rehace con el paquete de origen, datos/
// (manifiestoConElPaqueteDeOrigen), y con el ya publicado por publicar-paquete.ts: los dos dan los mismos bytes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paqueteParaPublicar } from '../../src/plataforma/node/paquete-publicado.ts';
import { CARPETA_DEL_PAQUETE } from '../../src/plataforma/paquete-publicado.ts';
import { huella } from '../../web/scripts/firmas/firmas.js';
import { FORMATO_DEL_MANIFIESTO } from '../../web/scripts/firmas/manifiesto-firmado.js';
import { CARPETA_DEL_MOTOR, listarArchivos } from './carpeta-del-motor.ts';

/** Un archivo del manifiesto: su ruta desde la raíz de la web y sus bytes, o dónde se leen. */
type ArchivoDelDispositivo = readonly [ruta: string, bytes: string | Uint8Array];

/** Faltan el motor compilado o el paquete: no hay manifiesto que escribir. */
export class FaltaLoQueDescarga extends Error {
  override name = 'FaltaLoQueDescarga';
}

/** Dónde se publica el manifiesto, desde la raíz de la web: lo piden el Worker del motor y «Faro verificable». */
export const MANIFIESTO_PUBLICADO = 'firmas/manifiesto.json';

/**
 * Lo que se escribe en firmas/: JSON con dos espacios y salto de línea final, siempre igual para el mismo valor.
 *
 * @param valor - Un valor que JSON.stringify sabe escribir.
 * @returns Sus bytes en UTF-8.
 */
export function enBytes(valor: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(valor, null, 2)}\n`);
}

/**
 * Todos los archivos de una carpeta, con su ruta desde `base` separada por «/». Una carpeta que no existe no tiene
 * archivos: así la falta del motor o del paquete llega a manifiestoDe, que la explica con FaltaLoQueDescarga.
 */
function archivosDe(carpeta: string, base: string): string[] {
  if (!existsSync(carpeta)) {
    return [];
  }
  return listarArchivos(carpeta, base);
}

/** El manifiesto de unos archivos (por ruta, en orden) y la versión del paquete; sin motor o sin paquete, falla. */
function manifiestoDe(archivos: readonly ArchivoDelDispositivo[], versionDelPaquete: string): Uint8Array {
  const rutas = archivos.map(([ruta]) => ruta);
  if (
    !rutas.some((ruta) => ruta.startsWith(`${CARPETA_DEL_MOTOR}/`)) ||
    !rutas.some((ruta) => ruta.startsWith(`${CARPETA_DEL_PAQUETE}/`))
  ) {
    throw new FaltaLoQueDescarga('Faltan el motor empaquetado o el paquete publicado en la web construida');
  }
  const ordenados = [...archivos].sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
  const huellas = Object.fromEntries(
    ordenados.map(([ruta, bytes]) => [ruta, huella(typeof bytes === 'string' ? readFileSync(bytes) : bytes)]),
  );
  return enBytes({ formato: FORMATO_DEL_MANIFIESTO, paquete: versionDelPaquete, archivos: huellas });
}

/** El motor compilado de `web`, con la ruta de cada archivo desde la raíz de la web. */
function motorDe(web: string): ArchivoDelDispositivo[] {
  return archivosDe(join(web, CARPETA_DEL_MOTOR), web).map((ruta) => [ruta, join(web, ruta)]);
}

/**
 * El manifiesto de lo publicado para el despliegue: el motor y el paquete de la versión `paquete`, ya copiado en
 * `web`/paquete/<versionDelPaquete>/ (herramientas/publicar-paquete.ts).
 *
 * @param web - La carpeta de la web publicada.
 * @param versionDelPaquete - La versión del paquete de datos.
 * @param motor - Los bytes del motor empaquetado, por su ruta desde la web; sin ellos, los de `web`/motor/.
 * @returns Los bytes del manifiesto (enBytes).
 * @throws {FaltaLoQueDescarga} Si no hay motor o paquete publicado (carpetas vacías o que no existen).
 */
export function manifiestoDelDispositivo(
  web: string,
  versionDelPaquete: string,
  motor?: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const publicado = archivosDe(join(web, CARPETA_DEL_PAQUETE, versionDelPaquete), web).map(
    (ruta): ArchivoDelDispositivo => [ruta, join(web, ruta)],
  );
  const delMotor = motor ? [...motor] : motorDe(web);
  return manifiestoDe([...delMotor, ...publicado], versionDelPaquete);
}

/**
 * El mismo manifiesto con el paquete de su carpeta de origen (`carpetaDelPaquete`, datos/): lo que el servidor
 * local sirve en /paquete/<versión>/ y lo que publicar-paquete.ts copia al desplegar.
 *
 * @param web - La carpeta de la web, con el motor compilado en motor/.
 * @param carpetaDelPaquete - La carpeta de origen del paquete de datos.
 * @returns Los bytes del manifiesto (enBytes).
 * @throws {FaltaLoQueDescarga} Si no hay motor compilado o el paquete no tiene archivos.
 */
export function manifiestoConElPaqueteDeOrigen(web: string, carpetaDelPaquete: string): Uint8Array {
  const { version, archivos } = paqueteParaPublicar(carpetaDelPaquete);
  const delPaquete = archivos.map(
    (archivo): ArchivoDelDispositivo => [
      `${CARPETA_DEL_PAQUETE}/${version}/${archivo}`,
      join(carpetaDelPaquete, archivo),
    ],
  );
  return manifiestoDe([...motorDe(web), ...delPaquete], version);
}
