/** Despacho privado de la lista de administradores en el objeto durable; la identidad se verificó en la frontera. */
import {
  type AlmacenAdministradores,
  leerCambioAdministradores,
  leerEntradaAdministrador,
  leerSiembraAdministradores,
  RUTAS_ADMINISTRADORES_DURABLE as RUTAS,
} from '../../administracion/administradores.ts';
import { leerAccesoSesionPanel } from '../../administracion/sesion.ts';

function objeto(valor: unknown, claves: string): valor is Record<string, unknown> {
  return (
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    Object.keys(valor).sort().join(',') === claves
  );
}
/** undefined indica ruta o entrada inválida; el adaptador aplica la respuesta HTTP uniforme. */
export function operarAdministradoresDurable(
  almacen: AlmacenAdministradores,
  ruta: string,
  cuerpo: unknown,
): Promise<unknown> | undefined {
  try {
    if (ruta === RUTAS.autorizar && objeto(cuerpo, 'entrada,siembra')) {
      return almacen.autorizarAdministrador(
        leerEntradaAdministrador(cuerpo.entrada),
        leerSiembraAdministradores(cuerpo.siembra),
      );
    }
    if (ruta === RUTAS.leer && objeto(cuerpo, '')) {
      return almacen.leerAdministradores();
    }
    if (ruta === RUTAS.cambiar && objeto(cuerpo, 'acceso,cambio')) {
      return almacen.cambiarAdministradores(
        leerAccesoSesionPanel(cuerpo.acceso),
        leerCambioAdministradores(cuerpo.cambio),
      );
    }
  } catch {
    return undefined;
  }
  return undefined;
}
