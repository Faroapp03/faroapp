// La tarjeta de agente de Faro (Agent2Agent 1.0, sección 4.4.1 de la especificación): quién es, dónde y cómo se le
// habla (el enlace JSON-RPC en /a2a) y qué sabe hacer. Sus habilidades son las herramientas del servidor MCP, con el
// mismo identificador y la misma descripción (con la forma del mensaje A2A añadida): una sola lista para los dos protocolos, sin duplicar ninguna regla.

import { VERSION_FARO } from '../../comun/version.ts';
import { TIPO_JSON } from '../errores.ts';
import { HERRAMIENTAS } from '../mcp/herramientas.ts';

/** La versión del protocolo A2A que habla el agente (la cabecera A2A-Version de cada petición). */
export const VERSION_A2A = '1.0';
/** El enlace JSON-RPC del agente. */
export const RUTA_A2A = '/a2a';
/** Donde la especificación pide publicar la tarjeta (sección 8.2, URI bien conocida registrada en la IANA). */
export const RUTA_TARJETA = '/.well-known/agent-card.json';

/** Tipo de las partes de texto libre. */
const TIPO_TEXTO = 'text/plain';
/** Etiquetas de todas las habilidades. */
const SOLO_LECTURA = Object.freeze(['solo lectura', 'datos oficiales', 'sin llamadas a modelos']);
/** Palabras clave de cada habilidad, para que un catálogo de agentes la encuentre. */
const ETIQUETAS: Readonly<Record<string, readonly string[]>> = {
  buscar_ocupacion: ['ocupaciones', 'ESCO', 'CIUO-08'],
  explorar_grupos: ['CIUO-08', 'ISCO-08', 'clasificación'],
  ficha_grupo: ['tareas', 'exposición a la IA generativa', 'OIT'],
  formacion_oficial: ['formación', 'SEPE', 'SOC', 'Cataluña'],
  acreditacion_competencias: ['acreditación', 'certificados de profesionalidad', 'Cataluña'],
  contexto_del_grupo: ['empleo', 'salarios', 'Cataluña'],
  catalogo_datos_globales: ['catálogo', 'territorios', 'Cataluña', 'UE', 'países'],
  consultar_datos_globales: ['estadísticas', 'metas normativas', 'Cataluña', 'UE', 'países'],
};
/** Una habilidad de la tarjeta (AgentSkill): una herramienta del servidor MCP, con sus etiquetas y un ejemplo. */
interface HabilidadDeAgente {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes?: string[];
}

/** La tarjeta de agente (sección 4.4.1), con los campos que publica Faro. */
export interface TarjetaDeAgente {
  name: string;
  description: string;
  supportedInterfaces: { url: string; protocolBinding: 'JSONRPC'; protocolVersion: string }[];
  version: string;
  documentationUrl: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; extendedAgentCard: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: HabilidadDeAgente[];
}

const EJEMPLOS_GLOBALES: Readonly<Record<string, Record<string, unknown>>> = {
  catalogo_datos_globales: { seccion: 'territorios' },
  consultar_datos_globales: { seccion: 'indicadores', id: 'empresas-ia', territorio: 'ES51' },
};

/** Las estadísticas incluyen opiniones y cálculos: no se etiquetan todas como datos oficiales. */
function etiquetas(nombre: string): string[] {
  const comunes = Object.hasOwn(EJEMPLOS_GLOBALES, nombre) ? ['solo lectura', 'sin llamadas a modelos'] : SOLO_LECTURA;
  return [...comunes, ...(ETIQUETAS[nombre] ?? [])];
}

/** Un ejemplo de mensaje por habilidad: texto libre para buscar; para el resto, la parte de datos que la pide. */
function ejemplo(nombre: string): string {
  return nombre === 'buscar_ocupacion'
    ? 'recepcionista de hotel'
    : JSON.stringify({
        skill: nombre,
        arguments: EJEMPLOS_GLOBALES[nombre] ?? (nombre === 'explorar_grupos' ? { padre: '4' } : { isco: '4224' }),
      });
}

/**
 * La tarjeta, con las direcciones del origen desde el que se pide (el de la entidad que despliega Faro).
 *
 * @param origen - El origen (esquema y anfitrión, sin barra final) desde el que se pide la tarjeta.
 * @returns La tarjeta del agente, con sus direcciones bajo ese origen.
 */
export function tarjetaDeAgente(origen: string): TarjetaDeAgente {
  return {
    name: 'Faro',
    description:
      'Datos sobre Cataluña, la UE y países, con estadísticas, opiniones, cálculos y metas normativas diferenciados, y datos oficiales sobre cómo puede cambiar un trabajo con la IA generativa, tarea a tarea (notas de la OIT), y la formación oficial a su alcance en Cataluña. De solo lectura y sin llamadas a modelos durante la consulta. Antes de buscar, Faro retira los datos personales que reconoce su filtro. No envíes datos personales en las consultas. Es orientación, nunca una decisión: las cifras ocupacionales son de un grupo y las globales de un territorio, no de una persona, y Faro no busca empleo. Cada respuesta lleva su procedencia; no inventes cifras.',
    supportedInterfaces: [{ url: `${origen}${RUTA_A2A}`, protocolBinding: 'JSONRPC', protocolVersion: VERSION_A2A }],
    version: VERSION_FARO,
    documentationUrl: `${origen}/llms.txt`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: [TIPO_JSON],
    defaultOutputModes: [TIPO_JSON, TIPO_TEXTO],
    skills: [
      ...HERRAMIENTAS.map(({ name, title, description }) => ({
        id: name,
        name: title,
        description: `${description} Mensaje: una parte de datos {"skill": "${name}", "arguments": {…}} con los argumentos de la herramienta MCP del mismo nombre.`,
        tags: etiquetas(name),
        examples: [ejemplo(name)],
        ...(name === 'buscar_ocupacion' ? { inputModes: [TIPO_TEXTO, TIPO_JSON] } : {}),
      })),
    ],
  };
}
