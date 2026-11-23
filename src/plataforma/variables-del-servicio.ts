/** Opciones de un perfil de servicio: inventario cerrado y copia propia, sin valores en los diagnósticos. */
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { ErrorDeProcesamiento } from '../comun/error-de-procesamiento.ts';

const ADMITIDAS: ReadonlySet<string> = new Set([
  'FARO_A2A',
  'FARO_ACCESS_AUD',
  'FARO_ACCESS_DECLARACION',
  'FARO_ACCESS_EQUIPO',
  'FARO_ACTIVACION_AUTOMATICA',
  'FARO_ACTUALIZACION_DEMANDA',
  'FARO_ACTUALIZACION_GITHUB',
  'FARO_ACTUALIZACION_GITHUB_TOKEN',
  'FARO_ACTUALIZACION_PROGRAMADA',
  'FARO_ADMINISTRACION',
  'FARO_ADMINISTRADORES_INICIALES',
  'FARO_VIGILANTE',
  'FARO_ADMIN_ACCESS_AUD',
  'FARO_ADMIN_ACCESS_CUENTA',
  'FARO_ADMIN_ACCESS_EQUIPO',
  'FARO_ADMIN_ACCESS_GRUPO',
  'FARO_ADMIN_ACCESS_TOKEN',
  'FARO_ADMIN_EXIGIR_MFA',
  'FARO_ADMIN_ORIGEN',
  'FARO_API_SOCIOS',
  'FARO_AVISO_REMITENTE',
  'FARO_AVISO_URL',
  'FARO_CAMINO_A_MANO',
  'FARO_CITILAB_PAGO',
  'FARO_FIRMA_MCP_CLAVES',
  'FARO_FORMACION_ABIERTA',
  'FARO_MCP',
  'FARO_ORIGENES',
  'FARO_PLAZO_PETICION_S',
  'FARO_SECRETO_FIRMA',
  'FARO_SECRETO_FIRMA_ANTERIOR',
  'FARO_SEGURIDAD_CADUCA',
  'FARO_SEGURIDAD_CONTACTO',
  'FARO_SEGURIDAD_POLITICA',
]);
export function comprobarVariablesDelServicio(variables: VariablesDelEntorno): void {
  if (
    !variables ||
    typeof variables !== 'object' ||
    Array.isArray(variables) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(variables)) ||
    Object.getOwnPropertySymbols(variables).length
  ) {
    throw new ErrorDeProcesamiento('no_configurado', 'El perfil de servicio contiene opciones no admitidas');
  }
  for (const nombre of Object.getOwnPropertyNames(variables)) {
    const d = Object.getOwnPropertyDescriptor(variables, nombre);
    if (
      !d ||
      !('value' in d) ||
      !d.enumerable ||
      !ADMITIDAS.has(nombre) ||
      (d.value !== undefined && typeof d.value !== 'string')
    ) {
      throw new ErrorDeProcesamiento('no_configurado', 'El perfil de servicio contiene opciones no admitidas');
    }
  }
}
export function variablesDelServicio(variables: VariablesDelEntorno): Record<string, string> {
  comprobarVariablesDelServicio(variables);
  return Object.fromEntries(
    Object.entries(variables).filter((entrada): entrada is [string, string] => typeof entrada[1] === 'string'),
  );
}
