// ---------- Primer análisis del paquete ----------
// La copia del paquete (paquete.js) guarda primero lo que necesita el primer análisis del recorrido y, en cuanto lo
// tiene guardado y comprobado, lo sirve al motor sin esperar a estar completa. Aquí está esa lista, el orden de la
// descarga y lo que el intento en curso ya ha guardado.

/** Mensaje con que se cuenta a la página que pidió la copia que ya está guardado lo del primer análisis. */
export const PRIMER_ANALISIS_DEL_PAQUETE = 'PRIMER_ANALISIS_DEL_PAQUETE';

/**
 * Los archivos del paquete que necesita el primer análisis, además del manifiesto. Su fuente es
 * ARCHIVOS_DEL_PRIMER_ANALISIS de src/plataforma/archivos-del-paquete.ts; npm run web:comprobar exige que sean los
 * mismos (herramientas/web/primer-analisis.ts).
 */
export const ARCHIVOS_DEL_PRIMER_ANALISIS = [
  'esco.json',
  'oit.json',
  'clasificaciones.json',
  'exposicion-cambra.json',
  'textos.json',
  'correspondencia-eures.json',
  'ocupados.json',
  'catalan.json',
  'vectores-movil.json',
  'clasificador-movil.json',
];

const DEL_PRIMER_ANALISIS = new Set(ARCHIVOS_DEL_PRIMER_ANALISIS);

/** @param {string} archivo @returns {boolean} Si el archivo es de lo que necesita el primer análisis. */
export const esDelPrimerAnalisis = (archivo) => DEL_PRIMER_ANALISIS.has(archivo);

/**
 * Cuenta cómo empieza la copia (`contar`, contarProgreso de paquete.js) y devuelve lo que la cuenta con cada archivo
 * guardado: la copia entera y, aparte, lo del primer análisis.
 *
 * @param {readonly string[]} nombres - Los archivos que nombra el manifiesto.
 * @param {ReadonlySet<string>} faltan - Los que aún no están guardados.
 * @param {{ peso: (archivo: string) => number, total: number, exacto: boolean }} pesos - Los de pesosDelPaquete.
 * @param {(avance: { archivos: number, guardados: number, bytes: number, total: number, exacto: boolean,
 *   primerAnalisis: { archivos: number, guardados: number, bytes: number, total: number } }) => void} contar
 * @returns {(archivo: string) => void}
 */
export function avanceDeLaCopia(nombres, faltan, { peso, total, exacto }, contar) {
  /** @param {readonly string[]} archivos */
  const cuenta = (archivos) => ({
    archivos: archivos.length,
    guardados: archivos.filter((archivo) => !faltan.has(archivo)).length,
    bytes: archivos.filter((archivo) => !faltan.has(archivo)).reduce((suma, archivo) => suma + peso(archivo), 0),
    total: archivos.reduce((suma, archivo) => suma + peso(archivo), 0),
  });
  const avance = {
    ...cuenta(nombres),
    total,
    exacto,
    primerAnalisis: cuenta(nombres.filter(esDelPrimerAnalisis)),
  };
  contar(avance);
  return (archivo) => {
    avance.guardados += 1;
    avance.bytes += peso(archivo);
    if (esDelPrimerAnalisis(archivo)) {
      avance.primerAnalisis.guardados += 1;
      avance.primerAnalisis.bytes += peso(archivo);
    }
    contar(avance);
  };
}

/**
 * Guarda los archivos que faltan con `guardar`: primero los del primer análisis y, con todos ellos guardados, llama a
 * `alGuardarElPrimerAnalisis`; después, el resto. Devuelve los fallos de las dos tandas.
 *
 * @param {readonly (readonly [archivo: string, huella: string])[]} pendientes - Archivo y huella esperada.
 * @param {(tanda: readonly (readonly [archivo: string, huella: string])[]) => Promise<string[]>} guardar
 * @param {() => void} alGuardarElPrimerAnalisis - Se llama cuando está guardado todo lo del primer análisis.
 * @returns {Promise<string[]>}
 */
export async function guardarPorOrden(pendientes, guardar, alGuardarElPrimerAnalisis) {
  const fallos = await guardar(pendientes.filter(([archivo]) => esDelPrimerAnalisis(archivo)));
  if (!fallos.length) {
    alGuardarElPrimerAnalisis();
  }
  return [...fallos, ...(await guardar(pendientes.filter(([archivo]) => !esDelPrimerAnalisis(archivo))))];
}

/**
 * Lo del primer análisis ya guardado y comprobado en el intento en curso: la dirección del manifiesto, que aún no está
 * en la copia, con su respuesta, las direcciones de los archivos que se pueden servir y cómo leerlos de la copia. null
 * mientras no lo está o sin intento en curso.
 * @type {{ manifiesto: string, respuesta: () => Response, archivos: ReadonlySet<string>,
 *   deLaCopia: (clave: string) => Promise<Response | undefined> } | null}
 */
let primerAnalisisAnotado = null;

/**
 * Anota que el intento en curso ya tiene guardado lo del primer análisis, o, con null, que no lo tiene.
 * @param {typeof primerAnalisisAnotado} anotado
 */
export function anotarElPrimerAnalisis(anotado) {
  primerAnalisisAnotado = anotado;
}

/**
 * Un archivo de lo del primer análisis que ya ha guardado el intento en curso: el manifiesto comprobado, de la memoria,
 * o un archivo de ARCHIVOS_DEL_PRIMER_ANALISIS, de la copia. null si no lo es o aún no está.
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia), de un archivo de esta versión.
 * @returns {Promise<Response | null>}
 */
export async function delPrimerAnalisisGuardado(clave) {
  const anotado = primerAnalisisAnotado;
  if (!anotado) {
    return null;
  }
  if (clave === anotado.manifiesto) {
    return anotado.respuesta();
  }
  if (!anotado.archivos.has(clave)) {
    return null;
  }
  return (await anotado.deLaCopia(clave)) ?? null;
}
