// Autorización administrativa de Cloudflare Access, separada de las credenciales de consulta.
// La política de la aplicación de Access debe admitir únicamente a las personas administradoras mediante OTP.
// Aquí se verifica su JWT; no se implementa un login ni se convierte otro canal de consulta en administrador.

import { segundoFactorExigidoDelEntorno } from '../administracion/configuracion-administradores.ts';
import { esCorreoVerificado } from '../administracion/sesion-unica.ts';
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { crearVerificadorAccess, emisorDelEquipo, type PeticionHttp } from '../seguridad/access.ts';

/**
 * Identidad estable de la persona: el sujeto solo es único dentro de su emisor. El correo verificado identifica a quien
 * tiene la sesión única del panel y el instante de emisión distingue cada sesión de Access; nunca incluye el token.
 */
export interface PrincipalAdministrativo {
  readonly emisor: string;
  readonly sujeto: string;
  /** null si el JWT verificado no trae un correo válido: entonces la sesión única no puede abrirse. */
  readonly correo: string | null;
  /** Instante de emisión (iat) del JWT en segundos, o null si no lo trae. */
  readonly emitidoEn: number | null;
  /** Si el JWT verificado declara en `amr` un método de segundo factor. */
  readonly segundoFactor: boolean;
}

/**
 * Métodos de RFC 8176 que son un segundo factor: contraseña de un solo uso (apps TOTP), llave de seguridad física o
 * de software, biometría y la marca genérica de varios factores. Una contraseña sola (`pwd`) no lo es.
 */
const METODOS_SEGUNDO_FACTOR: ReadonlySet<string> = new Set(['mfa', 'otp', 'hwk', 'swk', 'fpt', 'face', 'iris']);
/** Se deniega la entrada porque la instalación exige segundo factor y este JWT no lo declara. */
export class SegundoFactorRequerido extends Error {
  override readonly name = 'SegundoFactorRequerido';
  constructor() {
    super('Segundo factor requerido');
  }
}
function conSegundoFactor(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((metodo) => typeof metodo === 'string' && METODOS_SEGUNDO_FACTOR.has(metodo));
}

/** null significa denegado, nunca ausencia opcional de un control; sin el segundo factor exigido, lanza. */
export type GuardiaAdministrativa = (peticion: Request) => Promise<PrincipalAdministrativo | null>;

/** Equipo administrativo en forma estricta: minúsculas, sin espacios, puertos, rutas ni credenciales. */
const EQUIPO_ADMIN = /^(?:https:\/\/)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.cloudflareaccess\.com)?\/?$/;
/** Claims y configuración de identidad no admiten espacios ni caracteres de control. */
const ESPACIOS_O_CONTROLES = /[\s\p{Cc}]/u;

function textoDeIdentidad(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0 && !ESPACIOS_O_CONTROLES.test(valor);
}

/** La aplicación administrativa es obligatoria y su audiencia no puede reutilizar la pública configurada. */
function aplicacionAdministrativa(env: VariablesDelEntorno): { emisor: string; audiencia: string } {
  const equipo = env.FARO_ADMIN_ACCESS_EQUIPO ?? '';
  const audiencia = env.FARO_ADMIN_ACCESS_AUD;
  const emisor = textoDeIdentidad(equipo) && EQUIPO_ADMIN.test(equipo) ? emisorDelEquipo(equipo) : null;
  if (!emisor || !textoDeIdentidad(audiencia)) {
    throw new Error(
      'FARO_ADMIN_ACCESS_EQUIPO y FARO_ADMIN_ACCESS_AUD son obligatorias y deben identificar una aplicación de Cloudflare Access válida',
    );
  }
  if (audiencia === env.FARO_ACCESS_AUD?.trim()) {
    throw new Error('FARO_ADMIN_ACCESS_AUD debe ser distinta de FARO_ACCESS_AUD');
  }
  return { emisor, audiencia };
}

/** Access entrega el correo tal como lo escribió la persona; se compara y se muestra en minúsculas. */
function correoDe(valor: unknown): string | null {
  const correo = typeof valor === 'string' ? valor.toLowerCase() : null;
  return esCorreoVerificado(correo) ? correo : null;
}
/** También se comprueba la forma completa de aud y los tiempos sin desbordamiento antes de obtener identidad. */
function claimsAdministrativas(claims: Readonly<Record<string, unknown>>, ahora: number): boolean {
  const audiencias = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    audiencias.every(textoDeIdentidad) &&
    claims.type === 'app' &&
    !Object.hasOwn(claims, 'common_name') &&
    typeof claims.exp === 'number' &&
    Number.isFinite(claims.exp * MS_POR_SEGUNDO) &&
    claims.exp * MS_POR_SEGUNDO > ahora &&
    (claims.nbf === undefined ||
      (typeof claims.nbf === 'number' &&
        Number.isFinite(claims.nbf * MS_POR_SEGUNDO) &&
        claims.nbf * MS_POR_SEGUNDO <= ahora)) &&
    textoDeIdentidad(claims.sub)
  );
}

/**
 * Construye la guardia o falla sin revelar la configuración. Cada instancia conserva su caché por emisor y audiencia.
 * El principal identifica al sujeto por su emisor y exige un JWT válido, también en localhost y ante otras credenciales.
 */
export function guardiaAdministrativaDelEntorno(
  env: VariablesDelEntorno,
  pedir: PeticionHttp = fetch,
  ahora: () => number = () => Date.now(),
): GuardiaAdministrativa {
  const aplicacion = aplicacionAdministrativa(env);
  const exigirSegundoFactor = segundoFactorExigidoDelEntorno(env);
  const verificar = crearVerificadorAccess(aplicacion, pedir, ahora);
  return async (peticion) => {
    const claims = await verificar(peticion);
    if (!claims || !claimsAdministrativas(claims, ahora()) || typeof claims.sub !== 'string') {
      return null;
    }
    const segundoFactor = conSegundoFactor(claims.amr);
    if (exigirSegundoFactor && !segundoFactor) {
      throw new SegundoFactorRequerido();
    }
    return Object.freeze({
      emisor: aplicacion.emisor,
      sujeto: claims.sub,
      correo: correoDe(claims.email),
      emitidoEn:
        typeof claims.iat === 'number' && Number.isSafeInteger(claims.iat) && claims.iat >= 0 ? claims.iat : null,
      segundoFactor,
    });
  };
}
