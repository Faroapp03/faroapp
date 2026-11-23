// Contratos de la formación oficial del paquete y del informe: EURES, SEPE, SOC, Consorci y ACTIC.
// Las reglas de selección y vigencia dependen de estos tipos; los contratos no importan esas reglas.

import type { Idioma } from './idioma.ts';
import type { Correspondencia, CorrespondenciasEures } from './tipos-eures.ts';

export type { Correspondencia } from './tipos-eures.ts';

/**
 * Momento de un curso el día de la consulta, decidido por sus fechas: «por-iniciar», su inicio es posterior;
 * «iniciado», su inicio ya llegó; «sin-fecha», la copia no da su inicio. Los terminados quedan fuera de la oferta.
 * Estas marcas no comprueban plazas ni inscripción; con fin desconocido tampoco acreditan que el curso siga activo.
 */
export type MomentoCurso = 'por-iniciar' | 'iniciado' | 'sin-fecha';

/**
 * A quién se dirige un curso, según lo publica su fuente: «en-busqueda-de-empleo», sobre todo a personas en búsqueda
 * de empleo, como la formación ocupacional del SOC;
 * «personas-ocupadas», sobre todo a personas que trabajan, como los cursos del Consorci, que guardan un porcentaje
 * de plazas para personas en paro.
 */
export type DestinatariosCurso = 'en-busqueda-de-empleo' | 'personas-ocupadas';

/** Formación oficial del paquete de datos: correspondencias EURES, especialidades del SEPE y cursos del SOC. */
export interface DatosFormacion {
  fuentes: { sepe: string; soc: string; eures: string };
  /** Fecha (AAAA-MM-DD) de la copia de los cursos del SOC. */
  fecha_cursos: string;
  /** Cuántas ocupaciones o especialidades cubre cada correspondencia, por clave de la fuente (EURES, SEPE, SOC). */
  cobertura: Record<string, number>;
  ocupaciones: CorrespondenciasEures;
  especialidades: Record<string, EspecialidadSepeOficial>;
  cursos: CursoSocOficial[];
}

/** Una especialidad formativa del SEPE tal como la trae el paquete. */
interface EspecialidadSepeOficial {
  nombre: string;
  nivel: string;
  /** Duración en horas, como texto tal cual la publica la fuente. */
  horas: string;
  familia: string;
  modalidad: string;
  /** Códigos de las ocupaciones con que se relaciona. */
  ocupaciones: string[];
  /** Dirección de su ficha oficial. */
  ficha: string;
}

/** Un curso del SOC tal como lo trae el paquete. */
interface CursoSocOficial {
  id: string;
  nombre: string;
  /** Códigos de las especialidades del SEPE que imparte. */
  especialidades: string[];
  modalidad: string;
  municipio: string;
  /** Fecha (AAAA-MM-DD) de inicio, o null si la copia no la da. */
  inicio: string | null;
  /** Fecha (AAAA-MM-DD) de fin, o null si la copia no la da. */
  fin: string | null;
  /** Duración en horas, como texto tal cual la publica la fuente. */
  horas: string;
  /** Etiqueta de estado del SOC, tal como la publica. No decide nada: marca «en inscripción» cursos empezados. */
  estado: string;
  centro: string;
  /** Dirección oficial del curso. */
  enlace: string;
  /** Solo si la fuente publica a quién se dirige el curso. */
  destinatarios?: DestinatariosCurso | null;
}

/** Una edición del Consorci tal como la trae el paquete de datos. */
export interface EdicionConsorciOficial {
  id: string;
  /** Nombre del curso, en catalán; en un módulo de certificado, el del módulo. */
  nombre: string;
  /** Certificado de profesionalidad y módulo, si la edición es un módulo de certificado. */
  certificado: string | null;
  modulo: string | null;
  /** Código de la especialidad, el del catálogo del SEPE si está en él. */
  especialidad: string;
  modalidad: string;
  /** Teleformación o aula virtual: entonces el municipio es el de la entidad, no el de las clases. */
  a_distancia: boolean;
  municipio: string;
  inicio: string;
  fin: string;
  horas: string;
  /** Nombre de la entidad; null si es una persona física. */
  entidad: string | null;
  web: string | null;
  /** Solo buzones de la entidad y teléfonos fijos: lo que puede ser de una persona no llega al paquete. */
  correo: string | null;
  telefono: string | null;
  /** Solo si la entidad es una persona física, que no da contacto: la página de contacto del Consorci. */
  contacto_oficial: string | null;
}

