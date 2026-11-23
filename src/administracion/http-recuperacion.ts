/** Retirar y reconciliar un trabajo desde el panel, con la sesión comprobada antes y después. */
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import type { CapacidadActualizacionPanel } from './http.ts';
import { leerResultadoReconciliacion } from './reconciliacion.ts';
import { type AccesoSesionPanel, type AlmacenSesionPanel, leerEstadoSesionPanel } from './sesion.ts';
import { leerResultadoRetiradaTrabajo, type ReferenciaTrabajo, type RetiradaTrabajo } from './trabajos.ts';

type Ayudas = {
  respuesta: (datos: object, estado?: number) => Response;
  respuestaSesion: (estado: ReturnType<typeof leerEstadoSesionPanel>) => Response;
};
type SolicitudRecuperacion =
  | { readonly operacion: 'retirar'; readonly entrada: RetiradaTrabajo }
  | { readonly operacion: 'reconciliar'; readonly entrada: ReferenciaTrabajo };
/** Retirar requiere CAS dentro del almacén; reconciliar solo registra un fin remoto confirmado, nunca lo ordena. */
export async function recuperarActualizacion(
  opciones: { almacen: AlmacenSesionPanel; actualizacion?: CapacidadActualizacionPanel },
  acceso: AccesoSesionPanel,
  { solicitud, senal }: { solicitud: SolicitudRecuperacion; senal: AbortSignal },
  { respuesta, respuestaSesion }: Ayudas,
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  const capacidad = opciones.actualizacion?.recuperacion;
  if (!capacidad) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  const resultado =
    solicitud.operacion === 'retirar'
      ? leerResultadoRetiradaTrabajo(await capacidad.retirar(acceso, solicitud.entrada, senal))
      : leerResultadoReconciliacion(await capacidad.reconciliar(acceso, solicitud.entrada, senal));
  senal.throwIfAborted();
  if (!('sesion' in resultado)) {
    return respuestaSesion(resultado);
  }
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (sesion.estado !== 'activa') {
    return respuestaSesion(sesion);
  }
  const conflicto = resultado.estado === 'conflicto' || ('decision' in resultado && resultado.decision === 'conflicto');
  return respuesta({ ...resultado, sesion }, conflicto ? ESTADO_HTTP.conflicto : ESTADO_HTTP.correcto);
}
