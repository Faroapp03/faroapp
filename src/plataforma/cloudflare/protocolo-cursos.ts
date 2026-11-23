// Contrato del enlace de servicio (binding) privado CURSOS: una petición JSON por consulta factual. Cada petición se
// basta sola; los filtros pertenecen al contrato compartido y el principal no carga el motor de Cursos.
// Los dos Workers se publican por separado y cada uno lleva su paquete dentro: la petición dice qué paquete espera el
// principal y la respuesta, cuál lleva Cursos, para que un informe nunca combine datos de dos versiones.

import type { MotivoSinMotor } from '../motor-de-cursos.ts';
import { esOperacion, type NombreDeOperacion } from '../operaciones-de-cursos.ts';

/** La dirección de las peticiones al Worker de Cursos: un enlace de servicio no sale a la red, el nombre no se resuelve. */
export const DIRECCION_DE_CURSOS = 'https://cursos.faro.interno/operar';

/**
 * La huella del paquete con el que se construyó este Worker. Plantilla neutra, que nunca se reescribe: en las fuentes
 * vale ''. La construcción de los dos Workers la sustituye por la huella del paquete que empaqueta
 * (herramientas/cloudflare/comprobar-construccion.ts, protocoloConHuella), así que cada Worker publicado sabe qué
 * paquete lleva.
 */
export const HUELLA_DEL_PAQUETE = '';

/** Lo que el Worker principal pide al de Cursos, con la huella del paquete que espera. */
export interface PeticionACursos {
  readonly tipo: 'operacion';
  readonly nombre: NombreDeOperacion;
  readonly argumentos: readonly unknown[];
  readonly huellaPaquete: string;
}

/**
 * Lo que responde el Worker de Cursos: el valor, o por qué no hay motor (sin datos de la persona), siempre con la huella
 * del paquete que lleva.
 */
export type RespuestaDeCursos =
  | { readonly ok: true; readonly valor: unknown; readonly huellaPaquete: string }
  | { readonly ok: false; readonly motivo: MotivoSinMotor; readonly detalle: string; readonly huellaPaquete: string };

/**
 * Lee una petición al Worker de Cursos.
 *
 * @param valor - El cuerpo, ya leído como JSON.
 * @returns La petición, o null si no tiene la forma esperada.
 */
export function leerPeticionACursos(valor: unknown): PeticionACursos | null {
  if (typeof valor !== 'object' || valor === null) {
    return null;
  }
  const { tipo, nombre, argumentos, huellaPaquete } = valor as Record<string, unknown>;
  if (tipo === 'operacion' && esOperacion(nombre) && Array.isArray(argumentos) && typeof huellaPaquete === 'string') {
    return { tipo, nombre, argumentos, huellaPaquete };
  }
  return null;
}

/**
 * Lee una respuesta del Worker de Cursos.
 *
 * @param valor - El cuerpo, ya leído como JSON.
 * @returns La respuesta, o null si no tiene la forma esperada (también si no dice qué paquete lleva).
 */
export function leerRespuestaDeCursos(valor: unknown): RespuestaDeCursos | null {
  if (typeof valor !== 'object' || valor === null) {
    return null;
  }
  const { ok, valor: dado, motivo, detalle, huellaPaquete } = valor as Record<string, unknown>;
  if (typeof huellaPaquete !== 'string') {
    return null;
  }
  if (ok === true && Object.hasOwn(valor, 'valor')) {
    return { ok, valor: dado, huellaPaquete };
  }
  if (
    ok === false &&
    (motivo === 'ausente' || motivo === 'averiado' || motivo === 'bloqueado') &&
    typeof detalle === 'string'
  ) {
    return { ok, motivo, detalle, huellaPaquete };
  }
  return null;
}
