// Generado desde src/administracion/estado-trabajos.js; no editar esta copia.
/** Contrato público de seguimiento; leer un resultado no activa ninguna generación. */
/**
 * @typedef {'actualizar-datos'|'reintentar-pendientes'} AccionManual
 * @typedef {AccionManual|'comprobar-programada'|'comprobar-vencidas'|'actualizar-cursos'} AccionActualizacion
 * @typedef {'programada'|'panel'|'demanda'} OrigenTrabajo
 * @typedef {Readonly<{solicitudId:string,revisionReserva:number}>} ReferenciaTrabajo
 * @typedef {'actualizacion_no_completada'|'actualizacion_no_admitida'|'candidato_no_verificable'|null} ErrorTrabajo
 * @typedef {'plazo-agotado'|'plazo-insuficiente'|'motor-terminado-por-senal'|'motor-sin-recibo'|'sin-resultado'} CausaUltimoFallo
 * @typedef {Readonly<{causa:CausaUltimoFallo,paso:string|null}>} UltimoFallo
 * @typedef {Readonly<{resultado:'validado'|'sin-pendientes'|'rechazado'|'despacho-rechazado'|'retirado'|'ejecucion-sin-recibo',veredicto:'verde'|'ámbar'|'rojo'|null,terminadoEn:string,huellaPaquete:string|null,error:ErrorTrabajo,ultimoFallo?:UltimoFallo}>} ResultadoTrabajo
 * @typedef {Readonly<ReferenciaTrabajo & {accion:AccionActualizacion,revisionBase:number,creadoEn:number,actualizadoEn:number,estado:'despacho-incierto'|'despachado'|'terminado',runId:string|null,runAttempt:'1',resultado:ResultadoTrabajo|null}>} TrabajoActualizacion
 * @typedef {Readonly<TrabajoActualizacion & {origen?:OrigenTrabajo,iniciado?:boolean}>} TrabajoPublico
 * @typedef {Readonly<{version:1,revision:number,ultimoTrabajo:TrabajoPublico|null}>} EstadoTrabajos
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** @param {unknown} valor @returns {valor is string} */
export function esIdSolicitudTrabajo(valor) {
  return typeof valor === 'string' && UUID.test(valor);
}
/** @type {readonly ErrorTrabajo[]} */
const ERRORES = ['actualizacion_no_completada', 'actualizacion_no_admitida', 'candidato_no_verificable', null];
/** Margen entre reloj remoto y local; nunca se adelanta el reloj durable al instante del recibo. */
export const MARGEN_RELOJ_GITHUB_MS = 30_000;
const MS_SEGUNDO = 1000;
/** @param {boolean} condicion @returns {asserts condicion} */
export function exigirTrabajo(condicion) {
  if (!condicion) {
    throw new Error('Estado de actualización no válido');
  }
}
/** @param {unknown} valor @returns {valor is number} */
export function esEnteroTrabajo(valor) {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor >= 0;
}
/** @param {unknown} valor @returns {valor is string} */
export function esIdEjecucion(valor) {
  return (
    typeof valor === 'string' && /^[1-9][0-9]{0,15}$/.test(valor) && BigInt(valor) <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}
/** Descriptores propios antes de leer: no ejecuta accesores ni normaliza prototipos ajenos. */
/** @param {unknown} entrada @param {string} campos @returns {Record<string, unknown>} */
export function objetoTrabajo(entrada, campos) {
  exigirTrabajo(entrada !== null && typeof entrada === 'object' && !Array.isArray(entrada));
  exigirTrabajo([Object.prototype, null].includes(Object.getPrototypeOf(entrada)));
  exigirTrabajo(Object.getOwnPropertySymbols(entrada).length === 0);
  exigirTrabajo(Object.getOwnPropertyNames(entrada).sort().join(',') === campos);
  /** @type {Record<string, unknown>} */
  const copia = {};
  for (const clave of Object.getOwnPropertyNames(entrada)) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    exigirTrabajo(descriptor !== undefined && 'value' in descriptor && descriptor.enumerable === true);
    Object.defineProperty(copia, clave, { value: descriptor.value, enumerable: true });
  }
  return copia;
}
/** @param {unknown} valor @returns {valor is AccionManual} */
export function accionManual(valor) {
  return valor === 'actualizar-datos' || valor === 'reintentar-pendientes';
}
/**
 * Lista cerrada de lo que un trabajo puede pedir. `comprobar-vencidas` y `actualizar-cursos` existen en el contrato
 * para la reserva a demanda; el panel solo pide acciones manuales y la programada, `comprobar-programada`.
 */
