/** Configuración privada del ejecutor: un destino fijo, identidad fijada y secreto separado. */
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { validarOrigenAdministrativo } from './configuracion.ts';
import { type DestinoActualizacionGitHub, leerDestinoActualizacionGitHub } from './ejecutor-github.ts';
import { type ConfianzaOidcGitHub, leerConfianzaOidcGitHub } from './oidc-github.ts';

export interface ConfiguracionActualizacionGitHub {
  readonly destino: DestinoActualizacionGitHub;
  readonly confianza: ConfianzaOidcGitHub;
  readonly obtenerToken: () => Promise<string>;
}
const MAX_CONFIGURACION_BYTES = 8192;
const MAX_TOKEN_CARACTERES = 4096;
const ERROR = 'Configuración de actualización GitHub no válida';

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error(ERROR);
  }
}
function objeto(entrada: unknown, claves: string): Record<string, unknown> {
  exigir(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  exigir(Object.keys(entrada).sort().join(',') === claves);
  return entrada as Record<string, unknown>;
}

/** Captura solo esta capacidad; validarla al usarla evita bloquear servicios independientes. */
export function configuracionActualizacionDiferida(
  variables: VariablesDelEntorno,
  origen: string,
  permitirHttpLocal = false,
): (() => ConfiguracionActualizacionGitHub) | undefined {
  if (variables.FARO_ACTUALIZACION_GITHUB === undefined) {
    return undefined;
  }
  const capturadas = Object.freeze({
    FARO_ACTUALIZACION_GITHUB: variables.FARO_ACTUALIZACION_GITHUB,
    FARO_ACTUALIZACION_GITHUB_TOKEN: variables.FARO_ACTUALIZACION_GITHUB_TOKEN,
  });
  return () => {
    const configuracion = configuracionActualizacionDelEntorno(capturadas, origen, permitirHttpLocal);
    if (!configuracion) {
      throw new Error(ERROR);
    }
    return configuracion;
  };
}

/** Ausencia deshabilita esta capacidad. Una configuración parcial o incoherente no habilita ningún envío. */
export function configuracionActualizacionDelEntorno(
  variables: VariablesDelEntorno,
  origen: string,
  permitirHttpLocal = false,
): ConfiguracionActualizacionGitHub | undefined {
  const texto = variables.FARO_ACTUALIZACION_GITHUB;
  if (texto === undefined) {
    return undefined;
  }
  const canonico = validarOrigenAdministrativo(origen, permitirHttpLocal);
  exigir(new TextEncoder().encode(texto).byteLength <= MAX_CONFIGURACION_BYTES);
  let entrada: unknown;
  try {
    entrada = JSON.parse(texto);
  } catch {
    throw new Error(ERROR);
  }
  const o = objeto(entrada, 'confianza,destino,version');
  exigir(o.version === 1);
  const d = objeto(o.destino, 'propietario,ref,repositorio,workflow');
  exigir(
    typeof d.propietario === 'string' &&
      typeof d.repositorio === 'string' &&
      typeof d.workflow === 'string' &&
      typeof d.ref === 'string',
  );
  const destino = leerDestinoActualizacionGitHub({
    propietario: d.propietario,
    repositorio: d.repositorio,
    workflow: d.workflow,
    ref: d.ref,
  });
  const confianza = leerConfianzaOidcGitHub(o.confianza);
  exigir(confianza.audiencia === `${canonico}/mantenimiento/resultado`);
  exigir(confianza.ref === `refs/heads/${destino.ref}` || confianza.ref === `refs/tags/${destino.ref}`);
  exigir(
    confianza.workflowRef ===
      `${destino.propietario}/${destino.repositorio}/.github/workflows/${destino.workflow}@${confianza.ref}`,
  );
  const token = variables.FARO_ACTUALIZACION_GITHUB_TOKEN;
  exigir(
    typeof token === 'string' &&
      token.length > 0 &&
      token.length <= MAX_TOKEN_CARACTERES &&
      !/[^\x21-\x7e]/.test(token),
  );
  return Object.freeze({ destino, confianza, obtenerToken: async () => token });
}
