// Configuración de servicio compartida por Worker y Node: oferta, plazo, firma y canales factuales.
// Los interruptores y enumeraciones son exactos: un valor mal escrito impide arrancar.

import {
  MODOS_FORMACION_ABIERTA,
  OFERTA_POR_DEFECTO,
  type OfertaDeFormacion,
} from '../../compartido/contratos/oferta-de-formacion.ts';
import { type ClaveDeFirma, ClavesDeFirmaInvalidas, clavesDeFirmaDe } from '../api/mcp/firma-de-respuesta.ts';
import { plazoDelEntorno } from '../api/plazo.ts';
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { CAMINO_A_MANO_POR_DEFECTO } from '../dominio/camino-a-mano.ts';

/** Los dos valores de un interruptor: exactamente «si» o «no». */
const SI_O_NO = ['si', 'no'] as const;

/** Una variable con un valor que no está entre los previstos: la API no arranca y el registro dice por qué. */
export class ErrorDeConfiguracion extends Error {
  override readonly name = 'ErrorDeConfiguracion';
}

/** Los secretos de firma de las respuestas, tal como llegan del entorno. */
interface SeguridadDelEntorno {
  secretoFirma?: string;
  secretoFirmaAnterior?: string;
}

/** Los canales factuales MCP y A2A que enciende el entorno. */
export interface AgentesDelEntorno {
  mcp: boolean;
  a2a: boolean;
}

/** Los agentes, apagados mientras el entorno no los encienda. */
const AGENTES_POR_DEFECTO: AgentesDelEntorno = { mcp: false, a2a: false };

/**
 * Lo que el entorno dice de la API, igual en las dos plataformas: todo menos los datos y lo propio de cada plataforma.
 */
export interface OpcionesDelEntorno {
  oferta: OfertaDeFormacion;
  plazoMs: number;
  seguridad: SeguridadDelEntorno;
  /** La exploración manual usa datos locales y no habilita inferencia externa. */
  caminoAMano: boolean;
  /**
   * Los canales de agentes, las claves con que el servidor MCP firma sus resultados (si las hay) y la API para
   * socios (null, apagada).
   */
  agentes: AgentesDelEntorno & { clavesFirmaMcp: ClaveDeFirma[] | null };
}

/** Un interruptor «si» o «no»; sin la variable, `porDefecto`. */
function siONo(variables: VariablesDelEntorno, nombre: string, porDefecto: boolean): boolean {
  return unoDe(variables, nombre, SI_O_NO, porDefecto ? 'si' : 'no') === 'si';
}

/**
 * Si `valor` es exactamente uno de `admitidos`: la comparación con cada uno es la que estrecha el tipo.
 *
 * @param valor - El valor leído.
 * @param admitidos - Los valores que se admiten.
 * @returns Si es uno de ellos.
 */
export function esUnoDe<T extends string>(valor: string | undefined, admitidos: readonly T[]): valor is T {
  return admitidos.some((admitido) => admitido === valor);
}

/**
 * El valor de `nombre` si es exactamente uno de `admitidos`; sin la variable, `porDefecto`; con otro, no arranca.
 *
 * @param variables - Las variables del despliegue.
 * @param nombre - La variable.
 * @param admitidos - Los valores que admite.
 * @param porDefecto - El valor sin la variable.
 * @returns El valor admitido.
 * @throws {ErrorDeConfiguracion} Con un valor que no admite.
 */
export function unoDe<T extends string>(
  variables: VariablesDelEntorno,
  nombre: string,
  admitidos: readonly T[],
  porDefecto: T,
): T {
  const valor = variables[nombre];
  if (valor === undefined) {
    return porDefecto;
  }
  if (!esUnoDe(valor, admitidos)) {
    throw new ErrorDeConfiguracion(`${nombre} admite ${admitidos.join(', ')} («${valor}»)`);
  }
  return valor;
}

/**
 * La formación de fuera del catálogo oficial que enseña el informe: FARO_FORMACION_ABIERTA y FARO_CITILAB_PAGO.
 *
 * @param variables - Las variables del despliegue.
 * @returns La oferta que enseña el informe.
 */
/**
 * Si dos instantáneas de variables tienen exactamente las mismas claves con los mismos valores: decide si un montaje
 * hecho con las guardadas sigue valiendo para las actuales.
 */
