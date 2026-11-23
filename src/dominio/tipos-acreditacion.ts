// Contratos del paquete de acreditación de competencias y del bloque de una ocupación confirmada.
// Separan los datos oficiales de su presentación; no comprueban requisitos ni acreditan a la persona.

import type { Idioma } from '../comun/idioma.ts';

/** Un texto oficial en los dos idiomas de Faro; null si la fuente no lo da en ese idioma. */
type TextoBilingue = Record<Idioma, string | null>;

/** Una unidad de competencia de un certificado, como la trae el paquete. */
export interface UnidadOficial {
  codigo: string;
  /** El nombre del anexo del BOE (castellano) y el del SOC (catalán). */
  nombre: TextoBilingue;
  /** Su módulo formativo y sus horas, según el SOC. */
  modulo: string | null;
  horas: number | null;
  /** Las unidades actuales que la sustituyen, si una norma posterior la suprimió (Real Decreto 151/2022). */
  actuales: { codigo: string; nombre: string }[];
}

/** El nivel de un certificado profesional (niveles 1 a 3 del catálogo). */
type NivelCertificado = 1 | 2 | 3;

/** Un certificado profesional que imparte el SOC y que su real decreto relaciona con alguna ocupación o grupo. */
export interface CertificadoOficial {
  nombre: TextoBilingue;
  nivel: NivelCertificado;
  horas: number | null;
  /** Familia profesional («ADG», «SAN»…). */
  familia: string;
  /** El real decreto de su anexo («645/2011») y su texto en el BOE. */
  real_decreto: string;
  boe: string;
  unidades: UnidadOficial[];
  /**
   * «si» si la oferta de la Agència FP.CAT lo trae con seguridad tras el cotejo de la cadena de datos; si no,
   * «sin-comprobar». Nunca «no»: la oferta no trae códigos y lo que no casa puede estar en ella con otro nombre.
   */
  oferta_cataluna: 'si' | 'sin-comprobar';
}

/** Las páginas oficiales a las que remite el bloque, por idioma (si una no tiene versión castellana, solo `ca`). */
type EnlacesAcreditacion = Record<
  'tramite' | 'expedicion' | 'agencia' | 'orientacion',
  Partial<Record<Idioma, string>> & { ca: string }
>;

/** La acreditación del paquete de datos. */
export interface DatosAcreditacion {
  fuentes: { boe: string; ine: string; soc: string };
  /** Fecha (AAAA-MM-DD) de la copia de los textos del BOE. */
  fecha_boe: string;
  /** Fecha (AAAA-MM-DD) de la última comprobación a mano de las páginas de la Generalitat y la Sindicatura. */
  comprobado: string;
  /** Horas de experiencia del nivel 1 en Cataluña (guía de la Agència FP.CAT); null si están por confirmar. */
  horas_nivel_1: number | null;
  /** El punto de información de la acreditación en Cornellà, con el teléfono que da la página del Ajuntament. */
  punto_de_informacion?: { telefono: string; url: string; comprobado: string };
  /**
   * Los certificados cuya cualificación la Agència FP.CAT da como no disponible (profesiones sanitarias reguladas,
   * Real Decreto 659/2023, art. 175.2): no se acreditan por esta vía. Los demás de Sanidad, sí.
   */
  no_disponibles: string[];
  /** Fecha (AAAA-MM-DD) de la oferta de la Agència FP.CAT con que se marca `oferta_cataluna`. */
  oferta_actualizada: string;
  enlaces: EnlacesAcreditacion;
  /**
   * Los certificados de cada ocupación ESCO, con cómo se relaciona cada uno, y los de cada grupo ISCO-08 confirmado sin
   * ocupación ESCO (siempre por grupo). Solo están las que tienen alguno; las reglas de relaciones de la
   * cadena de datos calculan estos enlaces.
   */
  relaciones: {
    ocupaciones: Record<string, [codigo: string, relacion: RelacionAcreditacion][]>;
    grupos: Record<string, string[]>;
  };
  certificados: Record<string, CertificadoOficial>;
  /**
   * La escala del servicio en Cataluña, de la Memòria del Sistema FPCAT: personas con una cualificación entera
   * acreditada, solicitudes pendientes y puntos de orientación, con su página.
   */
  memoria_fpcat?: EscalaDelServicio;
}

/** Tres cifras de la Memòria del Sistema FPCAT, leídas de su página, con su periodo. */
interface EscalaDelServicio {
  cita: string;
  url: string;
  pagina: number;
  periodo: string;
  personas_con_cualificacion_entera: number;
  solicitudes_pendientes: number;
  puntos_de_orientacion: number;
}

/**
 * Certificados relacionados por el SEPE en los perfiles de la oferta de empleo del paquete: solo los nombrados por
 * código, sin los que Faro ya enseña comprobados y para ocupaciones con un único grupo CNO-11 de 4 cifras.
 * Cada uno lleva la posición del perfil que lo nombra.
 */
export interface DatosPerfilesSepe {
  fuente: string;
  cita: string;
  /** El nombre del perfil del SEPE y su año. */
  perfiles: [perfil: string, anio: number][];
  ocupaciones: Record<string, [codigo: string, perfil: number][]>;
}

/**
 * Certificados relacionados por el SEPE en su informe de necesidades formativas de 2016: solo vigentes, sin los que
 * ya enseñan lo comprobado y los perfiles, y para ocupaciones con un único grupo CNO-11 de 4 cifras. Cada uno lleva
 * las unidades que nombra el informe si no son todas (vacío: todas o ninguna en concreto).
 */
