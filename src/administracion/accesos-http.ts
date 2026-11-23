/** Lectura del registro operativo solo desde el panel Access y la sesión global vigente. */
import { SolicitudInvalida } from '../api/errores.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import {
  type AlmacenAccesos,
  leerPaginaAccesos,
  leerResultadoAccesosSesion,
  SolicitudAccesoInvalida,
} from './accesos.ts';
import type { AccesoSesionPanel } from './sesion.ts';

export async function atenderAccesosPanel(
  almacen: AlmacenAccesos,
  acceso: AccesoSesionPanel,
  cuerpo: unknown,
): Promise<{
  readonly datos: object;
  readonly estadoHttp: number;
}> {
  let pagina: number;
  try {
    pagina = leerPaginaAccesos(cuerpo);
  } catch (error) {
    if (error instanceof SolicitudAccesoInvalida) {
      throw new SolicitudInvalida('Página del registro no válida');
    }
    throw error;
  }
  const leido = await almacen.leerAccesosDeSesion(acceso, pagina);
  let resultado: ReturnType<typeof leerResultadoAccesosSesion>;
  try {
    resultado = leerResultadoAccesosSesion(leido);
  } catch {
    throw new Error('Respuesta del registro operativo no válida');
  }
  if (resultado.estado === 'activa') {
    return { datos: resultado, estadoHttp: ESTADO_HTTP.correcto };
  }
  return resultado.estado === 'sustituida'
    ? { datos: { error: 'sesion_sustituida' }, estadoHttp: ESTADO_HTTP.conflicto }
    : { datos: { error: 'sesion_inactiva' }, estadoHttp: ESTADO_HTTP.prohibido };
}