/** Una acción prevista del Consorci: una entidad suele ofrecer esta especialidad, todavía sin fecha. */
interface AccionPrevistaOficial {
  /** Identificador de la entidad en `DatosConsorci.entidades`. */
  entidad: string;
  modalidad: string;
  horas: string;
}

/** Una entidad de formación del Consorci, con el contacto con que se inscribe la persona. */
export interface EntidadConsorciOficial {
  /** null si la entidad es una persona física: su nombre no se publica. */
  entidad: string | null;
  municipio: string;
  web: string | null;
  correo: string | null;
  telefono: string | null;
  /** Solo si la entidad es una persona física, que no da contacto: la página de contacto del Consorci. */
  contacto_oficial: string | null;
}

/**
 * Cursos gratuitos del Consorci para personas que trabajan: una copia diaria de sus ediciones con fecha y de las
 * acciones que sus entidades suelen ofrecer, sin fecha.
 */
export interface DatosConsorci {
  /** Cita que pide la licencia: la fuente y la fecha de la última actualización. */
  fuente: string;
  /** Fecha (AAAA-MM-DD) de la copia: la de su descarga. */
  fecha_copia: string;
  /** Fecha (AAAA-MM-DD) de la última actualización de los conjuntos, según sus metadatos. */
  actualizado: string;
  /** Buscador oficial de cursos del Consorci. */
  buscador: string;
  ediciones: EdicionConsorciOficial[];
  /** Por código de especialidad, su nombre en catalán y las acciones previstas de las entidades que la ofrecen. */
  previstas: Record<string, { nombre: string; acciones: AccionPrevistaOficial[] }>;
  entidades: Record<string, EntidadConsorciOficial>;
  /** Por código de especialidad, cuántas ediciones de este curso están programadas pero aún sin fecha. */
  programadas_sin_fecha: Record<string, number>;
}

/** Con quién se inscribe la persona en una edición del Consorci: la entidad que la imparte. */
export type ContactoEntidad = Pick<
  EntidadConsorciOficial,
  'entidad' | 'web' | 'correo' | 'telefono' | 'contacto_oficial'
>;

/** Las especialidades del SEPE cuyo programa en PDF se ha comprobado que responde. */
export interface ProgramasSepe {
  /** Fecha (AAAA-MM-DD) de la comprobación más antigua de los PDF enlazados. */
  comprobado: string;
  /** Cuántas especialidades tiene el catálogo del paquete. */
  candidatas: number;
  /** Las especialidades cuyo PDF respondió como un PDF, en orden. */
  codigos: string[];
}

/**
 * Un enlace que el informe no enseña, con la evidencia que lo justifica: su dirección dio un 404 o un 410 en la última
 * observación concluyente. Una observación posterior que responda lo saca de la lista.
 */
export interface EnlaceOculto {
  /** La dirección que se pidió. */
  url: string;
  /** El código recibido (404 o 410); null en lo que el paquete anterior ocultaba y aún no se ha vuelto a consultar. */
  codigo_http: number | null;
  /** Instante (UTC, ISO 8601) de la observación, o de la comprobación anterior si aún no hay consulta propia. */
  observado_el: string;
  /** Dónde terminó la consulta tras las redirecciones. */
  url_final: string | null;
  /** El identificador del curso, solo en los cursos del SOC. */
  id?: string;
}

/** Las webs de las entidades del Consorci: las que el informe no enseña porque su dirección no existe. */
export interface WebsComprobadas {
  /** Fecha (AAAA-MM-DD) de la observación más reciente. */
  comprobado: string;
  /** Cuántas webs distintas se comprueban. */
  candidatas: number;
  /** Las webs con evidencia vigente de que no existen, en orden de dirección: no se enseñan. */
  ocultas: EnlaceOculto[];
}

/** Las fichas del SOC de los cursos de la copia: las que el informe no enseña porque su dirección no existe. */
export interface CursosComprobados {
  /** Fecha (AAAA-MM-DD) de la observación más reciente. */
  comprobado: string;
  /** Cuántos cursos se comprueban. */
  candidatos: number;
  /** Los cursos con evidencia vigente de que su ficha no existe, en orden de identificador: no se enseñan. */
  ocultos: EnlaceOculto[];
}

/**
 * Observaciones de los enlaces del paquete: qué programas del SEPE responden como un PDF y qué webs y fichas de cursos
 * tienen evidencia vigente de no existir.
 */
export interface EnlacesComprobados {
  version: 2;
  programas: ProgramasSepe;
  webs: WebsComprobadas;
  cursos: CursosComprobados;
}

