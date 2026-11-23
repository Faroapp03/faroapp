/**
 * Huella de lo último avisado y resultado del último intento, en la misma autoridad que el vigilante. El estado
 * avisado solo cambia cuando un envío se confirma: un envío fallido se vuelve a intentar en el evento siguiente.
 */
import {
  type AvisoPreparado,
  type EstadoAvisoVigilante,
  leerEstadoAvisoVigilante,
  prepararAvisoVigilante,
  retirarIncidenciasCerradas,
} from '../../administracion/aviso-vigilante.ts';
import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import {
  MOTIVOS_FALLO_AVISO,
  type MotivoFalloAviso,
  type ResultadoEnvioAviso,
} from '../../administracion/envio-aviso.ts';
import type { EnvioPorCanal } from '../../administracion/envio-por-canal.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from '../../administracion/estado-trabajos.js';
import {
  type IntentosPorCanal,
  leerIntentosPorCanalSqlite,
  registrarIntentosPorCanalSqlite,
} from './aviso-canales-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { comprobarObservacionVigilanteEnTransaccion } from './vigilante-sqlite.ts';

export interface UltimoIntentoAviso {
  readonly en: number;
  readonly resultado: 'enviado' | 'fallido';
  readonly motivo: MotivoFalloAviso | null;
}
export interface RegistroAvisoVigilante {
  readonly avisado: EstadoAvisoVigilante | null;
  /** El intento conjunto de todos los canales: es el que decide lo avisado. */
  readonly ultimoIntento: UltimoIntentoAviso | null;
}

function prepararTabla(sql: SqlAccesoPublico): void {
  sql.ejecutar(`CREATE TABLE IF NOT EXISTS administracion_vigilante_aviso (
    id INTEGER PRIMARY KEY CHECK(id=1), avisado TEXT, intento_en INTEGER NOT NULL,
    intento_resultado TEXT NOT NULL CHECK(intento_resultado IN ('enviado','fallido')), intento_motivo TEXT) STRICT`);
}
function leerIntento(fila: Record<string, unknown>): UltimoIntentoAviso {
  const o = objetoTrabajo(fila, 'avisado,id,intento_en,intento_motivo,intento_resultado');
  exigirTrabajo(o.id === 1 && esEnteroTrabajo(o.intento_en));
  exigirTrabajo(o.intento_resultado === 'enviado' || o.intento_resultado === 'fallido');
  const motivo = MOTIVOS_FALLO_AVISO.find((m) => m === o.intento_motivo) ?? null;
  exigirTrabajo((o.intento_resultado === 'fallido') === (motivo !== null));
  return Object.freeze({ en: o.intento_en, resultado: o.intento_resultado, motivo });
}
/** Lo ya avisado con el último intento de cada canal, para el estado que ve el panel. */
export function leerAvisoPorCanalSqlite(
  sql: SqlAccesoPublico,
): Readonly<{ registro: RegistroAvisoVigilante; porCanal: IntentosPorCanal }> {
  return Object.freeze({ registro: leerAvisoVigilanteSqlite(sql), porCanal: leerIntentosPorCanalSqlite(sql) });
}
/** Sin tabla o sin fila: todavía no se ha intentado ningún aviso. */
export function leerAvisoVigilanteSqlite(sql: SqlAccesoPublico): RegistroAvisoVigilante {
  const tabla = sql.filas(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_vigilante_aviso'",
  );
  const fila = tabla.length === 1 ? sql.filas('SELECT * FROM administracion_vigilante_aviso WHERE id=1')[0] : undefined;
  if (!fila) {
    return { avisado: null, ultimoIntento: null };
  }
  const texto = fila.avisado;
  exigirTrabajo(texto === null || typeof texto === 'string');
  return Object.freeze({
    avisado: texto === null ? null : leerEstadoAvisoVigilante(JSON.parse(texto)),
    ultimoIntento: leerIntento(fila),
  });
}
/**
 * Lo que evalúa el evento programado: la configuración del vigilante con la de la programación o, si
 * `FARO_VIGILANTE` no es válida, solo ese hecho, que es en sí una incidencia (nadie se enteraría de lo demás).
 */
export type EntradaAvisoVigilante =
  | Readonly<{ configuracion: ConfiguracionVigilante; programada: ConfiguracionProgramada | undefined }>
  | Readonly<{ configuracionNoValida: true }>;
export const INCIDENCIA_CONFIGURACION_NO_VALIDA = Object.freeze({
  clave: 'vigilante',
  motivo: 'configuracion_no_valida',
});
function incidenciasDelAviso(sql: SqlAccesoPublico, entrada: EntradaAvisoVigilante, ahora: number) {
  if ('configuracionNoValida' in entrada) {
    return [INCIDENCIA_CONFIGURACION_NO_VALIDA];
  }
  return comprobarObservacionVigilanteEnTransaccion(
    sql,
    entrada.configuracion,
    { programada: entrada.programada, observacion: { origen: 'recibo' } },
    ahora,
  ).incidencias;
}
/**
 * Evalúa el vigilante con el último recibo, guarda sus decisiones y decide si hay aviso que enviar, con la misma
 * huella y el mismo recordatorio para una configuración no válida que para el resto de incidencias.
 */
export function prepararAvisoVigilanteSqlite(
  sql: SqlAccesoPublico,
  entrada: EntradaAvisoVigilante,
  contexto: Readonly<{ ahora: number; panel: string }>,
): AvisoPreparado | null {
  const incidencias = incidenciasDelAviso(sql, entrada, contexto.ahora);
  const avisado = leerAvisoVigilanteSqlite(sql).avisado;
  const aviso = prepararAvisoVigilante(avisado, incidencias, contexto);
  const depurado = aviso ? null : retirarIncidenciasCerradas(avisado, incidencias);
  if (depurado) {
    sql.ejecutar('UPDATE administracion_vigilante_aviso SET avisado=? WHERE id=1', JSON.stringify(depurado));
  }
  return aviso;
}
/**
 * Un envío confirmado sustituye lo avisado; un fallo solo deja constancia del intento y de su motivo. Con `canales`,
 * cada canal deja además su propio intento.
 */
export function registrarEnvioAvisoSqlite(
  sql: SqlAccesoPublico,
  entrada: Readonly<{
    envio: ResultadoEnvioAviso;
    siguiente: EstadoAvisoVigilante;
    canales?: readonly EnvioPorCanal[];
  }>,
  ahora: number,
): RegistroAvisoVigilante {
  prepararTabla(sql);
  if (entrada.canales) {
    registrarIntentosPorCanalSqlite(sql, entrada.canales, ahora);
  }
  const previo = leerAvisoVigilanteSqlite(sql).avisado;
  const enviado = entrada.envio.resultado === 'enviado';
  const avisado = enviado ? leerEstadoAvisoVigilante(entrada.siguiente) : previo;
  sql.ejecutar(
    'INSERT OR REPLACE INTO administracion_vigilante_aviso VALUES (1,?,?,?,?)',
    avisado === null ? null : JSON.stringify(avisado),
    ahora,
    entrada.envio.resultado,
    entrada.envio.resultado === 'fallido' ? entrada.envio.motivo : null,
  );
  return leerAvisoVigilanteSqlite(sql);
}
