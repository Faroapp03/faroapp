// Generado desde src/administracion/salud-datos.js; no editar esta copia.
/** Reglas únicas de presentación del mantenimiento. No certifican disponibilidad ni una entrega activa. */
/** @typedef {import('./estado-datos.js').EstadoDatosPanel} EstadoDatosPanel */
/** @typedef {Readonly<{id:string,nombre:string,tema:string,modalidad:import('./estado-datos.js').ModalidadFuenteDatos}>} IdentidadFuente */
/** @typedef {import('./estado-datos.js').ConjuntoComprobacionDatos} Conjunto */
/** @typedef {'atencion'|'incidencia'|'pendiente'|'revision'|'sin-observacion'|'local'|'comprobada'|'candidata'|'externa'|'productor-local'} EstadoSalud */
/** @typedef {Readonly<{id:string,nombre:string,tema:string,modalidad:string,estado:EstadoSalud,mensaje:string,accion:string,atencionPorAviso:boolean,ultimaConsulta:string|null,resultadoConsulta:import('./estado-datos.js').ResultadoOperacionDatos|null,comprobaciones:readonly Readonly<{id:string,fecha:string|null}>[],proximasConsultas:readonly Readonly<{id:string,fecha:string|null}>[],proximoReintento:string|null,proximaConsulta:string|null,fallosSeguidos:number,consultaParcial:import('./estado-datos.js').ConsultaParcialDatos|null,coberturaLimitada:import('./estado-datos.js').MotivoCoberturaLimitadaDatos|null,revisionPendiente:RevisionPendiente|null,edicionNueva:import('./edicion-nueva-datos.js').EdicionNuevaDatos|null,avisoEdicion:import('./edicion-nueva-datos.js').AvisoEdicionDatos|null,gruposEnSuGranGrupo:number|null,gruposSinClase:number|null,salidaParcial:import('./estado-datos.js').SalidaParcialDatos|null,enlaces:import('./estado-datos.js').EnlacesDatos|null,retirada:import('./retirada-datos.js').RetiradaDatos|null,retiradaAmplia:import('./retirada-datos.js').RetiradaAmpliaDatos|null}>} SaludFuente */
/** @typedef {Readonly<{fecha:string,vencida:boolean}>} RevisionPendiente */

/** Texto, forma y tono siempre viajan juntos; no hay animación ni significado concedido solo al color. */
export const ESTADOS_SALUD = Object.freeze({
  atencion: { texto: 'Necesita atención', forma: '■', tono: 'rojo' },
  incidencia: { texto: 'No se pudo comprobar', forma: '▲', tono: 'ambar' },
  pendiente: { texto: 'Consulta pendiente', forma: '▲', tono: 'ambar' },
  revision: { texto: 'Revisión manual', forma: '◆', tono: 'neutro' },
  'sin-observacion': { texto: 'Sin comprobación registrada', forma: '○', tono: 'neutro' },
  local: { texto: 'Comprobación local', forma: '◆', tono: 'neutro' },
  comprobada: { texto: 'Consulta comprobada', forma: '●', tono: 'verde' },
  candidata: { texto: 'No activada', forma: '○', tono: 'neutro' },
  externa: { texto: 'Revisión externa', forma: '◆', tono: 'neutro' },
  'productor-local': { texto: 'Producción local', forma: '◆', tono: 'neutro' },
});
for (const estado of Object.values(ESTADOS_SALUD)) {
  Object.freeze(estado);
}
export const NOMBRES_TEMAS = Object.freeze({
  cursos: 'Cursos',
  ocupaciones: 'Ocupaciones',
  ia_y_trabajo: 'IA y trabajo',
  mercado: 'Mercado',
  derechos: 'Derechos',
  biblioteca: 'Biblioteca',
  comun: 'Datos comunes',
  derivados: 'Datos derivados',
  'sin-tema': 'Tema no conservado en esta observación',
});
const DIA_MS = 86_400_000;
const FIN_FECHA = 10;
const MAX_FECHA_MS = 8_640_000_000_000_000;
// Única fuente cuyas fichas tienen revisión periódica; la observación publica desde cuándo está pendiente (desde la v5,
// formacionAbiertaRevisionPendiente; hasta la v4, formacionAbiertaCaduca). Es un aviso: no caduca nada.
const FUENTE_CON_REVISION = 'abierta';
/** Fuente cuya comprobación reparte su trabajo entre actualizaciones por diseño: llegar al tope o al plazo es lo previsto. */
const FUENTE_DE_ENLACES = 'enlaces';
/** Motivos de una salida parcial que son funcionamiento previsto: no piden nada ni cambian la salud de la fuente. Una
 * web que pide que se la consulte menos se deja para la próxima actualización, el Cibernàrium cambió la dirección de
 * su consulta y Faro ya usa la nueva, un curso de HP LIFE que sale del listado con su página en pie se mantiene, y lo
 * que las fichas de Digitalízate contradicen al buscador se resuelve por regla.
 * @type {readonly import('./estado-datos.js').MotivoSalidaParcialDatos[]} */
