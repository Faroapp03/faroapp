/** Activación expresa local y plazos operativos; no son TTL del contenido ni cadencias de publicación. */
import { MS_POR_DIA } from '../comun/tiempo.ts';
import { ConfiguracionVigilanteInvalida } from './errores-vigilante.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';

export interface ConfiguracionVigilante {
  readonly version: 1;
  readonly habilitado: boolean;
  readonly activadoEn: number;
  readonly plazoEventoMs: number;
  readonly plazoInicioMs: number;
  readonly plazoCierreMs: number;
  readonly plazoObservacionMs: number;
}
const MAX_CONFIG_BYTES = 4096;
const MAX_PLAZO_DIAS = 31;
const MAX_PLAZO_MS = MAX_PLAZO_DIAS * MS_POR_DIA;
const MAX_FECHA_MS = 8_640_000_000_000_000;
export function leerConfiguracionVigilante(entrada: unknown): ConfiguracionVigilante {
  const o = objetoTrabajo(
    entrada,
    'activadoEn,habilitado,plazoCierreMs,plazoEventoMs,plazoInicioMs,plazoObservacionMs,version',
  );
  exigirTrabajo(o.version === 1 && typeof o.habilitado === 'boolean');
  exigirTrabajo(esEnteroTrabajo(o.activadoEn) && o.activadoEn > 0 && o.activadoEn <= MAX_FECHA_MS);
  function plazo(valor: unknown): number {
    exigirTrabajo(esEnteroTrabajo(valor) && valor > 0 && valor <= MAX_PLAZO_MS);
    return valor;
  }
  return Object.freeze({
    version: 1,
    habilitado: o.habilitado,
    activadoEn: o.activadoEn,
    plazoEventoMs: plazo(o.plazoEventoMs),
    plazoInicioMs: plazo(o.plazoInicioMs),
    plazoCierreMs: plazo(o.plazoCierreMs),
    plazoObservacionMs: plazo(o.plazoObservacionMs),
  });
}

/** Una instalación debe aportar la política completa; no se rellenan plazos por defecto. */
export function configuracionVigilanteDelEntorno(
  variables: Readonly<Record<string, string | undefined>>,
): ConfiguracionVigilante | undefined {
  const texto = variables.FARO_VIGILANTE;
  if (texto === undefined) {
    return undefined;
  }
  if (new TextEncoder().encode(texto).byteLength > MAX_CONFIG_BYTES) {
    throw new ConfiguracionVigilanteInvalida('Configuración de vigilante no válida');
  }
  try {
    return leerConfiguracionVigilante(JSON.parse(texto));
  } catch (error) {
    throw new ConfiguracionVigilanteInvalida('Configuración de vigilante no válida', { cause: error });
  }
}

/** Aísla solo errores de esta política; ningún fallo de identidad o de otra capacidad se convierte en válido. */
export function capturarConfiguracionVigilante(variables: Readonly<Record<string, string | undefined>>) {
  try {
    return { configuracion: configuracionVigilanteDelEntorno(variables), invalida: false as const };
  } catch (error) {
    if (!(error instanceof ConfiguracionVigilanteInvalida)) {
      throw error;
    }
    return { configuracion: undefined, invalida: true as const };
  }
}
