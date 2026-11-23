// Lectura de los resúmenes del reportero de Node: confirma casos reales ejecutados, ningún archivo de unidad ausente ni
// con una omisión fuera de la lista cerrada y ningún archivo de navegador ausente, omitido o pendiente.

import { relative, sep } from 'node:path';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';

/** Una omisión admitida en la suite de unidad: cuántos casos de ese archivo se saltan y por qué. */
export interface OmisionAdmitida {
  readonly omitidas: number;
  readonly motivo: string;
}
/** Las omisiones admitidas, por la ruta del archivo relativa a la raíz y con «/». */
export type OmisionesAdmitidas = Readonly<Record<string, OmisionAdmitida>>;

/**
 * La lista cerrada de la batería global: solo el motor empaquetado, que necesita una construcción y se ejecuta sobre el
 * artefacto final con `npm run probar:motor-empaquetado`, que exige 12 de 12.
 */
export const OMISIONES_DE_LA_GLOBAL: OmisionesAdmitidas = Object.freeze({
  'pruebas/web-recorrido-integral/motor-empaquetado.test.ts': {
    omitidas: 12,
    motivo: 'Sin FARO_CONSTRUCCION no hay construcción que cargar; se ejecuta aparte sobre el artefacto final.',
  },
});

const SIN_OTRA_VARIANTE = 'Sin extensiones instaladas no hay otra variante que probar.';

/** Sin extensiones instaladas (el ensayo de su retirada), además, los casos que no tienen otra variante que probar. */
export const OMISIONES_SIN_EXTENSIONES: OmisionesAdmitidas = Object.freeze({
  ...OMISIONES_DE_LA_GLOBAL,
  'pruebas/acceso-publico/acceso-cancelacion-flujos.test.ts': { omitidas: 2, motivo: SIN_OTRA_VARIANTE },
  'pruebas/acceso-publico/acceso-recorrido-sin-sesion.test.ts': { omitidas: 3, motivo: SIN_OTRA_VARIANTE },
  'pruebas/acceso-publico/acceso-recorrido.test.ts': { omitidas: 13, motivo: SIN_OTRA_VARIANTE },
  'pruebas/acceso-publico/recorrido-worker.test.ts': { omitidas: 2, motivo: SIN_OTRA_VARIANTE },
  'pruebas/cloudflare/worker-oficial-marca-del-recorrido.test.ts': { omitidas: 1, motivo: SIN_OTRA_VARIANTE },
  'pruebas/cloudflare/worker-oficial-selector-durable.test.ts': { omitidas: 2, motivo: SIN_OTRA_VARIANTE },
  'pruebas/herramientas/web-publicaciones.test.ts': { omitidas: 2, motivo: SIN_OTRA_VARIANTE },
});

/** El inventario de la suite de unidad: sus archivos, en rutas absolutas, y las omisiones que admite. */
export interface InventarioDeUnidad {
  readonly raiz: string;
  readonly archivos: readonly string[];
  readonly admitidas: OmisionesAdmitidas;
}

/** Un registro recibido del reportero: lo externo se valida antes de leer sus campos. */
function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Cada cuenta estructurada debe ser un entero no negativo. */
function cuentaDe(cuentas: Record<string, unknown>, nombre: string): number {
  const cuenta = cuentas[nombre];
  if (typeof cuenta !== 'number' || !Number.isSafeInteger(cuenta) || cuenta < 0) {
    throw new FalloDeComprobacion(`El resumen no trae una cuenta válida de ${nombre}`);
  }
  return cuenta;
}

/** Valida un resumen de Node y devuelve sus cuentas, sin sumar skip/TODO como ejecuciones. */
function cuentasDelResumen(resumen: Record<string, unknown>): Record<string, unknown> {
  const cuentas = resumen.counts;
  if (!esRegistro(cuentas) || resumen.success !== true) {
    throw new FalloDeComprobacion('Falta un resumen correcto de las pruebas');
  }
  const aprobadas = cuentaDe(cuentas, 'passed');
  const fallidas = cuentaDe(cuentas, 'failed');
  const canceladas = cuentaDe(cuentas, 'cancelled');
  const omitidas = cuentaDe(cuentas, 'skipped');
  const pendientes = cuentaDe(cuentas, 'todo');
  const total = cuentaDe(cuentas, 'tests');
  if (fallidas !== 0 || canceladas !== 0 || total !== aprobadas + fallidas + canceladas + omitidas + pendientes) {
    throw new FalloDeComprobacion('El resumen de pruebas contiene fallos o cuentas incoherentes');
  }
  return cuentas;
}

/** Los casos aprobados de un resumen válido. */
function aprobadasDelResumen(resumen: Record<string, unknown>): number {
  return cuentaDe(cuentasDelResumen(resumen), 'passed');
}

/** La salida del reportero se interpreta como unknown y todo fallo de lectura se diagnostica. */
function leerResumen(linea: string): Record<string, unknown> | null {
  let evento: unknown;
  try {
    evento = JSON.parse(linea);
  } catch (error) {
    throw new FalloDeComprobacion('La suite no entrega JSON válido del reportero', { cause: error });
  }
  if (!esRegistro(evento) || !esRegistro(evento.data)) {
    throw new FalloDeComprobacion('La suite no entrega un evento estructurado válido');
  }
  if (['test:fail', 'test:stderr', 'test:stdout', 'test:diagnostic'].includes(String(evento.type))) {
    return null;
  }
  if (evento.type !== 'test:summary') {
    throw new FalloDeComprobacion('La suite no entrega un resumen estructurado válido');
  }
  return evento.data;
}