export interface DatosCertificadosSepe2016 {
  fuente: string;
  cita: string;
  ocupaciones: Record<string, [codigo: string, unidades: string[]][]>;
}

// ---------- El bloque que devuelve el dominio ----------

/**
 * Categoría de relación del certificado dentro del bloque. En `certificados`, «ocupacion» indica que su real decreto
 * nombra la ocupación (código CO-SISPE) y «grupo», uno de sus grupos CNO-11 de 4 cifras. En `sepe.perfiles`, «grupo»
 * es la categoría general usada sin una relación comprobada en el BOE: el apartado y su nota identifican al SEPE
 * como fuente de la relación.
 */
export type RelacionAcreditacion = 'ocupacion' | 'grupo';

/**
 * Qué bloque corresponde a la ocupación, solo con lo que Faro ha comprobado:
 * - 'por-ocupacion': algún certificado por su ocupación.
 * - 'por-grupo': certificados solo por su grupo.
 * - 'sanidad': solo certificados de no_disponibles (que no se acreditan por esta vía).
 * - 'solo-sepe': nada comprobado, pero el SEPE le relaciona certificados que Faro no ha comprobado.
 * - 'sin-relacion': ninguno.
 */
export type VarianteAcreditacion = 'por-ocupacion' | 'por-grupo' | 'sanidad' | 'solo-sepe' | 'sin-relacion';

/** Una unidad de competencia tal como la enseña el bloque. */
export interface UnidadAcreditable {
  codigo: string;
  nombre: string | null;
  modulo: string | null;
  horas: number | null;
  /** «Hoy equivale a …»: las unidades actuales, si la unidad se suprimió. Null si no. */
  equivalencia: string | null;
}

/** Un certificado relacionado, con su presentación ya escrita. */
export interface CertificadoAcreditable {
  codigo: string;
  nombre: string;
  nivel: NivelCertificado;
  horas: number | null;
  relacion: RelacionAcreditacion;
  /** «… incluye tu ocupación entre sus ocupaciones relacionadas. Tiene 7 unidades…». */
  presentacion: string;
  /** «Relacionada con tu grupo de ocupaciones»; null si el real decreto nombra la ocupación. */
  etiqueta: string | null;
  realDecreto: string;
  enlaceBoe: string;
  unidades: UnidadAcreditable[];
  /** Está con seguridad en la oferta de la Agència FP.CAT: se puede pedir ahora en Cataluña. False: sin comprobar. */
  sePuedePedirAhora: boolean;
}

/** Los certificados de un perfil del SEPE, con la nota que dice de dónde salen. */
export interface PerfilDelSepe {
  nota: string;
  /**
   * El año del perfil, para enseñarlo junto a cada certificado; null en los del informe, que lo dejan en las fuentes.
   */
  anio: number | null;
  certificados: CertificadoAcreditable[];
}

/** «Otros certificados que el SEPE relaciona con tu ocupación», por perfil y, al final, los de su informe. */
export interface CertificadosDelSepe {
  titulo: string;
  perfiles: PerfilDelSepe[];
}

/** La lista de requisitos de un nivel, para leerla y comprobarla sola: texto, sin casillas. */
export interface RequisitosAcreditacion {
  niveles: NivelCertificado[];
  titulo: string;
  lista: string[];
}

/** Un enlace a una página oficial. */
export interface EnlaceAcreditacion {
  texto: string;
  url: string;
}

/**
 * El bloque «Acreditar lo que ya sabes hacer» de una ocupación confirmada. Es igual para todas las personas con la
 * misma ocupación: no depende de su edad, su experiencia ni nada de ella, y no dice si cumple los requisitos.
 */
export interface BloqueAcreditacion {
  variante: VarianteAcreditacion;
  titulo: string;
  /** La primera frase: «La acreditación de competencias existe para tu ocupación…» o la línea neutra. */
  introduccion: string;
  certificados: CertificadoAcreditable[];
  /** «Comprueba si cumples los requisitos…»; null sin certificados. */
  comprueba: string | null;
  /** Una lista por cada conjunto de niveles; vacía sin certificados o si la comprobación a mano ha caducado. */
  requisitos: RequisitosAcreditacion[];
  /** Horas de experiencia del nivel 1 en Cataluña, las del paquete (`horas_nivel_1`): la pizarra las resume. */
  horasNivel1: number | null;
  comoFunciona: string | null;
  /** Dónde informarse en Cornellà (Servei Local d'Ocupació, sin enlace); va siempre. */
  dondeInformarse: string;
  /** La escala del servicio en Cataluña, en una línea con su fuente; solo si el paquete trae la memoria. */
  escala?: string;
  /** Qué hacer con todas las unidades del certificado: pedirlo al SOC. Null sin certificados. */
  expedicion: string | null;
  enlaces: EnlaceAcreditacion[];
  /** Los certificados que relaciona el SEPE y Faro no ha comprobado, aparte y con su aviso; null si no hay. */
  sepe: CertificadosDelSepe | null;
  fuente: string;
  /** Fecha (AAAA-MM-DD) de la última comprobación a mano de las páginas oficiales. */
  comprobado: string;
  /** Fecha (AAAA-MM-DD) de la oferta de la Agència FP.CAT con que se marca `sePuedePedirAhora`. */
  ofertaActualizada: string;
  /** La comprobación a mano tiene más de 60 días o su fecha no se puede leer. Solo informa: no oculta nada. */
  comprobacionAntigua: boolean;
}
