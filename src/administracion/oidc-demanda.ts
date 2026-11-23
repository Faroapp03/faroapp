/**
 * Identidad de un run lanzado a mano que pide un ciclo a demanda. Parte del veredicto `admitida` del verificador OIDC
 * (revisión y workflow autorizados) y exige además quién lo lanzó, cómo y dónde corre; no autoriza la reserva: los
 * topes y la autoridad deciden después.
 */
import type { PeticionHttpJwt } from '../seguridad/jwt-rs256.ts';
import {
  type ConfianzaOidcGitHub,
  crearAdmisorOidcGitHub,
  esIdentificadorGitHub,
  type IdentidadEjecucionGitHub,
} from './oidc-github.ts';

/** Solo un lanzamiento manual del workflow; un push, un cron o una llamada entre workflows no piden ciclos. */
const EVENTO_A_DEMANDA = 'workflow_dispatch';
/** Un runner propio podría estar fuera del control de GitHub; solo se admite el alojado por GitHub. */
const RUNNER_ALOJADO = 'github-hosted';
/** Un reintento repetiría la petición del primer intento: la reserva se pide una sola vez por run. */
const PRIMER_INTENTO = '1';
const MAX_ACTORES = 8;
/** Nombre de cuenta de GitHub (hasta 39 caracteres) o de una aplicación (`nombre[bot]`); solo se muestra. */
const NOMBRE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/;
const ERROR_ACTORES = 'Actores de la actualización a demanda no válidos';
/** Si un valor tiene la forma de un nombre de cuenta o de aplicación de GitHub. */
export function esNombreDeActorGitHub(valor: unknown): valor is string {
  return typeof valor === 'string' && NOMBRE_ACTOR.test(valor);
}

/** Quién lanzó el run: el identificador numérico autoriza; el nombre solo sirve para mostrarlo. */
export interface ActorDemandaGitHub {
  readonly id: string;
  readonly nombre: string;
}
export interface IdentidadDemandaGitHub {
  readonly ejecucion: IdentidadEjecucionGitHub;
  readonly actor: ActorDemandaGitHub;
}

/**
 * Si es una lista de actores admitidos: identificadores numéricos de GitHub, sin repetir. Un nombre de cuenta puede
 * cambiar de dueño; el identificador no. Una lista vacía es válida y no admite a nadie.
 */
export function sonActoresDemanda(entrada: unknown): entrada is readonly string[] {
  if (!Array.isArray(entrada) || Object.getPrototypeOf(entrada) !== Array.prototype || entrada.length > MAX_ACTORES) {
    return false;
  }
  const actores = Array.from(entrada, (actor: unknown) => actor);
  return actores.every(esIdentificadorGitHub) && new Set(actores).size === actores.length;
}
/** Copia inmutable de una lista de actores admitidos; cualquier otra entrada es un error de configuración. */
export function leerActoresDemanda(entrada: unknown): readonly string[] {
  if (!sonActoresDemanda(entrada)) {
    throw new Error(ERROR_ACTORES);
  }
  return Object.freeze(Array.from(entrada));
}

/** El actor de unas afirmaciones ya admitidas, o null si el lanzamiento no es uno a demanda permitido. */
function actorDeDemanda(
  afirmaciones: Readonly<Record<string, unknown>>,
  actores: readonly string[],
): ActorDemandaGitHub | null {
  if (afirmaciones.event_name !== EVENTO_A_DEMANDA) {
    return null;
  }
  // Un token que no declara dónde corre no acredita que sea un runner de GitHub.
  if (afirmaciones.runner_environment !== RUNNER_ALOJADO) {
    return null;
  }
  const { actor_id: id, actor: nombre } = afirmaciones;
  if (!esIdentificadorGitHub(id) || !actores.includes(id) || !esNombreDeActorGitHub(nombre)) {
    return null;
  }
  return Object.freeze({ id, nombre });
}

type VerificadorDemanda = (token: string) => Promise<IdentidadDemandaGitHub | null>;
/**
 * La identidad del run y su actor si el token es de la revisión autorizada y de un lanzamiento permitido, en cualquier
 * intento del run; si no, null. El token se verifica una sola vez: lo que depende del intento lo decide después
 * `puedeReservar`.
 */
export function crearVerificadorDemandaGitHub(
  confianza: ConfianzaOidcGitHub,
  actoresAdmitidos: readonly string[],
  pedir: PeticionHttpJwt = fetch,
  ahora: () => number = Date.now,
): VerificadorDemanda {
  const actores = leerActoresDemanda(actoresAdmitidos);
  const admitir = crearAdmisorOidcGitHub(confianza, pedir, ahora);
  return async (token) => {
    const admision = await admitir(token);
    const actor = admision === null ? null : actorDeDemanda(admision.afirmaciones, actores);
    return admision === null || actor === null ? null : Object.freeze({ ejecucion: admision.identidad, actor });
  };
}
/** Solo el primer intento reserva; cualquier intento del mismo run puede consultar la reserva que aquel obtuvo. */
export function puedeReservar(identidad: IdentidadDemandaGitHub): boolean {
  return identidad.ejecucion.runAttempt === PRIMER_INTENTO;
}
