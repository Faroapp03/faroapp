// La máquina de estados de la ocupación: de la respuesta de la persona a «¿A qué te dedicas?» hasta el grupo ISCO-08
// elegido. Es lógica pura, sin DOM, sin red y sin reloj: recibe un estado y un evento y devuelve el estado siguiente,
// sin cambiar el que recibe. Quien pinta (paso-ocupacion.js) solo mira la fase y los datos del estado.
//
// La ocupación se ancla en el grupo ISCO-08 de 4 cifras, porque las tareas oficiales de la OIT son del grupo; la
// ocupación ESCO solo afina. El motor local propone, el código comprueba y la persona decide.
//
// La persona puede confirmar el grupo, responder a una pregunta abierta o explorar la jerarquía oficial.
// Volver conserva el límite de preguntas; una conversación nueva comienza con estadoInicial.

/** @import { Clasificacion, GrupoClasificado, OcupacionEsco } from './traduccion-api.js' */

/** Las fases de la ocupación. */
export const FASES = Object.freeze({
  ESPERANDO: 'esperando',
  CLASIFICANDO: 'clasificando',
  CONFIRMANDO: 'confirmando',
  RESPONDIENDO: 'respondiendo',
  EXPLORANDO: 'explorando',
  RELATANDO: 'relatando',
  ELEGIDA: 'elegida',
});

/** Por qué se ha llegado a una fase: cambia lo que dice Faro al presentarla, no lo que se puede hacer en ella. */
export const MOTIVOS_DE_FASE = Object.freeze({
  INICIO: 'inicio',
  CLASIFICACION: 'clasificacion',
  LIMITE: 'limite',
  SIN_GRUPO: 'sin-grupo',
  JERARQUIA: 'jerarquia',
  PETICION: 'peticion',
  VOLVER: 'volver',
  OTRA_COSA: 'otra-cosa',
});

/** De dónde sale el grupo elegido. */
export const ORIGENES = Object.freeze({ IA: 'ia', JERARQUIA: 'jerarquia' });

/** Preguntas de aclaración que Faro hace como mucho a cada persona; la siguiente se convierte en explorar. */
export const MAX_PREGUNTAS = 2;
/** Un grupo ISCO-08 de 4 cifras es un grupo primario: el que tiene tareas oficiales de la OIT. */
const CIFRAS_GRUPO_PRIMARIO = 4;
/** La raíz de la clasificación oficial: sus hijos son los grandes grupos (1 cifra). */
const RAIZ = '';

/** Entre la respuesta anterior y la nueva, cuando la persona contesta a una pregunta abierta. */
export const SEPARADOR_DE_RESPUESTAS = '\n';

/** Las decisiones que recibe la máquina de ocupación. */
const DECISIONES = Object.freeze({ CONFIRMAR: 'confirmar', PREGUNTAR: 'preguntar', EXPLORAR: 'explorar' });
/** Explorar desde el principio de la clasificación oficial. */
const EN_LA_RAIZ = Object.freeze({ padre: RAIZ, tituloPadre: '' });

/**
 * Una fase de la ocupación.
 * @typedef {typeof FASES[keyof typeof FASES]} Fase
 */
/**
 * Por qué se ha llegado a la fase.
 * @typedef {typeof MOTIVOS_DE_FASE[keyof typeof MOTIVOS_DE_FASE]} Motivo
 */
/**
 * De dónde sale el grupo elegido.
 * @typedef {typeof ORIGENES[keyof typeof ORIGENES]} Origen
 */
/**
 * Un grupo en la máquina: el que propuso la IA o uno del que solo se sabe el código (y quizá el título), con
 * `ocupaciones` null mientras falte pedir su ficha (grupoSinDescribir).
 * @typedef {Omit<GrupoClasificado, 'ocupaciones'> & { ocupaciones: OcupacionEsco[] | null }} Grupo
 */
/**
 * La ocupación que decide la persona: el grupo, la ocupación ESCO (o ninguna), el grupo secundario y su origen.
 * @typedef {{ isco08: string, esco: string | null, isco08Secundario: string | null, origen: Origen | null }} Eleccion
 */
/**
 * El estado de la ocupación (estadoInicial explica cada campo).
 * @typedef {Object} EstadoOcupacion
 * @property {Fase} fase
 * @property {Motivo} motivo
 * @property {string} texto
 * @property {string} palabra
 * @property {number} preguntasHechas
 * @property {Clasificacion | null} clasificacion
 * @property {Grupo | null} grupo
 * @property {Grupo | null} secundario
 * @property {Origen | null} origen
 * @property {string} padre
 * @property {string} tituloPadre
 * @property {Eleccion | null} eleccion
 * @property {EstadoOcupacion | null} desde
 * @property {Instantanea[]} historial
 */
