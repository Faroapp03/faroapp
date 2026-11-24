/** Watermark único, en la misma transacción que construcción y activación. Nunca recupera permiso de despacho. */

import type { FalloProgramado, ResultadoFalloProgramado } from '../../administracion/fallo-programado.ts';
import type { ConfianzaOidcGitHub } from '../../administracion/oidc-github.ts';
import {
  type EventoProgramado,
  leerEventoProgramado,
  MAX_EVENTOS_PROGRAMADOS,
  type MotivoEventoProgramado,
  type ResultadoEventoProgramado,
  type ResultadoReservaTrabajoProgramado,
  reservaProgramadaVencida,
  type SolicitudTrabajoProgramado,
  VENTANA_TRABAJO_PROGRAMADO_MS,
} from '../../administracion/programacion-trabajos.ts';
import {
  type EstadoTrabajosPrivado,
  esEnteroTrabajo,
  estadoPublicoTrabajos,
  exigirTrabajo,
  objetoTrabajo,
} from '../../administracion/trabajos.ts';
import { leerActivacionSqlite, TERMINALES } from './activacion-sqlite.ts';
import { decidirAdmisionReserva } from './admision-reserva-sqlite.ts';
import { candidatoSinIntencion } from './candidato-pendiente-sqlite.ts';
import { anotarLiberacionSqlite, anotarSolicitudSqlite, type MotivoSolicitud } from './solicitudes-sqlite.ts';
import type { SqlAccesoPublico } from './sqlite.ts';
import { leerTrabajosSqlite, reservarTrabajoSqlite, retirarTrabajoSqlite } from './trabajos-sqlite.ts';

/** Cómo queda en el registro de solicitudes cada motivo por el que se omite la programada. */
const MOTIVO_DE_LA_OMISION: Readonly<Partial<Record<MotivoEventoProgramado, MotivoSolicitud>>> = {
  'evento-fuera-de-ventana': 'fuera_de_ventana',
  'activacion-sin-resolver': 'activacion_pendiente',
  'candidato-en-plazo': 'candidato_en_plazo',
  'trabajo-en-plazo': 'ocupado',
  'requiere-atencion': 'requiere_atencion',
};
/** La versión 2 del historial guarda la fase y el motivo de cada fallo (`fase`, `motivo_fallo`). */
const VERSION_EVENTOS = 2;
const COLUMNA_VERSION_EVENTOS = `programacion_eventos_version INTEGER NOT NULL DEFAULT 0 CHECK(programacion_eventos_version IN (0,${VERSION_EVENTOS}))`;
function motivoDeLaOmision(motivo: MotivoEventoProgramado): MotivoSolicitud {
  const enElRegistro = MOTIVO_DE_LA_OMISION[motivo];
  exigirTrabajo(enElRegistro !== undefined);
  return enElRegistro;
}
function existeTabla(sql: SqlAccesoPublico, nombre: string): boolean {
  return sql.filas("SELECT name FROM sqlite_master WHERE type='table' AND name=?", nombre).length === 1;
}
function leerFila(sql: SqlAccesoPublico, ahora: number) {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(
    metadata?.version === 1 &&
      metadata.programacion_panel_version === 1 &&
      existeTabla(sql, 'administracion_programacion'),
  );
  const filas = sql.filas('SELECT * FROM administracion_programacion');
  exigirTrabajo(filas.length === 1);
  const fila = objetoTrabajo(filas[0], 'evento_en,id,reloj,version');
  exigirTrabajo(fila.id === 1 && fila.version === 1 && esEnteroTrabajo(fila.reloj) && ahora >= fila.reloj);
  exigirTrabajo(esEnteroTrabajo(fila.evento_en) && fila.evento_en <= fila.reloj);
  return { eventoEn: fila.evento_en, reloj: fila.reloj };
}
/**
 * Un evento consumido nunca supera la marca. Una fila `fallida` no consume su evento: puede quedar por delante de
 * ella hasta que una reserva posterior del mismo evento la sustituya.
 */
