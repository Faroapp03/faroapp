// Contrato del informe serializado: tareas, contexto, aprendizaje y procedencia de cada dato.
// Su versión es independiente de la versión del contrato de la API REST.

import type { CitilabDelInforme } from '../../compartido/contratos/tipos-citilab.ts';
import type {
  DestinatariosCurso,
  FormacionRelacionada,
  FormacionTransversal,
  MomentoCurso,
} from '../../compartido/contratos/tipos-formacion.ts';
import type { FormacionAbierta } from '../../compartido/contratos/tipos-formacion-abierta.ts';
import type { Idioma, IdiomaDeDato } from '../comun/idioma.ts';
import type { MarcaIa } from './marca-ia.ts';
import type { BloqueAcreditacion } from './tipos-acreditacion.ts';
import type {
  OcupadosEnLaZona,
  PerfilDelGrupo,
  SalarioPorEstudios,
  UsoDeclaradoDeLaIa,
  VariacionOcupados,
} from './tipos-contexto.ts';
import type { Tiempo } from './tipos-entrada.ts';
import type { FrenteAlConjunto, InformacionAdicional } from './tipos-frente-al-conjunto.ts';
import type { NecesidadesDeLaOcupacion } from './tipos-necesidades.ts';
import type { ProvinciasDeLaOcupacion } from './tipos-provincias.ts';

/** Franja de cambio de una tarea según su nota (dominio/franjas.ts). */
export type Franja = 'alta' | 'media' | 'baja';

/** Nivel de la fuente de cada dato que ve la persona. */
export type Evidencia =
  | 'dato-publicado' // publicado por un organismo: censo, contratos, tabla oficial de la OIT
  | 'estimacion-oit' // nota por tarea de la OIT (datos complementarios del autor, con su margen)
  | 'estimacion-faro' // valoración de Faro con la rúbrica de la OIT, con su margen (medido o provisional)
  | 'dato-persona' // lo que ha dicho o elegido la persona
  | 'sugerencia' // propuesta de Faro; no es un dato
  | 'insuficiente'; // no hay nota publicada ni estimación: se dice, no se rellena

/**
 * Competencia ESCO de una tarea y su relación con la ocupación. «sin-ocupacion»: la persona confirmó un grupo sin
 * ocupación ESCO, así que no se sabe si la competencia es esencial u opcional en su ocupación.
 */
export interface Competencia {
  uri: string;
  titulo: string;
  relacion: 'esencial' | 'opcional' | 'propuesta-faro' | 'sin-ocupacion';
  /** Orientación editorial disponible para tareas del grupo, sin enlace específico a la ocupación elegida. */
  alcance?: 'grupo';
}

/** Tarea tal como aparece en el informe: con su nota, su margen, su fuente y sus competencias. */
export interface TareaInforme {
  id: string;
  nombre: string;
  texto: string;
  tiempo: Tiempo;
  /** Peso relativo del tiempo declarado: mucho = 3, algo = 2 y poco = 1 (franjas.ts). */
  peso: number;
  /** null: información insuficiente (sin nota publicada ni estimación). La tarea aparece igualmente. */
  valor: number | null;
  /** Solo con valor null tras descartar una estimación interna inválida; se omite en las demás tareas sin nota. */
  motivoSinNota?: 'estimacion-no-disponible';
  margen: [number, number] | null;
  franja: Franja | null;
  /** Franjas que abarca el rango descriptivo. No es una probabilidad ni una nueva estimación. */
  franjasPosibles?: Franja[];
  evidencia: Evidencia;
  /** Estimación de Faro cuyas repeticiones difirieron mucho (se muestra con su rango). */
  incierta: boolean;
  origenValor: string;
  /** La nota es un valor fijo del caso de la página de ejemplo, no una estimación calculada por Faro. */
  ejemplo?: true;
  referencia: { tareaOit: string; isco08: string; ocupacion: string; relacion: 'propia' | 'equivalente' } | null;
  iaPodria: string | null;
  loTuyo: string | null;
  /**
   * «La IA podría» y «Lo tuyo» los ha redactado la IA (estimaciones de Faro y textos oficiales redactados con IA).
   */
  textosIa: boolean;
  competencias: Competencia[];
}