export const MOTIVOS_INFORMATIVOS = [
  'portlet-cambiado',
  'dominio-con-limite',
  'ficha-integra-fuera-del-listado',
  'curso-fuera-del-catalogo-con-su-pagina',
  'censo-digitalizate-contradice-al-indice',
];
/** El tope de consultas y el plazo de la descarga: previstos en la comprobación de enlaces, que reparte su trabajo
 * entre actualizaciones; anómalos en FUNDAE, cuyo día normal queda muy por debajo del tope.
 * @type {readonly import('./estado-datos.js').MotivoSalidaParcialDatos[]} */
export const MOTIVOS_PREVISTOS_EN_ENLACES = ['tope-de-consultas', 'plazo-de-la-descarga'];
/** Motivos que solo se arreglan si una persona actúa: su texto pide avisar al equipo técnico o revisar algo.
 * @type {readonly import('./estado-datos.js').MotivoSalidaParcialDatos[]} */
export const MOTIVOS_QUE_PIDEN_ATENCION = [
  'censo-digitalizate-forma-inesperada',
  'censo-digitalizate-tope-de-proveedores',
  'fundae-conjunto-sin-aplicar',
  'portlet-no-encontrado',
  'ambito-ia-sin-nombre',
  'ambito-ia-cambiado',
  'codigo-de-inscripcion-desconocido',
  'texto-de-plazas-desconocido',
  'estado-desconocido-en-el-catalogo',
];

/** Lo que un motivo de salida parcial hace con la salud de su fuente: nada (información), «No se pudo comprobar»
 * (Faro lo vuelve a intentar solo) o «Necesita atención» (solo lo arregla una persona).
 * @param {import('./estado-datos.js').MotivoSalidaParcialDatos} motivo @param {string} fuente
 * @returns {'informacion'|'incidencia'|'atencion'}
 */
export function gravedadDeMotivo(motivo, fuente) {
  if (
    MOTIVOS_INFORMATIVOS.includes(motivo) ||
    (fuente === FUENTE_DE_ENLACES && MOTIVOS_PREVISTOS_EN_ENLACES.includes(motivo))
  ) {
    return 'informacion';
  }
  return MOTIVOS_QUE_PIDEN_ATENCION.includes(motivo) ? 'atencion' : 'incidencia';
}

