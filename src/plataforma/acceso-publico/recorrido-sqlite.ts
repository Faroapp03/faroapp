/** Las funciones se ejecutan dentro de la transacción que valida también la sesión. */
import {
  type DocumentoRecorrido,
  leerDocumentoRecorrido,
  leerModo,
  type ModoRecorrido,
} from '../../administracion/recorrido.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

export function iniciarModoSqlite(sql: SqlAccesoPublico): void {
  sql.ejecutar(
    "CREATE TABLE administracion_recorrido (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0), modo TEXT NOT NULL CHECK(modo IN ('real','demo'))) STRICT",
  );
  sql.ejecutar("INSERT INTO administracion_recorrido VALUES (1,0,'real')");
  sql.ejecutar(
    'CREATE TABLE administracion_recorrido_intentos (clave TEXT PRIMARY KEY, caduca INTEGER NOT NULL, usados INTEGER NOT NULL CHECK(usados>=0)) STRICT',
  );
}

/** Solo el esquema enteramente ausente se adopta; una tabla existente nunca recupera una fila perdida. */
export function prepararEsquemaRecorrido(sql: SqlAccesoPublico): void {
  sql.transaccion(() => {
    const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
    if (!metadata) {
      throw new Error('Autoridad de recorrido no disponible');
    }
    const tablas = sql.filas(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('administracion_recorrido','administracion_recorrido_intentos')",
    );
    if (Object.hasOwn(metadata, 'recorrido_version')) {
      if (metadata.recorrido_version !== 1) {
        throw new Error('Migración de recorrido no válida');
      }
      return;
    }
    if (tablas.length !== 0) {
      throw new Error('Esquema de recorrido incompleto');
    }
    sql.ejecutar(
      'ALTER TABLE publico_estado ADD COLUMN recorrido_version INTEGER NOT NULL DEFAULT 0 CHECK(recorrido_version IN (0,1))',
    );
    iniciarModoSqlite(sql);
    sql.ejecutar('UPDATE publico_estado SET recorrido_version=1 WHERE id=1');
  });
}

export function leerModoSqlite(sql: SqlAccesoPublico): DocumentoRecorrido {
  const filas = sql.filas('SELECT revision,modo FROM administracion_recorrido WHERE id=1');
  if (filas.length !== 1) {
    throw new Error('Autoridad de recorrido no disponible');
  }
  return leerDocumentoRecorrido({ ...filas[0], version: 1 });
}

export function cambiarModoSqlite(sql: SqlAccesoPublico, revision: number, entrada: ModoRecorrido) {
  const modo = leerModo(entrada);
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw new Error('Revisión inválida');
  }
  const actual = leerModoSqlite(sql);
  if (actual.revision !== revision) {
    return { estado: 'conflicto' as const, recorrido: actual };
  }
  sql.ejecutar('UPDATE administracion_recorrido SET revision=?, modo=? WHERE id=1', revision + 1, modo);
  return { estado: 'cambiado' as const, recorrido: leerModoSqlite(sql) };
}