/**
 * Una fase estable guardada en el historial, sin el suyo ni su «desde».
 * @typedef {Omit<EstadoOcupacion, 'historial' | 'desde'>} Instantanea
 */
/**
 * Los datos de cada evento, por su tipo.
 * @typedef {Object} DatosDeLosEventos
 * @property {{ texto: string }} responder
 * @property {{ clasificacion: Clasificacion }} clasificado
 * @property {{}} fallo
 * @property {{ esco: string }} elegirOcupacion
 * @property {{}} soloGrupo
 * @property {{}} otraCosa
 * @property {{}} explorar
 * @property {{ codigo: string, titulo: string }} abrirGrupo
 * @property {{}} contarConPalabras
 * @property {{}} volver
 */
/**
 * El evento de tipo `Tipo`: { tipo, …datos }.
 * @template {keyof DatosDeLosEventos} Tipo
 * @typedef {{ tipo: Tipo } & DatosDeLosEventos[Tipo]} EventoDe
 */
/**
 * Cualquier evento de la máquina.
 * @typedef {{ [Tipo in keyof DatosDeLosEventos]: EventoDe<Tipo> }[keyof DatosDeLosEventos]} Evento
 */

/**
 * Desde estas fases, escribir en la barra es una respuesta nueva que se vuelve a clasificar.
 * @type {Set<Fase>}
 */
const FASES_QUE_ADMITEN_RESPUESTA = new Set([
  FASES.ESPERANDO,
  FASES.RESPONDIENDO,
  FASES.CONFIRMANDO,
  FASES.EXPLORANDO,
  FASES.RELATANDO,
]);
/**
 * Desde estas fases se puede pedir la clasificación oficial en lugar de seguir contestando.
 * @type {Set<Fase>}
 */
const FASES_QUE_ADMITEN_EXPLORAR = new Set([FASES.ESPERANDO, FASES.RESPONDIENDO, FASES.CONFIRMANDO]);

/**
 * La transición de cada tipo de evento. Sus funciones son declaraciones, que se elevan: pueden ir más abajo en el
 * archivo.
 * @type {{ [Tipo in keyof DatosDeLosEventos]: (estado: EstadoOcupacion, evento: EventoDe<Tipo>) => EstadoOcupacion }}
 */
const TRANSICIONES = Object.freeze({
  responder,
  clasificado,
  fallo,
  elegirOcupacion,
  soloGrupo,
  otraCosa,
  explorar,
  abrirGrupo,
  contarConPalabras,
  volver,
});

/**
 * El estado del principio: Faro acaba de saludar y espera la respuesta. `texto` es lo que se envía a clasificar;
 * `palabra`, cómo nombra la persona su trabajo (su primera respuesta); `desde`, la fase estable que había antes de
 * clasificar; `historial`, las fases estables anteriores para «Volver».
 * @returns {EstadoOcupacion}
 */
export function estadoInicial() {
  return {
    fase: FASES.ESPERANDO,
    motivo: MOTIVOS_DE_FASE.INICIO,
    texto: '',
    palabra: '',
    preguntasHechas: 0,
    clasificacion: null,
    grupo: null,
    secundario: null,
    origen: null,
    padre: RAIZ,
    tituloPadre: '',
    eleccion: null,
    desde: null,
    historial: [],
  };
}

/**
 * El estado sin su historial ni su «desde», para guardarlo en el historial sin anidar historiales.
 * @param {EstadoOcupacion} estado @returns {Instantanea}
 */
// `_historial` y `_desde` se extraen solo para quedar fuera de `resto`.
function instantanea({ historial: _historial, desde: _desde, ...resto }) {
  return resto;
}

/**
 * Pasa a una fase nueva y guarda la actual en el historial, para poder volver a ella.
 * @param {EstadoOcupacion} estado @param {Partial<EstadoOcupacion>} cambios @returns {EstadoOcupacion}
 */
function avanzarDesde(estado, cambios) {
  return {
    ...estado,
    ...cambios,
    desde: null,
    historial: [...estado.historial, instantanea(estado)],
  };
}

/**
 * Un grupo del que solo se sabe el código (y quizá el título): sus ocupaciones y sus marcas llegan con su ficha
 * (`ocupaciones: null` dice que falta pedirla).
 * @param {string} isco08 @param {string} titulo @returns {Grupo}
 */