/**
 * Exige casos ejecutados en resúmenes por archivo, además del resumen global correcto.
 *
 * Los pseudo-casos que Node asigna a archivos vacíos no tienen resumen de casos con entryFile.
 */
function exigirResumenGlobal(salida: string): void {
  let aprobadasReales = 0;
  let resumenesGlobales = 0;
  for (const linea of salida.trim().split('\n')) {
    const resumen = leerResumen(linea);
    if (resumen === null) {
      continue;
    }
    const aprobadas = aprobadasDelResumen(resumen);
    if (typeof resumen.entryFile === 'string') {
      aprobadasReales += aprobadas;
    } else if (resumen.file === undefined) {
      resumenesGlobales += 1;
    }
  }
  if (aprobadasReales === 0 || resumenesGlobales !== 1) {
    throw new FalloDeComprobacion('La suite no confirma pruebas reales ejecutadas y un resumen global');
  }
}

/**
 * Exige el resumen global y uno por cada archivo del inventario de unidad, sin pendientes y con exactamente las
 * omisiones de su lista cerrada: una omisión fuera de ella, otro número o un archivo sin resumen hacen fallar.
 *
 * @param salida - Eventos JSON del reportero propio de Node.
 * @param inventario - Los archivos ejecutados y las omisiones admitidas.
 * @throws {FalloDeComprobacion} Si no confirma casos ejecutados, falta un resumen o hay una omisión inesperada.
 */
export function exigirPruebasEjecutadas(salida: string, { raiz, archivos, admitidas }: InventarioDeUnidad): void {
  exigirResumenGlobal(salida);
  const ruta = (archivo: string) => relative(raiz, archivo).split(sep).join('/');
  const conAdmitidas = new Set(archivos.map(ruta));
  const ajenas = Object.keys(admitidas).filter((archivo) => !conAdmitidas.has(archivo));
  if (ajenas.length) {
    throw new FalloDeComprobacion(`Omisiones admitidas de archivos que no están en la suite: ${ajenas.join(', ')}`);
  }
  const pendientes = new Set(archivos);
  for (const linea of salida.trim().split('\n')) {
    const resumen = leerResumen(linea);
    if (!resumen || typeof resumen.entryFile !== 'string') {
      continue;
    }
    const cuentas = cuentasDelResumen(resumen);
    const esperadas = admitidas[ruta(resumen.entryFile)]?.omitidas ?? 0;
    const omitidas = cuentaDe(cuentas, 'skipped');
    if (omitidas !== esperadas || cuentaDe(cuentas, 'todo')) {
      throw new FalloDeComprobacion(
        `Omisión inesperada en ${resumen.entryFile}: ${omitidas} omitidas (admitidas: ${esperadas}), ` +
          `${cuentaDe(cuentas, 'todo')} pendientes`,
      );
    }
    if (!pendientes.delete(resumen.entryFile)) {
      throw new FalloDeComprobacion(`Resumen de unidad inesperado: ${resumen.entryFile}`);
    }
  }
  if (pendientes.size) {
    throw new FalloDeComprobacion(`Faltan resúmenes de unidad: ${[...pendientes].join(', ')}`);
  }
}

/** Los casos aprobados de cada archivo, según sus resúmenes, que se validan al leerlos. */
export function aprobadasPorArchivo(salida: string): ReadonlyMap<string, number> {
  const aprobadas = new Map<string, number>();
  for (const linea of salida.trim().split('\n')) {
    const resumen = leerResumen(linea);
    if (resumen && typeof resumen.entryFile === 'string') {
      aprobadas.set(resumen.entryFile, (aprobadas.get(resumen.entryFile) ?? 0) + aprobadasDelResumen(resumen));
    }
  }
  return aprobadas;
}

/** Ningún archivo de navegador puede quedar ausente o con casos omitidos o pendientes. */
export function exigirPruebasNavegadorEjecutadas(salida: string, archivos: readonly string[]): void {
  exigirResumenGlobal(salida);
  const pendientes = new Set(archivos);
  for (const linea of salida.trim().split('\n')) {
    const resumen = leerResumen(linea);
    if (!resumen || typeof resumen.entryFile !== 'string') {
      continue;
    }
    const aprobadas = aprobadasDelResumen(resumen);
    const cuentas = resumen.counts;
    if (!esRegistro(cuentas) || aprobadas === 0 || cuentaDe(cuentas, 'skipped') || cuentaDe(cuentas, 'todo')) {
      throw new FalloDeComprobacion(`Prueba de navegador omitida o pendiente: ${resumen.entryFile}`);
    }
    if (!pendientes.delete(resumen.entryFile)) {
      throw new FalloDeComprobacion(`Resumen de navegador inesperado: ${resumen.entryFile}`);
    }
  }
  if (pendientes.size) {
    throw new FalloDeComprobacion(`Faltan resúmenes de navegador: ${[...pendientes].join(', ')}`);
  }
}
