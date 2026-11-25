import type { CatalogoPrivado } from '../../administracion/catalogo-privado.js';
/** Transiciones síncronas; el llamador conserva la transacción de la misma autoridad SQL del panel. */
import {
  leerCatalogoDeRecibo,
  leerDatosDeRecibo,
  type ObservacionDatosTrabajo,
  resultadoCoincideConRecibo,
  resultadoDelRecibo,
} from '../../administracion/datos-trabajo.ts';
import { leerResultadoDespacho, type ResultadoDespacho } from '../../administracion/ejecutor-github.ts';
import type { EstadoDatosPanel } from '../../administracion/estado-datos.js';
import type { UltimoFallo } from '../../administracion/estado-trabajos.js';
import type { ConfianzaOidcGitHub, IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import {
  type EstadoTrabajosPrivado,
  esEnteroTrabajo,
  esIdEjecucion,
  estadoPublicoTrabajos,
  exigirTrabajo,
  type InicioTrabajo,
  leerEstadoTrabajosPrivado,
  MARGEN_RELOJ_GITHUB_MS,
  objetoTrabajo,
  type ReciboTrabajo,
  type ReferenciaTrabajo,
  type ResultadoTransicionTrabajo,
  type RetiradaTrabajo,
  type TrabajoPrivado,
  tiempoReciboAdmitido,
} from '../../administracion/trabajos.ts';
import { anotarCandidatoPendiente } from './candidato-pendiente-sqlite.ts';
import {
  guardarDatosTrabajoSqlite,
  leerDatosTrabajoSqlite,
  leerObservacionDelPanelSqlite,
  type ObservacionDelPanel,
  prepararDatosTrabajoSqlite,
} from './datos-trabajo-sqlite.ts';
import { prepararSolicitudesSqlite, registrarTransicionSqlite, type SolicitudReservada } from './solicitudes-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';

const MAX_DOCUMENTO = 8192;
const MAX_JTI_BYTES = 128;
const MS_SEGUNDO = 1000;
const MAX_ANTIGUEDAD_MS = 600_000;
interface FilaTrabajo {
  readonly estado: EstadoTrabajosPrivado;
  readonly reloj: number;
  readonly versionPersistida: 1 | 2;
  readonly datos: ObservacionDatosTrabajo | null;
}
function existeTabla(sql: SqlAccesoPublico): boolean {
  return sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_trabajo'").length === 1;
}
function leerFila(sql: SqlAccesoPublico, ahora: number, migrando = false): FilaTrabajo {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.trabajo_panel_version === 1 && existeTabla(sql));
  const filas = sql.filas('SELECT * FROM administracion_trabajo');
  exigirTrabajo(filas.length === 1);
  const fila = objetoTrabajo(filas[0], 'documento,id,reloj,version');
  exigirTrabajo(fila.id === 1 && fila.version === 1 && esEnteroTrabajo(fila.reloj) && ahora >= fila.reloj);
  exigirTrabajo(typeof fila.documento === 'string' && fila.documento.length <= MAX_DOCUMENTO);
  const documento = objetoTrabajo(JSON.parse(fila.documento), 'revision,ultimoTrabajo,version');
  const estado = leerEstadoTrabajosPrivado(documento);
  exigirTrabajo(documento.version === 1 || documento.version === 2);
  exigirTrabajo(estado.ultimoTrabajo === null || estado.ultimoTrabajo.actualizadoEn <= fila.reloj);
  const datos =
    !migrando || Object.hasOwn(metadata, 'datos_trabajo_version') ? leerDatosTrabajoSqlite(sql, estado) : null;
  return { estado, reloj: fila.reloj, versionPersistida: documento.version, datos };
}
export function prepararTrabajosSqlite(sql: SqlAccesoPublico, ahora: number): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.sesion_panel_version === 1 && metadata.controles_version === 1);
  if (Object.hasOwn(metadata, 'trabajo_panel_version')) {
    const fila = leerFila(sql, ahora, true);
    if (fila.versionPersistida === 1) {
      // Migración explícita del documento: conserva revisión, trabajo, sesión y reloj; no concede inicio retroactivo.
      sql.ejecutar('UPDATE administracion_trabajo SET documento=? WHERE id=1', JSON.stringify(fila.estado));
    }
    prepararDatosTrabajoSqlite(sql, fila.estado);
    prepararSolicitudesSqlite(sql);
    return;
  }
  exigirTrabajo(!existeTabla(sql));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN trabajo_panel_version INTEGER NOT NULL DEFAULT 0 CHECK(trabajo_panel_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_trabajo (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
    documento TEXT NOT NULL, reloj INTEGER NOT NULL) STRICT`);
  sql.ejecutar(
    'INSERT INTO administracion_trabajo VALUES (1,1,?,?)',
    JSON.stringify({ version: 2, revision: 0, ultimoTrabajo: null }),
    ahora,
  );
  sql.ejecutar('UPDATE publico_estado SET trabajo_panel_version=1 WHERE id=1');
  prepararDatosTrabajoSqlite(sql, leerFila(sql, ahora, true).estado);
  prepararSolicitudesSqlite(sql);
}
export function leerTrabajosSqlite(sql: SqlAccesoPublico, ahora: number): EstadoTrabajosPrivado {
  return leerFila(sql, ahora).estado;
}
export function leerDatosDelUltimoTrabajoSqlite(sql: SqlAccesoPublico, ahora: number): ObservacionDatosTrabajo | null {
  return leerFila(sql, ahora).datos;
}
/** Lo que enseña el panel: con una actualización reservada después, la última observación admitida, marcada. */
export function leerDatosDelPanelSqlite(sql: SqlAccesoPublico, ahora: number): ObservacionDelPanel | null {
  return leerObservacionDelPanelSqlite(sql, leerFila(sql, ahora).estado);
}
/** Única escritura del documento de trabajos: valida el estado completo y avanza su revisión. */
export function guardar(
  sql: SqlAccesoPublico,
  anterior: EstadoTrabajosPrivado,
  trabajo: TrabajoPrivado,
  ahora: number,
): EstadoTrabajosPrivado {
  exigirTrabajo(anterior.revision < Number.MAX_SAFE_INTEGER);
  const nuevo = leerEstadoTrabajosPrivado({ version: 2, revision: anterior.revision + 1, ultimoTrabajo: trabajo });
  const documento = JSON.stringify(nuevo);
  exigirTrabajo(documento.length <= MAX_DOCUMENTO);
  sql.ejecutar('UPDATE administracion_trabajo SET documento=?,reloj=? WHERE id=1', documento, ahora);
  registrarTransicionSqlite(sql, anterior.ultimoTrabajo, nuevo.ultimoTrabajo, ahora);
  return nuevo;
}
export function reservarTrabajoSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudReservada,
  confianza: ConfianzaOidcGitHub,
  ahora: number,
) {
  const estado = leerFila(sql, ahora).estado;
  const ultimo = estado.ultimoTrabajo;
  if (ultimo?.solicitudId === solicitud.solicitudId) {
    return {
      estado:
        ultimo.accion === solicitud.accion && ultimo.revisionBase === solicitud.revisionEsperada
          ? 'repetida'
          : 'conflicto',
      trabajos: estadoPublicoTrabajos(estado),
    } as const;
  }
  if (solicitud.revisionEsperada !== estado.revision) {
    return { estado: 'conflicto', trabajos: estadoPublicoTrabajos(estado) } as const;
  }
  if (ultimo && ultimo.estado !== 'terminado') {
    return { estado: 'ocupado', trabajos: estadoPublicoTrabajos(estado) } as const;
  }
  const nuevo = guardar(
    sql,
    estado,
    {
      solicitudId: solicitud.solicitudId,
      accion: solicitud.accion,
      revisionBase: estado.revision,
      revisionReserva: estado.revision + 1,
      creadoEn: ahora,
      actualizadoEn: ahora,
      estado: 'despacho-incierto',
      runId: null,
      runAttempt: '1',
      resultado: null,
      confianza,
      huellaRecibo: null,
      protocoloInicio: 'obligatorio',
      inicioConfirmado: false,
      origen: solicitud.origen,
    },
    ahora,
  );
  // Únicamente esta rama entrega nueva. Un reinicio o una repetición jamás recupera permiso de envío.
  return { estado: 'nueva', trabajos: estadoPublicoTrabajos(nuevo) } as const;
}
function respuesta(
  estado: ResultadoTransicionTrabajo['estado'],
  trabajos: EstadoTrabajosPrivado,
): ResultadoTransicionTrabajo {
  return { estado, trabajos: estadoPublicoTrabajos(trabajos) };
}
function trabajoDespachado(
  t: TrabajoPrivado,
  entrada: Exclude<ResultadoDespacho, { estado: 'incierta' }>,
  ahora: number,
): TrabajoPrivado {
  if (entrada.estado === 'despachada') {
    return { ...t, estado: 'despachado', runId: entrada.runId, actualizadoEn: ahora };
  }
  return {
    ...t,
    estado: 'terminado',
    actualizadoEn: ahora,
    resultado: {
      resultado: 'despacho-rechazado',
      veredicto: null,
      terminadoEn: new Date(ahora).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: null,
      error: null,
    },
  };
}
export function anotarDespachoSqlite(
  sql: SqlAccesoPublico,
  referencia: ReferenciaTrabajo,
  resultado: ResultadoDespacho,
  ahora: number,
): ResultadoTransicionTrabajo {
  const entrada = leerResultadoDespacho(resultado);
  const estado = leerFila(sql, ahora).estado;
  const t = estado.ultimoTrabajo;
  if (!t || t.solicitudId !== referencia.solicitudId || t.revisionReserva !== referencia.revisionReserva) {
    return respuesta('conflicto', estado);
  }
  if (entrada.estado === 'incierta') {
    return respuesta('repetido', estado);
  }
  if (entrada.estado === 'despachada' && t.runId !== null) {
    return respuesta(t.runId === entrada.runId ? 'repetido' : 'conflicto', estado);
  }
  if (t.estado === 'terminado') {
    return respuesta(
      entrada.estado === 'rechazada' && t.resultado?.resultado === 'despacho-rechazado' ? 'repetido' : 'conflicto',
      estado,
    );
  }
  if (t.estado !== 'despacho-incierto') {
    return respuesta('conflicto', estado);
  }
  return respuesta('aplicado', guardar(sql, estado, trabajoDespachado(t, entrada, ahora), ahora));
}

export function identidadCoincide(
  entrada: IdentidadEjecucionGitHub,
  confianza: ConfianzaOidcGitHub,
  ahora: number,
  intentoEsperado = '1',
): boolean {
  const i = objetoTrabajo(
    entrada,
    'caducaEn,emitidoEn,jti,propietarioId,ref,repositorioId,runAttempt,runId,sha,workflowRef,workflowSha',
  );
  exigirTrabajo(esIdEjecucion(i.runId) && esIdEjecucion(i.runAttempt));
  exigirTrabajo(
    typeof i.jti === 'string' &&
      i.jti.length > 0 &&
      new TextEncoder().encode(i.jti).byteLength <= MAX_JTI_BYTES &&
      !/[\s\p{Cc}]/u.test(i.jti),
  );
  exigirTrabajo(esEnteroTrabajo(i.emitidoEn) && esEnteroTrabajo(i.caducaEn));
  exigirTrabajo(Number.isSafeInteger(i.emitidoEn * MS_SEGUNDO) && Number.isSafeInteger(i.caducaEn * MS_SEGUNDO));
  return (
    esIdEjecucion(intentoEsperado) &&
    i.runAttempt === intentoEsperado &&
    i.caducaEn > i.emitidoEn &&
    i.caducaEn * MS_SEGUNDO > ahora &&
    i.emitidoEn * MS_SEGUNDO <= ahora + MARGEN_RELOJ_GITHUB_MS &&
    ahora - i.emitidoEn * MS_SEGUNDO <= MAX_ANTIGUEDAD_MS &&
    i.repositorioId === confianza.repositorioId &&
    i.propietarioId === confianza.propietarioId &&
    i.ref === confianza.ref &&
    i.workflowRef === confianza.workflowRef &&
    i.workflowSha === confianza.workflowSha &&
    i.sha === confianza.sha
  );
}
function reciboRepetido(
  t: TrabajoPrivado,
  entrada: { recibo: ReciboTrabajo; identidad: IdentidadEjecucionGitHub; huellaRecibo: string },
): boolean {
  return (
    t.runId === entrada.identidad.runId &&
    t.huellaRecibo === entrada.huellaRecibo &&
    resultadoCoincideConRecibo(t.resultado, entrada.recibo)
  );
}
interface EntradaRecibo {
  readonly recibo: ReciboTrabajo;
  readonly huellaRecibo: string;
  readonly identidad: IdentidadEjecucionGitHub;
  readonly datos?: EstadoDatosPanel | null;
  readonly catalogo?: CatalogoPrivado | null;
}
function datosRepetidos(sql: SqlAccesoPublico, estado: EstadoTrabajosPrivado, entrada: EntradaRecibo): boolean {
  if (entrada.datos === undefined && entrada.catalogo === undefined) {
    return true;
  }
  const observacion = leerDatosTrabajoSqlite(sql, estado);
  const datos = leerDatosDeRecibo(entrada.recibo, entrada.datos);
  return (
    JSON.stringify(observacion?.datos ?? null) === JSON.stringify(datos) &&
    (entrada.catalogo === undefined ||
      JSON.stringify(observacion?.catalogo ?? null) === JSON.stringify(entrada.catalogo))
  );
}
function aplicarRecibo(
  sql: SqlAccesoPublico,
  contexto: { readonly estado: EstadoTrabajosPrivado; readonly t: TrabajoPrivado },
  entrada: EntradaRecibo,
  ahora: number,
): ResultadoTransicionTrabajo {
  const { estado, t } = contexto;
  const { recibo, huellaRecibo, identidad } = entrada;
  const datos = entrada.datos === undefined ? null : leerDatosDeRecibo(recibo, entrada.datos);
  if (entrada.catalogo !== undefined) {
    const catalogo = leerCatalogoDeRecibo(recibo, entrada.catalogo);
    exigirTrabajo(catalogo === null || datos !== null);
  }
  const nuevo = guardar(
    sql,
    estado,
    {
      ...t,
      estado: 'terminado',
      actualizadoEn: ahora,
      runId: identidad.runId,
      resultado: resultadoDelRecibo(recibo),
      huellaRecibo,
    },
    ahora,
  );
  if (datos !== null) {
    guardarDatosTrabajoSqlite(
      sql,
      entrada.catalogo === undefined
        ? { version: 1, recibo, huellaRecibo, datos }
        : { version: 2, recibo, huellaRecibo, datos, catalogo: entrada.catalogo },
      identidad.sha,
    );
  }
  anotarCandidatoPendiente(sql, nuevo.ultimoTrabajo);
  return respuesta('aplicado', nuevo);
}
export function registrarReciboSqlite(
  sql: SqlAccesoPublico,
  entrada: EntradaRecibo,
  ahora: number,
): ResultadoTransicionTrabajo {
  const { recibo, huellaRecibo, identidad } = entrada;
  exigirTrabajo(typeof huellaRecibo === 'string' && /^[0-9a-f]{64}$/.test(huellaRecibo));
  const estado = leerFila(sql, ahora).estado;
  const t = estado.ultimoTrabajo;
  if (
    !t ||
    t.solicitudId !== recibo.solicitudId ||
    t.accion !== recibo.accion ||
    t.revisionReserva !== recibo.revisionReserva
  ) {
    return respuesta('conflicto', estado);
  }
  if (
    !identidadCoincide(identidad, t.confianza, ahora) ||
    !tiempoReciboAdmitido(recibo.terminadoEn, t.creadoEn, ahora) ||
    (t.runId !== null && t.runId !== identidad.runId)
  ) {
    return respuesta('conflicto', estado);
  }
  if (t.protocoloInicio === 'obligatorio' && !t.inicioConfirmado && recibo.resultado !== 'rechazado') {
    return respuesta('conflicto', estado);
  }
  if (t.estado === 'terminado') {
    return respuesta(
      reciboRepetido(t, entrada) && datosRepetidos(sql, estado, entrada) ? 'repetido' : 'conflicto',
      estado,
    );
  }
  return aplicarRecibo(sql, { estado, t }, entrada, ahora);
}

export function coincideReferencia(t: TrabajoPrivado | null, referencia: ReferenciaTrabajo): t is TrabajoPrivado {
  return t !== null && t.solicitudId === referencia.solicitudId && t.revisionReserva === referencia.revisionReserva;
}
export function confirmarInicioSqlite(
  sql: SqlAccesoPublico,
  inicio: InicioTrabajo,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionTrabajo {
  const estado = leerFila(sql, ahora).estado;
  const t = estado.ultimoTrabajo;
  if (
    !coincideReferencia(t, inicio) ||
    t.accion !== inicio.accion ||
    t.estado === 'terminado' ||
    t.protocoloInicio !== 'obligatorio'
  ) {
    return respuesta('conflicto', estado);
  }
  if (
    !identidadCoincide(identidad, t.confianza, ahora) ||
    identidad.emitidoEn * MS_SEGUNDO < t.creadoEn - MARGEN_RELOJ_GITHUB_MS ||
    (t.runId !== null && t.runId !== identidad.runId)
  ) {
    return respuesta('conflicto', estado);
  }
  if (t.inicioConfirmado) {
    return respuesta('repetido', estado);
  }
  return respuesta(
    'aplicado',
    guardar(
      sql,
      estado,
      { ...t, estado: 'despachado', runId: identidad.runId, inicioConfirmado: true, actualizadoEn: ahora },
      ahora,
    ),
  );
}
/** Termina un trabajo sin recibo ni candidato; si se sabe por qué no terminó, lo guarda con su resultado. */
export function terminalSinCandidato(
  t: TrabajoPrivado,
  resultado: 'retirado' | 'ejecucion-sin-recibo',
  ahora: number,
  ultimoFallo?: UltimoFallo,
): TrabajoPrivado {
  return {
    ...t,
    estado: 'terminado',
    actualizadoEn: ahora,
    huellaRecibo: null,
    resultado: {
      resultado,
      veredicto: null,
      terminadoEn: new Date(ahora).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      huellaPaquete: null,
      error: null,
      ...(ultimoFallo ? { ultimoFallo } : {}),
    },
  };
}
export function retirarTrabajoSqlite(sql: SqlAccesoPublico, retirada: RetiradaTrabajo, ahora: number) {
  const estado = leerFila(sql, ahora).estado;
  const t = estado.ultimoTrabajo;
  if (!coincideReferencia(t, retirada) || t.protocoloInicio !== 'obligatorio' || t.inicioConfirmado) {
    return { estado: 'conflicto', trabajos: estadoPublicoTrabajos(estado) } as const;
  }
  if (t.resultado?.resultado === 'retirado' && retirada.revisionEsperada === estado.revision - 1) {
    return { estado: 'retirado', trabajos: estadoPublicoTrabajos(estado) } as const;
  }
  if (retirada.revisionEsperada !== estado.revision || t.estado === 'terminado') {
    return { estado: 'conflicto', trabajos: estadoPublicoTrabajos(estado) } as const;
  }
  return {
    estado: 'retirado',
    trabajos: estadoPublicoTrabajos(guardar(sql, estado, terminalSinCandidato(t, 'retirado', ahora), ahora)),
  } as const;
}
