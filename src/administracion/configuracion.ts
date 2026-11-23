// Habilitación y origen del panel administrativo; la conectividad se gobierna por separado.
// La composición valida también la identidad Access antes de preparar la persistencia.
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import {
  type ConfiguracionAdministradores,
  configuracionAdministradoresDelEntorno,
} from './configuracion-administradores.ts';

const MIN_SECRETO_FIRMA = 32;
export interface ConfiguracionAdministrativa {
  readonly origen: string;
  readonly permitirHttpLocal: boolean;
  /** Siembra y sincronización de la lista de administradores; sin ellas, la lista vive solo en Faro y empieza vacía. */
  readonly administradores?: ConfiguracionAdministradores;
}
export interface OpcionesConfiguracionAdministrativa {
  /** Solo la composición local puede autorizar explícitamente HTTP en loopback. */
  readonly permitirHttpLocal?: boolean;
}

/** Origen canónico fijado por el despliegue; no se obtiene de cabeceras de una petición. */
export function validarOrigenAdministrativo(origen: string, permitirHttpLocal = false): string {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    throw new Error('El origen administrativo debe ser canónico y seguro');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const seguro = url.protocol === 'https:' || (url.protocol === 'http:' && local && permitirHttpLocal === true);
  if (!seguro || url.origin !== origen) {
    throw new Error('El origen administrativo debe ser canónico y seguro');
  }
  return url.origin;
}

/** El panel solo se prepara con habilitación explícita y secreto estable para los tokens que puede activar. */
export function configuracionAdministrativaDelEntorno(
  variables: VariablesDelEntorno,
  opciones: OpcionesConfiguracionAdministrativa = {},
): ConfiguracionAdministrativa | null {
  const habilitada = variables.FARO_ADMINISTRACION;
  if (habilitada === undefined || habilitada === 'no') {
    return null;
  }
  if (habilitada !== 'si') {
    throw new Error('FARO_ADMINISTRACION admite si o no');
  }
  if (!variables.FARO_SECRETO_FIRMA || variables.FARO_SECRETO_FIRMA.length < MIN_SECRETO_FIRMA) {
    throw new Error('La administración requiere FARO_SECRETO_FIRMA estable de al menos 32 caracteres');
  }
  const permitirHttpLocal = opciones.permitirHttpLocal === true;
  return {
    origen: validarOrigenAdministrativo(variables.FARO_ADMIN_ORIGEN ?? '', permitirHttpLocal),
    permitirHttpLocal,
    administradores: configuracionAdministradoresDelEntorno(variables),
  };
}