/** Una conclusión del informe, con el nivel de su evidencia. */
export interface Hallazgo {
  titulo: string;
  texto: string;
  evidencia: Evidencia;
  detalle: string;
}

/**
 * Grupo del censo. `amplio`: el organismo no publica el grupo de 3 cifras de la ocupación y se da el de 2 (por
 * ejemplo, bomberos). Las personas y las mujeres son del último año del censo anual del Idescat o, sin él, del Censo
 * 2021 del INE; la edad, siempre del Censo 2021.
 */
export interface GrupoOcupados {
  cno11: string;
  grupo: string;
  amplio: boolean;
  /** Quién publica la cifra y a 1 de enero de qué año. */
  organismo: 'Idescat' | 'INE';
  anio: string;
  personas: number;
  pctMujeres: number | null;
  pctMenores30: number | null;
  pct55: number | null;
  /** Variación en Cataluña entre los dos últimos años comparables; null si no se da. */
  variacion: VariacionOcupados | null;
}

/** Personas contratadas en 12 meses; `variacion` es null si son tan pocas que el porcentaje no significaría nada. */
export interface GrupoContratacion {
  cno11: string;
  grupo: string;
  personas: number;
  anterior: number | null;
  variacion: number | null;
  pctIndefinidos: number | null;
}

/**
 * La ocupación en Cataluña: personas ocupadas (también en la comarca del Baix Llobregat) y contratadas, quién hace un
 * trabajo como el tuyo y la diferencia de exposición por género.
 */
export interface Contexto {
  /**
   * Si la ocupación se reparte entre varios grupos de la estadística, están todos: nunca se elige uno por la persona.
   */
  ocupados: GrupoOcupados[];
  contratacion: GrupoContratacion[];
  /** El periodo de las cifras de contratación (cataluna.json), como lo publica la fuente; null sin cifras. */
  periodo: string | null;
  /** La variación (%) de las personas ocupadas de toda Cataluña entre los dos años comparados; null sin ella. */
  variacionConjunto: number | null;
  /** La diferencia de exposición por género de la ocupación, con su fuente (Cambra de Comerç). */
  genero: { mujeres: number; hombres: number; fuente: string };
  /** Por qué el contexto va sin cifras (texto para la persona); null si las trae. */
  pendiente: string | null;
  /** Las mismas personas ocupadas en la comarca del Baix Llobregat, siempre debajo de Cataluña. */
  zona: OcupadosEnLaZona[];
  /** Quién hace un trabajo como el tuyo, grupo a grupo (Censo 2021). */
  perfil: PerfilDelGrupo[];
  /** Salario medio por estudios del gran grupo; solo con un único grupo del censo, que decide qué se compara. */
  salario: SalarioPorEstudios | null;
  /** Cómo se cuenta la ocupación en el censo, dicho una vez; null si el informe no da ninguna cifra del censo. */
  avisoCenso: string | null;
  /** Dónde se firman los contratos del grupo, por provincia; null si no se enseña (dominio/provincias.ts). */
  provincias: ProvinciasDeLaOcupacion | null;
  /** El grupo del censo frente a todas las ocupaciones de Cataluña; null con varios grupos o sin datos. */
  frente: FrenteAlConjunto | null;
  /** Demandantes, contratos y salario por antigüedad; null si no se enseña ninguna parte. */
  adicional: InformacionAdicional | null;
}

/** Camino que propone el informe, apoyado en unas tareas y sus competencias. */
export interface Camino {
  tipo: 'mas-cambia' | 'sigue-siendo-tuyo';
  titulo: string;
  porque: string;
  tareas: string[];
  competencias: Competencia[];
}

/** Cómo confirmó la persona su ocupación, dicho en el informe («Grupo 7512 · …, confirmado por ti a partir de…»). */
export interface ConfirmacionOcupacion {
  texto: string;
  /** Su palabra, limpia de datos personales, o null si no la dio. */
  palabra: string | null;
  /** El segundo grupo, si hace las dos cosas. */
  secundario: { isco08: string; tituloIsco: string } | null;
  /** Solo si el grupo lo propuso la IA de Faro y la persona lo confirmó. */
  propuestoPorIa?: true;
}

/** Un texto de los datos que un informe traducido muestra en su idioma original, porque no tiene traducción. */
export interface TextoSinTraducir {
  texto: string;
  idioma: IdiomaDeDato;
}

