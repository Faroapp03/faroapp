// Verificación de Cloudflare Access compartida por los adaptadores: RS256 y caché por aplicación.
// No decide permisos ni depende de perfiles IA; las claims solo salen después de verificar el JWT.

import { ClavesNoDisponibles, crearVerificadorJwtRs256 } from './jwt-rs256.ts';

/** Cabecera con el JWT que pone Cloudflare Access en cada petición que deja pasar. */
export const CABECERA_ACCESS = 'cf-access-jwt-assertion';
/** Dónde publica sus claves públicas un equipo de Access, desde su dominio. */
const RUTA_CLAVES = '/cdn-cgi/access/certs';
const DOMINIO_DE_EQUIPO = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
/** Avisos sin datos internos: ni el token ni el detalle del fallo. */
const AVISO_CLAVES = 'No se ha podido completar la verificación de Cloudflare Access: la petición no pasa';
const AVISO_INTERNO = 'Error interno al verificar Cloudflare Access: la petición no pasa';
export type PeticionHttp = typeof fetch;
export type VerificadorAccess = (peticion: Request) => Promise<Readonly<Record<string, unknown>> | null>;
export interface AplicacionAccess {
  emisor: string;
  audiencia: string;
}

/** Mantiene la cabecera, la política y el diagnóstico de Access sobre el motor compartido. */
export function crearVerificadorAccess(
  aplicacion: AplicacionAccess,
  pedir: PeticionHttp,
  ahora: () => number,
): VerificadorAccess {
  const configuracion = { ...aplicacion };
  const verificar = crearVerificadorJwtRs256(
    { ...configuracion, urlClaves: `${configuracion.emisor}${RUTA_CLAVES}` },
    pedir,
    ahora,
  );
  return async (peticion) => {
    const token = peticion.headers.get(CABECERA_ACCESS) ?? '';
    try {
      return await verificar(token);
    } catch (error) {
      // Los dos casos deniegan; solo se distingue el origen: el servicio de claves caído es un fallo operativo, y
      // cualquier otro error (reloj, WebCrypto, programación) es interno.
      if (error instanceof ClavesNoDisponibles) {
        console.warn(AVISO_CLAVES);
      } else {
        console.error(AVISO_INTERNO);
      }
      return null;
    }
  };
}

/** El emisor de los JWT de un equipo («faro», «faro.cloudflareaccess.com» o su dirección), o null si no lo es. */
export function emisorDelEquipo(equipo: string): string | null {
  const nombre = equipo
    .trim()
    .replace(/^https:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  const dominio = nombre.includes('.') ? nombre : `${nombre}.cloudflareaccess.com`;
  return DOMINIO_DE_EQUIPO.test(dominio) ? `https://${dominio}` : null;
}
