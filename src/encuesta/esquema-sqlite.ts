/**
 * El esquema de la encuesta en SQLite y su preparación (las tablas las describe almacen-sqlite.ts). Hay dos versiones
 * que se comprueban por separado:
 * - ESQUEMA, en encuesta_estado.version: las columnas de las tablas. Sube con cada cambio de columnas.
 * - El cuestionario, en encuesta_estado.cuestionario: a qué preguntas pertenecen las celdas de encuesta_recuentos.
 * Pasar a otro cuestionario rehace las celdas, y eso solo se hace con la encuesta sin estrenar: ningún código consumido
 * y todos los recuentos a cero. Con una sola respuesta la preparación se niega y no toca nada, porque sumar respuestas
 * de dos cuestionarios daría resultados que no corresponden a ninguno. Pasar del esquema 3 al 4 (las rondas) con el
 * mismo cuestionario no cambia ninguna cifra: lo que había pasa entero a la primera ronda, con respuestas o sin ellas.
 */
import type { SqlAccesoPublico, ValorSql } from '../plataforma/acceso-publico/sqlite.ts';
import { NOMBRE_PRIMERA_RONDA } from './contrato.ts';
import { CUESTIONARIO, PREGUNTAS, TIPOS_DE_CODIGO } from './cuestionario.ts';

const TABLAS = [
  'encuesta_estado',
  'encuesta_rondas',
  'encuesta_lotes',
  'encuesta_codigos',
  'encuesta_recuentos',
] as const;
/** Las tablas que ya existían antes de las rondas: una encuesta guardada con un esquema anterior tiene estas. */
const TABLAS_ANTERIORES = ['encuesta_estado', 'encuesta_lotes', 'encuesta_codigos', 'encuesta_recuentos'] as const;

/** Error técnico sin datos del registro: una fila defectuosa nunca se convierte en un código válido ni en un cero. */
export class RegistroEncuestaNoValido extends Error {
  override readonly name = 'RegistroEncuestaNoValido';
  constructor() {
    super('Registro de la encuesta no válido');
  }
}
/**
 * La encuesta guardada pertenece a otro esquema o a otro cuestionario y ya tiene respuestas: sus celdas no se pueden
 * rehacer sin perderlas ni mezclarlas. Para usar el cuestionario vigente hace falta una base de la encuesta nueva.
 */
export class CuestionarioConRespuestas extends Error {
  override readonly name = 'CuestionarioConRespuestas';
  constructor() {
    super('La encuesta guardada es de otro cuestionario y ya tiene respuestas');
  }
}
export function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new RegistroEncuestaNoValido();
  }
}

/**
 * La versión del esquema de la encuesta. La 1 no tenía el nombre del lote; la 2 lo añade; la 3 guarda el cuestionario;
 * la 4 reparte lotes y recuentos en rondas, y la apertura pasa de la encuesta a cada ronda.
 * Va en la tabla de la encuesta y no en publico_estado.encuesta_version, que marca que la encuesta está preparada y
 * nació con CHECK(encuesta_version IN (0,1)): esa restricción no se puede cambiar sin rehacer la tabla común.
 */