/** @param {EstadoDatosPanel} datos @returns {readonly IdentidadFuente[]|null} */
function identidades(datos) {
  // Por presencia del campo: cada versión nueva conserva el catálogo sin tener que nombrarla aquí.
  return 'catalogoFuentes' in datos ? datos.catalogoFuentes : null;
}
/** @param {EstadoDatosPanel} datos @param {string} id */
function hechos(datos, id) {
  const fuente = datos.fuentes.find((f) => f.id === id);
  const modulo = datos.modulos.find((m) => m.id === id);
  const conjuntos = datos.version === 1 ? [] : datos.comprobaciones.conjuntos.filter((c) => c.fuente === id);
  const operacion = datos.version === 1 ? null : (datos.fuentes.find((f) => f.id === id)?.ultimaOperacion ?? null);
  const seguimiento = 'seguimientoRemoto' in datos ? datos.seguimientoRemoto?.find((f) => f.fuente === id) : null;
  const remota = seguimiento?.ultimoIntento ?? (operacion?.remoto ? operacion : null);
  const ultimaConsulta = remota?.inicioEn ?? operacion?.ultimoIntentoRemotoEn ?? null;
  return {
    fuente,
    modulo,
    conjuntos,
    operacion,
    remota,
    ultimaConsulta,
    pendientes: seguimiento?.incidenciasPendientes ?? [],
    ...avisos(seguimiento),
    ...edicion(fuente),
  };
}
/** Avisos del panel; una observación anterior a ellos no los conserva y no se deducen.
 * @param {import('./estado-datos.js').SeguimientoRemotoDatos|null|undefined} seguimiento
 */
function avisos(seguimiento) {
  return {
    proximaConsulta: seguimiento?.proximaConsultaEn ?? null,
    fallosSeguidos: seguimiento?.fallosSeguidos ?? 0,
    consultaParcial: seguimiento?.consultaParcial ?? null,
    // Propiedad de la fuente, no resultado de una consulta: se informa y nunca es una incidencia.
    coberturaLimitada: seguimiento?.coberturaLimitada ?? null,
    salidaParcial: seguimiento?.salidaParcial ?? null,
    enlaces: seguimiento?.enlaces ?? null,
    // El cambio de modo de la regla de retirada: un aviso que pide atención, nunca una incidencia de la consulta.
    retirada: seguimiento?.retirada ?? null,
    // Lo que la regla activa retira de golpe por encima del umbral: un aviso con su cifra, nunca una incidencia.
    retiradaAmplia: seguimiento?.retiradaAmplia ?? null,
  };
}
/** Lo que la fila de una fuente por ediciones dice de su edición; una fila sin esos campos no los deduce.
 * @param {EstadoDatosPanel['fuentes'][number]|undefined} fuente
 */
function edicion(fuente) {
  const v2 = fuente !== undefined && 'ultimaOperacion' in fuente ? fuente : null;
  return {
    edicionNueva: v2?.edicionNueva ?? null,
    avisoEdicion: v2?.avisoEdicion ?? null,
    gruposEnSuGranGrupo: v2?.gruposEnSuGranGrupo ?? null,
    gruposSinClase: v2?.gruposSinClase ?? null,
  };
}
/** Intervalo de consulta del planificador por día UTC, no TTL ni promesa de una tarea instalada.
 * @param {Conjunto} conjunto @param {string|null} consulta @returns {string|null}
 */
function siguienteConsulta(conjunto, consulta) {
  if (conjunto.operacion !== 'descargar' || conjunto.intervaloDias === null || consulta === null) {
    return null;
  }
  const dia = Date.parse(`${consulta.slice(0, FIN_FECHA)}T00:00:00Z`);
  const siguiente = dia + conjunto.intervaloDias * DIA_MS;
  return Number.isFinite(siguiente) && Math.abs(siguiente) <= MAX_FECHA_MS ? new Date(siguiente).toISOString() : null;
}
/** @typedef {ReturnType<typeof hechos>} Hechos */
/** Lo más grave que dicen de una fuente su edición nueva y los motivos de su salida parcial.
 * @param {Hechos} h @returns {'atencion'|'incidencia'|null}
 */