export const ACCIONES_TRABAJO = Object.freeze(
  /** @type {const} */ ([
    'actualizar-datos',
    'reintentar-pendientes',
    'comprobar-programada',
    'comprobar-vencidas',
    'actualizar-cursos',
  ]),
);
/** @param {unknown} valor @returns {valor is AccionActualizacion} */
export function accion(valor) {
  return ACCIONES_TRABAJO.includes(/** @type {AccionActualizacion} */ (valor));
}
/** Quién pidió el trabajo: la tarea programada, una persona desde el panel o un lanzamiento a demanda. */
export const ORIGENES_TRABAJO = Object.freeze(/** @type {const} */ (['programada', 'panel', 'demanda']));
/** @param {unknown} valor @returns {valor is OrigenTrabajo} */
export function esOrigenTrabajo(valor) {
  return ORIGENES_TRABAJO.includes(/** @type {OrigenTrabajo} */ (valor));
}
/**
 * Lista cerrada de claves de un trabajo con sus claves opcionales: cada opcional cuenta solo si está presente, para
 * leer igual un documento guardado antes de que existiera.
 * @param {unknown} entrada @param {string} obligatorias @param {readonly string[]} opcionales @returns {string}
 */
export function camposDelTrabajo(entrada, obligatorias, opcionales) {
  const objeto = entrada !== null && typeof entrada === 'object';
  const presentes = opcionales.filter((clave) => objeto && Object.hasOwn(entrada, clave));
  return [...obligatorias.split(','), ...presentes].sort().join(',');
}
/** @param {unknown} entrada @returns {ReferenciaTrabajo} */
export function leerReferenciaTrabajo(entrada) {
  const o = objetoTrabajo(entrada, 'revisionReserva,solicitudId');
  exigirTrabajo(esIdSolicitudTrabajo(o.solicitudId));
  exigirTrabajo(esEnteroTrabajo(o.revisionReserva) && o.revisionReserva > 0);
  return Object.freeze({ solicitudId: o.solicitudId, revisionReserva: o.revisionReserva });
}
/** @param {unknown} valor @returns {number} */
export function instanteRecibo(valor) {
  exigirTrabajo(typeof valor === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(valor));
  const ms = Date.parse(valor);
  exigirTrabajo(esEnteroTrabajo(ms) && new Date(ms).toISOString() === valor.replace('Z', '.000Z'));
  return ms;
}
/** @param {string} terminadoEn @param {number} creadoEn @param {number} recibidoEn @returns {boolean} */
export function tiempoReciboAdmitido(terminadoEn, creadoEn, recibidoEn) {
  const terminado = instanteRecibo(terminadoEn);
  return (
    terminado >= Math.floor(creadoEn / MS_SEGUNDO) * MS_SEGUNDO - MARGEN_RELOJ_GITHUB_MS &&
    terminado <= recibidoEn + MARGEN_RELOJ_GITHUB_MS
  );
}
/**
 * Por qué no terminó un trabajo, en palabras de listas cerradas: el tiempo previsto se agotó, no quedaba tiempo para
 * terminar, el proceso se interrumpió o terminó sin resultado (lo dice el supervisor), o el job acabó sin decir nada
 * (`sin-resultado`, lo deduce el servidor de la evidencia de GitHub). Nunca un mensaje, una ruta ni un identificador.
 */