function grupoSinDescribir(isco08, titulo) {
  return {
    isco08,
    titulo,
    cita: '',
    sinTareasOit: false,
    referenciasSubgrupo: false,
    sinReferencias: false,
    ocupaciones: null,
  };
}

/**
 * La pregunta abierta o la exploración oficial cuando se alcanza el límite.
 * @param {EstadoOcupacion} estado @returns {Partial<EstadoOcupacion>}
 */
function trasPregunta(estado) {
  if (estado.preguntasHechas >= MAX_PREGUNTAS) {
    return { fase: FASES.EXPLORANDO, motivo: MOTIVOS_DE_FASE.LIMITE, ...EN_LA_RAIZ };
  }
  return {
    fase: FASES.RESPONDIENDO,
    motivo: MOTIVOS_DE_FASE.CLASIFICACION,
    preguntasHechas: estado.preguntasHechas + 1,
  };
}

/**
 * La fase que corresponde a la decisión recibida, con sus datos.
 * @param {EstadoOcupacion} estado @param {Clasificacion} clasificacion @returns {Partial<EstadoOcupacion>}
 */
function faseDeLaDecision(estado, clasificacion) {
  const { decision, grupos, pregunta } = clasificacion;
  const grupo = grupos[0];
  if (decision === DECISIONES.CONFIRMAR && grupo !== undefined) {
    return {
      fase: FASES.CONFIRMANDO,
      motivo: MOTIVOS_DE_FASE.CLASIFICACION,
      grupo,
      secundario: null,
      origen: ORIGENES.IA,
    };
  }
  if (decision === DECISIONES.PREGUNTAR && pregunta?.texto) {
    return trasPregunta(estado);
  }
  return {
    fase: FASES.EXPLORANDO,
    motivo: MOTIVOS_DE_FASE.SIN_GRUPO,
    ...EN_LA_RAIZ,
  };
}

/**
 * La persona escribe: su respuesta se clasifica. En una pregunta abierta, se suma a lo que ya había contado.
 * @param {EstadoOcupacion} estado @param {DatosDeLosEventos['responder']} evento @returns {EstadoOcupacion}
 */
function responder(estado, { texto }) {
  if (!FASES_QUE_ADMITEN_RESPUESTA.has(estado.fase)) {
    return estado;
  }
  const suma = estado.fase === FASES.RESPONDIENDO;
  return {
    ...estado,
    fase: FASES.CLASIFICANDO,
    texto: suma ? `${estado.texto}${SEPARADOR_DE_RESPUESTAS}${texto}` : texto,
    palabra: suma ? estado.palabra : texto,
    desde: estado,
  };
}

/**
 * Sale de clasificando con `cambios`: la fase estable de antes de enviar pasa al historial, para poder volver.
 * @param {EstadoOcupacion} estado @param {Partial<EstadoOcupacion>} cambios @returns {EstadoOcupacion}
 */
function salirDeClasificar(estado, cambios) {
  const anterior = estado.desde;
  const historial = anterior ? [...anterior.historial, instantanea(anterior)] : estado.historial;
  return { ...estado, ...cambios, desde: null, historial };
}

/**
 * Llega la clasificación: la fase anterior pasa al historial y se entra en la que toca.
 * @param {EstadoOcupacion} estado @param {DatosDeLosEventos['clasificado']} evento @returns {EstadoOcupacion}
 */
function clasificado(estado, { clasificacion }) {
  if (estado.fase !== FASES.CLASIFICANDO) {
    return estado;
  }
  return salirDeClasificar(estado, { ...faseDeLaDecision(estado, clasificacion), clasificacion });
}

/**
 * La clasificación ha fallado o se ha cancelado: todo queda como antes de enviarla.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function deshacerClasificacion(estado) {
  if (!estado.desde) {
    return estado;
  }
  return { ...estado.desde, preguntasHechas: estado.preguntasHechas };
}

/**
 * La persona decide su ocupación: el grupo, la ocupación ESCO (o ninguna) y el grupo secundario, si lo hay.
 * @param {EstadoOcupacion} estado @param {string | null} esco @returns {EstadoOcupacion}
 */
function elegir(estado, esco) {
  if (!estado.grupo) {
    return estado;
  }
  const eleccion = {
    isco08: estado.grupo.isco08,
    esco,
    isco08Secundario: estado.secundario?.isco08 ?? null,
    origen: estado.origen,
  };
  return avanzarDesde(estado, { fase: FASES.ELEGIDA, motivo: MOTIVOS_DE_FASE.PETICION, eleccion });
}

