/** Política durable por petición. Este módulo es portable y no conoce SQLite, Access ni secretos. */
import type { UsoConectividad } from '../administracion/accesos.ts';
import { type DocumentoControles, leerDocumentoControles } from '../administracion/controles.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { RUTA_A2A, RUTA_TARJETA } from './a2a/tarjeta.ts';
import type { ContextoApi } from './contexto-api.ts';
import { problema, registrarErrorOperativo, respuestaDeProblema } from './errores.ts';
import { RUTA_MCP } from './mcp/servidor-mcp.ts';
import { dentroDelPlazo } from './plazo.ts';
import { esDeLaApiDeSocios } from './socios/api-de-socios.ts';
import { esDescubrimientoOAuth } from './socios/descubrimiento-oauth.ts';
import type { OpcionesDeSocios } from './socios/servidor-socios.ts';

export interface AdministracionApi {
  registrarAcceso?(uso: UsoConectividad): Promise<void>;
  leerControles(senal: AbortSignal): Promise<DocumentoControles>;
  /**
   * Capacidad institucional preparada independientemente de la semilla REST; la política durable decide su exposición.
   */
  socios?: OpcionesDeSocios;
}
export type CapacidadesAdministradas = Pick<ContextoApi, 'mcp' | 'a2a' | 'socios'>;
export type DisponibilidadConectividad = DocumentoControles | 'apagado-sin-administracion' | null;
/** Ausencia explícita de los tres montajes, distinta de una autoridad que no puede leerse. */
export function disponibilidadSinAdministracion(capacidades: CapacidadesAdministradas): DisponibilidadConectividad {
  return capacidades.mcp === null && capacidades.a2a === null && capacidades.socios === null
    ? 'apagado-sin-administracion'
    : null;
}
const ESPERA_CONTROLES_MS = 1000;

/** Una captura propia; null es indisponibilidad, nunca una vuelta a la política de arranque. */
export async function capturarControles(
  administracion: AdministracionApi | undefined,
  senal: AbortSignal,
): Promise<DocumentoControles | null> {
  if (!administracion) {
    return null;
  }
  try {
    const controles = await dentroDelPlazo(
      (lectura) => administracion.leerControles(lectura),
      ESPERA_CONTROLES_MS,
      senal,
    );
    const copia = leerDocumentoControles(controles);
    return Object.freeze(copia);
  } catch (error) {
    senal.throwIfAborted();
    registrarErrorOperativo('controles', error);
    return null;
  }
}
/** Una decisión para estado, rutas y descripciones; una autoridad fallida nunca cae al apagado de arranque. */
export function capturarDisponibilidad(
  administracion: AdministracionApi | undefined,
  capacidades: CapacidadesAdministradas,
  senal: AbortSignal,
): Promise<DisponibilidadConectividad> {
  return administracion
    ? capturarControles(administracion, senal)
    : Promise.resolve(disponibilidadSinAdministracion(capacidades));
}
export function proyectarControles(
  base: ContextoApi,
  controles: DisponibilidadConectividad,
  capacidades: CapacidadesAdministradas,
): ContextoApi {
  if (!controles || controles === 'apagado-sin-administracion') {
    return {
      ...base,
      mcp: null,
      a2a: null,
      socios: capacidades.socios,
    };
  }
  return {
    ...base,
    mcp: controles.mcp ? capacidades.mcp : null,
    a2a: controles.a2a ? capacidades.a2a : null,
    socios: capacidades.socios,
  };
}
function agenteApagado(controles: DocumentoControles, camino: string): boolean {
  const mcp = camino === RUTA_MCP;
  const a2a = camino === RUTA_A2A || camino === RUTA_TARJETA;
  return (mcp && !controles.mcp) || (a2a && !controles.a2a);
}
/** Toda la API institucional, incluido OAuth, depende de la misma política; apagado y fallo son estados distintos. */
export function problemaDeControles(controles: DisponibilidadConectividad, camino: string) {
  if (controles === 'apagado-sin-administracion') {
    return problemaDeServiciosSinMontar({ mcp: null, a2a: null, socios: null }, camino);
  }
  const externo = camino === RUTA_MCP || camino === RUTA_A2A || camino === RUTA_TARJETA;
  const rest = esDeLaApiDeSocios(camino);
  if (!controles && (externo || rest || esDescubrimientoOAuth(camino))) {
    return respuestaDeProblema(
      problema(ESTADO_HTTP.noDisponible, 'no_configurado', 'Los controles del servicio no están disponibles.'),
    );
  }
  if (controles && agenteApagado(controles, camino)) {
    return respuestaDeProblema(
      problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'Este servicio no está habilitado.'),
    );
  }
  if (controles?.api === 'deshabilitada' && (rest || esDescubrimientoOAuth(camino))) {
    return respuestaDeProblema(
      problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'Este servicio no está habilitado.'),
    );
  }
  return null;
}

/** OFF conocido sin panel: no crea una autoridad ni usa semillas para recuperar una lectura que ha fallado. */
export function problemaDeServiciosSinMontar(capacidades: CapacidadesAdministradas, camino: string) {
  const servicio = [
    { pertenece: camino === RUTA_MCP, activo: capacidades.mcp !== null },
    { pertenece: camino === RUTA_A2A || camino === RUTA_TARJETA, activo: capacidades.a2a !== null },
    { pertenece: esDeLaApiDeSocios(camino) || esDescubrimientoOAuth(camino), activo: capacidades.socios !== null },
  ].find((s) => s.pertenece);
  if (!servicio) {
    return null;
  }
  return servicio.activo
    ? respuestaDeProblema(
        problema(ESTADO_HTTP.noDisponible, 'no_configurado', 'Los controles del servicio no están disponibles.'),
      )
    : respuestaDeProblema(problema(ESTADO_HTTP.noEncontrado, 'ruta_desconocida', 'Este servicio no está habilitado.'));
}
