// Generado desde src/administracion/vigilante-panel.js; no editar esta copia.
/** Contrato acotado de la presentación; no contiene soportes, referencias ni huellas. */
import { accion, esEnteroTrabajo, exigirTrabajo, objetoTrabajo } from './estado-trabajos.js';

/** @typedef {Readonly<{id:number,clave:string,estado:'incidencia'|'conforme',motivo:string,observadoEn:number,evaluadoEn:number,origen:'recibo'|'lectura-local'|'no-registrado'}>} FilaVigilantePanel */
/** @typedef {Readonly<{clave:string,estado:'incidencia'|'conforme',motivo:string,observadoEn:number}>} AreaVigilantePanel */
/** @typedef {Readonly<{estado:'despacho-incierto'|'despachado'|'terminado',accion:import('./estado-trabajos.js').AccionActualizacion,creadoEn:number,actualizadoEn:number,resultado:'validado'|'sin-pendientes'|'rechazado'|'despacho-rechazado'|'retirado'|'ejecucion-sin-recibo'|null}>} UltimoTrabajoVigilante */
/** @typedef {Readonly<{avisos?:AvisosVigilantePanel,pausaProgramadaHasta?:string,areas:readonly AreaVigilantePanel[],version:1,origenDatos:'recibo'|'lectura-local',evaluadoEn:number,pulsoContinuo:'no-instrumentado',entregaActiva:'sin-observacion-actual',revision:number,incidencias:readonly FilaVigilantePanel[],fechaDatos:readonly Readonly<{fuente:string,fecha:string|null}>[],ultimoTrabajo:UltimoTrabajoVigilante|null,eventosProgramados:readonly EventoProgramadoPanel[]}>} VigilantePanel */
/** @typedef {Readonly<{eventoEn:number,resultado:string,motivo:string,fase?:string,motivoFallo?:string}>} EventoProgramadoPanel */
/** @typedef {Readonly<{en:number,resultado:'enviado'|'fallido',motivo:string|null}>} IntentoAvisoPanel */
/** @typedef {Readonly<{canal:'correo',estado:'no-configurado'|'remitente-no-admitido'|'sin-destino'|'pendiente'|'verificado',ultimoIntento:IntentoAvisoPanel|null}>|Readonly<{canal:'url',estado:'no-configurados'|'configurados'|'destino-no-admitido',ultimoIntento:IntentoAvisoPanel|null}>} CanalAvisoPanel */
/** @typedef {Readonly<{canales:readonly CanalAvisoPanel[]}>} AvisosVigilantePanel */
/** @typedef {Readonly<{version:1,revision:number,decisiones:readonly FilaVigilantePanel[],siguiente:number|null}>} HistorialVigilantePanel */
export const LIMITE_PAGINA_VIGILANTE = 50;
const MAX_INCIDENCIAS = 256;
const MAX_FUENTES = 64;
const MAX_EVENTOS_PROGRAMADOS = 60;
/** Resultado de cada evento diario y los motivos que admite; igual que el registro del almacén. */
const MOTIVOS_EVENTO_PROGRAMADO = new Map([
  ['nueva', ['sin-trabajo-pendiente', 'reserva-sin-inicio-liberada', 'ejecucion-cerrada-sin-recibo']],
  ['omitida-tardia', ['evento-fuera-de-ventana']],
  ['omitida-candidato', ['activacion-sin-resolver', 'candidato-en-plazo']],
  ['omitida-ocupado', ['trabajo-en-plazo', 'requiere-atencion']],
  ['fallida', ['evento-sin-consumir']],
]);
/** Fases del manejador programado que pueden fallar; el despacho solo sigue a una reserva nueva. */
const FASES_PROGRAMADAS = ['configuracion', 'validacion', 'preparacion', 'reconciliacion', 'reserva', 'despacho'];
const MOTIVOS_FALLO_PROGRAMADO = ['error', 'plazo-agotado'];
/** @param {string} resultado @param {unknown} fase @param {unknown} motivoFallo */
function falloDelEvento(resultado, fase, motivoFallo) {
  if (fase === undefined && motivoFallo === undefined && resultado !== 'fallida') {
    return {};
  }
  exigirTrabajo(typeof fase === 'string' && FASES_PROGRAMADAS.includes(fase));
  exigirTrabajo(typeof motivoFallo === 'string' && MOTIVOS_FALLO_PROGRAMADO.includes(motivoFallo));
  exigirTrabajo(resultado === 'fallida' ? fase !== 'despacho' : resultado === 'nueva' && fase === 'despacho');
  return { fase, motivoFallo };
}
const MOTIVOS = new Set([
  'sin_trabajo_reservado',
  'trabajo_terminado_sin_resultado_admitido',
  'trabajo_terminado',
  'inicio_no_confirmado',
  'inicio_rechazado',
  'inicio_confirmado_sin_cierre',
  'evento_esperado_sin_registro',
  'sin_evento_vencido',
  'programacion_apagada',
  'programacion_en_pausa',
  'sin_observacion_correlacionada',
  'lectura_local_no_disponible',
  'observacion_de_mantenimiento_antigua',
  'observacion_disponible',
  'lectura_local_disponible',
  'legado_sin_comprobaciones_por_conjunto',
  'contrato_con_comprobaciones',
  'comprobacion_sin-observacion',
  'comprobacion_vencida',
  'comprobacion_comprobada',
  'mantenimiento_incidencia',
  'mantenimiento_atencion',
  'mantenimiento_comprobada',
  'mantenimiento_local',
  'datos_validados_sin_publicar',
  'sin_datos_validados_por_publicar',
]);
/** @param {unknown} entrada @returns {FilaVigilantePanel} */
export function leerFilaVigilantePanel(entrada) {
  const o = objetoTrabajo(entrada, 'clave,estado,evaluadoEn,id,motivo,observadoEn,origen');
  exigirTrabajo(
    esEnteroTrabajo(o.id) && o.id > 0 && typeof o.clave === 'string' && /^[a-z][a-z0-9:_-]{0,127}$/.test(o.clave),
  );
  exigirTrabajo(
    (o.estado === 'incidencia' || o.estado === 'conforme') && typeof o.motivo === 'string' && MOTIVOS.has(o.motivo),
  );
  exigirTrabajo(esEnteroTrabajo(o.observadoEn) && esEnteroTrabajo(o.evaluadoEn) && o.observadoEn <= o.evaluadoEn);
  exigirTrabajo(o.origen === 'recibo' || o.origen === 'lectura-local' || o.origen === 'no-registrado');
  return Object.freeze({
    id: o.id,
    clave: o.clave,
    estado: o.estado,
    motivo: o.motivo,
    observadoEn: o.observadoEn,
    evaluadoEn: o.evaluadoEn,
    origen: o.origen,
  });
}
/** @param {unknown[]} entrada @param {number} evaluadoEn @returns {AreaVigilantePanel[]} */
function leerAreas(entrada, evaluadoEn) {
  return entrada.map((entrada) => {
    const a = objetoTrabajo(entrada, 'clave,estado,motivo,observadoEn');
    exigirTrabajo(typeof a.clave === 'string' && /^[a-z][a-z0-9:_-]{0,127}$/.test(a.clave));
    exigirTrabajo(
      (a.estado === 'incidencia' || a.estado === 'conforme') && typeof a.motivo === 'string' && MOTIVOS.has(a.motivo),
    );
    exigirTrabajo(esEnteroTrabajo(a.observadoEn) && a.observadoEn <= evaluadoEn);
    return Object.freeze({ clave: a.clave, estado: a.estado, motivo: a.motivo, observadoEn: a.observadoEn });
  });
}
/** @param {unknown[]} entrada */
function leerFechas(entrada) {
  return entrada.map((entrada) => {
    const f = objetoTrabajo(entrada, 'fecha,fuente');
    exigirTrabajo(typeof f.fuente === 'string' && /^[a-z][a-z0-9_-]{0,127}$/.test(f.fuente));
    exigirTrabajo(
      f.fecha === null ||
        (typeof f.fecha === 'string' &&
          /^\d{4}-\d\d-\d\d$/.test(f.fecha) &&
          Number.isFinite(Date.parse(f.fecha)) &&
          new Date(f.fecha).toISOString().slice(0, 10) === f.fecha),
    );
    return Object.freeze({ fuente: f.fuente, fecha: f.fecha });
  });
}
/** @param {unknown} entrada @returns {UltimoTrabajoVigilante|null} */
function leerUltimoTrabajo(entrada) {
  if (entrada === null) {
    return null;
  }
  const o = objetoTrabajo(entrada, 'accion,actualizadoEn,creadoEn,estado,resultado');
  exigirTrabajo(o.estado === 'despacho-incierto' || o.estado === 'despachado' || o.estado === 'terminado');
  exigirTrabajo(
    accion(o.accion) &&
      esEnteroTrabajo(o.creadoEn) &&
      esEnteroTrabajo(o.actualizadoEn) &&
      o.actualizadoEn >= o.creadoEn,
  );
  exigirTrabajo(
    o.resultado === null ||
      o.resultado === 'validado' ||
      o.resultado === 'sin-pendientes' ||
      o.resultado === 'rechazado' ||
      o.resultado === 'despacho-rechazado' ||
      o.resultado === 'retirado' ||
      o.resultado === 'ejecucion-sin-recibo',
  );
  return Object.freeze({
    estado: o.estado,
    accion: o.accion,
    creadoEn: o.creadoEn,
    actualizadoEn: o.actualizadoEn,
    resultado: o.resultado,
  });
}
/** @param {unknown} entrada @param {number} evaluadoEn @returns {EventoProgramadoPanel[]} */
function leerEventosProgramados(entrada, evaluadoEn) {
  exigirTrabajo(Array.isArray(entrada) && entrada.length <= MAX_EVENTOS_PROGRAMADOS);
  /** @type {EventoProgramadoPanel[]} */
  const eventos = [];
  for (const valor of entrada) {
    // La fase y el motivo del fallo solo viajan en un evento que falló: un panel anterior sigue leyendo los demás.
    const conFallo = valor !== null && typeof valor === 'object' && Object.hasOwn(valor, 'fase');
    const e = objetoTrabajo(
      valor,
      conFallo ? 'eventoEn,fase,motivo,motivoFallo,resultado' : 'eventoEn,motivo,resultado',
    );
    exigirTrabajo(esEnteroTrabajo(e.eventoEn) && e.eventoEn > 0 && e.eventoEn <= evaluadoEn);
    exigirTrabajo(eventos.length === 0 || e.eventoEn < (eventos[eventos.length - 1]?.eventoEn ?? 0));
    exigirTrabajo(typeof e.resultado === 'string' && typeof e.motivo === 'string');
    exigirTrabajo(MOTIVOS_EVENTO_PROGRAMADO.get(e.resultado)?.includes(e.motivo) === true);
    const fallo = falloDelEvento(e.resultado, e.fase, e.motivoFallo);
    eventos.push(Object.freeze({ eventoEn: e.eventoEn, resultado: e.resultado, motivo: e.motivo, ...fallo }));
  }
  return eventos;
}
/** Estados de cada canal: el correo depende del enlace, del remitente y de la dirección; la URL, de `FARO_AVISO_URL`. */
const ESTADOS_CANAL = new Map([
  ['correo', ['no-configurado', 'remitente-no-admitido', 'sin-destino', 'pendiente', 'verificado']],
  ['url', ['no-configurados', 'configurados', 'destino-no-admitido']],
]);
/** Lo que no hace falta decir: un canal sin configurar y sin ningún intento no viaja. */
const SIN_CANAL = new Map([
  ['correo', 'no-configurado'],
  ['url', 'no-configurados'],
]);
const MOTIVOS_FALLO_AVISO = ['respuesta-no-admitida', 'sin-respuesta', 'plazo-agotado', 'destino-no-admitido'];
/** Por qué el enlace de correo no aceptó el aviso, o que la dirección guardada no cabe en el mensaje. */
export const MOTIVOS_FALLO_CORREO_PANEL = Object.freeze([
  'remitente-no-configurado',
  'destinatario-no-permitido',
  'limite-alcanzado',
  'rechazo-del-destino',
  'error-temporal',
  'plazo-agotado',
  'envio-rechazado',
  'destino-no-admitido',
]);
/** @param {unknown} entrada @param {readonly string[]} motivos @param {number} evaluadoEn @returns {IntentoAvisoPanel|null} */
function leerIntento(entrada, motivos, evaluadoEn) {
  if (entrada === null) {
    return null;
  }
  const i = objetoTrabajo(entrada, 'en,motivo,resultado');
  exigirTrabajo(esEnteroTrabajo(i.en) && i.en <= evaluadoEn);
  const fallido = i.resultado === 'fallido';
  exigirTrabajo(
    fallido
      ? typeof i.motivo === 'string' && motivos.includes(i.motivo)
      : i.resultado === 'enviado' && i.motivo === null,
  );
  const motivo = fallido ? /** @type {string} */ (i.motivo) : null;
  return Object.freeze({ en: i.en, resultado: fallido ? 'fallido' : 'enviado', motivo });
}
/**
 * `completo`: en la lectura de la tarjeta viajan los dos canales aunque no digan nada; en el vigilante, solo los que sí.
 * @param {unknown} entrada @param {number} evaluadoEn @param {boolean} [completo] @returns {CanalAvisoPanel}
 */
