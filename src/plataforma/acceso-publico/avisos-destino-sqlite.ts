/**
 * El destino de los avisos en el SQLite del objeto durable: una tabla de una sola fila. Mientras nadie lo ha
 * configurado, la tabla no existe y la lectura es el destino inicial (sin dirección, revisión 0); el primer cambio la
 * crea en su misma transacción. Las funciones son síncronas: el llamador mantiene la transacción y comprueba la sesión
 * dentro de ella. Ninguna registra nada ni repite la dirección en sus errores.
 */
import {
  DESTINO_INICIAL,
  type DestinoAvisos,
  esRevisionDestino,
  leerDestinoAvisos,
  type ResumenDestinoAvisos,
  resumenDe,
} from '../../administracion/avisos-destino.ts';
import { leerDestinoCorreo } from '../../administracion/destino-correo.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

const TABLA = 'administracion_avisos_destino';
export interface CambioDestinoSqlite {
  readonly estado: 'cambiado' | 'conflicto';
  readonly destino: ResumenDestinoAvisos;
}

function existeTabla(sql: SqlAccesoPublico): boolean {
  return sql.filas(`SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLA}'`).length === 1;
}
/** Las restricciones repiten el contrato para que ninguna escritura directa deje una fila incoherente. */
function crearTabla(sql: SqlAccesoPublico): void {
  sql.ejecutar(`CREATE TABLE ${TABLA} (
    id INTEGER PRIMARY KEY CHECK(id=1),
    version INTEGER NOT NULL CHECK(version=1),
    correo TEXT CHECK(correo IS NULL OR length(correo) BETWEEN 1 AND 254),
    revision INTEGER NOT NULL CHECK(revision>=0),
    cambiado_en INTEGER CHECK(cambiado_en IS NULL OR cambiado_en>=0),
    verificacion TEXT NOT NULL CHECK(verificacion IN ('sin_destino','pendiente','verificado')),
    CHECK((correo IS NULL)=(verificacion='sin_destino'))) STRICT`);
  sql.ejecutar(`INSERT INTO ${TABLA} VALUES (1,1,NULL,0,NULL,'sin_destino')`);
}

/** Una tabla presente tiene exactamente su fila; si no la tiene, o no cumple el contrato, la lectura falla. */
export function leerDestinoSqlite(sql: SqlAccesoPublico): DestinoAvisos {
  if (!existeTabla(sql)) {
    return DESTINO_INICIAL;
  }
  const filas = sql.filas(`SELECT id,version,correo,revision,cambiado_en,verificacion FROM ${TABLA}`);
  const fila = filas[0];
  if (filas.length !== 1 || fila?.id !== 1) {
    throw new Error('Destino de avisos no válido');
  }
  return leerDestinoAvisos({
    version: fila.version,
    correo: fila.correo,
    revision: fila.revision,
    cambiadoEn: fila.cambiado_en,
    verificacion: fila.verificacion,
  });
}

/**
 * Pone una dirección nueva (o la quita con `null`) si la revisión vista es la vigente. Toda dirección guardada queda
 * pendiente de confirmar, también si repite la anterior: la confirmación es de quien la recibe, no de quien la escribe.
 */
export function cambiarDestinoSqlite(
  sql: SqlAccesoPublico,
  revisionEsperada: number,
  entrada: string | null,
  ahora: number,
): CambioDestinoSqlite {
  if (!esRevisionDestino(revisionEsperada) || !esRevisionDestino(ahora)) {
    throw new Error('Cambio del destino de avisos no válido');
  }
  const correo = entrada === null ? null : leerDestinoCorreo(entrada);
  const anterior = leerDestinoSqlite(sql);
  if (anterior.revision !== revisionEsperada) {
    return { estado: 'conflicto', destino: resumenDe(anterior) };
  }
  if (anterior.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Revisión del destino de avisos agotada');
  }
  if (!existeTabla(sql)) {
    crearTabla(sql);
  }
  const destino = leerDestinoAvisos({
    version: 1,
    correo,
    revision: anterior.revision + 1,
    cambiadoEn: ahora,
    verificacion: correo === null ? 'sin_destino' : 'pendiente',
  });
  sql.ejecutar(
    `UPDATE ${TABLA} SET correo=?,revision=?,cambiado_en=?,verificacion=? WHERE id=1`,
    destino.correo,
    destino.revision,
    destino.cambiadoEn,
    destino.verificacion,
  );
  return { estado: 'cambiado', destino: resumenDe(destino) };
}
/**
 * Marca como verificada la dirección vigente si es la misma y con la misma revisión a la que se envió la prueba.
 * Una dirección ya verificada lo sigue estando; cualquier otra situación es un conflicto sin cambios.
 */
export function verificarDestinoSqlite(
  sql: SqlAccesoPublico,
  revisionEsperada: number,
  entrada: string,
): CambioDestinoSqlite {
  if (!esRevisionDestino(revisionEsperada)) {
    throw new Error('Verificación del destino de avisos no válida');
  }
  const correo = leerDestinoCorreo(entrada);
  const anterior = leerDestinoSqlite(sql);
  if (anterior.revision !== revisionEsperada || anterior.correo !== correo) {
    return { estado: 'conflicto', destino: resumenDe(anterior) };
  }
  sql.ejecutar(`UPDATE ${TABLA} SET verificacion='verificado' WHERE id=1 AND revision=?`, revisionEsperada);
  return { estado: 'cambiado', destino: resumenDe(leerDestinoSqlite(sql)) };
}
