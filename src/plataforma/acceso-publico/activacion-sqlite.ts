/** Fases durables en la misma autoridad SQL. El llamador conserva la transacción durante cada CAS. */
import {
  type ActivacionPrivada,
  autoridadActivacion,
  dosServicios,
  type EstadoActivacionPrivado,
  FASES_CON_EFECTO,
  leerEstadoActivacionPrivado,
  leerTrabajoActivable,
  type PasoActivacion,
  type ReferenciaActivacion,
  type RegistroPasoActivacion,
  type ResultadoTransicionActivacion,
  type SolicitudActivacion,
  sirveLoAnterior,
} from '../../administracion/activacion.ts';
import type { IdentidadEjecucionGitHub } from '../../administracion/oidc-github.ts';
import type { TrabajoPrivado } from '../../administracion/trabajos.ts';
import { esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from '../../administracion/trabajos.ts';
import { formaObservada } from '../../administracion/versiones-activacion.ts';
import { leerCandidatoPendiente, resolverMarcaDeActivacion } from './candidato-pendiente-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { identidadCoincide, leerTrabajosSqlite } from './trabajos-sqlite.ts';

const MAX_DOCUMENTO = 16_384;
function existeTabla(sql: SqlAccesoPublico): boolean {
  return (
    sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name='administracion_activacion'").length === 1
  );
}
export function leerActivacionSqlite(sql: SqlAccesoPublico, ahora: number): EstadoActivacionPrivado {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.activacion_panel_version === 1 && existeTabla(sql));
  const filas = sql.filas('SELECT * FROM administracion_activacion');
  exigirTrabajo(filas.length === 1);
  const fila = objetoTrabajo(filas[0], 'documento,id,reloj,version');
  exigirTrabajo(fila.id === 1 && fila.version === 1 && esEnteroTrabajo(fila.reloj) && ahora >= fila.reloj);
  exigirTrabajo(
    typeof fila.documento === 'string' && new TextEncoder().encode(fila.documento).byteLength <= MAX_DOCUMENTO,
  );
  const estado = leerEstadoActivacionPrivado(JSON.parse(fila.documento));
  exigirTrabajo(estado.ultimaActivacion === null || estado.ultimaActivacion.actualizadoEn <= fila.reloj);
  return estado;
}
export function prepararActivacionSqlite(sql: SqlAccesoPublico, ahora: number): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1 && metadata.sesion_panel_version === 1 && metadata.controles_version === 1);
  // También comprueba que el almacén de construcción siga existiendo; nunca se reconstruye desde el candidato.
  leerTrabajosSqlite(sql, ahora);
  if (Object.hasOwn(metadata, 'activacion_panel_version')) {
    leerActivacionSqlite(sql, ahora);
    return;
  }
  exigirTrabajo(!existeTabla(sql));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN activacion_panel_version INTEGER NOT NULL DEFAULT 0 CHECK(activacion_panel_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_activacion (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
    documento TEXT NOT NULL, reloj INTEGER NOT NULL) STRICT`);
  sql.ejecutar(
    'INSERT INTO administracion_activacion VALUES (1,1,?,?)',
    JSON.stringify({ version: 1, revision: 0, ultimaActivacion: null }),
    ahora,
  );
  sql.ejecutar('UPDATE publico_estado SET activacion_panel_version=1 WHERE id=1');
}
export function leerActivacionVigilanteSqlite(sql: SqlAccesoPublico, ahora: number) {
  const activacion = leerActivacionSqlite(sql, ahora);
  const pendiente = leerCandidatoPendiente(sql, activacion.ultimaActivacion);
  return { activacion, ...(pendiente ? { candidatoPendiente: pendiente } : {}) };
}
export function resultado(
  estado: ResultadoTransicionActivacion['estado'],
  activacion: EstadoActivacionPrivado,
): ResultadoTransicionActivacion {
  return { estado, activacion };
}
export function guardar(
  sql: SqlAccesoPublico,
  anterior: EstadoActivacionPrivado,
  activacion: ActivacionPrivada,
  ahora: number,
): ResultadoTransicionActivacion {
  exigirTrabajo(anterior.revision < Number.MAX_SAFE_INTEGER);
  const nuevo = leerEstadoActivacionPrivado({
    version: 1,
    revision: anterior.revision + 1,
    ultimaActivacion: activacion,
  });
  const documento = JSON.stringify(nuevo);
  exigirTrabajo(new TextEncoder().encode(documento).byteLength <= MAX_DOCUMENTO);
  sql.ejecutar('UPDATE administracion_activacion SET documento=?,reloj=? WHERE id=1', documento, ahora);
  resolverMarcaDeActivacion(sql, activacion);
  return resultado('aplicado', nuevo);
}
/** Una activación se nombra por la ejecución que manda en ella (en un reintento, la que reintenta). */
export function coincide(a: ActivacionPrivada, referencia: ReferenciaActivacion): boolean {
  const autoridad = autoridadActivacion(a);
  return (
    autoridad.solicitudId === referencia.solicitudId &&
    autoridad.revisionReserva === referencia.revisionReserva &&
    autoridad.runId === referencia.runId
  );
}
export function identidadValida(a: ActivacionPrivada, identidad: IdentidadEjecucionGitHub, ahora: number): boolean {
  const autoridad = autoridadActivacion(a);
  return (
    !a.recuperacion && identidad.runId === autoridad.runId && identidadCoincide(identidad, autoridad.confianza, ahora)
  );
}
export function nuevaActivacion(
  trabajo: TrabajoPrivado,
  revisiones: { readonly activacion: number; readonly trabajos: number },
  ahora: number,
): ActivacionPrivada {
  return {
    revisionBase: revisiones.activacion,
    revisionTrabajos: revisiones.trabajos,
    trabajo: leerTrabajoActivable(trabajo),
    fase: 'reservada',
    creadoEn: ahora,
    actualizadoEn: ahora,
    evidencia: null,
    versionId: null,
    deploymentId: null,
    error: null,
    // Toda reserva nueva publica los dos Workers: primero Cursos y después el principal.
    versionIdCursos: null,
    deploymentIdCursos: null,
  };
}
export function reservarActivacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudActivacion,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const anterior = estado.ultimaActivacion;
  if (anterior && !anterior.reintento && coincide(anterior, solicitud)) {
    return resultado(
      solicitud.revisionEsperada === anterior.revisionBase && identidadValida(anterior, identidad, ahora)
        ? 'repetido'
        : 'conflicto',
      estado,
    );
  }
  if (solicitud.revisionEsperada !== estado.revision) {
    return resultado('conflicto', estado);
  }
  if (anterior && !TERMINALES.includes(anterior.fase)) {
    return resultado('ocupado', estado);
  }
  const trabajos = leerTrabajosSqlite(sql, ahora);
  const trabajo = trabajos.ultimoTrabajo;
  if (
    !trabajo ||
    trabajo.solicitudId !== solicitud.solicitudId ||
    trabajo.revisionReserva !== solicitud.revisionReserva ||
    trabajo.runId !== solicitud.runId ||
    trabajo.estado !== 'terminado' ||
    trabajo.resultado?.resultado !== 'validado' ||
    trabajo.protocoloInicio !== 'obligatorio' ||
    !trabajo.inicioConfirmado ||
    (anterior && trabajo.revisionReserva <= autoridadActivacion(anterior).revisionReserva) ||
    identidad.runId !== trabajo.runId ||
    !identidadCoincide(identidad, trabajo.confianza, ahora)
  ) {
    return resultado('conflicto', estado);
  }
  const revisiones = { activacion: estado.revision, trabajos: trabajos.revision };
  return guardar(sql, estado, nuevaActivacion(trabajo, revisiones, ahora), ahora);
}
export const TERMINALES: readonly ActivacionPrivada['fase'][] = ['confirmada', 'rechazada', 'abandonada'];
function repetido(a: ActivacionPrivada, paso: PasoActivacion): boolean {
  switch (paso.tipo) {
    case 'preparar':
      return a.fase === 'preparada' && JSON.stringify(a.evidencia) === JSON.stringify(paso.evidencia);
    case 'subiendo':
    case 'promoviendo':
    case 'subiendo-cursos':
    case 'promoviendo-cursos':
      return a.fase === paso.tipo;
    case 'subida':
      return a.fase === 'subida' && a.versionId === paso.versionId;
    case 'cursos-subida':
      return a.fase === 'cursos-subida' && a.versionIdCursos === paso.versionIdCursos;
    case 'cursos-confirmado':
      return (
        a.fase === 'cursos-confirmado' &&
        a.versionIdCursos === paso.versionIdCursos &&
        a.deploymentIdCursos === paso.deploymentIdCursos
      );
    case 'confirmada':
      return (
        a.fase === 'confirmada' &&
        a.versionId === paso.versionId &&
        a.deploymentId === paso.deploymentId &&
        a.evidencia?.sha256ManifiestoWeb === paso.sha256ManifiestoWeb
      );
    case 'rechazar':
      return a.fase === 'rechazada' && a.error === paso.error;
    case 'anotar-rechazo':
      return JSON.stringify(a.detenida) === JSON.stringify({ motivo: paso.motivo, observado: paso.observado });
    case 'abandonar':
      return (
        a.fase === 'abandonada' &&
        JSON.stringify(a.abandono) === JSON.stringify({ motivo: paso.motivo, observado: paso.observado })
      );
  }
}
/**
 * Cierra sin publicar una intención no terminal. Solo con lo observado en la forma de la activación y, si ya había
 * evidencia, con cada Worker sirviendo su versión anterior: ninguna versión de la intención queda en servicio.
 */
function abandonar(
  a: ActivacionPrivada,
  paso: Extract<PasoActivacion, { tipo: 'abandonar' }>,
  ahora: number,
): ActivacionPrivada | null {
  const forma = 'principal' in paso.observado === dosServicios(a);
  const anterior = a.evidencia === null || sirveLoAnterior(a.evidencia.anterior, paso.observado);
  if (TERMINALES.includes(a.fase) || !forma || !anterior) {
    return null;
  }
  return {
    ...a,
    actualizadoEn: ahora,
    fase: 'abandonada',
    abandono: { motivo: paso.motivo, observado: paso.observado },
  };
}
function preparacionValida(a: ActivacionPrivada, paso: Extract<PasoActivacion, { tipo: 'preparar' }>): boolean {
  return (
    a.fase === 'reservada' &&
    paso.evidencia.artefacto.revisionCodigo === a.trabajo.confianza.sha &&
    paso.evidencia.artefacto.huellaPaquete === a.trabajo.resultado?.huellaPaquete &&
    // La evidencia guarda lo que servía cada Worker que la activación va a publicar, ni más ni menos.
    'principal' in paso.evidencia.anterior === dosServicios(a) &&
    // Un reintento solo prepara si la web sirve lo mismo que al abandonar: no deshace lo publicado entre medias.
    (!a.reintento || sirveLoAnterior(a.reintento.observado, paso.evidencia.anterior))
  );
}
/** Fase desde la que se admite cada paso; en dos servicios, el principal empieza cuando Cursos está confirmado. */
function previa(
  a: ActivacionPrivada,
  tipo: Exclude<PasoActivacion['tipo'], 'rechazar' | 'abandonar' | 'anotar-rechazo'>,
): string | null {
  const dos = dosServicios(a);
  const previas = {
    preparar: 'reservada',
    'subiendo-cursos': dos ? 'preparada' : null,
    'cursos-subida': dos ? 'subiendo-cursos' : null,
    'promoviendo-cursos': dos ? 'cursos-subida' : null,
    'cursos-confirmado': dos ? 'promoviendo-cursos' : null,
    subiendo: dos ? 'cursos-confirmado' : 'preparada',
    subida: 'subiendo',
    promoviendo: 'subida',
    confirmada: 'promoviendo',
  };
  return previas[tipo];
}
function confirmacionValida(a: ActivacionPrivada, paso: Extract<PasoActivacion, { tipo: 'confirmada' }>): boolean {
  return (
    a.fase === 'promoviendo' &&
    a.versionId === paso.versionId &&
    a.evidencia?.sha256ManifiestoWeb === paso.sha256ManifiestoWeb
  );
}
/** Los dos cierres sin publicar: rechazar antes de cualquier efecto y abandonar con lo anterior servido. */
function cerrar(
  a: ActivacionPrivada,
  paso: Extract<PasoActivacion, { tipo: 'rechazar' | 'abandonar' }>,
  ahora: number,
): ActivacionPrivada | null {
  if (paso.tipo === 'abandonar') {
    return abandonar(a, paso, ahora);
  }
  // Una subida con respuesta perdida ya es incierta, aunque todavía no haya versionId.
  return a.fase === 'reservada' || a.fase === 'preparada'
    ? { ...a, actualizadoEn: ahora, fase: 'rechazada', error: paso.error }
    : null;
}
/** Anota sin cambiar de fase el rechazo que detuvo un efecto en curso; cualquier paso posterior lo borra. */
function anotar(a: ActivacionPrivada, paso: Extract<PasoActivacion, { tipo: 'anotar-rechazo' }>, ahora: number) {
  const forma = formaObservada(paso.observado, dosServicios(a));
  const { cierre: _cierre, ...sinCierre } = a;
  return FASES_CON_EFECTO.includes(a.fase) && forma
    ? { ...sinCierre, actualizadoEn: ahora, detenida: { motivo: paso.motivo, observado: paso.observado } }
    : null;
}
function aplicar(a: ActivacionPrivada, paso: PasoActivacion, ahora: number): ActivacionPrivada | null {
  if (paso.tipo === 'anotar-rechazo') {
    return anotar(a, paso, ahora);
  }
  // Cualquier paso de la intención borra su detención y deja sin valor un cierre pedido.
  const { detenida: _detenida, cierre: _cierre, ...sinDetenida } = a;
  if (paso.tipo === 'rechazar' || paso.tipo === 'abandonar') {
    return cerrar(sinDetenida, paso, ahora);
  }
  const base = { ...sinDetenida, actualizadoEn: ahora };
  if (a.fase !== previa(a, paso.tipo)) {
    return null;
  }
  switch (paso.tipo) {
    case 'preparar':
      return preparacionValida(a, paso) ? { ...base, fase: 'preparada', evidencia: paso.evidencia } : null;
    case 'subiendo':
    case 'promoviendo':
    case 'subiendo-cursos':
    case 'promoviendo-cursos':
      return { ...base, fase: paso.tipo };
    case 'subida':
      return { ...base, fase: 'subida', versionId: paso.versionId };
    case 'cursos-subida':
      return { ...base, fase: 'cursos-subida', versionIdCursos: paso.versionIdCursos };
    case 'cursos-confirmado':
      return a.versionIdCursos === paso.versionIdCursos
        ? { ...base, fase: 'cursos-confirmado', deploymentIdCursos: paso.deploymentIdCursos }
        : null;
    case 'confirmada':
      return confirmacionValida(a, paso) ? { ...base, fase: 'confirmada', deploymentId: paso.deploymentId } : null;
  }
}
function registrarPasoSqlite(
  sql: SqlAccesoPublico,
  registro: RegistroPasoActivacion,
  { identidad, ahora, recuperacion }: { identidad: IdentidadEjecucionGitHub; ahora: number; recuperacion: boolean },
): ResultadoTransicionActivacion {
  const estado = leerActivacionSqlite(sql, ahora);
  const a = estado.ultimaActivacion;
  if (
    !a ||
    !coincide(a, registro) ||
    !(recuperacion ? identidadRecuperacionValida(a, identidad, ahora) : identidadValida(a, identidad, ahora))
  ) {
    return resultado('conflicto', estado);
  }
  if (registro.revisionEsperada === estado.revision - 1 && repetido(a, registro.paso)) {
    return resultado('repetido', estado);
  }
  if (registro.revisionEsperada !== estado.revision) {
    return resultado('conflicto', estado);
  }
  const nueva = aplicar(a, registro.paso, ahora);
  return nueva ? guardar(sql, estado, nueva, ahora) : resultado('conflicto', estado);
}

export function identidadRecuperacionValida(
  a: ActivacionPrivada,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): boolean {
  const autoridad = autoridadActivacion(a);
  return (
    a.recuperacion !== undefined &&
    identidad.runId === autoridad.runId &&
    identidad.runAttempt === a.recuperacion.intento &&
    identidadCoincide(identidad, autoridad.confianza, ahora, a.recuperacion.intento)
  );
}
export function registrarPasoRecuperacionActivacionSqlite(
  sql: SqlAccesoPublico,
  registro: RegistroPasoActivacion,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionActivacion {
  return registrarPasoSqlite(sql, registro, { identidad, ahora, recuperacion: true });
}

export function registrarPasoActivacionSqlite(
  sql: SqlAccesoPublico,
  registro: RegistroPasoActivacion,
  identidad: IdentidadEjecucionGitHub,
  ahora: number,
): ResultadoTransicionActivacion {
  return registrarPasoSqlite(sql, registro, { identidad, ahora, recuperacion: false });
}
