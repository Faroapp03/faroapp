/** Mensajes privados del registro operativo, cerrados y sin parámetros de consultas. */
import { type AlmacenAccesos, leerPaginaAccesos, leerUsoConectividad } from '../../administracion/accesos.ts';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';

const RUTAS = new Set(['/accesos/preparar', '/accesos/registrar', '/accesos/depurar', '/accesos/leer']);
export const MAX_RESPUESTA_ACCESOS = 65_536;
export function esRutaAccesosDurable(ruta: string): boolean {
  return RUTAS.has(ruta);
}
function objeto(entrada: unknown, claves: string): Record<string, unknown> {
  if (
    entrada === null ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    (Object.getPrototypeOf(entrada) !== Object.prototype && Object.getPrototypeOf(entrada) !== null) ||
    Object.getOwnPropertySymbols(entrada).length > 0 ||
    Object.getOwnPropertyNames(entrada).sort().join(',') !== claves
  ) {
    throw new Error('Mensaje operativo no válido');
  }
  for (const clave of Object.getOwnPropertyNames(entrada)) {
    const d = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!d || !('value' in d) || !d.enumerable) {
      throw new Error('Mensaje operativo no válido');
    }
  }
  return entrada as Record<string, unknown>;
}
function accionDe(almacen: AlmacenAccesos, ruta: string, entrada: unknown): (() => Promise<unknown>) | undefined {
  switch (ruta) {
    case '/accesos/preparar':
      objeto(entrada, '');
      return async () => {
        await almacen.prepararAccesos();
        return { correcto: true };
      };
    case '/accesos/depurar':
      objeto(entrada, '');
      return async () => {
        await almacen.depurarAccesos();
        return { correcto: true };
      };
    case '/accesos/registrar': {
      const o = objeto(entrada, 'uso'),
        uso = leerUsoConectividad(o.uso);
      return async () => {
        await almacen.registrarAcceso(uso);
        return { correcto: true };
      };
    }
    case '/accesos/leer': {
      const o = objeto(entrada, 'acceso,pagina'),
        acceso = leerAccesoSesionPanel(o.acceso),
        pagina = leerPaginaAccesos({ pagina: o.pagina });
      return () => almacen.leerAccesosDeSesion(acceso, pagina);
    }
    default:
      return undefined;
  }
}
/** La captura solo rodea el contrato de entrada, nunca la operación de almacenamiento. */
export async function operarAccesosDurable(almacen: AlmacenAccesos, ruta: string, entrada: unknown): Promise<unknown> {
  let accion: (() => Promise<unknown>) | undefined;
  try {
    accion = accionDe(almacen, ruta, entrada);
  } catch {
    return undefined;
  }
  return accion ? accion() : undefined;
}