/**
 * La forma del registro sin versión: lista las webs rotas y los cursos fuera de la oferta de una comprobación sin
 * guardar el código ni la fecha de cada enlace. Se sigue aplicando mientras el paquete publicado sea de esta forma.
 */
export interface EnlacesComprobadosAnteriores {
  programas: ProgramasSepe;
  webs: { comprobado: string; candidatas: number; rotas: string[]; sin_respuesta: string[] };
  cursos: { comprobado: string; candidatos: number; fuera_de_la_oferta: string[] };
}

/** El programa oficial de una especialidad: su PDF y el día en que se comprobó que responde. */
export interface ProgramaOficial {
  enlace: string;
  comprobado: string;
}

/** Especialidad formativa que se muestra en el informe, con cómo se relaciona con la ocupación. */
export interface EspecialidadRelacionada {
  codigo: string;
  nombre: string;
  nivel: string;
  horas: string;
  familia: string;
  modalidad: string;
  /**
   * Su programa oficial en PDF según el registro de enlaces; null si no consta comprobado.
   * Sin programa, el informe remite al buscador del catálogo por su código.
   */
  programa: ProgramaOficial | null;
  /**
   * «ocupacion»: el SEPE la relaciona con su misma ocupación; «incluye»: con una ocupación oficial más general que
   * incluye la suya; «grupo»: con otra de su grupo CNO-11 de 4 cifras; «variante»: con una variante más específica.
   * En «incluye» y «variante», `ocupacionOficial` dice cuál. «sugerencia»: el SEPE no la relaciona; Faro la propone
   * porque su nombre se parece a la ocupación (no es un dato oficial).
   */
  relacion: 'ocupacion' | 'incluye' | 'grupo' | 'variante' | 'sugerencia';
  ocupacionOficial?: string;
  /** Parecido semántico de su nombre con la ocupación, si hay vectores; puede ser negativo y no es una probabilidad. */
  parecido?: number | undefined;
  /** Correspondencia oficial que sustenta la relación; null en sugerencias de Faro, que carecen de ella. */
  correspondencia: Correspondencia | null;
}

/** Curso de la copia fechada del SOC que se ofrece el día de la consulta: no ha terminado. */
export interface CursoRelacionado {
  id: string;
  nombre: string;
  especialidad: string;
  modalidad: string;
  municipio: string;
  inicio: string | null;
  fin: string | null;
  horas: string;
  centro: string;
  enlace: string;
  /** El curso es de una especialidad sugerida por Faro, no relacionada oficialmente con la ocupación. */
  sugerencia: boolean;
  momento: MomentoCurso;
  /** A quién se dirige, si la fuente lo publica; null si no consta. */
  destinatarios: DestinatariosCurso | null;
  /** Fecha (AAAA-MM-DD) de la copia de la que salen sus datos. */
  comprobado: string;
  /** Faro no comprueba plazas ni inscripción con el centro: el momento sale de las fechas de la copia. */
  inscripcion: 'sin-verificar';
  /** Teleformación o aula virtual: se sigue desde cualquier sitio. */
  aDistancia: boolean;
  /** Programa oficial de su especialidad, si consta comprobado en el registro de enlaces. */
  programa: ProgramaOficial | null;
}

/**
 * Edición del Consorci que se ofrece el día de la consulta: un curso gratuito para personas que trabajan, sin
 * enlace propio. La inscripción es con la entidad, que da su contacto.
 */
export interface EdicionRelacionada extends Omit<CursoRelacionado, 'centro' | 'enlace' | 'inscripcion'> {
  /** La entidad con que se inscribe la persona. A distancia, el municipio de la edición es el de la entidad. */
  contacto: ContactoEntidad;
  inscripcion: 'con-la-entidad';
}

/**
 * Acción prevista que se ofrece sin fecha: una entidad suele impartir este curso. Se pregunta a la entidad cuándo
 * habrá una edición.
 */
export interface PrevistaRelacionada {
  especialidad: string;
  /** Nombre del curso, en catalán. */
  nombre: string;
  modalidad: string;
  horas: string;
  municipio: string;
  /** Teleformación: se sigue desde cualquier sitio, y el municipio es el de la entidad. */
  aDistancia: boolean;
  contacto: ContactoEntidad;
  /** Programa oficial de su especialidad, si consta comprobado en el registro de enlaces. */
  programa: ProgramaOficial | null;
}

/**
 * Lo del Consorci en el informe: todas las ediciones que no han terminado, en el orden de las convocatorias, y las
 * acciones previstas de las mismas especialidades, sin fecha, con su copia.
 */