function gravedadPropia(h) {
  const gravedades = (h.salidaParcial?.motivos ?? []).map((motivo) => gravedadDeMotivo(motivo, h.fuente?.id ?? ''));
  if (h.edicionNueva?.estado === 'detenida-por-controles' || gravedades.includes('atencion')) {
    return 'atencion';
  }
  return gravedades.includes('incidencia') ? 'incidencia' : null;
}
/** @param {Hechos} h @param {string} observado @returns {EstadoSalud} */
function estadoOperativo(h, observado) {
  const propia = gravedadPropia(h);
  if (h.modulo?.veredicto === 'rojo' || propia === 'atencion') {
    return 'atencion';
  }
  // «completa» (consulta entera de una fuente de cobertura limitada) no es incidencia; «parcial» siempre lo es.
  if (
    h.pendientes.length ||
    h.consultaParcial !== null ||
    propia === 'incidencia' ||
    h.modulo?.veredicto === 'ámbar' ||
    ['fallo', 'interrumpido', 'parcial'].includes(h.remota?.resultado ?? '')
  ) {
    return 'incidencia';
  }
  if (h.operacion?.resultado === 'en-curso') {
    return 'pendiente';
  }
  if (h.conjuntos.some((c) => c.revisionNecesaria)) {
    return 'revision';
  }
  const consultas = h.conjuntos.filter((c) => c.operacion === 'descargar');
  if (
    consultas.some((c) => {
      const fecha = siguienteConsulta(c, c.ultimaComprobacion?.fecha ?? null);
      return fecha !== null && fecha.slice(0, FIN_FECHA) <= observado.slice(0, FIN_FECHA);
    })
  ) {
    return 'pendiente';
  }
  if (consultas.length && h.remota !== null && consultas.every((c) => c.ultimaComprobacion !== null)) {
    return 'comprobada';
  }
  if (consultas.length) {
    return 'sin-observacion';
  }
  return h.modulo?.veredicto === 'verde' ? 'local' : 'sin-observacion';
}
/** @type {Readonly<Record<EstadoSalud,readonly [string,string]>>} */
const EXPLICACIONES = Object.freeze({
  atencion: [
    'La última operación local requiere revisión. No se ha confirmado una entrega activa.',
    'Revisa el resultado del trabajo antes de volver a preparar una entrega.',
  ],
  incidencia: [
    'Hay una incidencia de mantenimiento sin resolver. Las comprobaciones anteriores se muestran por separado.',
    'Consulta el trabajo y su diagnóstico. Usa el reintento registrado o busca actualizaciones cuando corresponda.',
  ],
  pendiente: [
    'Falta una consulta según su intervalo o confirmar el cierre de una operación. Esto no declara que el dato sea incorrecto.',
    'Comprueba el seguimiento del trabajo y el calendario antes de solicitar otra ejecución.',
  ],
  revision: [
    'Esta fuente requiere intervención o revisión manual dentro del alcance declarado.',
    'Revisa sus entradas y evidencia con el Equipo Faro; una descarga por sí sola no completa esa revisión.',
  ],
  'sin-observacion': [
    'Esta observación no conserva una comprobación suficiente de la fuente.',
    'Consulta sus entradas y el resultado del último trabajo. No se deduce un fallo ni una baja por ausencia de registro.',
  ],
  local: [
    'Consta una comprobación local. No acredita una consulta nueva a la fuente oficial.',
    'Conserva la procedencia y revisa las entradas cuando cambien; no hay una consulta remota acreditada por este estado.',
  ],
  comprobada: [
    'Hay comprobaciones registradas para los conjuntos consultables de esta fuente. Su alcance se detalla abajo.',
    'Sigue el calendario de consulta y conserva los límites de cada conjunto. Esta luz no confirma la entrega activa.',
  ],
  candidata: [
    'El productor está preparado, pero no forma parte de las actualizaciones operativas.',
    'Completa su admisión y conexión antes de activarlo. No se ejecuta por aparecer en este panel.',
  ],
  'productor-local': [
    'Produce entregas desde entradas fijadas. No acredita una comprobación remota ni una ejecución automática.',
    'Comprueba sus entradas con el CLI local explícito; generar puede escribir sus entregas y manifiesto.',
  ],
  externa: [
    'Los agregados se revisan fuera de la cadena automática de descargas.',
    'Comprueba la entrega y su procedencia con el responsable de esa revisión. No se programa una descarga automática.',
  ],
});
/** «Necesita atención» por un aviso de la propia fuente (una edición detenida o un motivo que pide actuar), no por el
 * resultado de la operación local: el aviso que se ve en su tarjeta dice qué hacer.
 * @type {readonly [string,string]} */
