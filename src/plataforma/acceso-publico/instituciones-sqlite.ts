/** Registro institucional común Node/DO. El llamador conserva una transacción SQL síncrona y la sesión cuando procede. */
import {
  CADUCIDAD_INVITACION_MS,
  correoInstitucion,
  ID_INSTITUCION,
  ID_INVITACION,
  type IdentidadInvitacion,
  type Institucion,
  type InvitacionLeida,
  LIMITES_CONECTIVIDAD,
  nombreInstitucion,
  type RegistroInstituciones,
  type ResultadoActivarInvitacion,
  type ResultadoCambioInstituciones,
  type SolicitudInstitucion,
  SolicitudInstitucionInvalida,
  type SolicitudInvitar,
  type SolicitudRetirarClave,
} from '../../administracion/instituciones.ts';
import type { Socio } from '../../api/socios/registro.ts';
import { leerControlesSqlite } from './controles-sqlite.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

const MAX_INSTANTE_DATE = 8_640_000_000_000_000;
const HUELLA = /^[0-9a-f]{64}$/;
const TABLAS = ['instituciones_estado', 'instituciones', 'instituciones_invitaciones', 'instituciones_claves'] as const;
interface FilaInstitucion {
  id: string;
  nombre: string;
  correo: string | null;
  retirada: number;
  ultima_conexion: number | null;
  consultas: number;
}

