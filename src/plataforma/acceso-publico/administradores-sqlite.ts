/**
 * Lista de administradores del Panel de Control sobre SQLite, en el mismo almacén que la sesión única. El llamador
 * mantiene la transacción; cada alta, retirada y respuesta de Cloudflare Access queda en el registro del panel.
 */
import {
  type Administrador,
  type CambioAdministradores,
  correoDeAdministrador,
  type DecisionAutorizacion,
  type EntradaAdministrador,
  ESTADOS_ADMINISTRADOR,
  type EstadoAdministrador,
  MAX_ADMINISTRADORES,
  type ResultadoCambioAdministradores,
  rechazoDeAlta,
  rechazoDeRetirada,
} from '../../administracion/administradores.ts';
import type { TipoRegistroPanel } from '../../administracion/sesion-unica.ts';
import { anotarRegistroPanelSqlite, prepararSesionUnicaSqlite } from './sesion-unica-sqlite.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Estado de la lista de administradores no válido');
  }
}
/** Migración única y explícita; antes prepara la de la sesión única, de la que depende el registro. */
export function prepararAdministradoresSqlite(sql: SqlAccesoPublico): void {
  prepararSesionUnicaSqlite(sql);
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.sesion_unica_version === 1);
  if (Object.hasOwn(metadata, 'administradores_version')) {
    exigir(metadata.administradores_version === 1);
    return;
  }
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN administradores_version INTEGER NOT NULL DEFAULT 0 CHECK(administradores_version IN (0,1))',
  );
  const estados = ESTADOS_ADMINISTRADOR.map((estado) => `'${estado}'`).join(',');
  sql.ejecutar(`CREATE TABLE administracion_administradores (
    correo TEXT PRIMARY KEY, estado TEXT NOT NULL CHECK(estado IN (${estados})), anadido_por TEXT,
    anadido_en INTEGER NOT NULL, ultima_entrada INTEGER,
    segundo_factor INTEGER CHECK(segundo_factor IS NULL OR segundo_factor IN (0,1))
  ) STRICT`);
  sql.ejecutar('UPDATE publico_estado SET administradores_version=1 WHERE id=1');
}
function administrador(fila: FilaSql): Administrador {
  exigir(typeof fila.correo === 'string' && correoDeAdministrador(fila.correo) === fila.correo);
  exigir(ESTADOS_ADMINISTRADOR.includes(fila.estado as EstadoAdministrador));
  exigir(fila.anadido_por === null || correoDeAdministrador(fila.anadido_por) === fila.anadido_por);
  exigir(typeof fila.anadido_en === 'number' && Number.isSafeInteger(fila.anadido_en));
  exigir(fila.ultima_entrada === null || Number.isSafeInteger(fila.ultima_entrada));
  exigir(fila.segundo_factor === null || fila.segundo_factor === 0 || fila.segundo_factor === 1);
  return {
    correo: fila.correo,
    estado: fila.estado as EstadoAdministrador,
    anadidoPor: fila.anadido_por as string | null,
    anadidoEn: fila.anadido_en,
    ultimaEntrada: fila.ultima_entrada as number | null,
    segundoFactor: fila.segundo_factor === null ? null : fila.segundo_factor === 1,
  };
}
export function leerAdministradoresSqlite(sql: SqlAccesoPublico): readonly Administrador[] {
  prepararAdministradoresSqlite(sql);
  const filas = sql.filas('SELECT * FROM administracion_administradores ORDER BY anadido_en, correo');
  exigir(filas.length <= MAX_ADMINISTRADORES);
  return filas.map(administrador);
}
/** La siembra solo se aplica a una lista que nunca ha tenido filas: después, la lista la gobierna el panel. */
function sembrar(sql: SqlAccesoPublico, siembra: readonly string[], ahora: number): void {
  const correos = siembra.map(correoDeAdministrador);
  exigir(correos.length <= MAX_ADMINISTRADORES && new Set(correos).size === correos.length);
  for (const correo of correos) {
    exigir(correo !== null);
    sql.ejecutar("INSERT INTO administracion_administradores VALUES (?,'pendiente',NULL,?,NULL,NULL)", correo, ahora);
  }
}
/**
 * Decide si el correo verificado puede usar el panel. Una entrada autorizada cuenta como entrada: un pendiente pasa a
 * activo y se guarda si llegó con segundo factor. Sin correo no hay a quién buscar y se deniega.
 */
