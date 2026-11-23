// Tipos del motor de preguntas adaptativas del recorrido. Módulo puro: sin red, sin
// interfaz y determinista. Lo integra la web; aquí solo se decide qué preguntar y cuándo parar.

export type Idioma = 'es' | 'ca';

/** Una ocupación candidata tal como la devuelve el buscador (POST /api/clasificar → candidatas). */
export interface CandidataBusqueda {
  /** Código ESCO de la ocupación, si la candidata es una ocupación (y no solo un grupo). */
  readonly esco?: string;
  /** Grupo CIUO-08 de 4 cifras. */
  readonly isco08: string;
  /** Puntos del buscador (de 20 a 110 hoy): cuanto más, mejor. */
  readonly puntos: number;
  readonly titulo?: string;
  /** Título en catalán (el `titulo_ca` de /api/clasificar), para la pregunta «¿Cuál de estos es tu puesto?». */
  readonly tituloCa?: string;
  /**
   * Puntuación extra de otra rama para esta candidata (p. ej. los vectores), en la escala que se quiera:
   * se suma a los puntos multiplicada por `pesoExtra` (0 mientras no esté calibrada).
   */
  readonly extra?: number;
}

/**
 * Pista de sector del buscador (`PistaDeSector`, busqueda/contexto.ts): el texto nombra un lugar o una institución
 * («en la Generalitat») que hace más probables unos grupos. Se usa como verosimilitud blanda, nunca para descartar.
 */
export interface PistaSector {
  readonly sector: string;
  /** Prefijos CIUO-08 (1 a 4 cifras) que ese sector hace más probables. */
  readonly grupos: readonly string[];
  readonly palabra?: string;
}

/** Lo que la persona ha respondido: el id de la pregunta y el de la opción elegida (o NO_LO_SE). */
export interface Respuesta {
  readonly pregunta: string;
  readonly opcion: string;
}

export interface Entrada {
  readonly candidatas: readonly CandidataBusqueda[];
  readonly idioma: Idioma;
  readonly respuestas: readonly Respuesta[];
  readonly pistas?: readonly PistaSector[];
  /**
   * Clave de la palabra genérica del buscador ('tecnico', 'auxiliar'…; PALABRAS_GENERICAS): la primera pregunta
   * es «¿Técnico de qué?».
   */
  readonly necesitaPrecision?: string;
  /**
   * Previa explícita (la de la fusión): con ella el motor usa estas probabilidades tal cual, reparte `fondo` entre los
   * demás grupos según los ocupados (alfaFondo) y no aplica tau, alfa, pesoFondo, pesoExtra ni `pistas`.
   * `ocupaciones`, si llega, da P(o) dentro de cada grupo (se normaliza por grupo).
   */
  readonly previa?: PreviaExplicita;
  /**
   * Cómo se expresa la persona: 'f' si escribió en femenino («maestra»), 'm' en masculino. Si falta, el motor lo deduce
   * de `texto` (si llega) comparándolo con los títulos dobles de las candidatas («maestro/maestra»).
   */
  readonly genero?: 'f' | 'm';
  /** El texto ya limpio que escribió la persona (solo para deducir el género; no sale del dispositivo). */
  readonly texto?: string;
  /**
   * Área que nombra el texto sin decir el puesto («recursos humanos»), con sus ocupaciones (las da el léxico). La
   * primera pregunta es entonces «¿Qué haces sobre todo en recursos humanos?», con una opción por grupo del área (el
   * título llano de su ocupación) — y las ocupaciones del área entran como candidatas si no estaban.
   */
  readonly area?: AreaDeTexto;
  /** Grupos ya rechazados fuera del motor: bajan × factorRechazo (un «no» blando, nunca una exclusión). */
  readonly rechazados?: readonly string[];
  /**
   * Reserva para la última lista: los grupos que el clasificador ve más probables para el texto, en su orden.
   * No entran en la previa ni cambian las probabilidades: solo completan la última lista cuando ya no quedan grupos
   * probables que ofrecer.
   */
  readonly reserva?: readonly string[];
  /**
   * Si la reserva completa también las alternativas de una propuesta: solo sin la tabla de vectores, donde
   * la combinación es más débil y en la criba ayudó; con vectores no mostró ventaja.
   */
  readonly reservaEnAlternativas?: boolean;
  readonly configuracion?: Partial<Configuracion>;
}