function leerEventos(sql: SqlAccesoPublico, marca: { eventoEn: number }): readonly EventoProgramado[] {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(
    metadata?.programacion_eventos_version === VERSION_EVENTOS &&
      existeTabla(sql, 'administracion_programacion_eventos'),
  );
  const filas = sql.filas('SELECT * FROM administracion_programacion_eventos ORDER BY evento_en DESC');
  exigirTrabajo(filas.length <= MAX_EVENTOS_PROGRAMADOS);
  return Object.freeze(
    filas.map((entrada) => {
      const fila = objetoTrabajo(entrada, 'evento_en,fase,motivo,motivo_fallo,registrado_en,resultado');
      const evento = leerEventoProgramado({
        eventoEn: fila.evento_en,
        registradoEn: fila.registrado_en,
        resultado: fila.resultado,
        motivo: fila.motivo,
        fase: fila.fase,
        motivoFallo: fila.motivo_fallo,
      });
      exigirTrabajo(evento.resultado === 'fallida' || evento.eventoEn <= marca.eventoEn);
      return evento;
    }),
  );
}
/** Observa el watermark y el historial; leer no consume eventos ni acredita un ejecutor vivo. */
export function leerProgramacionSqlite(sql: SqlAccesoPublico, ahora: number) {
  const fila = leerFila(sql, ahora);
  return Object.freeze({
    version: 1 as const,
    ultimoEventoEn: fila.eventoEn === 0 ? null : fila.eventoEn,
    registradoEn: fila.reloj,
    eventos: leerEventos(sql, fila),
  });
}
function prepararMarca(sql: SqlAccesoPublico, ahora: number): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1);
  if (Object.hasOwn(metadata, 'programacion_panel_version')) {
    leerFila(sql, ahora);
    return;
  }
  exigirTrabajo(!existeTabla(sql, 'administracion_programacion'));
  sql.ejecutar(
    'ALTER TABLE publico_estado ADD COLUMN programacion_panel_version INTEGER NOT NULL DEFAULT 0 CHECK(programacion_panel_version IN (0,1))',
  );
  sql.ejecutar(`CREATE TABLE administracion_programacion (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL CHECK(version=1),
    evento_en INTEGER NOT NULL, reloj INTEGER NOT NULL) STRICT`);
  sql.ejecutar('INSERT INTO administracion_programacion VALUES (1,1,0,?)', ahora);
  sql.ejecutar('UPDATE publico_estado SET programacion_panel_version=1 WHERE id=1');
}
/**
 * Versión 1 a 2: añade al historial las columnas del fallo, sin tocar sus filas, que quedan sin fase. La columna de
 * versión se vuelve a crear porque su CHECK solo admitía 0 y 1.
 */