export function mismasVariables(guardadas: Record<string, string>, actuales: Record<string, string>): boolean {
  const claves = Object.keys(actuales);
  return (
    Object.keys(guardadas).length === claves.length && claves.every((clave) => guardadas[clave] === actuales[clave])
  );
}

function ofertaDelEntorno(variables: VariablesDelEntorno): OfertaDeFormacion {
  return {
    formacionAbierta: unoDe(
      variables,
      'FARO_FORMACION_ABIERTA',
      MODOS_FORMACION_ABIERTA,
      OFERTA_POR_DEFECTO.formacionAbierta,
    ),
    citilabDePago: siONo(variables, 'FARO_CITILAB_PAGO', OFERTA_POR_DEFECTO.citilabDePago),
  };
}

/**
 * La selección manual de ocupación (dominio/camino-a-mano.ts): FARO_CAMINO_A_MANO.
 *
 * @param variables - Las variables del despliegue.
 * @returns Si está habilitada la selección manual.
 */
function caminoAManoDelEntorno(variables: VariablesDelEntorno): boolean {
  return siONo(variables, 'FARO_CAMINO_A_MANO', CAMINO_A_MANO_POR_DEFECTO);
}

/**
 * Los canales de agentes (docs/mcp.md): MCP (FARO_MCP) y A2A (FARO_A2A), apagados por defecto.
 *
 * @param variables - Las variables del despliegue.
 * @returns Si se encienden el servidor MCP y el agente A2A.
 */
export function agentesDelEntorno(variables: VariablesDelEntorno): AgentesDelEntorno {
  return {
    mcp: siONo(variables, 'FARO_MCP', AGENTES_POR_DEFECTO.mcp),
    a2a: siONo(variables, 'FARO_A2A', AGENTES_POR_DEFECTO.a2a),
  };
}

/**
 * Las claves con que el servidor MCP firma sus resultados (FARO_FIRMA_MCP_CLAVES, docs/mcp.md): sin la variable, o
 * vacía, ninguna, y las respuestas van sin firma. Unas claves que no cuadran no arrancan, para que un error al pegarlas
 * no deje el servidor sin firma sin decirlo; el mensaje no repite ningún valor de la variable.
 */
function clavesFirmaMcpDelEntorno(variables: VariablesDelEntorno): ClaveDeFirma[] | null {
  try {
    return clavesDeFirmaDe(variables.FARO_FIRMA_MCP_CLAVES);
  } catch (error) {
    if (error instanceof ClavesDeFirmaInvalidas) {
      throw new ErrorDeConfiguracion(error.message);
    }
    throw error;
  }
}

/** Los servicios externos requieren la autoridad del panel, incluso cuando la semilla los deja apagados. */
function agentesAdministrados(variables: VariablesDelEntorno): AgentesDelEntorno {
  const agentes = agentesDelEntorno(variables);
  const api = siONo(variables, 'FARO_API_SOCIOS', false);
  const administrada = siONo(variables, 'FARO_ADMINISTRACION', false);
  if ((api || agentes.mcp || agentes.a2a) && !administrada) {
    throw new ErrorDeConfiguracion('La conectividad requiere la administración configurada');
  }
  return agentes;
}

/**
 * Las opciones de la API que salen del entorno. Valida cada valor antes de componer las opciones.
 *
 * @param variables - Las variables del despliegue.
 * @returns Las opciones de la API.
 * @throws {ErrorDeConfiguracion} Con el primer valor que no se entiende.
 */
export function opcionesDelEntorno(variables: VariablesDelEntorno): OpcionesDelEntorno {
  return {
    oferta: ofertaDelEntorno(variables),
    plazoMs: plazoDelEntorno(variables),
    seguridad: {
      // Vacío es como sin secreto: crearFirmador usa uno aleatorio. El Worker exige que esté (worker.ts, loExigido).
      ...(variables.FARO_SECRETO_FIRMA ? { secretoFirma: variables.FARO_SECRETO_FIRMA } : {}),
      // Durante una rotación (seguridad/firma.ts): se comprueba con el anterior mientras esté configurado, no se firma.
      ...(variables.FARO_SECRETO_FIRMA_ANTERIOR ? { secretoFirmaAnterior: variables.FARO_SECRETO_FIRMA_ANTERIOR } : {}),
    },
    caminoAMano: caminoAManoDelEntorno(variables),
    agentes: {
      ...agentesAdministrados(variables),
      clavesFirmaMcp: clavesFirmaMcpDelEntorno(variables),
    },
  };
}
