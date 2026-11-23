/** Frontera del cierre pedido desde el panel: sesión antes y después, y una respuesta que el panel sabe decir. */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { type CerrarPublicacion, leerSolicitudCierrePublicacion } from './cierre-publicacion.ts';
import { type AccesoSesionPanel, type AlmacenSesionPanel, leerEstadoSesionPanel } from './sesion.ts';

type Ayudas = {
  respuesta: (datos: object, estado?: number) => Response;
  respuestaSesion: (estado: ReturnType<typeof leerEstadoSesionPanel>) => Response;
  rechazar: (estado: number, codigo: string) => never;
};
export async function operarCierrePublicacion(
  opciones: { almacen: AlmacenSesionPanel; cerrarPublicacion?: CerrarPublicacion },
  acceso: AccesoSesionPanel,
  { cuerpo, senal }: { cuerpo: Record<string, unknown>; senal: AbortSignal },
  ayudas: Ayudas,
): Promise<Response> {
  let solicitud: ReturnType<typeof leerSolicitudCierrePublicacion>;
  try {
    solicitud = leerSolicitudCierrePublicacion(cuerpo);
  } catch {
    ayudas.rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (inicial.estado !== 'activa') {
    return ayudas.respuestaSesion(inicial);
  }
  if (!opciones.cerrarPublicacion) {
    return ayudas.respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  const cierre = await opciones.cerrarPublicacion(acceso, solicitud, senal);
  senal.throwIfAborted();
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (sesion.estado !== 'activa') {
    return ayudas.respuestaSesion(sesion);
  }
  const estado = cierre.estado === 'solicitado' ? ESTADO_HTTP.aceptada : ESTADO_HTTP.conflicto;
  return ayudas.respuesta({ estado: 'activa', sesion, cierre }, estado);
}
