import type { CubrirVencimiento } from './mantenimiento-durable.ts';
import { type AlmacenSesionPortalSqlite, validarRegistroPortal } from './sesion-portal-sqlite.ts';

const MILISEGUNDOS = 1000;
const RUTAS = new Set(['/portal/registrar', '/portal/disponible', '/portal/activa', '/portal/revocar']);
export function esRutaSesionPortal(ruta: string): boolean {
  return RUTAS.has(ruta);
}
/** Registrar escribe la huella con la alarma del objeto ya puesta a su caducidad, para retirarla aunque nadie vuelva. */
export async function operarSesionPortal(
  almacen: AlmacenSesionPortalSqlite,
  ruta: string,
  valor: unknown,
  cubrir: CubrirVencimiento,
): Promise<unknown> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return undefined;
  }
  const datos = valor as Record<string, unknown>;
  const claves = Object.keys(datos).sort().join(',');
  const ahora = Math.floor(Date.now() / MILISEGUNDOS);
  if (
    ruta === '/portal/registrar' &&
    claves === 'caduca,huella' &&
    typeof datos.huella === 'string' &&
    typeof datos.caduca === 'number'
  ) {
    const { huella, caduca } = datos;
    validarRegistroPortal(huella, caduca, ahora);
    return cubrir(caduca * MILISEGUNDOS, () => {
      almacen.registrar(huella, caduca, ahora);
      return { correcto: true };
    });
  }
  if (ruta === '/portal/disponible' && claves === '') {
    return { disponible: almacen.disponible(ahora) };
  }
  if (ruta === '/portal/activa' && claves === 'huella' && typeof datos.huella === 'string') {
    return { activa: almacen.activa(datos.huella, ahora) };
  }
  if (ruta === '/portal/revocar' && claves === 'huella' && typeof datos.huella === 'string') {
    almacen.revocar(datos.huella);
    return { correcto: true };
  }
  return undefined;
}