export function autorizarAdministradorSqlite(
  sql: SqlAccesoPublico,
  entrada: EntradaAdministrador,
  siembra: readonly string[],
  ahora: number,
): DecisionAutorizacion {
  let lista = leerAdministradoresSqlite(sql);
  if (lista.length === 0 && siembra.length > 0) {
    sembrar(sql, siembra, ahora);
    lista = leerAdministradoresSqlite(sql);
  }
  if (lista.length === 0) {
    return 'sin-lista';
  }
  const fila = lista.find((candidata) => candidata.correo === entrada.correo);
  if (fila === undefined || fila.estado === 'retirada-pendiente') {
    return 'denegado';
  }
  sql.ejecutar(
    "UPDATE administracion_administradores SET estado='activo',ultima_entrada=?,segundo_factor=? WHERE correo=?",
    ahora,
    entrada.segundoFactor ? 1 : 0,
    fila.correo,
  );
  return 'autorizado';
}
/** Cada hecho de la lista se anota con quién lo hizo (el autor) y a quién se refiere (el titular). */
interface Hecho {
  readonly tipo: TipoRegistroPanel;
  readonly autor: string;
  readonly correo: string;
}
function anotar(sql: SqlAccesoPublico, ahora: number, hecho: Hecho): void {
  anotarRegistroPanelSqlite(sql, ahora, { tipo: hecho.tipo, correo: hecho.autor, titular: hecho.correo });
}
type Cambio<O extends CambioAdministradores['operacion']> = Extract<CambioAdministradores, { operacion: O }>;
type Rechazo = Extract<ResultadoCambioAdministradores, { estado: 'rechazado' }>;
interface Contexto {
  readonly sql: SqlAccesoPublico;
  readonly ahora: number;
  readonly lista: readonly Administrador[];
}
function anadir({ sql, ahora, lista }: Contexto, cambio: Cambio<'anadir'>): Rechazo | null {
  const motivo = rechazoDeAlta(lista, cambio.autor, cambio.correo);
  const correo = correoDeAdministrador(cambio.correo);
  if (motivo !== null || correo === null) {
    return { estado: 'rechazado', motivo: motivo ?? 'correo_no_valido' };
  }
  // Quien se añade a sí mismo acaba de entrar verificado: ya es activo.
  const estado = correo === cambio.autor ? 'activo' : 'pendiente';
  sql.ejecutar(
    'INSERT INTO administracion_administradores VALUES (?,?,?,?,NULL,NULL)',
    correo,
    estado,
    cambio.autor,
    ahora,
  );
  if (cambio.access === 'correcta') {
    anotar(sql, ahora, { tipo: 'cloudflare-actualizado', autor: cambio.autor, correo });
  }
  anotar(sql, ahora, { tipo: 'administrador-anadido', autor: cambio.autor, correo });
  return null;
}
/** Con Access configurado la fila queda como retirada pendiente: deja de entrar ya, y se borra cuando Cloudflare confirma. */
function retirar({ sql, ahora, lista }: Contexto, cambio: Cambio<'retirar'>): Rechazo | null {
  const motivo = rechazoDeRetirada(lista, cambio.correo);
  if (motivo !== null) {
    return { estado: 'rechazado', motivo };
  }
  const consulta = cambio.esperarAccess
    ? "UPDATE administracion_administradores SET estado='retirada-pendiente' WHERE correo=?"
    : 'DELETE FROM administracion_administradores WHERE correo=?';
  sql.ejecutar(consulta, cambio.correo);
  anotar(sql, ahora, { tipo: 'administrador-retirado', autor: cambio.autor, correo: cambio.correo });
  return null;
}
function confirmarRetirada({ sql, ahora, lista }: Contexto, cambio: Cambio<'confirmar-retirada'>): Rechazo | null {
  if (!lista.some((fila) => fila.correo === cambio.correo && fila.estado === 'retirada-pendiente')) {
    return { estado: 'rechazado', motivo: 'administrador_no_encontrado' };
  }
  if (cambio.access === 'correcta') {
    sql.ejecutar('DELETE FROM administracion_administradores WHERE correo=?', cambio.correo);
  }
  const tipo = cambio.access === 'correcta' ? 'cloudflare-actualizado' : 'cloudflare-fallido';
  anotar(sql, ahora, { tipo, autor: cambio.autor, correo: cambio.correo });
  return null;
}
function aplicar(contexto: Contexto, cambio: CambioAdministradores): Rechazo | null {
  switch (cambio.operacion) {
    case 'anadir':
      return anadir(contexto, cambio);
    case 'retirar':
      return retirar(contexto, cambio);
    case 'confirmar-retirada':
      return confirmarRetirada(contexto, cambio);
    default: {
      const correo = correoDeAdministrador(cambio.correo);
      exigir(correo !== null);
      anotar(contexto.sql, contexto.ahora, { tipo: 'cloudflare-fallido', autor: cambio.autor, correo });
      return null;
    }
  }
}
/** El llamador ya ha comprobado que la sesión única es de quien pide; aquí se vuelven a aplicar las reglas. */
export function cambiarAdministradoresSqlite(
  sql: SqlAccesoPublico,
  cambio: CambioAdministradores,
  ahora: number,
): ResultadoCambioAdministradores {
  const rechazo = aplicar({ sql, ahora, lista: leerAdministradoresSqlite(sql) }, cambio);
  return rechazo ?? { estado: 'activa', administradores: leerAdministradoresSqlite(sql) };
}
