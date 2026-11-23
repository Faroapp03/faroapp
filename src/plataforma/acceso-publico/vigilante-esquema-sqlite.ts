/** Esquema creado exclusivamente por la preparación explícita. */
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

export function crearTablasVigilante(sql: SqlAccesoPublico): void {
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN vigilante_version INTEGER NOT NULL DEFAULT 0 CHECK(vigilante_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_vigilante (
      id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=1),reloj INTEGER NOT NULL,
      revision INTEGER NOT NULL,configuracion_sha TEXT NOT NULL,huella_evaluacion TEXT,
      formato_marcas INTEGER NOT NULL DEFAULT 2 CHECK(formato_marcas=2),
      formato_decisiones INTEGER NOT NULL DEFAULT 2 CHECK(formato_decisiones=2)) STRICT`);
  sql.ejecutar(
    'CREATE TABLE administracion_vigilante_configuraciones (sha TEXT PRIMARY KEY,documento TEXT NOT NULL) STRICT',
  );
  sql.ejecutar(`CREATE TABLE administracion_vigilante_decisiones (
      id INTEGER PRIMARY KEY,clave TEXT NOT NULL,estado TEXT NOT NULL CHECK(estado IN ('incidencia','conforme')),
      motivo TEXT NOT NULL,observado_en INTEGER NOT NULL,evaluado_en INTEGER NOT NULL,referencia TEXT NOT NULL,
      configuracion_sha TEXT NOT NULL,avisar INTEGER NOT NULL CHECK(avisar IN (0,1)),sha TEXT NOT NULL,
      origen TEXT CHECK(origen IN ('recibo','lectura-local'))) STRICT`);
  sql.ejecutar('CREATE INDEX vigilante_clave ON administracion_vigilante_decisiones(clave,id DESC)');
  sql.ejecutar(
    'CREATE TABLE administracion_vigilante_marcas (clave TEXT PRIMARY KEY,observado_en INTEGER NOT NULL,sha TEXT NOT NULL,soporte TEXT) STRICT',
  );
}

/** Solo preparación explícita: el legado conserva sus marcas, sin fabricar fracciones perdidas. */
export function migrarPrecisionMarcas(sql: SqlAccesoPublico) {
  sql.ejecutar('ALTER TABLE administracion_vigilante_marcas ADD COLUMN soporte TEXT');
  sql.ejecutar(
    'ALTER TABLE administracion_vigilante ADD COLUMN formato_marcas INTEGER NOT NULL DEFAULT 2 CHECK(formato_marcas=2)',
  );
}

/** Añade solo la columna de origen; las filas legadas conservan fechas y SHA originales. */
export function migrarOrigenDecisiones(sql: SqlAccesoPublico, leerDecision: (fila: FilaSql) => unknown) {
  sql.ejecutar(
    "ALTER TABLE administracion_vigilante_decisiones ADD COLUMN origen TEXT CHECK(origen IN ('recibo','lectura-local'))",
  );
  for (const fila of sql.filas('SELECT * FROM administracion_vigilante_decisiones')) {
    leerDecision(fila);
  }
  sql.ejecutar(
    'ALTER TABLE administracion_vigilante ADD COLUMN formato_decisiones INTEGER NOT NULL DEFAULT 2 CHECK(formato_decisiones=2)',
  );
}
