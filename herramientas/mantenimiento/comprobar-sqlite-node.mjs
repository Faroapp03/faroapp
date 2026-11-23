import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const cabecera = readFileSync(process.argv[2], 'utf8');
const esperada = /^#define SQLITE_VERSION\s+"(\d+\.\d+\.\d+)"/m.exec(cabecera)?.[1];
if (!esperada) {
  throw new Error('Falta la versión de SQLite en la cabecera verificada.');
}

const db = new DatabaseSync(':memory:');
try {
  const { version, fuente } = db.prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS fuente').get();
  if (version !== esperada) {
    throw new Error(`node:sqlite carga SQLite ${version} y la fuente verificada exige ${esperada}.`);
  }
  db.exec(
    "CREATE VIRTUAL TABLE indice USING fts5(texto); INSERT INTO indice VALUES ('curso abierto'), ('curso cerrado')",
  );
  const filas = db.prepare('SELECT texto FROM indice WHERE indice MATCH ?').all('abierto');
  if (filas.length !== 1 || filas[0].texto !== 'curso abierto') {
    throw new Error('La búsqueda FTS5 de node:sqlite falló.');
  }
  console.log(`SQLite ${version} · node:sqlite · FTS5 · ${fuente}`);
} finally {
  db.close();
}