/** Error técnico sin campos de registros ni secretos. Una fila defectuosa nunca se convierte en ausencia. */
export class RegistroInstitucionalNoValido extends Error {
  override readonly name = 'RegistroInstitucionalNoValido';
  constructor() {
    super('Registro institucional no válido');
  }
}
function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new RegistroInstitucionalNoValido();
  }
}
function entero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
function instante(valor: unknown): valor is number {
  return entero(valor) && valor <= MAX_INSTANTE_DATE;
}
function fecha(valor: number | null): string | null {
  exigir(valor === null || instante(valor));
  return valor === null ? null : new Date(valor).toISOString();
}
function identidad(entrada: IdentidadInvitacion): void {
  exigir(ID_INVITACION.test(entrada.id) && HUELLA.test(entrada.huella));
}
function estado(sql: SqlAccesoPublico): { revision: number; reloj: number } {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.version === 1 && metadata.instituciones_version === 1);
  const filas = sql.filas('SELECT version,revision,reloj FROM instituciones_estado WHERE id=1');
  const fila = filas[0];
  exigir(
    filas.length === 1 && fila !== undefined && fila.version === 1 && entero(fila.revision) && instante(fila.reloj),
  );
  return { revision: fila.revision, reloj: fila.reloj };
}
function reloj(sql: SqlAccesoPublico, ahora: number): number {
  const anterior = estado(sql);
  exigir(instante(ahora) && ahora >= anterior.reloj && ahora <= MAX_INSTANTE_DATE - CADUCIDAD_INVITACION_MS);
  sql.ejecutar('UPDATE instituciones_estado SET reloj=? WHERE id=1', ahora);
  return anterior.revision;
}
function avanzar(sql: SqlAccesoPublico): void {
  exigir(estado(sql).revision < Number.MAX_SAFE_INTEGER);
  sql.ejecutar('UPDATE instituciones_estado SET revision=revision+1 WHERE id=1');
}
function estadoInstitucion(retirada: number, clavesActivas: number, invitacionVigente: boolean): Institucion['estado'] {
  if (retirada === 1 || (clavesActivas === 0 && !invitacionVigente)) {
    return 'retirada';
  }
  return clavesActivas > 0 ? 'activa' : 'invitada';
}
function textosInstitucion(fila: FilaSql): { nombre: string; correo: string | null } {
  try {
    return { nombre: nombreInstitucion(fila.nombre), correo: correoInstitucion(fila.correo) };
  } catch (error) {
    if (error instanceof SolicitudInstitucionInvalida) {
      throw new RegistroInstitucionalNoValido();
    }
    throw error;
  }
}
function institucion(fila: FilaSql): FilaInstitucion {
  exigir(typeof fila.id === 'string' && ID_INSTITUCION.test(fila.id));
  const { nombre, correo } = textosInstitucion(fila);
  exigir(fila.retirada === 0 || fila.retirada === 1);
  exigir(fila.ultima_conexion === null || instante(fila.ultima_conexion));
  exigir(entero(fila.consultas));
  return {
    id: fila.id,
    nombre,
    correo,
    retirada: fila.retirada,
    ultima_conexion: fila.ultima_conexion,
    consultas: fila.consultas,
  };
}
function buscar(sql: SqlAccesoPublico, id: string): FilaInstitucion | null {
  const fila = sql.filas('SELECT * FROM instituciones WHERE id=?', id)[0];
  return fila ? institucion(fila) : null;
}
function claves(sql: SqlAccesoPublico, id: string) {
  return sql
    .filas(
      'SELECT id,huella,creada,ultima_conexion FROM instituciones_claves WHERE institucion=? ORDER BY creada,id',
      id,
    )
    .map((fila) => {
      exigir(typeof fila.id === 'string' && ID_INVITACION.test(fila.id) && instante(fila.creada));
      exigir(typeof fila.huella === 'string' && HUELLA.test(fila.huella));
      exigir(fila.ultima_conexion === null || instante(fila.ultima_conexion));
      return {
        id: fila.id,
        creadaEn: new Date(fila.creada).toISOString(),
        ultimaConexion: fecha(fila.ultima_conexion),
      };
    });
}
interface FilaInvitacion {
  readonly id: string;
  readonly institucion: string;
  readonly huella: string;
  readonly caduca: number;
  readonly consumida: number;
}
function invitacion(fila: FilaSql): FilaInvitacion {
  exigir(typeof fila.id === 'string' && ID_INVITACION.test(fila.id));
  exigir(typeof fila.institucion === 'string' && ID_INSTITUCION.test(fila.institucion));
  exigir(typeof fila.huella === 'string' && HUELLA.test(fila.huella) && instante(fila.caduca));
  exigir(fila.consumida === 0 || fila.consumida === 1);
  return {
    id: fila.id,
    institucion: fila.institucion,
    huella: fila.huella,
    caduca: fila.caduca,
    consumida: fila.consumida,
  };
}
/** Preparación explícita: un conjunto parcial no se completa ni se da por válido. */
export function prepararInstitucionesSqlite(sql: SqlAccesoPublico, ahora: number): void {
  const encontradas = sql.filas(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('instituciones_estado','instituciones','instituciones_invitaciones','instituciones_claves')",
  );
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.version === 1);
  if (Object.hasOwn(metadata, 'instituciones_version')) {
    exigir(metadata.instituciones_version === 1 && encontradas.length === TABLAS.length);
    const anterior = estado(sql);
    exigir(instante(ahora) && ahora >= anterior.reloj);
    return;
  }
  exigir(encontradas.length === 0 && instante(ahora));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN instituciones_version INTEGER NOT NULL DEFAULT 0 CHECK(instituciones_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE instituciones_estado (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1), revision INTEGER NOT NULL,
    reloj INTEGER NOT NULL) STRICT`);
  sql.ejecutar(`CREATE TABLE instituciones (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, correo TEXT, retirada INTEGER NOT NULL CHECK(retirada IN (0,1)),
    ultima_conexion INTEGER, consultas INTEGER NOT NULL CHECK(consultas>=0)) STRICT`);
  sql.ejecutar(`CREATE TABLE instituciones_invitaciones (
    id TEXT PRIMARY KEY, institucion TEXT NOT NULL UNIQUE, huella TEXT NOT NULL CHECK(length(huella)=64),
    caduca INTEGER NOT NULL, consumida INTEGER NOT NULL CHECK(consumida IN (0,1))) STRICT`);
  sql.ejecutar(`CREATE TABLE instituciones_claves (
    id TEXT PRIMARY KEY, institucion TEXT NOT NULL, huella TEXT NOT NULL UNIQUE CHECK(length(huella)=64),
    creada INTEGER NOT NULL, ultima_conexion INTEGER) STRICT`);
  sql.ejecutar('CREATE INDEX instituciones_claves_institucion ON instituciones_claves(institucion)');
  sql.ejecutar('INSERT INTO instituciones_estado VALUES(1,1,0,?)', ahora);
  sql.ejecutar('UPDATE publico_estado SET instituciones_version=1 WHERE id=1');
}
export function leerRegistroInstitucionesSqlite(sql: SqlAccesoPublico, ahora: number): RegistroInstituciones {
  const revision = reloj(sql, ahora);
  const filas = sql.filas('SELECT * FROM instituciones ORDER BY nombre,id');
  exigir(filas.length <= LIMITES_CONECTIVIDAD.instituciones);
  const instituciones = filas.map((fila) => {
    const i = institucion(fila),
      activas = claves(sql, i.id);
    exigir(activas.length <= LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion);
    const pendiente = sql.filas('SELECT * FROM instituciones_invitaciones WHERE institucion=?', i.id)[0];
    const inv = pendiente ? invitacion(pendiente) : null;
    return {
      id: i.id,
      nombre: i.nombre,
      correo: i.correo,
      estado: estadoInstitucion(i.retirada, activas.length, inv !== null && inv.consumida === 0 && inv.caduca > ahora),
      ultimaConexion: fecha(i.ultima_conexion),
      consultas: i.consultas,
      invitacion:
        inv && inv.consumida === 0 && inv.caduca > ahora ? { caducaEn: new Date(inv.caduca).toISOString() } : null,
      claves: activas,
    };
  });
  return { version: 1, revision, instituciones };
}
function resultado(
  sql: SqlAccesoPublico,
  ahora: number,
  decision: ResultadoCambioInstituciones['estado'],
): ResultadoCambioInstituciones {
  return { estado: decision, registro: leerRegistroInstitucionesSqlite(sql, ahora) };
}
function guardarInvitacion(sql: SqlAccesoPublico, id: string, nueva: IdentidadInvitacion, ahora: number): void {
  identidad(nueva);
  sql.ejecutar(
    `INSERT INTO instituciones_invitaciones(id,institucion,huella,caduca,consumida) VALUES(?,?,?,?,0)
    ON CONFLICT(institucion) DO UPDATE SET id=excluded.id,huella=excluded.huella,caduca=excluded.caduca,consumida=0`,
    nueva.id,
    id,
    nueva.huella,
    ahora + CADUCIDAD_INVITACION_MS,
  );
}
export function invitarInstitucionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudInvitar,
  nueva: IdentidadInvitacion & { readonly institucionId: string },
  ahora: number,
): ResultadoCambioInstituciones {
  if (reloj(sql, ahora) !== solicitud.revisionEsperada) {
    return resultado(sql, ahora, 'conflicto');
  }
  exigir(ID_INSTITUCION.test(nueva.institucionId));
  const cantidad = sql.filas('SELECT count(*) AS n FROM instituciones')[0]?.n;
  exigir(entero(cantidad));
  if (cantidad >= LIMITES_CONECTIVIDAD.instituciones) {
    return resultado(sql, ahora, 'lleno');
  }
  sql.ejecutar(
    'INSERT INTO instituciones VALUES(?,?,?,0,NULL,0)',
    nueva.institucionId,
    nombreInstitucion(solicitud.nombre),
    correoInstitucion(solicitud.correo),
  );
  guardarInvitacion(sql, nueva.institucionId, nueva, ahora);
  avanzar(sql);
  return resultado(sql, ahora, 'cambiado');
}
export function renovarInvitacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudInstitucion,
  nueva: IdentidadInvitacion,
  ahora: number,
): ResultadoCambioInstituciones {
  if (reloj(sql, ahora) !== solicitud.revisionEsperada) {
    return resultado(sql, ahora, 'conflicto');
  }
  if (!buscar(sql, solicitud.id)) {
    return resultado(sql, ahora, 'no_encontrada');
  }
  if (claves(sql, solicitud.id).length >= LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion) {
    return resultado(sql, ahora, 'dos_claves_activas');
  }
  guardarInvitacion(sql, solicitud.id, nueva, ahora);
  sql.ejecutar('UPDATE instituciones SET retirada=0 WHERE id=?', solicitud.id);
  avanzar(sql);
  return resultado(sql, ahora, 'cambiado');
}
export function retirarInstitucionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudInstitucion,
  ahora: number,
): ResultadoCambioInstituciones {
  if (reloj(sql, ahora) !== solicitud.revisionEsperada) {
    return resultado(sql, ahora, 'conflicto');
  }
  if (!buscar(sql, solicitud.id)) {
    return resultado(sql, ahora, 'no_encontrada');
  }
  sql.ejecutar('UPDATE instituciones SET retirada=1 WHERE id=?', solicitud.id);
  sql.ejecutar('UPDATE instituciones_invitaciones SET consumida=1 WHERE institucion=?', solicitud.id);
  sql.ejecutar('DELETE FROM instituciones_claves WHERE institucion=?', solicitud.id);
  avanzar(sql);
  return resultado(sql, ahora, 'cambiado');
}
export function retirarClaveInstitucionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudRetirarClave,
  ahora: number,
): ResultadoCambioInstituciones {
  if (reloj(sql, ahora) !== solicitud.revisionEsperada) {
    return resultado(sql, ahora, 'conflicto');
  }
  if (
    !sql.filas('SELECT id FROM instituciones_claves WHERE id=? AND institucion=?', solicitud.claveId, solicitud.id)
      .length
  ) {
    return resultado(sql, ahora, 'no_encontrada');
  }
  sql.ejecutar('DELETE FROM instituciones_claves WHERE id=? AND institucion=?', solicitud.claveId, solicitud.id);
  if (claves(sql, solicitud.id).length === 0) {
    const pendiente = sql.filas('SELECT * FROM instituciones_invitaciones WHERE institucion=?', solicitud.id)[0];
    const inv = pendiente ? invitacion(pendiente) : null;
    if (inv === null || inv.consumida === 1 || inv.caduca <= ahora) {
      sql.ejecutar('UPDATE instituciones SET retirada=1 WHERE id=?', solicitud.id);
    }
  }
  avanzar(sql);
  return resultado(sql, ahora, 'cambiado');
}
/** Cada activación comprueba los controles dentro de la misma transacción que consume el enlace. */
function habilitada(sql: SqlAccesoPublico): boolean {
  const controles = leerControlesSqlite(sql);
  exigir(controles !== null);
  return controles.api !== 'deshabilitada';
}
function invitacionVigente(sql: SqlAccesoPublico, id: string, huella: string, ahora: number): FilaInvitacion | null {
  const fila = sql.filas('SELECT * FROM instituciones_invitaciones WHERE id=?', id)[0];
  if (!fila) {
    return null;
  }
  const inv = invitacion(fila),
    i = buscar(sql, inv.institucion);
  exigir(i !== null);
  return inv.huella === huella && inv.consumida === 0 && inv.caduca > ahora && i.retirada === 0 ? inv : null;
}
export function consultarInvitacionSqlite(
  sql: SqlAccesoPublico,
  recibida: IdentidadInvitacion,
  ahora: number,
): InvitacionLeida | null | 'apagada' {
  identidad(recibida);
  reloj(sql, ahora);
  if (!habilitada(sql)) {
    return 'apagada';
  }
  const inv = invitacionVigente(sql, recibida.id, recibida.huella, ahora);
  if (!inv) {
    return null;
  }
  const i = buscar(sql, inv.institucion);
  exigir(i !== null);
  return { version: 1, institucion: { id: i.id, nombre: i.nombre }, caducaEn: new Date(inv.caduca).toISOString() };
}
export function activarInvitacionSqlite(
  sql: SqlAccesoPublico,
  recibida: IdentidadInvitacion,
  clave: IdentidadInvitacion,
  ahora: number,
): ResultadoActivarInvitacion {
  identidad(recibida);
  identidad(clave);
  reloj(sql, ahora);
  if (!habilitada(sql)) {
    return { estado: 'apagada' };
  }
  const inv = invitacionVigente(sql, recibida.id, recibida.huella, ahora);
  if (!inv) {
    return { estado: 'no_disponible' };
  }
  if (claves(sql, inv.institucion).length >= LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion) {
    return { estado: 'dos_claves_activas' };
  }
  sql.ejecutar('INSERT INTO instituciones_claves VALUES(?,?,?,?,NULL)', clave.id, inv.institucion, clave.huella, ahora);
  sql.ejecutar('UPDATE instituciones_invitaciones SET consumida=1 WHERE id=?', inv.id);
  avanzar(sql);
  return { estado: 'activada', institucionId: inv.institucion };
}
/** Lectura vigente por petición, sin caché de credenciales: una retirada invalida también tokens emitidos. */
export function buscarInstitucionAutorizadaSqlite(sql: SqlAccesoPublico, id: string): Socio | null {
  if (!ID_INSTITUCION.test(id)) {
    return null;
  }
  const i = buscar(sql, id);
  if (!i || i.retirada === 1) {
    return null;
  }
  const filas = sql.filas('SELECT huella FROM instituciones_claves WHERE institucion=? ORDER BY creada,id', id);
  exigir(filas.length <= LIMITES_CONECTIVIDAD.clavesActivasPorInstitucion);
  const huellas = filas.map((fila) => {
    exigir(typeof fila.huella === 'string' && HUELLA.test(fila.huella));
    return fila.huella;
  });
  return huellas.length ? { id, huellas, consultasPorHora: LIMITES_CONECTIVIDAD.consultasPorInstitucionHora } : null;
}