export const CAUSAS_ULTIMO_FALLO = Object.freeze(
  /** @type {const} */ ([
    'plazo-agotado',
    'plazo-insuficiente',
    'motor-terminado-por-senal',
    'motor-sin-recibo',
    'sin-resultado',
  ]),
);
/** El paso es un nombre del diario del supervisor; null cuando nadie dijo en qué paso iba. */
const PASO_DEL_DIARIO = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** @param {unknown} entrada @returns {UltimoFallo} */
export function leerUltimoFallo(entrada) {
  const o = objetoTrabajo(entrada, 'causa,paso');
  exigirTrabajo(CAUSAS_ULTIMO_FALLO.includes(/** @type {CausaUltimoFallo} */ (o.causa)));
  exigirTrabajo(o.paso === null || (typeof o.paso === 'string' && PASO_DEL_DIARIO.test(o.paso)));
  return Object.freeze({ causa: /** @type {CausaUltimoFallo} */ (o.causa), paso: o.paso });
}
/**
 * `ultimoFallo` solo acompaña a un trabajo que no terminó: un recibo rechazado o una ejecución sin recibo. Falta en
 * los demás y en los documentos guardados antes de existir. `sin-resultado` solo cabe sin recibo.
 * @param {Record<string, unknown>} o @param {unknown} resultado @returns {{ultimoFallo?:UltimoFallo}}
 */
function ultimoFalloDelResultado(o, resultado) {
  if (!Object.hasOwn(o, 'ultimoFallo')) {
    return {};
  }
  const ultimoFallo = leerUltimoFallo(o.ultimoFallo);
  exigirTrabajo(resultado === 'ejecucion-sin-recibo' || resultado === 'rechazado');
  exigirTrabajo(ultimoFallo.causa !== 'sin-resultado' || resultado === 'ejecucion-sin-recibo');
  return { ultimoFallo };
}
/** @param {unknown} entrada @returns {ResultadoTrabajo} */
export function leerResultado(entrada) {
  const campos = camposDelTrabajo(entrada, 'error,huellaPaquete,resultado,terminadoEn,veredicto', ['ultimoFallo']);
  const o = objetoTrabajo(entrada, campos);
  instanteRecibo(o.terminadoEn);
  exigirTrabajo(typeof o.terminadoEn === 'string');
  exigirTrabajo(o.veredicto === null || o.veredicto === 'verde' || o.veredicto === 'ámbar' || o.veredicto === 'rojo');
  exigirTrabajo(
    o.huellaPaquete === null || (typeof o.huellaPaquete === 'string' && /^[0-9a-f]{16}$/.test(o.huellaPaquete)),
  );
  exigirTrabajo(ERRORES.includes(/** @type {ErrorTrabajo} */ (o.error)));
  if (o.resultado === 'validado') {
    // En ámbar, el paquete publica lo actualizado y cada módulo que falló conserva su última versión buena.
    // Este lector solo recibe estos cinco campos, ya validados por el servidor (resultado-actualizacion.ts y
    // datos-trabajo.ts): allí se exige la versión 4, «conservados» igual al estado, el paquete en verde y ningún
    // módulo en rojo. Aquí se comprueba todo lo que estos campos permiten: nunca rojo, con huella y sin error.
    exigirTrabajo((o.veredicto === 'verde' || o.veredicto === 'ámbar') && o.huellaPaquete !== null && o.error === null);
  } else if (
    o.resultado === 'sin-pendientes' ||
    o.resultado === 'despacho-rechazado' ||
    o.resultado === 'retirado' ||
    o.resultado === 'ejecucion-sin-recibo'
  ) {
    exigirTrabajo(o.veredicto === null && o.huellaPaquete === null && o.error === null);
  } else {
    exigirTrabajo(o.resultado === 'rechazado' && o.huellaPaquete === null && o.error !== null);
  }
  return Object.freeze({
    resultado: o.resultado,
    veredicto: o.veredicto,
    terminadoEn: o.terminadoEn,
    huellaPaquete: o.huellaPaquete,
    error: /** @type {ErrorTrabajo} */ (o.error),
    ...ultimoFalloDelResultado(o, o.resultado),
  });
}
/** @param {Record<string,unknown>} t @param {ResultadoTrabajo|null} resultado @param {number} creadoEn @param {number} actualizadoEn @returns {TrabajoActualizacion['estado']} */
function estadoDelTrabajo(t, resultado, creadoEn, actualizadoEn) {
  if (t.estado === 'despacho-incierto') {
    exigirTrabajo(t.runId === null && resultado === null);
  } else if (t.estado === 'despachado') {
    exigirTrabajo(t.runId !== null && resultado === null);
  } else {
    exigirTrabajo(t.estado === 'terminado' && resultado !== null);
    exigirTrabajo(tiempoReciboAdmitido(resultado.terminadoEn, creadoEn, actualizadoEn));
    if (resultado.resultado !== 'retirado') {
      exigirTrabajo(resultado.resultado === 'despacho-rechazado' ? t.runId === null : t.runId !== null);
    }
  }
  exigirTrabajo(t.estado === 'despacho-incierto' || t.estado === 'despachado' || t.estado === 'terminado');
  return t.estado;
}
/** @param {Record<string,unknown>} t @param {number} revision @returns {TrabajoActualizacion} */
export function leerTrabajoBase(t, revision) {
  const referencia = leerReferenciaTrabajo({ solicitudId: t.solicitudId, revisionReserva: t.revisionReserva });
  exigirTrabajo(accion(t.accion) && esEnteroTrabajo(t.revisionBase));
  exigirTrabajo(t.revisionBase + 1 === referencia.revisionReserva && referencia.revisionReserva <= revision);
  exigirTrabajo(esEnteroTrabajo(t.creadoEn) && esEnteroTrabajo(t.actualizadoEn) && t.actualizadoEn >= t.creadoEn);
  exigirTrabajo(t.runAttempt === '1' && (t.runId === null || esIdEjecucion(t.runId)));
  const resultado = t.resultado === null ? null : leerResultado(t.resultado);
  const estado = estadoDelTrabajo(t, resultado, t.creadoEn, t.actualizadoEn);
  return Object.freeze({
    ...referencia,
    accion: t.accion,
    revisionBase: t.revisionBase,
    creadoEn: t.creadoEn,
    actualizadoEn: t.actualizadoEn,
    estado,
    runId: t.runId,
    runAttempt: '1',
    resultado,
  });
}
/**
 * `origen` falta en los trabajos reservados antes de anotarse; `iniciado` dice si el permiso de inicio se concedió.
 * Los dos son opcionales al leer, como cualquier campo añadido al contrato.
 * @param {unknown} entrada @param {number} revision @returns {TrabajoPublico}
 */