/**
 * La persona elige una de las ocupaciones ESCO del grupo que confirma.
 * @param {EstadoOcupacion} estado @param {DatosDeLosEventos['elegirOcupacion']} evento @returns {EstadoOcupacion}
 */
function elegirOcupacion(estado, { esco }) {
  if (estado.fase !== FASES.CONFIRMANDO || !esco) {
    return estado;
  }
  return elegir(estado, esco);
}

/**
 * «Ninguna de estas, pero es este tipo de trabajo»: el grupo, sin ocupación ESCO.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function soloGrupo(estado) {
  if (estado.fase !== FASES.CONFIRMANDO) {
    return estado;
  }
  return elegir(estado, null);
}

/** «No, es otra cosa»: Faro vuelve a preguntar. @param {EstadoOcupacion} estado @returns {EstadoOcupacion} */
function otraCosa(estado) {
  if (estado.fase !== FASES.CONFIRMANDO) {
    return estado;
  }
  /** @type {Partial<EstadoOcupacion>} */
  const cambios = {
    fase: FASES.ESPERANDO,
    motivo: MOTIVOS_DE_FASE.OTRA_COSA,
    grupo: null,
    secundario: null,
  };
  return avanzarDesde(estado, cambios);
}

/**
 * La persona pide la clasificación oficial.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function explorar(estado) {
  if (!FASES_QUE_ADMITEN_EXPLORAR.has(estado.fase)) {
    return estado;
  }
  return avanzarDesde(estado, { fase: FASES.EXPLORANDO, motivo: MOTIVOS_DE_FASE.PETICION, ...EN_LA_RAIZ });
}

/**
 * Un paso más concreto en la jerarquía; con un grupo primario (4 cifras), se confirma ese grupo.
 * @param {EstadoOcupacion} estado @param {DatosDeLosEventos['abrirGrupo']} evento @returns {EstadoOcupacion}
 */
function abrirGrupo(estado, { codigo, titulo }) {
  if (estado.fase !== FASES.EXPLORANDO || !codigo.startsWith(estado.padre)) {
    return estado;
  }
  if (codigo.length < CIFRAS_GRUPO_PRIMARIO) {
    const cambios = { fase: FASES.EXPLORANDO, motivo: MOTIVOS_DE_FASE.JERARQUIA, padre: codigo, tituloPadre: titulo };
    return avanzarDesde(estado, cambios);
  }
  return avanzarDesde(estado, {
    fase: FASES.CONFIRMANDO,
    motivo: MOTIVOS_DE_FASE.JERARQUIA,
    grupo: grupoSinDescribir(codigo, titulo),
    secundario: null,
    origen: ORIGENES.JERARQUIA,
  });
}

/**
 * «Prefiero contártelo con mis palabras»: el relato libre.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function contarConPalabras(estado) {
  if (estado.fase !== FASES.EXPLORANDO) {
    return estado;
  }
  return avanzarDesde(estado, { fase: FASES.RELATANDO, motivo: MOTIVOS_DE_FASE.PETICION });
}

/**
 * Vuelve a la fase estable anterior. Las preguntas ya hechas siguen contando.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function volver(estado) {
  if (estado.fase === FASES.CLASIFICANDO) {
    return { ...deshacerClasificacion(estado), motivo: MOTIVOS_DE_FASE.VOLVER };
  }
  const anterior = estado.historial.at(-1);
  if (!anterior) {
    return estado;
  }
  return {
    ...anterior,
    motivo: MOTIVOS_DE_FASE.VOLVER,
    preguntasHechas: estado.preguntasHechas,
    desde: null,
    historial: estado.historial.slice(0, -1),
  };
}

/**
 * La clasificación ha fallado: todo queda como antes de enviarla.
 * @param {EstadoOcupacion} estado @returns {EstadoOcupacion}
 */
function fallo(estado) {
  return estado.fase === FASES.CLASIFICANDO ? deshacerClasificacion(estado) : estado;
}

/**
 * El estado que sigue a `estado` con `evento` ({ tipo, …datos }). Un evento que la fase no admite devuelve el mismo
 * estado (el mismo objeto): así quien lo usa sabe que no ha cambiado nada y no repinta ni repite llamadas.
 * @template {keyof DatosDeLosEventos} Tipo
 * @param {EstadoOcupacion} estado @param {EventoDe<Tipo>} evento @returns {EstadoOcupacion}
 */
export function avanzar(estado, evento) {
  if (!Object.hasOwn(TRANSICIONES, evento.tipo)) {
    return estado;
  }
  return TRANSICIONES[evento.tipo](estado, evento);
}
