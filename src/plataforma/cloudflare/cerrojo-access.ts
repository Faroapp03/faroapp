// Cerrojo de Cloudflare Access para la API del Worker. Con FARO_ACCESS_DECLARACION=pruebas-con-relatos-ficticios
// Faro solo puede atender relatos ficticios de las personas autorizadas y exige
// el acceso protegido de Cloudflare Access.
// Access añade a cada petición que deja pasar la cabecera Cf-Access-Jwt-Assertion: un JWT firmado (RS256) con las
// claves públicas del equipo de Access. Aquí se comprueban su firma, su audiencia (la etiqueta AUD de la aplicación),
// su emisor (el dominio del equipo) y su vigencia; sin un JWT válido, /api/* responde 403. Con esa declaración y sin
// configurar FARO_ACCESS_EQUIPO y FARO_ACCESS_AUD, el Worker no crea la API (503). Con la declaración «si» no se exige
// Access. Las claves públicas se piden al equipo (https://<equipo>.cloudflareaccess.com/cdn-cgi/access/certs) y se
// guardan en memoria; Access las cambia cada seis semanas, así que una clave desconocida obliga a volver a pedirlas.

import type { VariablesDelEntorno } from '../../comun/entorno.ts';
import { crearVerificadorAccess, emisorDelEquipo, type PeticionHttp } from '../../seguridad/access.ts';
import { comprobarVariablesDelServicio } from '../variables-del-servicio.ts';

export { CABECERA_ACCESS, type PeticionHttp } from '../../seguridad/access.ts';

/** Declaración de pruebas que exige Access también para las consultas factuales. */
const DECLARACION_DE_PRUEBAS = 'pruebas-con-relatos-ficticios';

/** Dice si una petición viene de Access con un JWT válido. */
export type Cerrojo = (peticion: Request) => Promise<boolean>;

/**
 * El cerrojo que pide el entorno: con la declaración de pruebas, el de la aplicación de FARO_ACCESS_EQUIPO y
 * FARO_ACCESS_AUD; con cualquier otra, ninguno (no se exige Access).
 *
 * @param env - Las variables del entorno del Worker.
 * @param pedir - Cómo se piden las claves públicas de Access; las pruebas pasan un doble.
 * @param ahora - El reloj, en milisegundos de época.
 * @returns El cerrojo, o null si la declaración no es la de pruebas.
 * @throws {Error} Con la declaración de pruebas, si falta FARO_ACCESS_EQUIPO o FARO_ACCESS_AUD o el equipo no es un
 *   dominio de Access: el Worker no crea la API.
 */
export function cerrojoDelEntorno(
  env: VariablesDelEntorno,
  pedir: PeticionHttp = fetch,
  ahora: () => number = () => Date.now(),
): Cerrojo | null {
  comprobarVariablesDelServicio(env);
  const declaracion = env.FARO_ACCESS_DECLARACION;
  if (declaracion !== undefined && declaracion !== 'si' && declaracion !== DECLARACION_DE_PRUEBAS) {
    throw new TypeError('Declaración de acceso no válida');
  }
  if (declaracion !== DECLARACION_DE_PRUEBAS) {
    return null;
  }
  const emisor = emisorDelEquipo(env.FARO_ACCESS_EQUIPO ?? '');
  const audiencia = (env.FARO_ACCESS_AUD ?? '').trim();
  if (!emisor || !audiencia) {
    throw new Error(
      `Con FARO_ACCESS_DECLARACION=${DECLARACION_DE_PRUEBAS} la API solo atiende detrás de Cloudflare Access: faltan FARO_ACCESS_EQUIPO (<equipo>.cloudflareaccess.com) o FARO_ACCESS_AUD (la etiqueta AUD de la aplicación)`,
    );
  }
  const verificar = crearVerificadorAccess({ emisor, audiencia }, pedir, ahora);
  return async (peticion) => (await verificar(peticion)) !== null;
}
