// Operaciones compartidas del acceso público: persistencia obligatoria y fallos sin detalles internos.
import { registrarErrorOperativo } from '../errores.ts';
import type { AlmacenAccesoPublico, CuentaDeAcceso } from './almacen-publico.ts';
import { RevocacionesLlenas } from './revocaciones.ts';

/** El almacén o la protección del acceso público no está disponible; no se permite una alternativa local. */
export class AccesoPublicoNoDisponible extends Error {
  override readonly name = 'AccesoPublicoNoDisponible';

  constructor() {
    super('El almacenamiento de conectividad no está disponible ahora.');
  }
}

/**
 * Aísla el fallo de una operación remota sin trasladar secretos ni detalles de persistencia: quien llama recibe
 * AccesoPublicoNoDisponible y el registro, solo el tipo del fallo (su mensaje puede llevar un token o una credencial).
 */
export async function operacionPublica<T>(operacion: () => Promise<T>): Promise<T> {
  try {
    return await operacion();
  } catch (error) {
    if (error instanceof RevocacionesLlenas) {
      throw error;
    }
    registrarErrorOperativo('registro-conectividad', error);
    throw new AccesoPublicoNoDisponible();
  }
}

/** Comprueba y consume todas las cuotas públicas de la operación en una transacción. */
export function consumirPublico(almacen: AlmacenAccesoPublico, cuentas: readonly CuentaDeAcceso[]): Promise<boolean> {
  return operacionPublica(() => almacen.consumir(cuentas));
}