/** Propuesta de Faro, editable y sin diagnóstico de carencias personales. */
export interface ObjetivoPropuesto {
  id: string;
  huella: string;
  tarea: { id: string; texto: string; referencia: string | null };
  grupo: string;
  /** Ámbitos de los que puede elegir formación: su grupo y, en el uso crítico de IA, el bloque transversal. */
  ambitos: string[];
  tipo: 'profesional' | 'ia';
  titulo: string;
  competencias: Competencia[];
}

/**
 * De dónde sale una opción: el catálogo del SEPE, un curso del SOC, una edición del Consorci, un curso de Citilab o un
 * curso de la formación abierta en línea.
 */
type FuenteOpcion = 'sepe' | 'soc' | 'consorci' | 'citilab' | 'abierta';

/** Opción para explorar, con coste desconocido explícito y sin adecuación pedagógica acreditada. */
export interface OpcionAprendizaje {
  id: string;
  grupo: string;
  tipo: 'especialidad' | 'curso';
  fuente: FuenteOpcion;
  nombre: string;
  idioma: Idioma;
  /**
   * La página del curso o el programa de la especialidad. Null en una edición del Consorci, que no tiene página propia:
   * la inscripción se hace con la entidad (`web`, `correo`, `telefono`) o, si no publica su contacto, `contactoOficial`.
   */
  enlace: string | null;
  modalidad: string;
  horas: string;
  municipio: string | null;
  centro: string | null;
  inicio: string | null;
  fin: string | null;
  coste: number | null;
  relacion: string;
  adecuacion: 'sin-verificar';
  inscripcion: 'sin-verificar' | 'no-aplica';
  /** Un curso: su momento el día del informe (vigencia-cursos.ts). Una especialidad no es una convocatoria: null. */
  momento: MomentoCurso | null;
  /** Un curso: a quién se dirige, si la fuente lo publica. Null si no consta o es una especialidad. */
  destinatarios: DestinatariosCurso | null;
  /** Un curso: la fecha (AAAA-MM-DD) de la copia de la que salen sus datos. Null en una especialidad. */
  comprobado: string | null;
  /**
   * Una edición del Consorci: si se sigue a distancia (teleformación o aula virtual), y entonces el municipio es el de
   * la entidad. Null si la fuente no lo dice.
   */
  aDistancia: boolean | null;
  /** Una edición del Consorci: el contacto de la entidad, con la que se hace la inscripción. Null si no consta. */
  web: string | null;
  correo: string | null;
  telefono: string | null;
  /** Solo en una edición de una entidad que es una persona física, sin contacto: la página de contacto del Consorci. */
  contactoOficial?: string;
  /**
   * Una especialidad, con el Consorci en el paquete: cuántas entidades suelen ofrecerla (acciones previstas, sin fecha)
   * y cuántas ediciones suyas están programadas sin fecha todavía. Null en una convocatoria o sin el Consorci.
   */
  entidadesQueLaOfrecen: number | null;
  edicionesSinFecha: number | null;
}

/** Datos públicos que acompañan al informe; las decisiones personales permanecen en el navegador. */
export interface CatalogoAprendizaje {
  version: 3;
  idioma: Idioma;
  fecha: string;
  fechaCursos: string | null;
  objetivos: ObjetivoPropuesto[];
  opciones: OpcionAprendizaje[];
  fuentes: { texto: string; idioma: IdiomaDeDato }[];
}

/** La versión del contrato del informe: cambia cuando cambia su forma. */
export const VERSION_INFORME = 2 as const;