function leerCanal(entrada, evaluadoEn, completo = false) {
  const o = objetoTrabajo(entrada, 'canal,estado,ultimoIntento');
  const estados = typeof o.canal === 'string' ? ESTADOS_CANAL.get(o.canal) : undefined;
  exigirTrabajo(estados !== undefined && typeof o.estado === 'string' && estados.includes(o.estado));
  exigirTrabajo(completo || o.estado !== SIN_CANAL.get(/** @type {string} */ (o.canal)) || o.ultimoIntento !== null);
  const motivos = o.canal === 'correo' ? MOTIVOS_FALLO_CORREO_PANEL : MOTIVOS_FALLO_AVISO;
  const ultimoIntento = leerIntento(o.ultimoIntento, motivos, evaluadoEn);
  return /** @type {CanalAvisoPanel} */ (Object.freeze({ canal: o.canal, estado: o.estado, ultimoIntento }));
}
/**
 * Estado de cada canal de avisos y su último intento, sin la dirección. Se decide por la presencia de `canales`: la
 * forma de un solo canal (`estado` y `ultimoIntento`), que solo conocía la URL, se lee como el canal `url`.
 * @param {unknown} entrada @param {number} evaluadoEn @returns {AvisosVigilantePanel}
 */
function leerAvisos(entrada, evaluadoEn) {
  if (!traeCampo(entrada, 'canales')) {
    const o = objetoTrabajo(entrada, 'estado,ultimoIntento');
    return Object.freeze({ canales: Object.freeze([leerCanal({ canal: 'url', ...o }, evaluadoEn)]) });
  }
  const o = objetoTrabajo(entrada, 'canales');
  exigirTrabajo(Array.isArray(o.canales) && o.canales.length >= 1 && o.canales.length <= ESTADOS_CANAL.size);
  const canales = o.canales.map((canal) => leerCanal(canal, evaluadoEn));
  // Siempre en el mismo orden, el correo primero, y cada canal una sola vez.
  const orden = [...ESTADOS_CANAL.keys()];
  exigirTrabajo(
    canales.every((c, i) => i === 0 || orden.indexOf(c.canal) > orden.indexOf(canales[i - 1]?.canal ?? '')),
  );
  return Object.freeze({ canales: Object.freeze(canales) });
}
/** @typedef {Readonly<{comprobaciones:'activas'|'desactivadas',canales:readonly CanalAvisoPanel[]}>} EstadoAvisosPanel */
/**
 * El estado de los avisos que acompaña la lectura de la dirección en la tarjeta: si las comprobaciones automáticas
 * están activas y los dos canales, el correo primero, aunque no digan nada. Una lectura no tiene instante de
 * evaluación, así que el intento solo tiene que ser un instante entero.
 * @param {unknown} entrada @returns {EstadoAvisosPanel}
 */