const EXPLICACION_ATENCION_POR_AVISO = Object.freeze([
  'Esta fuente necesita que una persona la revise: el aviso de abajo dice qué hacer.',
  EXPLICACIONES.atencion[1],
]);
/** Revisión de las fichas de Formación abierta: solo un aviso del panel, que no cambia el estado de la fuente.
 * @param {EstadoDatosPanel} datos @param {string} id @param {string} evaluadoEn @returns {RevisionPendiente|null}
 */
function revisionPendiente(datos, id, evaluadoEn) {
  const publicada =
    'formacionAbiertaRevisionPendiente' in datos
      ? datos.formacionAbiertaRevisionPendiente
      : datos.formacionAbiertaCaduca;
  const fecha = id === FUENTE_CON_REVISION ? publicada : null;
  return fecha === null
    ? null
    : Object.freeze({ fecha, vencida: estadoPlazoComprobacion(fecha, evaluadoEn) === 'vencida' });
}
/** @param {EstadoDatosPanel} datos @param {IdentidadFuente} identidad @param {string} relojEvaluacion @returns {SaludFuente} */
function resumirFuente(datos, identidad, relojEvaluacion) {
  const h = hechos(datos, identidad.id);
  let estado = estadoOperativo(h, relojEvaluacion);
  if (identidad.modalidad === 'productor-local') {
    estado = 'productor-local';
  } else if (identidad.modalidad !== 'operativa') {
    estado = identidad.modalidad === 'productor-externo' ? 'externa' : 'candidata';
  }
  const atencionPorAviso = estado === 'atencion' && h.modulo?.veredicto !== 'rojo';
  const [mensaje, accion] = atencionPorAviso ? EXPLICACION_ATENCION_POR_AVISO : EXPLICACIONES[estado];
  return Object.freeze({
    ...identidad,
    estado,
    mensaje,
    accion,
    atencionPorAviso,
    ultimaConsulta: h.ultimaConsulta,
    resultadoConsulta: h.remota?.resultado ?? null,
    proximoReintento: h.modulo?.proximoReintento ?? null,
    proximaConsulta: h.proximaConsulta,
    fallosSeguidos: h.fallosSeguidos,
    consultaParcial: h.consultaParcial,
    coberturaLimitada: h.coberturaLimitada,
    revisionPendiente: revisionPendiente(datos, identidad.id, relojEvaluacion),
    edicionNueva: h.edicionNueva,
    avisoEdicion: h.avisoEdicion,
    gruposEnSuGranGrupo: h.gruposEnSuGranGrupo,
    gruposSinClase: h.gruposSinClase,
    salidaParcial: h.salidaParcial,
    enlaces: h.enlaces,
    retirada: h.retirada,
    retiradaAmplia: h.retiradaAmplia,
    comprobaciones: Object.freeze(
      h.conjuntos.map((c) => Object.freeze({ id: c.id, fecha: c.ultimaComprobacion?.fecha ?? null })),
    ),
    proximasConsultas: Object.freeze(
      h.conjuntos
        .filter((c) => c.operacion === 'descargar')
        .map((c) => Object.freeze({ id: c.id, fecha: siguienteConsulta(c, c.ultimaComprobacion?.fecha ?? null) })),
    ),
  });
}
/** @param {EstadoDatosPanel} datos @param {number} reloj @returns {string} */
function relojSalud(datos, reloj) {
  if (!Number.isSafeInteger(reloj) || reloj < Date.parse(datos.observadoEn) || Math.abs(reloj) > MAX_FECHA_MS) {
    throw new Error('Reloj de evaluación del mantenimiento no válido');
  }
  return new Date(reloj).toISOString();
}