/** El informe completo que recibe la persona. */
export interface Informe {
  version: typeof VERSION_INFORME;
  /** Solo si el informe no está en castellano: su idioma. Sin él, el informe está en castellano. */
  idioma?: Exclude<Idioma, 'es'>;
  fecha: string;
  ocupacion: {
    /** null si la persona confirmó el grupo sin afinar con una ocupación ESCO. */
    esco: string | null;
    /** El título de la ocupación ESCO o, sin ella, el del grupo. */
    titulo: string;
    isco08: string;
    tituloIsco: string;
    /** Media de exposición del grupo publicada por la OIT; null si no consta. */
    media: number | null;
    /** Código de gradiente publicado por la OIT; null si no consta. */
    gradiente: string | null;
    /** Rótulo del gradiente en el idioma del informe, o aviso de ausencia de nota publicada. */
    nivel: string;
    posicion: { masAltas: number; total: number } | null;
    /**
     * Cómo la confirmó la persona. Solo aparece sin ocupación ESCO, con su palabra, con un segundo grupo o si el grupo
     * lo propuso la IA. Sin esas condiciones, el título ESCO basta para identificar la ocupación.
     */
    confirmada?: ConfirmacionOcupacion;
  };
  tareas: TareaInforme[];
  /**
   * Solo si el informe se ha hecho sin la IA de Faro: el apartado de tareas lo dice, y el método no habla de lo que la
   * IA no ha hecho. `tareasPropias`: las que escribió la persona, que quedan sin datos.
   */
  sinIa?: { tareasPropias: number };
  /** Reparto del tiempo en % (pasos de 5). «sinDatos»: tiempo en tareas con información insuficiente. */
  semana: { alta: number; media: number; baja: number; sinDatos: number; pesoTotal: number };
  hallazgos: Hallazgo[];
  contexto: Contexto;
  caminos: Camino[];
  aprendizaje: CatalogoAprendizaje;
  plan: { cuando: string; paso: string; detalle: string }[];
  /** Formación oficial relacionada con su ocupación (SEPE y SOC). null si el paquete de datos no la trae. */
  formacion: FormacionRelacionada | null;
  /**
   * Formación digital transversal para usar la IA con criterio, la misma para todas las ocupaciones
   * (formacion-transversal.ts). null si el paquete de datos no trae la formación.
   */
  formacionTransversal: FormacionTransversal | null;
  /** Uso declarado de la IA en el grupo de la persona, en un bloque propio, nunca junto a la nota. */
  usoDeclaradoIa: UsoDeclaradoDeLaIa | null;
  /**
   * Lo que se pide en su ocupación: las fichas de necesidades formativas del SEPE de las ocupaciones CNO-11 de su grupo
   * (necesidades-formativas.ts). Solo si el paquete las trae y alguna corresponde al grupo.
   */
  necesidades?: NecesidadesDeLaOcupacion[];
  /**
   * «Acreditar lo que ya sabes hacer» (acreditacion.ts): el mismo para todas las personas con su ocupación. Solo si el
   * paquete trae la acreditación.
   */
  acreditacion?: BloqueAcreditacion;
  /** Cursos de Citilab en Cornellà (formacion-citilab.ts). Solo si el paquete los trae y alguno se enseña. */
  citilab?: CitilabDelInforme;
  /**
   * Formación abierta en línea (formacion-abierta.ts). Solo si la configuración la enciende y alguna ficha está
   * vigente. Con la configuración apagada, el campo se omite.
   */
  formacionAbierta?: FormacionAbierta;
  /** La ficha de su ocupación en el Catàleg d'ocupacions de Barcelona Activa, si su código ESCO tiene una sola. */
  fichaBarcelonaActiva?: string;
  fuentes: { texto: string; nivel: 'oficial' | 'complementaria' | 'faro' }[];
  limites: string[];
  avisos: string[];
  /**
   * Solo en un informe traducido: los datos oficiales que se muestran en su idioma original porque Faro no los ha
   * traducido (o no los traduce, como los títulos de la CNO-11). El HTML los marca con su `lang`.
   */
  sinTraducir?: TextoSinTraducir[];
  /**
   * Marca legible por máquina de lo que escribió la IA (dominio/marca-ia.ts, Reglamento europeo de IA, art. 50.2): qué
   * campos, con qué modo y qué modelo, y de dónde sale lo demás. construirInforme la incluye; un informe guardado
   * puede no llevarla.
   */
  marcaIa?: MarcaIa;
  /**
   * Solo si el motor de cursos no estaba (ausente, averiado o bloqueado) al hacer el informe: el informe sale sin
   * formación, con esta marca y sin el aviso de que no hay formación (avisosInforme, en dominio/fuentes-y-avisos.ts).
   * El resto del informe es el mismo.
   */
  formacionNoDisponible?: true;
}

/** La formación de fuera del catálogo oficial del informe: sus dos campos opcionales. */
export type OtraFormacion = Pick<Informe, 'citilab' | 'formacionAbierta'>;