export function leerEstadoAvisosPanel(entrada) {
  const o = objetoTrabajo(entrada, 'canales,comprobaciones');
  exigirTrabajo(o.comprobaciones === 'activas' || o.comprobaciones === 'desactivadas');
  const orden = [...ESTADOS_CANAL.keys()];
  exigirTrabajo(Array.isArray(o.canales) && o.canales.length === orden.length);
  const canales = o.canales.map((canal) => leerCanal(canal, Number.MAX_SAFE_INTEGER, true));
  exigirTrabajo(canales.every((c, i) => c.canal === orden[i]));
  return Object.freeze({ comprobaciones: o.comprobaciones, canales: Object.freeze(canales) });
}
/** Campos que solo viajan con valor. */
const OPCIONALES_VIGILANTE = ['avisos', 'pausaProgramadaHasta'];
const CAMPOS_VIGILANTE =
  'areas,entregaActiva,evaluadoEn,eventosProgramados,fechaDatos,incidencias,origenDatos,pulsoContinuo,revision,ultimoTrabajo,version';
/** @param {unknown} entrada @param {string} campo */
const traeCampo = (entrada, campo) => entrada !== null && typeof entrada === 'object' && Object.hasOwn(entrada, campo);
/** @param {unknown} valor @param {number} evaluadoEn @returns {string} */
function leerPausa(valor, evaluadoEn) {
  exigirTrabajo(typeof valor === 'string' && /^\d{4}-\d\d-\d\d$/.test(valor));
  exigirTrabajo(new Date(evaluadoEn).toISOString().slice(0, 10) <= valor);
  return valor;
}
/**
 * `avisos` solo viaja cuando dice algo más que «no configurados», y `pausaProgramadaHasta` solo con una pausa vigente:
 * así un panel anterior sigue leyendo la respuesta de una instalación sin canal de avisos ni pausa. La ausencia de
 * `avisos` equivale a avisos no configurados y sin ningún intento.
 * @param {unknown} entrada @returns {VigilantePanel}
 */