/** Misma regla de día UTC para un soporte admitido, sin rejuvenecerlo.
 * @param {string|null} siguiente @param {string} evaluadoEn
 */
export function estadoPlazoComprobacion(siguiente, evaluadoEn) {
  if (siguiente === null) {
    return 'sin-observacion';
  }
  return siguiente.slice(0, FIN_FECHA) <= evaluadoEn.slice(0, FIN_FECHA) ? 'vencida' : 'comprobada';
}

/** Plazos de comprobación por conjunto, no caducidad del dato ni frecuencia de publicación.
 * @param {EstadoDatosPanel} datos
 * @param {number} [relojEvaluacion]
 */
export function evaluarComprobacionesDatos(datos, relojEvaluacion = Date.parse(datos.observadoEn)) {
  const evaluadoEn = relojSalud(datos, relojEvaluacion);
  if (datos.version === 1) {
    return Object.freeze([]);
  }
  return Object.freeze(
    datos.comprobaciones.conjuntos.map((conjunto) => {
      const siguiente = siguienteConsulta(conjunto, conjunto.ultimaComprobacion?.fecha ?? null);
      let estado = 'no-remota';
      if (conjunto.operacion === 'descargar') {
        estado = 'sin-observacion';
        if (siguiente !== null) {
          estado = estadoPlazoComprobacion(siguiente, evaluadoEn);
        }
      }
      return Object.freeze({
        id: conjunto.id,
        fuente: conjunto.fuente,
        estado,
        ultimaComprobacion: conjunto.ultimaComprobacion?.fecha ?? null,
        proximaComprobacion: siguiente,
      });
    }),
  );
}

/** Única presentación derivada, con el reloj de la observación; no consulta fuentes ni usa Date.now.
 * @param {EstadoDatosPanel} datos
 * @param {number} [relojEvaluacion] Instante de evaluación; no sustituye observadoEn ni una captura.
 */
export function resumirSaludDatos(datos, relojEvaluacion = Date.parse(datos.observadoEn)) {
  const evaluadoEn = relojSalud(datos, relojEvaluacion);
  /** @type {readonly IdentidadFuente[]} */
  const catalogo =
    identidades(datos) ??
    datos.fuentes.map((f) => ({ id: f.id, nombre: f.id, tema: 'sin-tema', modalidad: 'operativa' }));
  const fuentes = catalogo.map((f) => resumirFuente(datos, f, evaluadoEn));
  const operativas = fuentes.filter((f) => f.modalidad === 'operativa');
  const otras = fuentes.filter((f) => f.modalidad !== 'operativa');
  const temas = [...new Set(operativas.map((f) => f.tema))].map((tema) =>
    Object.freeze({
      tema,
      fuentes: Object.freeze(operativas.filter((f) => f.tema === tema)),
      estado: estadoAgregado(operativas.filter((f) => f.tema === tema)),
    }),
  );
  const almacen = datos.modulos.find((m) => m.id === 'paquete')?.motivoAlmacen ?? null;
  const global = estadoAgregado(operativas);
  return Object.freeze({
    // El fallo del almacén de Cursos es de la instalación, no de una fuente: va aparte, pero el estado global no puede
    // decir que todo está bien mientras dure.
    global: almacen !== null ? 'atencion' : global,
    almacen,
    operativas: Object.freeze(operativas),
    otras: Object.freeze(otras),
    temas: Object.freeze(temas),
  });
}

/** Ninguna mayoría de fuentes correctas tapa una incidencia o una observación ausente.
 * @param {readonly SaludFuente[]} fuentes @returns {EstadoSalud}
 */
function estadoAgregado(fuentes) {
  /** @type {readonly EstadoSalud[]} */
  const prioridad = ['atencion', 'incidencia', 'pendiente', 'sin-observacion', 'revision', 'local', 'comprobada'];
  return prioridad.find((estado) => fuentes.some((f) => f.estado === estado)) ?? 'sin-observacion';
}
