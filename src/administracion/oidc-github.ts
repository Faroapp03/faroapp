/** Identidad de un job propio de GitHub Actions; no autoriza transiciones ni acredita resultados del trabajo. */
import { pedirSinRedirecciones } from '../comun/salida-sin-redirecciones.ts';
import { MS_POR_SEGUNDO } from '../comun/tiempo.ts';
import { crearVerificadorJwtRs256, type PeticionHttpJwt } from '../seguridad/jwt-rs256.ts';

const EMISOR = 'https://token.actions.githubusercontent.com';
// URI confirmada en el discovery público oficial; nunca procede del token recibido.
const CLAVES = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const MAX_TOKEN_BYTES = 16_384;
const MAX_AUDIENCIA = 256;
const MAX_REF = 256;
const MAX_WORKFLOW = 512;
const MAX_JTI = 128;
const MAX_ANTIGUEDAD_S = 600;
const MARGEN_IAT_S = 30;
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]{0,15}$/;
const REF = /^refs\/(?:heads|tags)\/[^\s\p{Cc}]+$/u;
const WORKFLOW =
  /^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+\/\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml@refs\/(?:heads|tags)\/[^\s\p{Cc}]+$/u;
const codificador = new TextEncoder();
export interface ConfianzaOidcGitHub {
  readonly audiencia: string;
  readonly repositorioId: string;
  readonly propietarioId: string;
  readonly ref: string;
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly sha: string;
}
export interface IdentidadEjecucionGitHub {
  readonly repositorioId: string;
  readonly propietarioId: string;
  readonly ref: string;
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly sha: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly jti: string;
  readonly emitidoEn: number;
  readonly caducaEn: number;
}
function texto(valor: unknown, maxBytes: number): valor is string {
  return (
    typeof valor === 'string' &&
    valor.length > 0 &&
    valor.length <= maxBytes &&
    codificador.encode(valor).byteLength <= maxBytes &&
    !/[\s\p{Cc}]/u.test(valor)
  );
}
/** Un identificador numérico de GitHub (repositorio, propietario, run o actor): decimal sin ceros a la izquierda. */
export function esIdentificadorGitHub(valor: unknown): valor is string {
  return typeof valor === 'string' && ID.test(valor) && BigInt(valor) <= BigInt(Number.MAX_SAFE_INTEGER);
}
export function leerConfianzaOidcGitHub(entrada: unknown): ConfianzaOidcGitHub {
  const claves = ['audiencia', 'repositorioId', 'propietarioId', 'ref', 'workflowRef', 'workflowSha', 'sha'] as const;
  if (
    entrada === null ||
    typeof entrada !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(entrada)) ||
    Object.getOwnPropertySymbols(entrada).length ||
    Object.getOwnPropertyNames(entrada).length !== claves.length
  ) {
    throw new Error('Confianza OIDC de GitHub no válida');
  }
  const copia: Record<string, unknown> = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      throw new Error('Confianza OIDC de GitHub no válida');
    }
    copia[clave] = descriptor.value;
  }
  if (
    !texto(copia.audiencia, MAX_AUDIENCIA) ||
    !esIdentificadorGitHub(copia.repositorioId) ||
    !esIdentificadorGitHub(copia.propietarioId) ||
    !texto(copia.ref, MAX_REF) ||
    !REF.test(copia.ref) ||
    !texto(copia.workflowRef, MAX_WORKFLOW) ||
    !WORKFLOW.test(copia.workflowRef) ||
    typeof copia.workflowSha !== 'string' ||
    !SHA.test(copia.workflowSha) ||
    typeof copia.sha !== 'string' ||
    !SHA.test(copia.sha)
  ) {
    throw new Error('Confianza OIDC de GitHub no válida');
  }
  return Object.freeze({
    audiencia: copia.audiencia,
    repositorioId: copia.repositorioId,
    propietarioId: copia.propietarioId,
    ref: copia.ref,
    workflowRef: copia.workflowRef,
    workflowSha: copia.workflowSha,
    sha: copia.sha,
  });
}
function instante(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isSafeInteger(valor) &&
    valor >= 0 &&
    Number.isSafeInteger(valor * MS_POR_SEGUNDO)
  );
}
function tiemposValidos(claims: Readonly<Record<string, unknown>>, ahora: number): boolean {
  const { iat, nbf, exp } = claims;
  return (
    Number.isSafeInteger(ahora) &&
    ahora >= 0 &&
    instante(iat) &&
    instante(nbf) &&
    instante(exp) &&
    exp > iat &&
    exp * MS_POR_SEGUNDO > ahora &&
    nbf * MS_POR_SEGUNDO <= ahora &&
    iat * MS_POR_SEGUNDO <= ahora + MARGEN_IAT_S * MS_POR_SEGUNDO &&
    ahora - iat * MS_POR_SEGUNDO <= MAX_ANTIGUEDAD_S * MS_POR_SEGUNDO
  );
}
function jobDelWorkflow(claims: Readonly<Record<string, unknown>>, confianza: ConfianzaOidcGitHub): boolean {
  if (!Object.hasOwn(claims, 'job_workflow_ref') && !Object.hasOwn(claims, 'job_workflow_sha')) {
    return true;
  }
  return claims.job_workflow_ref === confianza.workflowRef && claims.job_workflow_sha === confianza.workflowSha;
}
function identidad(
  claims: Readonly<Record<string, unknown>>,
  confianza: ConfianzaOidcGitHub,
  ahora: number,
): IdentidadEjecucionGitHub | null {
  if (
    claims.iss !== EMISOR ||
    claims.aud !== confianza.audiencia ||
    claims.repository_id !== confianza.repositorioId ||
    claims.repository_owner_id !== confianza.propietarioId ||
    claims.ref !== confianza.ref ||
    claims.workflow_ref !== confianza.workflowRef ||
    claims.workflow_sha !== confianza.workflowSha ||
    claims.sha !== confianza.sha ||
    !jobDelWorkflow(claims, confianza)
  ) {
    return null;
  }
  if (
    !esIdentificadorGitHub(claims.run_id) ||
    !esIdentificadorGitHub(claims.run_attempt) ||
    !texto(claims.jti, MAX_JTI) ||
    typeof claims.workflow_sha !== 'string' ||
    !SHA.test(claims.workflow_sha) ||
    !tiemposValidos(claims, ahora)
  ) {
    return null;
  }
  // tiemposValidos valida los valores, sin sustituirlos por fechas del cuerpo del recibo.
  const { iat, exp } = claims;
  if (!instante(iat) || !instante(exp)) {
    return null;
  }
  return Object.freeze({
    repositorioId: confianza.repositorioId,
    propietarioId: confianza.propietarioId,
    ref: confianza.ref,
    workflowRef: confianza.workflowRef,
    workflowSha: claims.workflow_sha,
    sha: confianza.sha,
    runId: claims.run_id,
    runAttempt: claims.run_attempt,
    jti: claims.jti,
    emitidoEn: iat,
    caducaEn: exp,
  });
}
/**
 * Un token firmado de este repositorio y este propietario, con ref, workflow, run y plazos admitidos, pero emitido para
 * otra revisión del workflow o del código, es `revision_no_autorizada`; cualquier otro defecto es `rechazada`.
 */