export const ESQUEMA = 4;
/** Las versiones anteriores que se pueden llevar a la vigente, con las columnas de su tabla de estado. */
const ESQUEMAS_SIN_CUESTIONARIO: readonly unknown[] = [1, 2];
const ESQUEMA_SIN_RONDAS = 3;
const ESTADO_SIN_CUESTIONARIO = ['id', 'version', 'abierta'];
const ESTADO_SIN_RONDAS = [...ESTADO_SIN_CUESTIONARIO, 'cuestionario'];
/** Las columnas que la versión vigente espera en cada tabla, sin importar su orden. */
const COLUMNAS: Readonly<Record<(typeof TABLAS)[number], readonly string[]>> = {
  encuesta_estado: ['id', 'version', 'cuestionario'],
  encuesta_rondas: ['numero', 'nombre', 'inicio', 'cierre', 'abierta'],
  encuesta_lotes: ['id', 'numero', 'ronda', 'tipo', 'emitidos', 'consumidos', 'nombre'],
  encuesta_codigos: ['huella', 'lote', 'tipo'],
  encuesta_recuentos: ['ronda', 'tipo', 'pregunta', 'valor', 'recuento'],
};
const COLUMNA_NOMBRE = 'nombre TEXT CHECK(nombre IS NULL OR length(nombre) BETWEEN 1 AND 60)';
/** Un día AAAA-MM-DD o nada: las rondas guardan el día, nunca la hora. */
const COLUMNA_DIA = (nombre: string) =>
  `${nombre} TEXT CHECK(${nombre} IS NULL OR ${nombre} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;
const TABLA_DE_ESTADO = (nombre: string) => `CREATE TABLE ${nombre} (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=${ESQUEMA}),
    cuestionario TEXT NOT NULL CHECK(length(cuestionario) BETWEEN 1 AND 40)) STRICT`;
const TABLA_DE_LOTES = (nombre: string) => `CREATE TABLE ${nombre} (
    id TEXT PRIMARY KEY, numero INTEGER NOT NULL UNIQUE CHECK(numero>=1), ronda INTEGER NOT NULL CHECK(ronda>=1),
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional')), emitidos INTEGER NOT NULL CHECK(emitidos>=1),
    consumidos INTEGER NOT NULL CHECK(consumidos>=0 AND consumidos<=emitidos), ${COLUMNA_NOMBRE}) STRICT`;
const TABLA_DE_RECUENTOS = (nombre: string) => `CREATE TABLE ${nombre} (
    ronda INTEGER NOT NULL CHECK(ronda>=1), tipo TEXT NOT NULL, pregunta TEXT NOT NULL, valor TEXT NOT NULL,
    recuento INTEGER NOT NULL CHECK(recuento>=0), PRIMARY KEY(ronda,tipo,pregunta,valor)) STRICT, WITHOUT ROWID`;
/** Solo una ronda abierta a la vez lo garantiza la propia base, con un índice único sobre las abiertas. */
function crearTablaDeRondas(sql: SqlAccesoPublico): void {
  sql.ejecutar(`CREATE TABLE encuesta_rondas (
    numero INTEGER PRIMARY KEY CHECK(numero>=1), nombre TEXT NOT NULL CHECK(length(nombre) BETWEEN 1 AND 60),
    ${COLUMNA_DIA('inicio')}, ${COLUMNA_DIA('cierre')}, abierta INTEGER NOT NULL CHECK(abierta IN (0,1)),
    CHECK(abierta=0 OR cierre IS NULL)) STRICT`);
  sql.ejecutar('CREATE UNIQUE INDEX encuesta_una_ronda_abierta ON encuesta_rondas(abierta) WHERE abierta=1');
}

/** Una celda a cero de esa ronda por cada tipo, pregunta y valor del cuestionario vigente. */
export function crearCeldas(sql: SqlAccesoPublico, ronda: number): void {
  for (const tipo of TIPOS_DE_CODIGO) {
    for (const [pregunta, valores] of Object.entries(PREGUNTAS[tipo])) {
      for (const valor of valores) {
        sql.ejecutar('INSERT INTO encuesta_recuentos VALUES(?,?,?,?,0)', ronda, tipo, pregunta, valor);
      }
    }
  }
}
/** Una encuesta nueva empieza con la primera ronda abierta, la misma que deja la migración de una encuesta abierta. */
function crearTablas(sql: SqlAccesoPublico): void {
  sql.ejecutar(TABLA_DE_ESTADO('encuesta_estado'));
  crearTablaDeRondas(sql);
  sql.ejecutar(TABLA_DE_LOTES('encuesta_lotes'));
  sql.ejecutar(`CREATE TABLE encuesta_codigos (
    huella TEXT PRIMARY KEY CHECK(length(huella)=64), lote TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('participante','profesional'))) STRICT, WITHOUT ROWID`);
  sql.ejecutar(TABLA_DE_RECUENTOS('encuesta_recuentos'));
  sql.ejecutar('INSERT INTO encuesta_estado (id,version,cuestionario) VALUES(1,?,?)', ESQUEMA, CUESTIONARIO);
  sql.ejecutar('INSERT INTO encuesta_rondas VALUES(1,?,NULL,NULL,1)', NOMBRE_PRIMERA_RONDA);
  crearCeldas(sql, 1);
}
/**
 * Prepara la encuesta dentro de la transacción de la operación que la usa: una encuesta averiada solo bloquea la
 * encuesta. Un conjunto parcial de tablas no se completa ni se da por válido.
 */
export function prepararEncuestaSqlite(sql: SqlAccesoPublico): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.version === 1);
  const encontradas = sql.filas(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${TABLAS.map(() => '?').join(',')})`,
    ...TABLAS,
  );
  if (Object.hasOwn(metadata, 'encuesta_version')) {
    exigir(metadata.encuesta_version === 1);
    const conRondas = encontradas.some((fila) => fila.name === 'encuesta_rondas');
    exigir(encontradas.length === (conRondas ? TABLAS : TABLAS_ANTERIORES).length);
    alinearConElCuestionario(sql);
    exigirColumnas(sql);
    return;
  }
  exigir(encontradas.length === 0);
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN encuesta_version INTEGER NOT NULL DEFAULT 0 CHECK(encuesta_version IN (0,1))',
  );
  crearTablas(sql);
  sql.ejecutar('UPDATE publico_estado SET encuesta_version=1 WHERE id=1');
}

