/**
 * Sesión única y registro de accesos del Panel de Control sobre SQLite. El llamador mantiene la transacción y ya ha
 * validado la fila de la sesión administrativa global; aquí solo se decide quién la tiene y qué se anota.
 */
import { DURACION_MAXIMA_SESION_PANEL_MS, INACTIVIDAD_SESION_PANEL_MS } from '../../administracion/sesion.ts';
import {
  type BienvenidaPanel,
  esCorreoVerificado,
  esIdEntrada,
  esIdSesion,
  FILAS_LECTURA_REGISTRO_PANEL,
  type FilaRegistroPanel,
  type IdentidadPanel,
  MAX_FILAS_CON_TOPE_REGISTRO_PANEL,
  type MotivoCaducidad,
  type OcupacionPanel,
  RETENCION_REGISTRO_PANEL_MS,
  TIPOS_CON_TOPE_REGISTRO_PANEL,
  TIPOS_REGISTRO_PANEL,
  type TipoRegistroPanel,
} from '../../administracion/sesion-unica.ts';
import type { FilaSql, SqlAccesoPublico } from './sqlite.ts';

/** Lo que este módulo necesita de la fila global de sesión, ya validada por su almacén. */
interface SesionGlobalLeida {
  readonly huellaSesion: string | null;
  readonly huellaPrincipal: string | null;
  readonly iniciada: number | null;
  readonly actividad: number | null;
  readonly cerrada: boolean;
}
export type CrearIdLegible = (prefijo: 'E' | 'S') => string;
interface DatosSesionUnica {
  readonly huellaSesion: string;
  readonly idSesion: string;
  readonly idEntrada: string;
  readonly correo: string;
  readonly cierre: string | null;
}
export interface Anotacion {
  readonly tipo: TipoRegistroPanel;
  readonly correo: string;
  readonly idEntrada?: string | null;
  readonly idSesion?: string | null;
  readonly motivo?: MotivoCaducidad | null;
  readonly titular?: string | null;
  /** Clave de deduplicación: la misma clave nunca anota una segunda fila. */
  readonly clave?: string | null;
}

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) {
    throw new Error('Estado de la sesión única no válido');
  }
}
function texto(valor: unknown): valor is string {
  return typeof valor === 'string';
}
/** Migración única y explícita, en la misma transacción que la primera operación de la sesión única. */
export function prepararSesionUnicaSqlite(sql: SqlAccesoPublico): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigir(metadata !== undefined && metadata.sesion_panel_version === 1);
  if (Object.hasOwn(metadata, 'sesion_unica_version')) {
    exigir(metadata.sesion_unica_version === 1);
    return;
  }
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN sesion_unica_version INTEGER NOT NULL DEFAULT 0 CHECK(sesion_unica_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_sesion_unica (
    id INTEGER PRIMARY KEY CHECK(id=1), huella_sesion TEXT NOT NULL, id_sesion TEXT NOT NULL, id_entrada TEXT NOT NULL,
    correo TEXT NOT NULL, cierre TEXT CHECK(cierre IS NULL OR cierre IN ('cerrada','inactividad','duracion','retomada'))
  ) STRICT`);
  const tipos = TIPOS_REGISTRO_PANEL.map((tipo) => `'${tipo}'`).join(',');
  sql.ejecutar(`CREATE TABLE administracion_registro_panel (
    n INTEGER PRIMARY KEY AUTOINCREMENT, instante INTEGER NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN (${tipos})),
    correo TEXT NOT NULL, id_entrada TEXT, id_sesion TEXT,
    motivo TEXT CHECK(motivo IS NULL OR motivo IN ('inactividad','duracion')), titular TEXT, clave TEXT UNIQUE
  ) STRICT`);
  sql.ejecutar('UPDATE publico_estado SET sesion_unica_version=1 WHERE id=1');
}
/** Antes de la primera operación de la sesión única no hay nada que anotar ni que leer. */
function migrada(sql: SqlAccesoPublico): boolean {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  return metadata !== undefined && metadata.sesion_unica_version === 1;
}
function leerDatos(sql: SqlAccesoPublico): DatosSesionUnica | null {
  const fila = sql.filas('SELECT * FROM administracion_sesion_unica WHERE id=1')[0];
  if (fila === undefined) {
    return null;
  }
  exigir(texto(fila.huella_sesion) && esIdSesion(fila.id_sesion) && esIdEntrada(fila.id_entrada));
  exigir(esCorreoVerificado(fila.correo) && (fila.cierre === null || texto(fila.cierre)));
  return {
    huellaSesion: fila.huella_sesion,
    idSesion: fila.id_sesion,
    idEntrada: fila.id_entrada,
    correo: fila.correo,
    cierre: fila.cierre,
  };
}
/** Solo vale para la sesión global vigente: una sesión abierta por otra vía no hereda datos ajenos. */
function datosDe(sql: SqlAccesoPublico, sesion: SesionGlobalLeida): DatosSesionUnica | null {
  if (!migrada(sql)) {
    return null;
  }
  const datos = leerDatos(sql);
  return datos !== null && datos.huellaSesion === sesion.huellaSesion ? datos : null;
}
function vencimiento(sesion: SesionGlobalLeida): { readonly en: number; readonly motivo: MotivoCaducidad } | null {
  if (sesion.huellaSesion === null || sesion.cerrada || sesion.iniciada === null || sesion.actividad === null) {
    return null;
  }
  const absoluta = sesion.iniciada + DURACION_MAXIMA_SESION_PANEL_MS;
  const inactividad = sesion.actividad + INACTIVIDAD_SESION_PANEL_MS;
  return absoluta <= inactividad ? { en: absoluta, motivo: 'duracion' } : { en: inactividad, motivo: 'inactividad' };
}
/**
 * Toda fila del registro entra por aquí, con su depuración por antigüedad y por número de filas. Solo un choque de la
 * clave se descarta en silencio: cualquier otra restricción sigue fallando.
 */
export function anotarRegistroPanelSqlite(sql: SqlAccesoPublico, instante: number, anotacion: Anotacion): void {
  sql.ejecutar(
    `INSERT INTO administracion_registro_panel
      (instante,tipo,correo,id_entrada,id_sesion,motivo,titular,clave) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(clave) DO NOTHING`,
    instante,
    anotacion.tipo,
    anotacion.correo,
    anotacion.idEntrada ?? null,
    anotacion.idSesion ?? null,
    anotacion.motivo ?? null,
    anotacion.titular ?? null,
    anotacion.clave ?? null,
  );
  depurarRegistroPanelSqlite(sql, instante);
}
/** La retención vale para todas las filas; el tope por número, solo para los tipos que lo tienen. */
function depurarRegistroPanelSqlite(sql: SqlAccesoPublico, ahora: number): void {
  sql.ejecutar('DELETE FROM administracion_registro_panel WHERE instante<?', ahora - RETENCION_REGISTRO_PANEL_MS);
  const conTope = TIPOS_CON_TOPE_REGISTRO_PANEL.map(() => '?').join(',');
  sql.ejecutar(
    `DELETE FROM administracion_registro_panel WHERE tipo IN (${conTope}) AND n NOT IN
      (SELECT n FROM administracion_registro_panel WHERE tipo IN (${conTope}) ORDER BY n DESC LIMIT ?)`,
    ...TIPOS_CON_TOPE_REGISTRO_PANEL,
    ...TIPOS_CON_TOPE_REGISTRO_PANEL,
    MAX_FILAS_CON_TOPE_REGISTRO_PANEL,
  );
}
/**
 * Un rechazo se anota una sola vez por cada par de entrada y sesión que bloquea: repetir la petición no añade filas.
 * Una sesión anterior a la sesión única no tiene identificador y se distingue por su inicio. La retoma no lo
 * necesita: sustituye en la misma transacción la sesión retomada, que ya no puede retomarse otra vez.
 */
function claveDeRechazo(idEntrada: string, datos: DatosSesionUnica | null, sesion: SesionGlobalLeida): string {
  return JSON.stringify(['apertura-rechazada', idEntrada, datos?.idSesion ?? sesion.iniciada]);
}
/**
 * La caducidad se anota la primera vez que alguien la observa, con el instante en que ocurrió de verdad. Así queda
 * registrada aunque nadie vuelva a usar aquel dispositivo.
 */
export function anotarCaducidadSqlite(sql: SqlAccesoPublico, sesion: SesionGlobalLeida, ahora: number): void {
  const vence = vencimiento(sesion);
  const datos = datosDe(sql, sesion);
  if (vence === null || ahora < vence.en || datos === null || datos.cierre !== null) {
    return;
  }
  sql.ejecutar('UPDATE administracion_sesion_unica SET cierre=? WHERE id=1', vence.motivo);
  anotarRegistroPanelSqlite(sql, vence.en, {
    tipo: 'sesion-caducada',
    correo: datos.correo,
    idEntrada: datos.idEntrada,
    idSesion: datos.idSesion,
    motivo: vence.motivo,
  });
}
/** Una entrada por sesión de Access: la misma huella devuelve el mismo identificador sin anotar otra fila. */
function registrarEntrada(sql: SqlAccesoPublico, identidad: IdentidadPanel, ahora: number, crearId: CrearIdLegible) {
  const previa = sql.filas(
    "SELECT id_entrada,instante FROM administracion_registro_panel WHERE tipo='entrada' AND clave=?",
    identidad.huellaEntrada,
  )[0];
  if (previa !== undefined) {
    exigir(esIdEntrada(previa.id_entrada) && typeof previa.instante === 'number');
    return { idEntrada: previa.id_entrada, entradaEn: previa.instante };
  }
  const idEntrada = crearId('E');
  exigir(esIdEntrada(idEntrada));
  anotarRegistroPanelSqlite(sql, ahora, {
    tipo: 'entrada',
    correo: identidad.correo,
    idEntrada,
    clave: identidad.huellaEntrada,
  });
  return { idEntrada, entradaEn: ahora };
}
function ocupacionDe(
  sql: SqlAccesoPublico,
  sesion: SesionGlobalLeida,
  identidad: IdentidadPanel,
  ahora: number,
): OcupacionPanel | null {
  const vence = vencimiento(sesion);
  if (vence === null || ahora >= vence.en || sesion.iniciada === null || sesion.actividad === null) {
    return null;
  }
  const datos = datosDe(sql, sesion);
  const propia = sesion.huellaPrincipal === identidad.huellaPrincipal;
  return {
    correo: datos?.correo ?? null,
    desde: sesion.iniciada,
    cierrePorInactividadEn: sesion.actividad + INACTIVIDAD_SESION_PANEL_MS,
    limiteEn: sesion.iniciada + DURACION_MAXIMA_SESION_PANEL_MS,
    idSesion: propia ? (datos?.idSesion ?? null) : null,
    idEntrada: propia ? (datos?.idEntrada ?? null) : null,
    propia,
  };
}
interface ContextoSesionUnica {
  readonly sql: SqlAccesoPublico;
  readonly sesion: SesionGlobalLeida;
  readonly identidad: IdentidadPanel;
  readonly ahora: number;
  readonly crearId: CrearIdLegible;
}
export function recibirEnPanelSqlite(contexto: ContextoSesionUnica): BienvenidaPanel {
  const { sql, sesion, identidad, ahora, crearId } = contexto;
  prepararSesionUnicaSqlite(sql);
  anotarCaducidadSqlite(sql, sesion, ahora);
  const entrada = registrarEntrada(sql, identidad, ahora, crearId);
  return { correo: identidad.correo, ...entrada, ocupacion: ocupacionDe(sql, sesion, identidad, ahora) };
}
type DecisionApertura =
  | { readonly estado: 'abrir'; readonly idEntrada: string }
  | { readonly estado: 'ocupada'; readonly ocupacion: OcupacionPanel };
/**
 * Otra persona con la sesión viva bloquea la apertura y queda anotado. La misma persona solo la sustituye si lo pide
 * de forma explícita: la sesión de su otro dispositivo se cierra como retomada.
 */
export function decidirAperturaSqlite(contexto: ContextoSesionUnica, retomar: boolean): DecisionApertura {
  const { sql, sesion, identidad, ahora } = contexto;
  const bienvenida = recibirEnPanelSqlite(contexto);
  const ocupacion = bienvenida.ocupacion;
  if (ocupacion === null) {
    return { estado: 'abrir', idEntrada: bienvenida.idEntrada };
  }
  const datos = datosDe(sql, sesion);
  if (!ocupacion.propia) {
    anotarRegistroPanelSqlite(sql, ahora, {
      tipo: 'apertura-rechazada',
      correo: identidad.correo,
      idEntrada: bienvenida.idEntrada,
      idSesion: datos?.idSesion ?? null,
      titular: ocupacion.correo,
      clave: claveDeRechazo(bienvenida.idEntrada, datos, sesion),
    });
    return { estado: 'ocupada', ocupacion };
  }
  if (!retomar) {
    return { estado: 'ocupada', ocupacion };
  }
  anotarRegistroPanelSqlite(sql, ahora, {
    tipo: 'sesion-retomada',
    correo: identidad.correo,
    idEntrada: bienvenida.idEntrada,
    idSesion: datos?.idSesion ?? null,
  });
  return { estado: 'abrir', idEntrada: bienvenida.idEntrada };
}
/** Se llama después de instalar el token nuevo en la fila global, dentro de la misma transacción. */
export function anotarAperturaSqlite(
  contexto: ContextoSesionUnica & { readonly huellaSesion: string; readonly idEntrada: string },
): string {
  const idSesion = contexto.crearId('S');
  exigir(esIdSesion(idSesion));
  contexto.sql.ejecutar(
    `INSERT INTO administracion_sesion_unica (id,huella_sesion,id_sesion,id_entrada,correo,cierre)
      VALUES (1,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET huella_sesion=excluded.huella_sesion,
      id_sesion=excluded.id_sesion,id_entrada=excluded.id_entrada,correo=excluded.correo,cierre=NULL`,
    contexto.huellaSesion,
    idSesion,
    contexto.idEntrada,
    contexto.identidad.correo,
  );
  anotarRegistroPanelSqlite(contexto.sql, contexto.ahora, {
    tipo: 'sesion-abierta',
    correo: contexto.identidad.correo,
    idEntrada: contexto.idEntrada,
    idSesion,
  });
  return idSesion;
}
/** La persona cierra su propia sesión vigente: se anota una sola vez. */
export function anotarCierreSqlite(sql: SqlAccesoPublico, sesion: SesionGlobalLeida, ahora: number): void {
  const datos = datosDe(sql, sesion);
  if (datos === null || datos.cierre !== null) {
    return;
  }
  sql.ejecutar("UPDATE administracion_sesion_unica SET cierre='cerrada' WHERE id=1");
  anotarRegistroPanelSqlite(sql, ahora, {
    tipo: 'sesion-cerrada',
    correo: datos.correo,
    idEntrada: datos.idEntrada,
    idSesion: datos.idSesion,
  });
}
function filaRegistro(fila: FilaSql): FilaRegistroPanel {
  exigir(typeof fila.instante === 'number' && Number.isSafeInteger(fila.instante));
  exigir(TIPOS_REGISTRO_PANEL.includes(fila.tipo as TipoRegistroPanel) && esCorreoVerificado(fila.correo));
  exigir(fila.id_entrada === null || esIdEntrada(fila.id_entrada));
  exigir(fila.id_sesion === null || esIdSesion(fila.id_sesion));
  exigir(fila.motivo === null || fila.motivo === 'inactividad' || fila.motivo === 'duracion');
  exigir(fila.titular === null || esCorreoVerificado(fila.titular));
  return {
    instante: fila.instante,
    tipo: fila.tipo as TipoRegistroPanel,
    correo: fila.correo,
    idEntrada: fila.id_entrada as string | null,
    idSesion: fila.id_sesion as string | null,
    motivo: fila.motivo as MotivoCaducidad | null,
    titular: fila.titular as string | null,
  };
}
/** Lo más reciente primero; nunca se devuelve la clave usada para deduplicar. */
export function leerRegistroPanelSqlite(sql: SqlAccesoPublico, ahora: number): readonly FilaRegistroPanel[] {
  depurarRegistroPanelSqlite(sql, ahora);
  return sql
    .filas(
      `SELECT instante,tipo,correo,id_entrada,id_sesion,motivo,titular FROM administracion_registro_panel
        ORDER BY instante DESC, n DESC LIMIT ?`,
      FILAS_LECTURA_REGISTRO_PANEL,
    )
    .map(filaRegistro);
}
