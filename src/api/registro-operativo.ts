/** Registro previo a la entrega de una consulta factual; solo tipos cerrados, nunca argumentos ni cabeceras. */
import type { UsoConectividad } from '../administracion/accesos.ts';
import { ErrorDeProcesamiento } from '../comun/error-de-procesamiento.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import type { ContextoApi } from './contexto-api.ts';
import type { AdministracionApi } from './controles-administrativos.ts';
import { registrarErrorInterno, registrarErrorOperativo, respuestaDeError } from './errores.ts';

export function registradorAdministrado(
  administracion: AdministracionApi | undefined,
): (uso: UsoConectividad) => Promise<void> {
  return async (uso) => {
    try {
      if (!administracion?.registrarAcceso) {
        throw new ErrorDeProcesamiento('no_configurado', 'Registro operativo no preparado');
      }
      await administracion.registrarAcceso(uso);
    } catch (error) {
      registrarErrorOperativo('registro-conectividad', error);
      throw new ErrorDeProcesamiento('no_configurado', 'Registro operativo no disponible');
    }
  };
}
export async function conRegistroOperativo<T>(
  contexto: ContextoApi,
  peticion: Request,
  uso: UsoConectividad,
  consultar: () => Promise<T>,
): Promise<T> {
  let resultado: T;
  try {
    resultado = await consultar();
  } catch (error) {
    try {
      await contexto.registrarAcceso(uso);
    } catch (falloRegistro) {
      if (respuestaDeError(error).estado === ESTADO_HTTP.errorInterno) {
        registrarErrorInterno(peticion, error);
      }
      throw falloRegistro;
    }
    throw error;
  }
  await contexto.registrarAcceso(uso);
  return resultado;
}