function leerTrabajoPublico(entrada, revision) {
  const obligatorias =
    'accion,actualizadoEn,creadoEn,estado,resultado,revisionBase,revisionReserva,runAttempt,runId,solicitudId';
  const t = objetoTrabajo(entrada, camposDelTrabajo(entrada, obligatorias, ['iniciado', 'origen']));
  const base = leerTrabajoBase(t, revision);
  exigirTrabajo(!Object.hasOwn(t, 'origen') || esOrigenTrabajo(t.origen));
  exigirTrabajo(!Object.hasOwn(t, 'iniciado') || typeof t.iniciado === 'boolean');
  exigirTrabajo(t.iniciado !== true || (base.runId !== null && base.estado !== 'despacho-incierto'));
  return Object.freeze({
    ...base,
    ...(Object.hasOwn(t, 'origen') ? { origen: /** @type {OrigenTrabajo} */ (t.origen) } : {}),
    ...(Object.hasOwn(t, 'iniciado') ? { iniciado: /** @type {boolean} */ (t.iniciado) } : {}),
  });
}
/** Copia cerrada e inmutable del estado público, sin contratos de autenticación. */
/** @param {unknown} entrada @returns {EstadoTrabajos} */
export function leerEstadoTrabajos(entrada) {
  const o = objetoTrabajo(entrada, 'revision,ultimoTrabajo,version');
  exigirTrabajo(o.version === 1 && esEnteroTrabajo(o.revision));
  if (o.ultimoTrabajo === null) {
    exigirTrabajo(o.revision === 0);
  }
  return Object.freeze({
    version: 1,
    revision: o.revision,
    ultimoTrabajo: o.ultimoTrabajo === null ? null : leerTrabajoPublico(o.ultimoTrabajo, o.revision),
  });
}