export type VerificacionOidcGitHub =
  | { readonly estado: 'admitida'; readonly identidad: IdentidadEjecucionGitHub }
  | { readonly estado: 'revision_no_autorizada'; readonly identidad: IdentidadEjecucionGitHub }
  | { readonly estado: 'rechazada' };
const RECHAZADA: VerificacionOidcGitHub = Object.freeze({ estado: 'rechazada' });
/**
 * Comprueba el token contra la confianza con las revisiones que el propio token declara: así toda otra comprobación
 * es la misma que la del caso admitido, y solo la comparación final de revisiones distingue los dos resultados.
 */
function clasificar(
  claims: Readonly<Record<string, unknown>>,
  confianza: ConfianzaOidcGitHub,
  ahora: number,
): VerificacionOidcGitHub {
  const { workflow_sha: workflowSha, sha } = claims;
  if (typeof workflowSha !== 'string' || !SHA.test(workflowSha) || typeof sha !== 'string' || !SHA.test(sha)) {
    return RECHAZADA;
  }
  const comprobada = identidad(claims, { ...confianza, workflowSha, sha }, ahora);
  if (comprobada === null) {
    return RECHAZADA;
  }
  const autorizada = workflowSha === confianza.workflowSha && sha === confianza.sha;
  return Object.freeze({ estado: autorizada ? 'admitida' : 'revision_no_autorizada', identidad: comprobada });
}
type AfirmacionesOidcGitHub = Readonly<Record<string, unknown>>;
/** El veredicto y las afirmaciones firmadas de las que sale; sin firma válida no hay afirmaciones. */
interface LecturaOidcGitHub {
  readonly verificacion: VerificacionOidcGitHub;
  readonly afirmaciones: AfirmacionesOidcGitHub | null;
}
const SIN_LECTURA: LecturaOidcGitHub = Object.freeze({ verificacion: RECHAZADA, afirmaciones: null });
/** Tamaño, firma y clasificación en un único sitio, compartido por el clasificador y el admisor. */
function crearLectorOidcGitHub(
  confianza: ConfianzaOidcGitHub,
  pedir: PeticionHttpJwt,
  ahora: () => number,
): (token: string) => Promise<LecturaOidcGitHub> {
  const configuracion = leerConfianzaOidcGitHub(confianza);
  const verificar = crearVerificadorJwtRs256(
    { emisor: EMISOR, audiencia: configuracion.audiencia, urlClaves: CLAVES },
    (url, opciones) => pedirSinRedirecciones(url, opciones, pedir),
    ahora,
  );
  return async (token) => {
    if (
      typeof token !== 'string' ||
      token.length > MAX_TOKEN_BYTES ||
      codificador.encode(token).byteLength > MAX_TOKEN_BYTES
    ) {
      return SIN_LECTURA;
    }
    try {
      const claims = await verificar(token);
      return claims
        ? Object.freeze({ verificacion: clasificar(claims, configuracion, ahora()), afirmaciones: claims })
        : SIN_LECTURA;
    } catch {
      return SIN_LECTURA;
    }
  };
}
/** Solo recibe el JWT compacto. HTTP, correlación del run y antirrepetición pertenecen al receptor. */
export function crearClasificadorOidcGitHub(
  confianza: ConfianzaOidcGitHub,
  pedir: PeticionHttpJwt = fetch,
  ahora: () => number = Date.now,
): (token: string) => Promise<VerificacionOidcGitHub> {
  const leer = crearLectorOidcGitHub(confianza, pedir, ahora);
  return async (token) => (await leer(token)).verificacion;
}
/** La identidad admitida junto con las demás afirmaciones firmadas del mismo token. */
export interface AdmisionOidcGitHub {
  readonly identidad: IdentidadEjecucionGitHub;
  readonly afirmaciones: AfirmacionesOidcGitHub;
}
/**
 * Para los verificadores que exigen afirmaciones además de la identidad: solo un veredicto `admitida` (revisión y
 * workflow autorizados) entrega las afirmaciones, de modo que ninguna exigencia añadida puede admitir otra revisión.
 */
export function crearAdmisorOidcGitHub(
  confianza: ConfianzaOidcGitHub,
  pedir: PeticionHttpJwt = fetch,
  ahora: () => number = Date.now,
): (token: string) => Promise<AdmisionOidcGitHub | null> {
  const leer = crearLectorOidcGitHub(confianza, pedir, ahora);
  return async (token) => {
    const { verificacion, afirmaciones } = await leer(token);
    return verificacion.estado === 'admitida' && afirmaciones !== null
      ? Object.freeze({ identidad: verificacion.identidad, afirmaciones })
      : null;
  };
}
/** Solo la identidad de la revisión autorizada; cualquier otro resultado es null. */
export function crearVerificadorOidcGitHub(
  confianza: ConfianzaOidcGitHub,
  pedir: PeticionHttpJwt = fetch,
  ahora: () => number = Date.now,
): (token: string) => Promise<IdentidadEjecucionGitHub | null> {
  const clasificarToken = crearClasificadorOidcGitHub(confianza, pedir, ahora);
  return async (token) => {
    const verificacion = await clasificarToken(token);
    return verificacion.estado === 'admitida' ? verificacion.identidad : null;
  };
}