export function leerVigilantePanel(entrada) {
  const opcionales = OPCIONALES_VIGILANTE.filter((campo) => traeCampo(entrada, campo));
  const o = objetoTrabajo(entrada, [...CAMPOS_VIGILANTE.split(','), ...opcionales].sort().join(','));
  exigirTrabajo(
    o.version === 1 &&
      (o.origenDatos === 'recibo' || o.origenDatos === 'lectura-local') &&
      esEnteroTrabajo(o.evaluadoEn) &&
      esEnteroTrabajo(o.revision),
  );
  exigirTrabajo(o.pulsoContinuo === 'no-instrumentado' && o.entregaActiva === 'sin-observacion-actual');
  exigirTrabajo(
    Array.isArray(o.incidencias) &&
      o.incidencias.length <= MAX_INCIDENCIAS &&
      Array.isArray(o.fechaDatos) &&
      o.fechaDatos.length <= MAX_FUENTES,
  );
  exigirTrabajo(Array.isArray(o.areas) && o.areas.length <= MAX_INCIDENCIAS);
  const areas = leerAreas(o.areas, o.evaluadoEn);
  const incidencias = o.incidencias.map(leerFilaVigilantePanel);
  const evaluadoEn = o.evaluadoEn;
  exigirTrabajo(incidencias.every((i) => i.estado === 'incidencia' && i.evaluadoEn <= evaluadoEn));
  const fechaDatos = leerFechas(o.fechaDatos);
  return Object.freeze({
    version: 1,
    origenDatos: o.origenDatos,
    evaluadoEn: o.evaluadoEn,
    pulsoContinuo: o.pulsoContinuo,
    entregaActiva: o.entregaActiva,
    revision: o.revision,
    incidencias,
    areas,
    fechaDatos,
    ultimoTrabajo: leerUltimoTrabajo(o.ultimoTrabajo),
    eventosProgramados: Object.freeze(leerEventosProgramados(o.eventosProgramados, o.evaluadoEn)),
    ...(opcionales.includes('avisos') ? { avisos: leerAvisos(o.avisos, o.evaluadoEn) } : {}),
    ...(opcionales.includes('pausaProgramadaHasta')
      ? { pausaProgramadaHasta: leerPausa(o.pausaProgramadaHasta, o.evaluadoEn) }
      : {}),
  });
}
/** @param {unknown} entrada @returns {HistorialVigilantePanel} */
export function leerHistorialVigilantePanel(entrada) {
  const o = objetoTrabajo(entrada, 'decisiones,revision,siguiente,version');
  exigirTrabajo(
    o.version === 1 &&
      esEnteroTrabajo(o.revision) &&
      Array.isArray(o.decisiones) &&
      o.decisiones.length <= LIMITE_PAGINA_VIGILANTE,
  );
  exigirTrabajo(o.siguiente === null || (esEnteroTrabajo(o.siguiente) && o.siguiente > 0));
  const decisiones = o.decisiones.map(leerFilaVigilantePanel);
  exigirTrabajo(decisiones.every((d, i) => i === 0 || d.id > (decisiones[i - 1]?.id ?? 0)));
  exigirTrabajo(
    o.siguiente === null || (decisiones.length > 0 && o.siguiente === decisiones[decisiones.length - 1]?.id),
  );
  return Object.freeze({ version: 1, revision: o.revision, decisiones, siguiente: o.siguiente });
}
