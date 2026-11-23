/** Activación expresa privada: solo el disparador interno lee esta configuración, nunca las peticiones web. */
import type { VariablesDelEntorno } from '../comun/entorno.ts';
import { diaUtc } from '../comun/tiempo.ts';

export interface ConfiguracionProgramada {
  readonly version: 1;
  readonly habilitada: boolean;
  /** UTC, un único minuto diario, sin abreviaturas ni normalización. */
  readonly cron: string;
  /**
   * Día UTC (AAAA-MM-DD), incluido, hasta el que la programación está apagada a propósito; solo se admite con
   * `habilitada: false`. Sin pausa vigente, una programación apagada es una incidencia del vigilante.
   */
  readonly pausaHasta?: string;
  /** Autoriza una recuperación solo durante este día UTC. */
  readonly recuperarEl?: string;
}
const MAX_CONFIGURACION_BYTES = 1_024;
const CRON_DIARIO = /^(?:0|[1-9]|[1-5][0-9]) (?:0|[1-9]|1[0-9]|2[0-3]) \* \* \*$/;
const ERROR = 'Configuración de actualización programada no válida';

/** Una fecha real del calendario, escrita AAAA-MM-DD; «2026-02-30» no lo es. */
function leerDiaPausa(entrada: unknown): string {
  if (typeof entrada !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(entrada)) {
    throw new Error(ERROR);
  }
  const instante = Date.parse(`${entrada}T00:00:00Z`);
  if (!Number.isFinite(instante) || diaUtc(instante) !== entrada) {
    throw new Error(ERROR);
  }
  return entrada;
}
export function leerCronDiario(entrada: unknown): string {
  if (typeof entrada !== 'string' || !CRON_DIARIO.test(entrada)) {
    throw new Error(ERROR);
  }
  return entrada;
}
function comprobarOpcionales(o: Record<string, unknown>): void {
  if ((o.habilitada && o.pausaHasta !== undefined) || (!o.habilitada && o.recuperarEl !== undefined)) {
    throw new Error(ERROR);
  }
}
export function configuracionProgramadaDelEntorno(variables: VariablesDelEntorno): ConfiguracionProgramada | undefined {
  const texto = variables.FARO_ACTUALIZACION_PROGRAMADA;
  if (texto === undefined) {
    return undefined;
  }
  if (new TextEncoder().encode(texto).byteLength > MAX_CONFIGURACION_BYTES) {
    throw new Error(ERROR);
  }
  let entrada: unknown;
  try {
    entrada = JSON.parse(texto);
  } catch {
    throw new Error(ERROR);
  }
  if (
    entrada === null ||
    typeof entrada !== 'object' ||
    Array.isArray(entrada) ||
    !['cron,habilitada,version', 'cron,habilitada,pausaHasta,version', 'cron,habilitada,recuperarEl,version'].includes(
      Object.keys(entrada).sort().join(','),
    )
  ) {
    throw new Error(ERROR);
  }
  const o = entrada as Record<string, unknown>;
  if (o.version !== 1 || typeof o.habilitada !== 'boolean') {
    throw new Error(ERROR);
  }
  // Una pausa declara hasta cuándo está apagada a propósito: con la programación encendida no significa nada.
  comprobarOpcionales(o);
  const cron = leerCronDiario(o.cron);
  return Object.freeze({
    version: 1,
    habilitada: o.habilitada,
    cron,
    ...(o.pausaHasta === undefined ? {} : { pausaHasta: leerDiaPausa(o.pausaHasta) }),
    ...(o.recuperarEl === undefined ? {} : { recuperarEl: leerDiaPausa(o.recuperarEl) }),
  });
}
/** Captura inmutable sin validar ni preparar otra capacidad durante fetch. */
export function configuracionProgramadaDiferida(
  variables: VariablesDelEntorno,
): (() => ConfiguracionProgramada | undefined) | undefined {
  if (variables.FARO_ACTUALIZACION_PROGRAMADA === undefined) {
    return undefined;
  }
  const capturadas = Object.freeze({ FARO_ACTUALIZACION_PROGRAMADA: variables.FARO_ACTUALIZACION_PROGRAMADA });
  return () => configuracionProgramadaDelEntorno(capturadas);
}
