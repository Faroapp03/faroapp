import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { esRevisionControles } from './controles.ts';
import type { OpcionesRouterAdministrativo } from './http.ts';
import { leerResultadoCambioSeccionesSesion, leerResultadoLecturaSeccionesSesion } from './secciones-almacen.ts';
import { leerPoliticaSecciones } from './secciones-web.js';
import { type AccesoSesionPanel, type EstadoSesionPanel, leerEstadoSesionPanel } from './sesion.ts';

interface Ayudas {
  respuesta(datos: object, estado?: number): Response;
  respuestaSesion(sesion: EstadoSesionPanel): Response;
  rechazar(estado: number, codigo: string): never;
}
/** La política comparte revisión con conectividad; el almacén conserva los campos no modificados. */
export async function operarSecciones(
  opciones: OpcionesRouterAdministrativo,
  acceso: AccesoSesionPanel,
  cuerpo: Record<string, unknown> | null,
  { senal, respuesta, respuestaSesion, rechazar }: Ayudas & { senal: AbortSignal },
): Promise<Response> {
  const inicial = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (inicial.estado !== 'activa') {
    return respuestaSesion(inicial);
  }
  const capacidad = opciones.secciones;
  if (!capacidad) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  const cambio = cuerpo === null ? null : cambioDeSecciones(cuerpo, rechazar);
  const resultado = cambio
    ? leerResultadoCambioSeccionesSesion(
        await capacidad.cambiarSeccionesDeSesion(acceso, cambio.revision, cambio.secciones),
      )
    : leerResultadoLecturaSeccionesSesion(await capacidad.leerSeccionesDeSesion(acceso));
  senal.throwIfAborted();
  if (!('sesion' in resultado)) {
    return respuestaSesion(resultado);
  }
  const sesion = leerEstadoSesionPanel(await opciones.almacen.comprobarSesion(acceso));
  senal.throwIfAborted();
  if (sesion.estado !== 'activa') {
    return respuestaSesion(sesion);
  }
  return respuesta(
    { ...resultado, sesion },
    resultado.estado === 'conflicto' ? ESTADO_HTTP.conflicto : ESTADO_HTTP.correcto,
  );
}
function cambioDeSecciones(cuerpo: Record<string, unknown>, rechazar: Ayudas['rechazar']) {
  if (
    Object.keys(cuerpo).sort().join(',') !== 'revisionEsperada,secciones' ||
    !esRevisionControles(cuerpo.revisionEsperada)
  ) {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  try {
    return { revision: cuerpo.revisionEsperada, secciones: leerPoliticaSecciones(cuerpo.secciones) };
  } catch {
    rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
}