/** El área del léxico (`ResultadoDeBusqueda.area`, src/busqueda/area.ts), con los títulos si se tienen. */
export interface AreaDeTexto {
  /** Cómo se nombra, para el enunciado («recursos humanos»); si falta, `texto`. */
  readonly nombre?: string;
  /**
   * Cómo se dice dónde o con quién, en cada idioma («en la hostelería», «con personas mayores»): el enunciado es
   * entonces «¿Qué haces sobre todo con personas mayores?». Sin ella, «… en {nombre}?».
   */
  readonly frase?: { readonly es: string; readonly ca: string };
  readonly texto?: string;
  /** Sus ocupaciones, de más a menos relacionadas (con `peso`, si lo trae el léxico). */
  readonly ocupaciones: readonly {
    readonly esco: string;
    readonly isco08: string;
    readonly titulo?: string;
    readonly tituloCa?: string;
    readonly peso?: number;
  }[];
  /** Sus grupos de más a menos relacionados; si falta, el orden de las ocupaciones. */
  readonly grupos?: readonly { readonly isco08: string; readonly peso?: number }[];
}

export interface PreviaExplicita {
  readonly grupos: readonly { readonly isco08: string; readonly p: number }[];
  /** Masa de los grupos que no están en `grupos`. */
  readonly fondo: number;
  readonly ocupaciones?: readonly { readonly esco: string; readonly isco08: string; readonly p: number }[];
}

export interface Configuracion {
  /** Tope de preguntas. */
  readonly maxPreguntas: number;
  /** Con esta probabilidad el motor PROPONE «¿Tu ocupación es X?» (la persona confirma o rechaza). */
  readonly umbralProponer: number;
  /** Lo mismo cuando aún no ha preguntado nada (más alto: sin preguntas solo propone si está muy claro). */
  readonly umbralProponerSinPreguntas: number;
  /**
   * Si llega, el umbral de proponer cuando el 2.º grupo está por debajo de `rivalCercano`: la prudencia de
   * `umbralProponer` solo hace falta con un rival cerca, que es cuando un «Sí» por error acaba en el grupo de al lado.
   */
  readonly umbralProponerSinRival?: number;
  /** Probabilidad del 2.º grupo desde la que cuenta como rival cercano (con `umbralProponerSinRival`). */
  readonly rivalCercano?: number;
  /**
   * Con esta probabilidad AFIRMA sin pedir confirmación. Por defecto, nunca (2): todo lo que se da por bueno lo
   * confirma la persona.
   */
  readonly umbralAfirmar: number;
  /** Propuestas que puede rechazar la persona antes de pasar a «No encuentro la mía». */
  readonly maxPropuestas: number;
  /** Lo que se multiplica la probabilidad de una propuesta rechazada (no se descarta del todo: la persona pudo errar). */
  readonly factorRechazo: number;
  /**
   * Con el grupo ya claro, se pregunta «¿Cuál de estos es tu puesto?» si la primera ocupación del grupo no llega a esta
   * probabilidad dentro de él (0: nunca; con la propuesta y sus alternativas suele bastar).
   */
  readonly umbralOcupacion: number;
  /** Probabilidad de que la persona se equivoque al responder (verosimilitud blanda). */
  readonly error: number;
  /** Temperatura de los puntos del buscador: P(g) ∝ exp(puntos / tau) · ocupados^alfa. */
  readonly tau: number;
  readonly alfa: number;
  /** Peso de los grupos que el buscador no propuso (para que las preguntas puedan recuperarlos). */
  readonly pesoFondo: number;
  /** Exponente de los ocupados al repartir la masa del fondo entre sus grupos. */
  readonly alfaFondo: number;
  /** Peso de `extra` de cada candidata: puntos efectivos = puntos + pesoExtra · extra. */
  readonly pesoExtra: number;
  /** Probabilidad mínima de un grupo para ser opción de una pregunta (nada de opciones residuales). */
  readonly pMinimaOpcion: number;
  /** Probabilidad mínima para proponer algo; por debajo, «No encuentro la mía» (nada de propuestas residuales). */
  readonly pMinimaPropuesta: number;
  /** Ganancia mínima (bits) para que merezca la pena preguntar. */
  readonly gananciaMinima: number;
}

export type TipoPregunta =
  | 'precision'
  | 'nivel1'
  | 'nivel2'
  | 'nivel3'
  | 'tarea'
  | 'trato'
  | 'campo'
  | 'universidad'
  | 'cuenta_propia'
  | 'ocupacion'
  | 'grupo'
  | 'area';

export interface Opcion {
  readonly id: string;
  readonly texto: string;
}

/** Una pregunta lista para enseñar: siempre de respuesta cerrada y con «No lo sé» como última opción. */
export interface Pregunta {
  /** Identificador estable: con él y la opción se reconstruye la respuesta (el motor no guarda estado). */
  readonly id: string;
  readonly tipo: TipoPregunta;
  readonly texto: string;
  readonly opciones: readonly Opcion[];
  /** Texto del enlace «Prefiero buscarla yo», que la interfaz enseña siempre. */
  readonly buscarYo: string;
}

