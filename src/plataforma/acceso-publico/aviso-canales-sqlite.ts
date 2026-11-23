/**
 * Último intento de aviso de cada canal, una fila por canal, en la misma autoridad que lo ya avisado. Un canal que no
 * ha intentado nada no tiene fila. La dirección no se guarda aquí: solo el canal, cuándo, el resultado y el motivo.
 */
import { MOTIVOS_FALLO_AVISO } from '../../administracion/envio-aviso.ts';
import type { EnvioPorCanal } from '../../administracion/envio-por-canal.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from '../../administracion/estado-trabajos.js';
import { type IntentoAvisoPanel, MOTIVOS_FALLO_CORREO_PANEL } from '../../administracion/vigilante-panel.js';
import type { SqlAccesoPublico } from './sqlite.ts';

export type CanalDeAviso = EnvioPorCanal['canal'];
export type IntentosPorCanal = Readonly<Partial<Record<CanalDeAviso, IntentoAvisoPanel>>>;

const TABLA = 'administracion_vigilante_aviso_canal';
function prepararTabla(sql: SqlAccesoPublico): void {
  sql.ejecutar(`CREATE TABLE IF NOT EXISTS ${TABLA} (
    canal TEXT PRIMARY KEY CHECK(canal IN ('correo','url')), intento_en INTEGER NOT NULL,
    intento_resultado TEXT NOT NULL CHECK(intento_resultado IN ('enviado','fallido')), intento_motivo TEXT,
    CHECK((intento_resultado='fallido') = (intento_motivo IS NOT NULL))) STRICT`);
}
function leerFila(fila: Record<string, unknown>): [CanalDeAviso, IntentoAvisoPanel] {
  const o = objetoTrabajo(fila, 'canal,intento_en,intento_motivo,intento_resultado');
  exigirTrabajo((o.canal === 'correo' || o.canal === 'url') && esEnteroTrabajo(o.intento_en));
  const motivos: readonly string[] = o.canal === 'correo' ? MOTIVOS_FALLO_CORREO_PANEL : MOTIVOS_FALLO_AVISO;
  const fallido = o.intento_resultado === 'fallido';
  exigirTrabajo(
    fallido
      ? typeof o.intento_motivo === 'string' && motivos.includes(o.intento_motivo)
      : o.intento_resultado === 'enviado' && o.intento_motivo === null,
  );
  const intento = Object.freeze({
    en: o.intento_en,
    resultado: fallido ? ('fallido' as const) : ('enviado' as const),
    motivo: fallido ? (o.intento_motivo as string) : null,
  });
  return [o.canal, intento];
}
/** Sin tabla: ningún canal ha intentado nada todavía. */
export function leerIntentosPorCanalSqlite(sql: SqlAccesoPublico): IntentosPorCanal {
  const tabla = sql.filas(`SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLA}'`);
  if (tabla.length === 0) {
    return Object.freeze({});
  }
  return Object.freeze(Object.fromEntries(sql.filas(`SELECT * FROM ${TABLA} ORDER BY canal`).map(leerFila)));
}
/** Cada canal que ha intentado algo sustituye su propio intento; el de un canal que no se ha usado se conserva. */
export function registrarIntentosPorCanalSqlite(
  sql: SqlAccesoPublico,
  envios: readonly EnvioPorCanal[],
  ahora: number,
): void {
  prepararTabla(sql);
  for (const { canal, envio } of envios) {
    sql.ejecutar(
      `INSERT OR REPLACE INTO ${TABLA} VALUES (?,?,?,?)`,
      canal,
      ahora,
      envio.resultado,
      envio.resultado === 'fallido' ? envio.motivo : null,
    );
  }
}
