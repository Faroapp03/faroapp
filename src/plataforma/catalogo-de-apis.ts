// Catálogo de las API de Faro (RFC 9727) en /.well-known/api-catalog: la lista, legible por máquina, de lo que este
// despliegue ofrece a otros programas, en formato linkset (RFC 9264, application/linkset+json) con el perfil de
// RFC 9727.
// Lleva la API REST con su descripción OpenAPI y su estado y, solo si la entidad que despliega Faro los ha encendido
// (FARO_MCP, FARO_A2A, FARO_API_SOCIOS), el servidor MCP, el agente A2A y la API para socios: un catálogo no anuncia lo
// que no existe. Las direcciones van absolutas, con el origen propio, como recomienda RFC 9264 (4.2.2 y 4.2.3). Igual
// en el Worker y en el servidor local.

import { RUTA_A2A, RUTA_TARJETA } from '../api/a2a/tarjeta.ts';
import { problema, TIPO_PROBLEMA } from '../api/http.ts';
import { RUTA_MCP } from '../api/mcp/servidor-mcp.ts';
import { RUTA_SOCIOS } from '../api/socios/servidor-socios.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { ENLACE_AL_CATALOGO, RUTA_CATALOGO_DE_APIS } from './cabeceras-web.ts';

/** El perfil que declara que un linkset es un catálogo de API (RFC 9727, 7.3). */
const PERFIL_DEL_CATALOGO = 'https://www.rfc-editor.org/info/rfc9727';
/** El tipo del catálogo: linkset en JSON con su perfil (RFC 9727, 4.2; RFC 9264, 5). */
export const TIPO_DEL_CATALOGO = `application/linkset+json; profile="${PERFIL_DEL_CATALOGO}"`;
/** La descripción OpenAPI 3.1 de la API REST publicada en web/openapi.json. */
const RUTA_OPENAPI = '/openapi.json';
/** Dónde dice la API si está en marcha (api/rutas/salud.ts): el «status» de RFC 8631. */
const RUTA_SALUD = '/api/salud';
/** Lo que explica a personas y agentes qué ofrece Faro a otros programas y en qué condiciones (web/llms.txt). */
const RUTA_PARA_AGENTES = '/llms.txt';
/** Los métodos que exige RFC 9727 (2) en el catálogo, los únicos que admite. */
const METODOS_DEL_CATALOGO: readonly string[] = ['GET', 'HEAD'];
/**
 * Una hora en cachés: el catálogo solo cambia cuando la entidad enciende o apaga un agente o la API para socios, y eso
 * pide desplegar de nuevo.
 */
const CACHE_DEL_CATALOGO = 'public, max-age=3600';
/** Un destino de un enlace del linkset (RFC 9264, 4.2.3 y 4.2.4.1). */
interface DestinoDelEnlace {
  href: string;
  type?: string;
  title?: string;
  hreflang?: readonly string[];
}

/**
 * Un contexto del linkset: su `anchor` y, por cada relación (RFC 8288; las de servicios, RFC 8631), la lista de sus
 * destinos, también si es uno solo (RFC 9264, 4.2.2).
 */
interface ContextoDelEnlace {
  anchor: string;
  [relacion: string]: string | readonly DestinoDelEnlace[];
}

/** El documento del catálogo: un objeto con «linkset» como único miembro (RFC 9264, 4.2.1). */
export interface Catalogo {
  linkset: readonly ContextoDelEnlace[];
}

/**
 * Qué publica el despliegue para otros programas, además de la API REST: los agentes de solo lectura (FARO_MCP,
 * FARO_A2A) y la API para socios (FARO_API_SOCIOS), agrupados como en las opciones de la API (`agentes`).
 */
export interface AgentesPublicados {
  readonly mcp: boolean;
  readonly a2a: boolean;
  readonly socios: boolean;
}

/**
 * Los contextos del servidor MCP, del agente A2A y de la API para socios que estén encendidos, con lo que los explica y
 * los describe. La API para socios no tiene explicación publicada (la suya, docs/api/socios.md, no sale con la web): su
 * descripción es la misma OpenAPI, donde sus operaciones llevan la etiqueta «socios» y su esquema OAuth 2.0.
 */