export interface Hipotesis {
  /** Grupo CIUO-08 de 4 cifras (su título y sus tareas están en el paquete: datos/clasificaciones.json y oit.json). */
  readonly grupo: string;
  readonly confianza: number;
  /** La ocupación ESCO del buscador con más puntos dentro del grupo, si la hay. */
  readonly ocupacion?: { readonly esco: string; readonly titulo?: string; readonly tituloCa?: string };
}

export interface OcupacionProbable {
  readonly esco: string;
  readonly grupo: string;
  readonly titulo?: string;
  readonly confianza: number;
}

export type MotivoClasico = 'confianza' | 'tope' | 'sin_preguntas';
export type MotivoDeResultado = MotivoClasico | 'confirmada' | 'confirmada_grupo' | 'no_encontrada';

/** Una alternativa debajo de la propuesta: la persona puede elegirla directamente. */
interface AlternativaDePropuesta {
  /** Lo que se responde al elegirla: `alt:<grupo>:<esco>` (esco vacío si es solo un grupo). */
  readonly id: string;
  readonly texto: string;
  readonly hipotesis: Hipotesis;
}

/** «¿Tu ocupación es X?» con «Sí, es esta», «Se parece, pero no», «No» y 2 alternativas. */
export interface PasoPropuesta {
  readonly tipo: 'propuesta';
  /** Identificador para la respuesta (como el de una pregunta): `propuesta:<grupo>:<esco>`. */
  readonly id: string;
  readonly texto: string;
  readonly propuesta: Hipotesis;
  /** si · parecida (solo si se propone una ocupación) · no. */
  readonly opciones: readonly Opcion[];
  readonly alternativas: readonly AlternativaDePropuesta[];
  /** Número de esta propuesta (1 o 2) y tope. */
  readonly numero: number;
  readonly maximo: number;
  readonly preguntasHechas: number;
  readonly buscarYo: string;
}

export interface PasoPregunta {
  readonly tipo: 'pregunta';
  readonly pregunta: Pregunta;
  /** Número de esta pregunta (1, 2…) y tope, para el contador «Pregunta 2 (como mucho 5)». */
  readonly numero: number;
  readonly maximo: number;
  readonly provisional: readonly Hipotesis[];
}

export interface PasoResultado<M extends MotivoDeResultado = MotivoDeResultado> {
  readonly tipo: 'resultado';
  readonly mejor: Hipotesis;
  readonly alternativas: readonly Hipotesis[];
  /** Las ocupaciones más probables (hasta 5): P(grupo) · P(ocupación | grupo), con los puntos del buscador. */
  readonly ocupaciones: readonly OcupacionProbable[];
  readonly preguntasHechas: number;
  /**
   * El motivo: confianza (llegó al umbral), tope o sin_preguntas (nada útil que preguntar) y, con propuestas,
   * confirmada («Sí, es esta» o una alternativa), confirmada_grupo («Se
   * parece, pero no»: vale el grupo), confianza (afirmada sin confirmar: solo si umbralAfirmar lo permite) o
   * no_encontrada (rechazó todas las propuestas: la interfaz abre «No encuentro la mía»).
   */
  readonly motivo: M;
  /** Propuestas rechazadas por el camino. */
  readonly rechazos: number;
}

/** Lo que devuelve siguientePasoConPropuestas. */
export type Paso = PasoPregunta | PasoPropuesta | PasoResultado;

/** Datos de un grupo CIUO-08 en atributos.json (lo genera herramientas/generar-atributos.ts). */
interface AtributosGrupo {
  /** Ocupados estimados en Cataluña (Censo 2021). */
  readonly pr: number;
  /** Proporción de ocupados con estudios universitarios (Censo 2021). */
  readonly un?: number;
  /** Proporción de ocupados por cuenta propia (Censo 2021). */
  readonly cp?: number;
  /** Reparto de las competencias esenciales de ESCO: [personas, información, manos o máquinas]. */
  readonly tr?: readonly number[];
  /** Reparto de los conocimientos esenciales de ESCO por campo ISCED-F amplio. */
  readonly cm?: Readonly<Record<string, number>>;
  /** Tareas características (ids de la OIT). */
  readonly ta: readonly string[];
}

interface AtributosTarea {
  readonly es: string;
  readonly ca: string;
  /** Otros grupos con una tarea parecida y cuánto (0-1). */
  readonly ve: readonly (readonly [string, number])[];
}

export interface Atributos {
  readonly version: number;
  readonly fuentes: Readonly<Record<string, string>>;
  readonly grupos: Readonly<Record<string, AtributosGrupo>>;
  readonly tareas: Readonly<Record<string, AtributosTarea>>;
  readonly etiquetas3: Readonly<Record<string, { readonly es: string; readonly ca: string }>>;
  /** Títulos oficiales de los grupos de 4 cifras (CIUO-08; en catalán, Idescat), para la propuesta. */
  readonly etiquetas4: Readonly<Record<string, { readonly es: string; readonly ca: string }>>;
}