function migrarEventosDeLaVersion1(sql: SqlAccesoPublico): void {
  exigirTrabajo(existeTabla(sql, 'administracion_programacion_eventos'));
  const columnas = sql
    .filas("SELECT name FROM pragma_table_info('administracion_programacion_eventos')")
    .map((c) => c.name);
  for (const columna of ['fase', 'motivo_fallo']) {
    if (!columnas.includes(columna)) {
      sql.ejecutar(`ALTER TABLE administracion_programacion_eventos ADD COLUMN ${columna} TEXT`);
    }
  }
  sql.ejecutar('ALTER TABLE publico_estado DROP COLUMN programacion_eventos_version');
  sql.ejecutar(`ALTER TABLE publico_estado ADD COLUMN ${COLUMNA_VERSION_EVENTOS}`);
  sql.ejecutar(`UPDATE publico_estado SET programacion_eventos_version=${VERSION_EVENTOS} WHERE id=1`);
}
/** Aditivo: una instalación con marca previa conserva su watermark y empieza el historial vacío. */
function prepararEventos(sql: SqlAccesoPublico): void {
  const metadata = sql.filas('SELECT * FROM publico_estado WHERE id=1')[0];
  exigirTrabajo(metadata?.version === 1);
  if (Object.hasOwn(metadata, 'programacion_eventos_version')) {
    if (metadata.programacion_eventos_version === 1) {
      migrarEventosDeLaVersion1(sql);
    }
    return;
  }
  exigirTrabajo(!existeTabla(sql, 'administracion_programacion_eventos'));
  sql.ejecutar(`ALTER TABLE publico_estado ADD COLUMN ${COLUMNA_VERSION_EVENTOS}`);
  sql.ejecutar(`CREATE TABLE administracion_programacion_eventos (
    evento_en INTEGER PRIMARY KEY, registrado_en INTEGER NOT NULL,
    resultado TEXT NOT NULL, motivo TEXT NOT NULL, fase TEXT, motivo_fallo TEXT) STRICT`);
  sql.ejecutar(`UPDATE publico_estado SET programacion_eventos_version=${VERSION_EVENTOS} WHERE id=1`);
}
export function prepararProgramacionSqlite(sql: SqlAccesoPublico, ahora: number): void {
  leerTrabajosSqlite(sql, ahora);
  prepararMarca(sql, ahora);
  prepararEventos(sql);
  sql.ejecutar(`CREATE TABLE IF NOT EXISTS administracion_recuperaciones_sin_inicio (
    evento_en INTEGER PRIMARY KEY, registrado_en INTEGER NOT NULL, run_anterior TEXT NOT NULL,
    solicitud_anterior TEXT NOT NULL, solicitud_nueva TEXT NOT NULL) STRICT`);
  leerEventos(sql, leerFila(sql, ahora));
}
/** Sustituye la fila `fallida` del mismo evento, si la hay: la reserva posterior es su resultado definitivo. */
function registrarEvento(sql: SqlAccesoPublico, evento: Omit<EventoProgramado, 'fase' | 'motivoFallo'>): void {
  const valido = leerEventoProgramado({ ...evento, fase: null, motivoFallo: null });
  guardarEvento(sql, valido);
}
function guardarEvento(sql: SqlAccesoPublico, valido: EventoProgramado): void {
  sql.ejecutar(
    'INSERT OR REPLACE INTO administracion_programacion_eventos VALUES (?,?,?,?,?,?)',
    valido.eventoEn,
    valido.registradoEn,
    valido.resultado,
    valido.motivo,
    valido.fase,
    valido.motivoFallo,
  );
  podarEventos(sql);
}
function podarEventos(sql: SqlAccesoPublico): void {
  sql.ejecutar(
    `DELETE FROM administracion_programacion_eventos WHERE evento_en NOT IN (
      SELECT evento_en FROM administracion_programacion_eventos ORDER BY evento_en DESC LIMIT ?)`,
    MAX_EVENTOS_PROGRAMADOS,
  );
}
/**
 * Solo libera una reserva cuyo permiso de inicio nunca se concedió: el motor no arrancó con ella y la retirada
 * deniega en la misma transacción un permiso tardío. Una reserva a demanda se libera aunque esté en plazo, porque el
 * ciclo diario tiene prioridad sobre una petición que aún no ha empezado; queda anotada con su motivo. Las demás, solo
 * vencidas. Lo demás queda ocupado y pide atención.
 */
function liberarReservaSinInicio(sql: SqlAccesoPublico, trabajos: EstadoTrabajosPrivado, ahora: number): boolean {
  const t = trabajos.ultimoTrabajo;
  if (!t || t.estado === 'terminado' || t.protocoloInicio !== 'obligatorio' || t.inicioConfirmado) {
    return false;
  }
  const demanda = t.origen === 'demanda';
  if (!demanda && !reservaProgramadaVencida(t, ahora)) {
    return false;
  }
  const retirada = retirarTrabajoSqlite(
    sql,
    { solicitudId: t.solicitudId, revisionReserva: t.revisionReserva, revisionEsperada: trabajos.revision },
    ahora,
  );
  exigirTrabajo(retirada.estado === 'retirado');
  if (demanda) {
    anotarLiberacionSqlite(sql, t.solicitudId, 'ciclo_programado');
  }
  return true;
}
/** Conserva el rastro de una ejecución cerrada sin recibo después del evento anterior, antes de sustituirla. */
function motivoNueva(
  trabajos: EstadoTrabajosPrivado,
  liberada: boolean,
  eventoAnterior: number,
): MotivoEventoProgramado {
  if (liberada) {
    return 'reserva-sin-inicio-liberada';
  }
  const t = trabajos.ultimoTrabajo;
  return t?.resultado?.resultado === 'ejecucion-sin-recibo' && t.actualizadoEn > eventoAnterior
    ? 'ejecucion-cerrada-sin-recibo'
    : 'sin-trabajo-pendiente';
}
/**
 * Una ejecución conocida sin cerrar puede haber terminado sin recibo, también dentro de su plazo (un fallo al preparar
 * el entorno llega antes que el supervisor): solo GitHub puede decirlo.
 */