function contextosDeLosAgentes(origen: string, agentes: AgentesPublicados): ContextoDelEnlace[] {
  const explicacion: DestinoDelEnlace = { href: `${origen}${RUTA_PARA_AGENTES}`, type: 'text/plain', hreflang: ['es'] };
  const contextos: ContextoDelEnlace[] = [];
  if (agentes.mcp) {
    contextos.push({ anchor: `${origen}${RUTA_MCP}`, 'service-doc': [explicacion] });
  }
  if (agentes.a2a) {
    contextos.push({
      anchor: `${origen}${RUTA_A2A}`,
      // La tarjeta del agente es la descripción del servicio que define Agent2Agent, para máquinas.
      'service-desc': [{ href: `${origen}${RUTA_TARJETA}`, type: 'application/json' }],
      'service-doc': [explicacion],
    });
  }
  if (agentes.socios) {
    contextos.push({
      anchor: `${origen}${RUTA_SOCIOS}/`,
      'service-desc': [{ href: `${origen}${RUTA_OPENAPI}`, type: 'application/json' }],
    });
  }
  return contextos;
}

/**
 * El catálogo de un origen (https://<dominio>): primero, cada API como «item» del propio catálogo (RFC 9727, A.2), y
 * después, por cada una, lo que la describe: la descripción para máquinas (service-desc), la explicación para personas
 * (service-doc) y su estado (status), con las relaciones de RFC 8631.
 *
 * @param origen - El origen (https://<dominio>).
 * @param agentes - Los agentes publicados.
 * @returns El catálogo.
 */
export function catalogoDeApis(origen: string, agentes: AgentesPublicados): Catalogo {
  const api = `${origen}/api/`;
  const elementos: DestinoDelEnlace[] = [
    { href: api, title: 'API REST de Faro' },
    ...(agentes.mcp ? [{ href: `${origen}${RUTA_MCP}`, title: 'Servidor MCP de Faro, de solo lectura' }] : []),
    ...(agentes.a2a ? [{ href: `${origen}${RUTA_A2A}`, title: 'Agente A2A de Faro, de solo lectura' }] : []),
    ...(agentes.socios ? [{ href: `${origen}${RUTA_SOCIOS}/`, title: 'API para socios de Faro (OAuth 2.0)' }] : []),
  ];
  return {
    linkset: [
      { anchor: `${origen}${RUTA_CATALOGO_DE_APIS}`, item: elementos },
      {
        anchor: api,
        'service-desc': [{ href: `${origen}${RUTA_OPENAPI}`, type: 'application/json' }],
        status: [{ href: `${origen}${RUTA_SALUD}`, type: 'application/json' }],
      },
      ...contextosDeLosAgentes(origen, agentes),
    ],
  };
}

/**
 * La respuesta en /.well-known/api-catalog: a GET, el catálogo; a HEAD, lo mismo sin cuerpo; las dos con el enlace
 * rel="api-catalog" que pide RFC 9727 (2). Otro método, 405 en Problem Details con los admitidos.
 *
 * @param metodo - El método HTTP de la petición.
 * @param origen - El origen (https://<dominio>).
 * @param agentes - Los agentes publicados.
 * @returns La respuesta HTTP con el catálogo.
 */
export function respuestaDelCatalogo(
  metodo: string,
  origen: string,
  agentes: AgentesPublicados = { mcp: false, a2a: false, socios: false },
): Response {
  if (!METODOS_DEL_CATALOGO.includes(metodo)) {
    const admitidos = METODOS_DEL_CATALOGO.join(', ');
    const cuerpo = problema(
      ESTADO_HTTP.metodoNoAdmitido,
      'metodo_no_admitido',
      `El catálogo de las API admite ${admitidos}.`,
    );
    return new Response(JSON.stringify(cuerpo), {
      status: cuerpo.status,
      headers: { allow: admitidos, 'content-type': `${TIPO_PROBLEMA}; charset=utf-8` },
    });
  }
  const cuerpo = metodo === 'GET' ? JSON.stringify(catalogoDeApis(origen, agentes)) : null;
  return new Response(cuerpo, {
    headers: { 'content-type': TIPO_DEL_CATALOGO, 'cache-control': CACHE_DEL_CATALOGO, link: ENLACE_AL_CATALOGO },
  });
}
