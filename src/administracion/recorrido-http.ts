import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { varianteInstalada } from '../plataforma/variantes-recorrido.ts';
import { esRevisionControles } from './controles.ts';
import type { OpcionesRouterAdministrativo } from './http.ts';
import { leerResultadoRecorrido, type ModoRecorrido, type ResultadoRecorrido } from './recorrido.ts';
import { type AccesoSesionPanel, type EstadoSesionPanel, leerEstadoSesionPanel } from './sesion.ts';

interface Ayudas {
  respuesta(datos: object, estado?: number): Response;
  respuestaSesion(sesion: EstadoSesionPanel): Response;
  rechazar(estado: number, codigo: string): never;
}
export async function operarRecorrido(
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
  if (!opciones.recorrido) {
    return respuesta({ error: 'no_disponible' }, ESTADO_HTTP.noDisponible);
  }
  let resultado: ResultadoRecorrido;
  if (cuerpo === null) {
    resultado = leerResultadoRecorrido(await opciones.recorrido.leerRecorridoDeSesion(acceso));
  } else {
    const { modo, revision } = validarCambio(cuerpo, rechazar);
    resultado = leerResultadoRecorrido(await opciones.recorrido.cambiarRecorridoDeSesion(acceso, revision, modo));
  }
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

function validarCambio(cuerpo: Record<string, unknown>, rechazar: Ayudas['rechazar']) {
  if (
    Object.keys(cuerpo).sort().join(',') !== 'modo,revisionEsperada' ||
    !esRevisionControles(cuerpo.revisionEsperada)
  ) {
    return rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  const modo: ModoRecorrido =
    cuerpo.modo === 'real' || cuerpo.modo === 'demo'
      ? cuerpo.modo
      : rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  if (!varianteInstalada(modo)) {
    return rechazar(ESTADO_HTTP.solicitudIncorrecta, 'solicitud_invalida');
  }
  return { modo, revision: cuerpo.revisionEsperada };
}