function reconciliable(trabajos: EstadoTrabajosPrivado): boolean {
  const t = trabajos.ultimoTrabajo;
  return t !== null && t.estado !== 'terminado' && t.runId !== null;
}
function motivoOcupado(trabajos: EstadoTrabajosPrivado, ahora: number): MotivoEventoProgramado {
  const t = trabajos.ultimoTrabajo;
  return t && reservaProgramadaVencida(t, ahora) ? 'requiere-atencion' : 'trabajo-en-plazo';
}
/** Un cron extraordinario puede sustituir una sola vez la ejecución que GitHub cerró antes del permiso de inicio. */
function recuperarSinInicio(
  sql: SqlAccesoPublico,
  evento: EventoProgramado | undefined,
  {
    solicitud,
    confianza,
    trabajos,
    ahora,
  }: {
    solicitud: SolicitudTrabajoProgramado;
    confianza: ConfianzaOidcGitHub;
    trabajos: EstadoTrabajosPrivado;
    ahora: number;
  },
): ResultadoReservaTrabajoProgramado {
  const anterior = trabajos.ultimoTrabajo;
  const repetida = { estado: 'repetida', trabajos: estadoPublicoTrabajos(trabajos) } as const;
  if (
    solicitud.recuperacion !== true ||
    evento?.resultado !== 'nueva' ||
    solicitud.eventoEn !== evento.eventoEn ||
    ahora - evento.eventoEn > VENTANA_TRABAJO_PROGRAMADO_MS ||
    anterior?.accion !== 'comprobar-programada' ||
    anterior.creadoEn !== evento.registradoEn ||
    anterior.protocoloInicio !== 'obligatorio' ||
    anterior.inicioConfirmado ||
    anterior.runId === null ||
    anterior.huellaRecibo !== null ||
    sql.filas('SELECT 1 FROM administracion_recuperaciones_sin_inicio WHERE evento_en=?', evento.eventoEn).length
  ) {
    return repetida;
  }
  if (anterior.estado !== 'terminado') {
    return solicitud.reconciliada ? repetida : { ...repetida, estado: 'pendiente-reconciliacion' };
  }
  const activacion = leerActivacionSqlite(sql, ahora).ultimaActivacion;
  if (
    anterior.resultado?.resultado !== 'ejecucion-sin-recibo' ||
    (activacion && !TERMINALES.includes(activacion.fase))
  ) {
    return repetida;
  }
  const nueva = reservarNueva(sql, trabajos, confianza, {
    eventoEn: evento.eventoEn,
    motivo: 'ejecucion-cerrada-sin-recibo',
    ahora,
  });
  const trabajo = nueva.trabajos.ultimoTrabajo;
  exigirTrabajo(trabajo !== null);
  sql.ejecutar('UPDATE administracion_programacion SET reloj=? WHERE id=1', ahora);
  sql.ejecutar(
    'INSERT INTO administracion_recuperaciones_sin_inicio VALUES (?,?,?,?,?)',
    evento.eventoEn,
    ahora,
    anterior.runId,
    anterior.solicitudId,
    trabajo.solicitudId,
  );
  return candidatoSinIntencion(sql, activacion) ? { ...nueva, revisarPaquetePendiente: true } : nueva;
}
export function reservarProgramacionSqlite(
  sql: SqlAccesoPublico,
  solicitud: SolicitudTrabajoProgramado,
  confianza: ConfianzaOidcGitHub,
  ahora: number,
): ResultadoReservaTrabajoProgramado {
  const fila = leerFila(sql, ahora);
  const eventos = leerEventos(sql, fila);
  exigirTrabajo(solicitud.eventoEn <= ahora);
  let trabajos = leerTrabajosSqlite(sql, ahora);
  const enVentana = ahora - solicitud.eventoEn <= VENTANA_TRABAJO_PROGRAMADO_MS;
  if (solicitud.eventoEn <= fila.eventoEn) {
    const ultimoEvento = eventos.find((e) => e.eventoEn === fila.eventoEn);
    return recuperarSinInicio(sql, ultimoEvento, { solicitud, confianza, trabajos, ahora });
  }
  // Sin consumir el evento: el reloj consulta a GitHub y vuelve con la misma solicitud marcada como reconciliada.
  if (enVentana && solicitud.reconciliada !== true && reconciliable(trabajos)) {
    return { estado: 'pendiente-reconciliacion', trabajos: estadoPublicoTrabajos(trabajos) };
  }
  // Los ticks omitidos se consumen también. Un error posterior revierte watermark, historial y reserva juntos.
  sql.ejecutar('UPDATE administracion_programacion SET evento_en=?,reloj=? WHERE id=1', solicitud.eventoEn, ahora);
  const omitir = (
    resultado: Exclude<ResultadoEventoProgramado, 'nueva' | 'fallida'>,
    motivo: MotivoEventoProgramado,
  ) => {
    registrarEvento(sql, { eventoEn: solicitud.eventoEn, registradoEn: ahora, resultado, motivo });
    const omitida = { origen: 'programada', accion: 'comprobar-programada', decision: 'rechazada' } as const;
    anotarSolicitudSqlite(sql, { ...omitida, motivo: motivoDeLaOmision(motivo) }, ahora);
    return { estado: resultado, trabajos: estadoPublicoTrabajos(trabajos) };
  };
  if (!enVentana) {
    return omitir('omitida-tardia', 'evento-fuera-de-ventana');
  }
  // Las guardias de la publicación pendiente van antes de liberar: una reserva vencida no se retira mientras otro
  // ciclo pueda publicar todavía.
  const activacion = leerActivacionSqlite(sql, ahora).ultimaActivacion;
  const admision = decidirAdmisionReserva(trabajos, activacion, ahora);
  if (!admision.admitida && admision.motivo !== 'ocupado') {
    const motivo = admision.motivo === 'activacion_pendiente' ? 'activacion-sin-resolver' : 'candidato-en-plazo';
    return omitir('omitida-candidato', motivo);
  }
  const liberada = liberarReservaSinInicio(sql, trabajos, ahora);
  if (liberada) {
    trabajos = leerTrabajosSqlite(sql, ahora);
  }
  if (!decidirAdmisionReserva(trabajos, activacion, ahora).admitida) {
    return omitir('omitida-ocupado', motivoOcupado(trabajos, ahora));
  }
  // La marca sobrevive al relevo del trabajo y a los rechazos del intento siguiente.
  const evento = { eventoEn: solicitud.eventoEn, motivo: motivoNueva(trabajos, liberada, fila.reloj), ahora };
  const nueva = reservarNueva(sql, trabajos, confianza, evento);
  return candidatoSinIntencion(sql, activacion) ? { ...nueva, revisarPaquetePendiente: true } : nueva;
}
function reservarNueva(
  sql: SqlAccesoPublico,
  trabajos: EstadoTrabajosPrivado,
  confianza: ConfianzaOidcGitHub,
  { eventoEn, motivo, ahora }: { readonly eventoEn: number; readonly motivo: MotivoEventoProgramado; ahora: number },
): ResultadoReservaTrabajoProgramado {
  const reserva = reservarTrabajoSqlite(
    sql,
    {
      solicitudId: crypto.randomUUID(),
      accion: 'comprobar-programada',
      revisionEsperada: trabajos.revision,
      origen: 'programada',
    },
    confianza,
    ahora,
  );
  exigirTrabajo(reserva.estado === 'nueva');
  registrarEvento(sql, { eventoEn, motivo, registradoEn: ahora, resultado: 'nueva' });
  return { estado: 'nueva', trabajos: reserva.trabajos };
}
/**
 * Un fallo antes de consumir el evento queda como `fallida` sin mover la marca, así que el vigilante sigue esperando
 * ese evento. El fallo del despacho anota la reserva `nueva` que lo precedió. Un evento ya consumido por otra
 * entrega conserva su registro.
 */
export function registrarFalloProgramadoSqlite(
  sql: SqlAccesoPublico,
  fallo: FalloProgramado,
  ahora: number,
): ResultadoFalloProgramado {
  const marca = leerFila(sql, ahora);
  const eventos = leerEventos(sql, marca);
  exigirTrabajo(fallo.eventoEn <= ahora);
  const previo = eventos.find((e) => e.eventoEn === fallo.eventoEn);
  if (fallo.fase === 'despacho') {
    exigirTrabajo(previo?.resultado === 'nueva');
    guardarEvento(sql, leerEventoProgramado({ ...previo, fase: fallo.fase, motivoFallo: fallo.motivo }));
    return { estado: 'registrado' };
  }
  if (fallo.eventoEn <= marca.eventoEn) {
    return { estado: 'repetida' };
  }
  const evento = { eventoEn: fallo.eventoEn, registradoEn: ahora, resultado: 'fallida', motivo: 'evento-sin-consumir' };
  guardarEvento(sql, leerEventoProgramado({ ...evento, fase: fallo.fase, motivoFallo: fallo.motivo }));
  return { estado: 'registrado' };
}