export interface EdicionesRelacionadas {
  ediciones: EdicionRelacionada[];
  previstas: PrevistaRelacionada[];
  fechaCopia: string;
  /** La copia supera el plazo de vigencia o su fecha no se puede leer. */
  copiaAntigua: boolean;
  buscador: string;
}

/**
 * Formación del informe: especialidades ordenadas y recortadas, con cursos no terminados en el orden del dominio.
 * La cantidad de cursos puede limitarse al construir este resultado; incluye las fechas de copia y las fuentes.
 */
export interface FormacionRelacionada {
  especialidades: EspecialidadRelacionada[];
  totalEspecialidades: number;
  cursos: CursoRelacionado[];
  fechaCursos: string;
  /** La copia supera el plazo de vigencia o su fecha no se puede leer. */
  copiaAntigua: boolean;
  fuentes: string[];
  /** «grupo»: buscada a nivel de grupo ISCO-08, sin ocupación ESCO. Sin la marca, es la de su ocupación ESCO. */
  nivel?: 'grupo';
  /** Ediciones del Consorci de las mismas especialidades. Solo si se piden y el paquete trae el Consorci. */
  consorci?: EdicionesRelacionadas;
}

/** Especialidad del bloque digital transversal: sus datos y su programa, sin relación con ninguna ocupación. */
export type EspecialidadTransversal = Pick<
  EspecialidadRelacionada,
  'codigo' | 'nombre' | 'nivel' | 'horas' | 'familia' | 'modalidad' | 'programa'
>;

/** Un tramo del bloque digital transversal: sus especialidades y lo que hay de ellas en el SOC y el Consorci. */
export interface TramoTransversal {
  especialidades: EspecialidadTransversal[];
  cursos: CursoRelacionado[];
  /** Ediciones del Consorci; ninguna si no se pide el Consorci. */
  ediciones: EdicionRelacionada[];
  /** Acciones previstas del Consorci, sin fecha: «suele ofrecerse, pregunta a la entidad». */
  previstas: PrevistaRelacionada[];
  /** Ediciones de sus especialidades programadas en el Consorci pero aún sin fecha. */
  programadasSinFecha: number;
}

/**
 * Bloque de formación digital transversal, el mismo para todas las ocupaciones:
 * «para empezar» (niveles 1 y 2) y «para ir más allá» (nivel 3).
 */
export interface FormacionTransversal extends TramoTransversal {
  paraIrMasAlla: TramoTransversal | null;
  /** La acreditación oficial ACTIC, con el nivel de cada tramo; null si el paquete no la trae. */
  certificacion: CertificacionActic | null;
  /** Cita del Consorci si el bloque trae algo suyo. */
  fuenteConsorci: string | null;
  buscadorConsorci: string | null;
}

/**
 * Un nivel de la acreditación oficial de competencias digitales de la Generalitat (ACTIC), por su clave del paquete.
 */
export type NivelActic = 'basico' | 'medio' | 'avanzado';

/** Un nivel de la ACTIC en el paquete: su número, su nombre y la duración máxima de su prueba (Ordre EMT/48/2026). */
interface NivelActicOficial extends Record<Idioma, string> {
  nivel: number;
  clave: NivelActic;
  minutos: number;
}

/** La ACTIC en el paquete: lo que lee el bloque digital transversal. */
export interface DatosActic {
  enlace: string;
  fuentes: { actic: string };
  niveles: NivelActicOficial[];
  areas: { area: number }[];
  /** Quién puede pedir la exención de la tasa, por clave (Ordre EMT/48/2026, art. 3.1). */
  prueba: { exencion: string[] };
  modelo: { vigente_desde: string };
}

/** Una opción «Certifica lo que sabes» de un tramo: sus niveles y lo que se dice de la prueba, sin promesas. */
export interface CertificacionDelTramo {
  niveles: NivelActicOficial[];
  /** Duración máxima de la prueba de esos niveles, en minutos. */
  minutos: number;
}

/** La ACTIC en el bloque digital transversal: la opción de cada tramo y lo común a las dos. */
export interface CertificacionActic {
  paraEmpezar: CertificacionDelTramo;
  paraIrMasAlla: CertificacionDelTramo;
  enlace: string;
  /** Desde cuándo rige el modelo de cinco áreas (Ordre EMT/47/2026). */
  vigenteDesde: string;
  areas: number;
  /** Si las personas desempleadas pueden pedir la exención de la tasa. */
  exencionDesempleo: boolean;
  fuente: string;
}