/** Los nombres de las columnas de una de las tablas de la encuesta. */
function columnasDe(sql: SqlAccesoPublico, tabla: (typeof TABLAS)[number]): unknown[] {
  return sql.filas(`SELECT name FROM pragma_table_info('${tabla}')`).map((fila) => fila.name);
}
/** Si las columnas de una tabla son exactamente estas, sin importar su orden. */
function tieneColumnas(sql: SqlAccesoPublico, tabla: (typeof TABLAS)[number], esperadas: readonly string[]): boolean {
  const columnas = columnasDe(sql, tabla);
  return columnas.length === esperadas.length && esperadas.every((columna) => columnas.includes(columna));
}
/** Cada tabla tiene exactamente las columnas que espera esta versión: un esquema distinto bloquea la encuesta. */
function exigirColumnas(sql: SqlAccesoPublico): void {
  for (const tabla of TABLAS) {
    exigir(tieneColumnas(sql, tabla, COLUMNAS[tabla]));
  }
}
/**
 * La versión del esquema, el cuestionario guardado (null en los esquemas 1 y 2, que no lo guardaban) y la apertura de
 * la encuesta en los esquemas sin rondas. Comprueba las columnas antes de leer: una tabla de estado incompleta bloquea
 * la encuesta con su error propio, nunca con uno crudo de SQLite.
 */
function estadoGuardado(sql: SqlAccesoPublico): { version: unknown; cuestionario: string | null } {
  if (tieneColumnas(sql, 'encuesta_estado', COLUMNAS.encuesta_estado)) {
    const filas = sql.filas('SELECT version,cuestionario FROM encuesta_estado WHERE id=1');
    const fila = filas[0];
    exigir(filas.length === 1 && fila?.version === ESQUEMA && typeof fila.cuestionario === 'string');
    return { version: fila.version, cuestionario: fila.cuestionario };
  }
  const conCuestionario = tieneColumnas(sql, 'encuesta_estado', ESTADO_SIN_RONDAS);
  exigir(conCuestionario || tieneColumnas(sql, 'encuesta_estado', ESTADO_SIN_CUESTIONARIO));
  const filas = sql.filas(
    `SELECT version,abierta${conCuestionario ? ',cuestionario' : ''} FROM encuesta_estado WHERE id=1`,
  );
  const fila = filas[0];
  exigir(filas.length === 1 && fila !== undefined && (fila.abierta === 0 || fila.abierta === 1));
  if (!conCuestionario) {
    exigir(ESQUEMAS_SIN_CUESTIONARIO.includes(fila.version));
    return { version: fila.version, cuestionario: null };
  }
  exigir(fila.version === ESQUEMA_SIN_RONDAS && typeof fila.cuestionario === 'string');
  return { version: fila.version, cuestionario: fila.cuestionario };
}
/**
 * Lleva la encuesta guardada al esquema y al cuestionario vigentes. Si ya lo está, no cambia nada. Con el mismo
 * cuestionario, pasar a las rondas conserva lotes, códigos y recuentos. Con otro, comprueba primero que no tiene
 * respuestas y solo entonces rehace las celdas.
 */
