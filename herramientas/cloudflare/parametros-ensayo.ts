/** Parámetros públicos de Access para el ensayo, provistos aparte; nunca contienen claves ni credenciales. */
import { guardiaAdministrativaDelEntorno } from '../../src/plataforma/acceso-administrativo.ts';

export interface AccesoEnsayo {
  readonly equipo: string;
  readonly audiencia: string;
  readonly origen: string;
}
const AUDIENCIA = /^[A-Za-z0-9_-]{16,256}$/;
const ETIQUETA_DNS = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Forma del origen de un ensayo: el workers.dev de su Worker en el subdominio de la cuenta, sin ruta ni barra final. */
export function esOrigenWorkersDev(origen: string, worker: string): boolean {
  let url: URL;
  try {
    url = new URL(origen);
  } catch {
    return false;
  }
  const [nombre, subdominio, ...resto] = url.hostname.split('.');
  return (
    url.origin === origen &&
    url.protocol === 'https:' &&
    nombre === worker &&
    ETIQUETA_DNS.test(subdominio ?? '') &&
    resto.join('.') === 'workers.dev'
  );
}

/** Solo el origen exacto de la instalación de ensayo autorizada: otro Worker u otra cuenta se rechazan. */
export function validarOrigenEnsayo(origen: string, autorizado: string): URL {
  if (origen !== autorizado) {
    throw new Error('El origen no es el de la instalación de ensayo autorizada: otro Worker u otra cuenta');
  }
  return new URL(origen);
}

/** Equipo y audiencia se validan con la misma guardia que aplica el Worker; el origen, con la instalación autorizada. */
export function leerAccesoEnsayo(valor: unknown, autorizado: string): AccesoEnsayo {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new Error('Los parámetros de Access deben ser un objeto');
  }
  const datos = valor as Record<string, unknown>;
  if (Object.keys(datos).sort().join(',') !== 'audiencia,equipo,origen') {
    throw new Error('Los parámetros de Access contienen exactamente equipo, audiencia y origen');
  }
  const { equipo, audiencia, origen } = datos;
  if (typeof equipo !== 'string' || typeof audiencia !== 'string' || typeof origen !== 'string') {
    throw new Error('Los parámetros de Access son textos');
  }
  if (!AUDIENCIA.test(audiencia)) {
    throw new Error('Audiencia de Access inválida');
  }
  guardiaAdministrativaDelEntorno({ FARO_ADMIN_ACCESS_EQUIPO: equipo, FARO_ADMIN_ACCESS_AUD: audiencia });
  validarOrigenEnsayo(origen, autorizado);
  return { equipo, audiencia, origen };
}
