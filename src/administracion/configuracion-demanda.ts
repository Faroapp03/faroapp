/**
 * Configuración no secreta de los ciclos a demanda. Los techos del código acotan lo que la variable puede pedir: una
 * variable ausente, ilegible o fuera de esos techos deja la vía cerrada, nunca abierta con valores corregidos.
 */
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { leerActoresDemanda, sonActoresDemanda } from './oidc-demanda.ts';

/** La lista cerrada de acciones que se pueden pedir a demanda. */
export const ACCIONES_DEMANDA = Object.freeze(['actualizar-datos', 'comprobar-vencidas', 'actualizar-cursos'] as const);
export type AccionDemanda = (typeof ACCIONES_DEMANDA)[number];

/** Días del mes más largo: acota los topes mensuales y la reserva del ciclo programado. */
const DIAS_MES_MAX = 31;
const MINUTOS_DIA = 1_440;
const DIAS_SEMANA = 7;
const MINUTOS_CUARTO_DE_HORA = 15;
/**
 * Una solicitud cada cuarto de hora, todo el día: más de las que caben, porque un ciclo dura más que eso y los ciclos a
 * demanda no se solapan (comparten grupo de concurrencia en el workflow). El código no frena las pruebas; lo prudente
 * lo decide la variable de cada instalación.
 */
const MAX_DIA = MINUTOS_DIA / MINUTOS_CUARTO_DE_HORA;
/** Límites que fija el código; la variable puede ser más prudente, nunca más permisiva. */
export const TECHOS_DEMANDA = Object.freeze({
  /** Minutos que separan, como poco, dos solicitudes a demanda: una puede pedirse en cuanto termina la anterior. */
  separacionMinimaMin: 1,
  /** Una separación de más de una semana ya no es un tope: es la vía apagada, y para eso está `habilitada`. */
  separacionMaximaMin: DIAS_SEMANA * MINUTOS_DIA,
  /** Solicitudes a demanda como mucho en un mismo día UTC. */
  maxDia: MAX_DIA,
  /** Solicitudes de una acción como mucho en un mes: el máximo diario todos los días. */
  maxMesPorAccion: MAX_DIA * DIAS_MES_MAX,
  /** Minutos de un mes como mucho: muy por encima de cualquier plan de GitHub Actions. */
  presupuestoMinMes: 50_000,
  /** Un ciclo programado no puede reservar más minutos que los de un día. */
  reservaProgramadaMin: MINUTOS_DIA,
});

export interface ConfiguracionDemanda {
  readonly version: 1;
  readonly actores: readonly string[];
  readonly separacionMin: number;
  readonly maxDia: number;
  readonly maxMes: Readonly<Record<AccionDemanda, number>>;
  /** Minutos de GitHub Actions del mes, para todos los ciclos: programados, del panel y a demanda. */
  readonly presupuestoMinMes: number;
  /** Minutos que se guardan para cada ciclo programado que queda en el mes. */
  readonly reservaProgramadaMin: number;
}
export type LecturaConfiguracionDemanda =
  | { readonly estado: 'abierta'; readonly configuracion: ConfiguracionDemanda }
  | { readonly estado: 'cerrada'; readonly motivo: 'ausente' | 'deshabilitada' | 'invalida' };

const MAX_CONFIGURACION_BYTES = 1_024;
const CLAVES = 'actores,habilitada,maxDia,maxMes,presupuestoMinMes,reservaProgramadaMin,separacionMin,version';
const CLAVES_MES = [...ACCIONES_DEMANDA].sort().join(',');
const INVALIDA: LecturaConfiguracionDemanda = Object.freeze({ estado: 'cerrada', motivo: 'invalida' });

class ConfiguracionDemandaNoValida extends Error {}

function objetoPlano(entrada: unknown, claves: string): Record<string, unknown> {
  if (
    entrada === null ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    Object.keys(entrada).sort().join(',') !== claves
  ) {
    throw new ConfiguracionDemandaNoValida();
  }
  return entrada as Record<string, unknown>;
}
function entero(entrada: unknown, minimo: number, maximo: number): number {
  if (typeof entrada !== 'number' || !Number.isSafeInteger(entrada) || entrada < minimo || entrada > maximo) {
    throw new ConfiguracionDemandaNoValida();
  }
  return entrada;
}
function leerMaxMes(entrada: unknown): Readonly<Record<AccionDemanda, number>> {
  const o = objetoPlano(entrada, CLAVES_MES);
  // Un cero cierra esa acción sin cerrar las demás.
  const valor = (accion: AccionDemanda) => entero(o[accion], 0, TECHOS_DEMANDA.maxMesPorAccion);
  return Object.freeze({
    'actualizar-datos': valor('actualizar-datos'),
    'comprobar-vencidas': valor('comprobar-vencidas'),
    'actualizar-cursos': valor('actualizar-cursos'),
  });
}
function leerConfiguracion(o: Record<string, unknown>): ConfiguracionDemanda {
  if (!sonActoresDemanda(o.actores)) {
    throw new ConfiguracionDemandaNoValida();
  }
  return Object.freeze({
    version: 1,
    actores: leerActoresDemanda(o.actores),
    separacionMin: entero(o.separacionMin, TECHOS_DEMANDA.separacionMinimaMin, TECHOS_DEMANDA.separacionMaximaMin),
    maxDia: entero(o.maxDia, 1, TECHOS_DEMANDA.maxDia),
    maxMes: leerMaxMes(o.maxMes),
    presupuestoMinMes: entero(o.presupuestoMinMes, 1, TECHOS_DEMANDA.presupuestoMinMes),
    reservaProgramadaMin: entero(o.reservaProgramadaMin, 1, TECHOS_DEMANDA.reservaProgramadaMin),
  });
}

/** Lee el texto de `FARO_ACTUALIZACION_DEMANDA`; una vía deshabilitada se valida igual que una abierta. */
export function leerConfiguracionDemanda(texto: string | undefined): LecturaConfiguracionDemanda {
  if (texto === undefined) {
    return Object.freeze({ estado: 'cerrada', motivo: 'ausente' });
  }
  if (typeof texto !== 'string' || new TextEncoder().encode(texto).byteLength > MAX_CONFIGURACION_BYTES) {
    return INVALIDA;
  }
  let entrada: unknown;
  try {
    entrada = JSON.parse(texto);
  } catch {
    return INVALIDA;
  }
  try {
    const o = objetoPlano(entrada, CLAVES);
    if (o.version !== 1 || typeof o.habilitada !== 'boolean') {
      return INVALIDA;
    }
    const configuracion = leerConfiguracion(o);
    return o.habilitada
      ? Object.freeze({ estado: 'abierta', configuracion })
      : Object.freeze({ estado: 'cerrada', motivo: 'deshabilitada' });
  } catch (error) {
    if (error instanceof ConfiguracionDemandaNoValida) {
      return INVALIDA;
    }
    throw error;
  }
}
export function configuracionDemandaDelEntorno(variables: VariablesDelEntorno): LecturaConfiguracionDemanda {
  return leerConfiguracionDemanda(variables.FARO_ACTUALIZACION_DEMANDA);
}