function alinearConElCuestionario(sql: SqlAccesoPublico): void {
  const estado = estadoGuardado(sql);
  const mismoCuestionario = estado.cuestionario === CUESTIONARIO;
  if (estado.version === ESQUEMA && mismoCuestionario) {
    return;
  }
  if (!mismoCuestionario) {
    exigirSinRespuestas(sql);
  }
  if (estado.version !== ESQUEMA) {
    migrarARondas(sql);
  }
  if (!mismoCuestionario) {
    sql.ejecutar('DELETE FROM encuesta_recuentos');
    for (const fila of sql.filas('SELECT numero FROM encuesta_rondas ORDER BY numero')) {
      exigir(typeof fila.numero === 'number');
      crearCeldas(sql, fila.numero);
    }
    sql.ejecutar('UPDATE encuesta_estado SET cuestionario=? WHERE id=1', CUESTIONARIO);
  }
}
/** Ningún código consumido y todas las celdas a cero; si no, CuestionarioConRespuestas antes de cambiar nada. */
function exigirSinRespuestas(sql: SqlAccesoPublico): void {
  exigir(columnasDe(sql, 'encuesta_lotes').includes('consumidos'));
  exigir(columnasDe(sql, 'encuesta_recuentos').includes('recuento'));
  const usados = sql.filas('SELECT count(*) AS n FROM encuesta_lotes WHERE consumidos<>0')[0]?.n;
  const sumados = sql.filas('SELECT count(*) AS n FROM encuesta_recuentos WHERE recuento<>0')[0]?.n;
  exigir(typeof usados === 'number' && typeof sumados === 'number');
  if (usados !== 0 || sumados !== 0) {
    throw new CuestionarioConRespuestas();
  }
}
/** La tabla vigente que sustituye a una anterior: su definición y la consulta que le copia las filas. */
interface Rehecha {
  readonly tabla: string;
  readonly crear: (nombre: string) => string;
  readonly seleccion: string;
  readonly valores?: readonly ValorSql[];
}
/** Rehace una tabla con su definición vigente y las filas que da `seleccion`, en la misma transacción. */
function rehacer(sql: SqlAccesoPublico, { tabla, crear, seleccion, valores = [] }: Rehecha): void {
  const nueva = `${tabla}_nueva`;
  // Un resto de una migración a medias no se pisa: bloquea la encuesta como cualquier otro esquema inesperado.
  exigir(sql.filas('SELECT 1 FROM sqlite_master WHERE name=?', nueva).length === 0);
  sql.ejecutar(crear(nueva));
  sql.ejecutar(`INSERT INTO ${nueva} ${seleccion}`, ...valores);
  sql.ejecutar(`DROP TABLE ${tabla}`);
  sql.ejecutar(`ALTER TABLE ${nueva} RENAME TO ${tabla}`);
}
/**
 * Lleva una encuesta de los esquemas 1 a 3 a las rondas: lo que había pasa a ser la primera ronda, «Piloto Citilab»,
 * abierta o cerrada como estaba la encuesta y sin fechas, porque esos esquemas no las guardaban. Los lotes y los
 * recuentos se copian enteros con la ronda 1 y los códigos sin usar no se tocan: ni se pierde ni se suma nada.
 */
function migrarARondas(sql: SqlAccesoPublico): void {
  const abierta = sql.filas('SELECT abierta FROM encuesta_estado WHERE id=1')[0]?.abierta;
  exigir(abierta === 0 || abierta === 1);
  // Los almacenes de la versión 1 que no tenían la columna del nombre la reciben vacía en los lotes que ya había.
  if (!columnasDe(sql, 'encuesta_lotes').includes('nombre')) {
    sql.ejecutar(`ALTER TABLE encuesta_lotes ADD COLUMN ${COLUMNA_NOMBRE}`);
  }
  crearTablaDeRondas(sql);
  sql.ejecutar('INSERT INTO encuesta_rondas VALUES(1,?,NULL,NULL,?)', NOMBRE_PRIMERA_RONDA, abierta);
  rehacer(sql, {
    tabla: 'encuesta_lotes',
    crear: TABLA_DE_LOTES,
    seleccion:
      '(id,numero,ronda,tipo,emitidos,consumidos,nombre) SELECT id,numero,1,tipo,emitidos,consumidos,nombre FROM encuesta_lotes',
  });
  rehacer(sql, {
    tabla: 'encuesta_recuentos',
    crear: TABLA_DE_RECUENTOS,
    seleccion: '(ronda,tipo,pregunta,valor,recuento) SELECT 1,tipo,pregunta,valor,recuento FROM encuesta_recuentos',
  });
  // Los esquemas 1 y 2 no guardaban el cuestionario: se marca el vigente y alinearConElCuestionario rehace las celdas.
  const cuestionario = columnasDe(sql, 'encuesta_estado').includes('cuestionario') ? 'cuestionario' : '?';
  rehacer(sql, {
    tabla: 'encuesta_estado',
    crear: TABLA_DE_ESTADO,
    seleccion: `(id,version,cuestionario) SELECT id,?,${cuestionario} FROM encuesta_estado`,
    valores: cuestionario === '?' ? [ESQUEMA, CUESTIONARIO] : [ESQUEMA],
  });
}
