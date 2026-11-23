/**
 * Configuración de la lista de administradores: la siembra de la instalación, el segundo factor obligatorio y la
 * sincronización con el grupo de Cloudflare Access. Una variable presente pero ilegible o fuera de sus techos detiene
 * el panel al arrancar; nunca se corrige ni se ignora en silencio.
 */
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { correoDeAdministrador, MAX_ADMINISTRADORES_INICIALES } from './administradores.ts';
import { crearGrupoAccess, type DestinoGrupoAccess, type GrupoAccess } from './grupo-access.ts';

/** Un correo ocupa como mucho 254 caracteres; con su coma, 255. */
const CARACTERES_POR_CORREO = 255;
/** Diez correos de 254 caracteres con sus comas: el texto no puede pedir más que eso. */
const MAX_SIEMBRA_CARACTERES = MAX_ADMINISTRADORES_INICIALES * CARACTERES_POR_CORREO;
/** Identificador de cuenta de Cloudflare: 32 cifras hexadecimales. */
const CUENTA = /^[0-9a-f]{32}$/;
/** Identificador de un grupo de Access: un UUID en minúsculas. */
const GRUPO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Tokens de la API de Cloudflare: base64url sin relleno, de longitud acotada. */
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

export const VARIABLES_SINCRONIZACION = [
  'FARO_ADMIN_ACCESS_CUENTA',
  'FARO_ADMIN_ACCESS_GRUPO',
  'FARO_ADMIN_ACCESS_TOKEN',
] as const;
export type VariableSincronizacion = (typeof VARIABLES_SINCRONIZACION)[number];
/** Sin sincronización la lista funciona solo en Faro; el panel avisa sin nombrar variables y la API conserva cuáles faltan. */
export type LecturaSincronizacion =
  | { readonly estado: 'configurada'; readonly destino: DestinoGrupoAccess }
  | { readonly estado: 'sin-configurar'; readonly falta: readonly VariableSincronizacion[] };

/** Lista de correos separados por comas. Ausente o vacía: no hay siembra. */
export function administradoresInicialesDelEntorno(variables: VariablesDelEntorno): readonly string[] {
  const texto = variables.FARO_ADMINISTRADORES_INICIALES?.trim() ?? '';
  if (texto === '') {
    return [];
  }
  const correos = texto.length <= MAX_SIEMBRA_CARACTERES ? texto.split(',').map(correoDeAdministrador) : [];
  const validos = correos.filter((correo): correo is string => correo !== null);
  if (
    validos.length === 0 ||
    validos.length !== correos.length ||
    validos.length > MAX_ADMINISTRADORES_INICIALES ||
    new Set(validos).size !== validos.length
  ) {
    throw new Error(
      `FARO_ADMINISTRADORES_INICIALES admite hasta ${MAX_ADMINISTRADORES_INICIALES} correos distintos separados por comas`,
    );
  }
  return validos;
}
/** Apagado por defecto: encenderlo antes de activar el segundo factor en Cloudflare dejaría fuera a todo el mundo. */
export function segundoFactorExigidoDelEntorno(variables: VariablesDelEntorno): boolean {
  const valor = variables.FARO_ADMIN_EXIGIR_MFA ?? 'no';
  if (valor !== 'si' && valor !== 'no') {
    throw new Error('FARO_ADMIN_EXIGIR_MFA admite si o no');
  }
  return valor === 'si';
}
/** Las tres variables van juntas; una sola que esté, pero mal escrita, detiene el panel en vez de apagar la sincronización. */
export function sincronizacionDelEntorno(variables: VariablesDelEntorno): LecturaSincronizacion {
  const formas: Readonly<Record<VariableSincronizacion, RegExp>> = {
    FARO_ADMIN_ACCESS_CUENTA: CUENTA,
    FARO_ADMIN_ACCESS_GRUPO: GRUPO,
    FARO_ADMIN_ACCESS_TOKEN: TOKEN,
  };
  const falta = VARIABLES_SINCRONIZACION.filter((nombre) => (variables[nombre] ?? '') === '');
  for (const nombre of VARIABLES_SINCRONIZACION) {
    const valor = variables[nombre] ?? '';
    if (valor !== '' && !formas[nombre].test(valor)) {
      throw new Error(`${nombre} no tiene la forma de un identificador de Cloudflare`);
    }
  }
  if (falta.length > 0) {
    return { estado: 'sin-configurar', falta };
  }
  return {
    estado: 'configurada',
    destino: {
      cuenta: variables.FARO_ADMIN_ACCESS_CUENTA as string,
      grupo: variables.FARO_ADMIN_ACCESS_GRUPO as string,
      token: variables.FARO_ADMIN_ACCESS_TOKEN as string,
    },
  };
}

/** Lo que el panel sabe de la sincronización; nunca incluye el token. */
export type EstadoSincronizacion =
  | { readonly estado: 'configurada' }
  | { readonly estado: 'sin-configurar'; readonly falta: readonly VariableSincronizacion[] };
export interface ConfiguracionAdministradores {
  readonly siembra: readonly string[];
  readonly sincronizacion: EstadoSincronizacion;
  /** Solo existe con la sincronización configurada; el token queda dentro del cliente. */
  readonly grupo?: GrupoAccess;
}
/** Sin ninguna variable: lista solo en Faro, sin siembra, y el panel avisa de que la sincronización no está completa. */
export const ADMINISTRADORES_SIN_CONFIGURAR: ConfiguracionAdministradores = Object.freeze({
  siembra: [],
  sincronizacion: Object.freeze({ estado: 'sin-configurar', falta: VARIABLES_SINCRONIZACION }),
});
export function configuracionAdministradoresDelEntorno(
  variables: VariablesDelEntorno,
  pedir: typeof fetch = fetch,
): ConfiguracionAdministradores {
  const siembra = administradoresInicialesDelEntorno(variables);
  const lectura = sincronizacionDelEntorno(variables);
  if (lectura.estado === 'sin-configurar') {
    return { siembra, sincronizacion: lectura };
  }
  return { siembra, sincronizacion: { estado: 'configurada' }, grupo: crearGrupoAccess(lectura.destino, pedir) };
}
