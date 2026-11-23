// Contratos de las fichas oficiales de Citilab en el paquete y de sus cursos en el informe.
// Solo declaran formas; las reglas de fechas, coste y selección corresponden al consumidor.

/** Una franja semanal: los días (1 = lunes … 7 = domingo), de qué hora a qué hora y si se atiende a distancia. */
export interface FranjaCitilab {
  dias: number[];
  /** Hora de inicio (HH:MM). */
  desde: string;
  /** Hora de fin (HH:MM). */
  hasta: string;
  a_distancia: boolean;
}

/** El coste según la ficha. `gratuito` es null si la ficha no lo deja claro («variable», «cal consultar»). */
interface CosteCitilab {
  gratuito: boolean | null;
  /** Precio en euros, o null si no se pudo leer con seguridad. */
  precio_eur: number | null;
  /** La ficha pide el carnet de Citilaber. */
  carnet_citilaber: boolean;
  /** El descuento para personas en paro, si la ficha lo publica. */
  descuento_paro_pct: number | null;
}

/** El lugar de la ficha. */
interface LugarCitilab {
  nombre: string;
  direccion: string;
  municipio: string;
  codigo_postal: string;
}

/** Una ficha de Citilab tal como la trae el paquete. Lo que no se pudo leer con seguridad es null. */
export interface CursoCitilabOficial {
  /** Identificador numérico de la ficha oficial de Citilab; se conserva sin convertirlo a texto. */
  id: number;
  /** El título, en catalán, tal como lo publica Citilab. */
  titulo: string;
  /** La ficha oficial en citilab.eu. */
  enlace: string;
  /** Fecha (AAAA-MM-DD) de la última modificación de la ficha. */
  modificado: string;
  /** A quién se dirige, por los términos de su vocabulario («adults», «persones-grans», «16-anys»…). */
  publico: string[];
  /** El tipo de formación, por los términos de su vocabulario. */
  temas: string[];
  trata_ia: boolean;
  modalidad: 'presencial' | 'en-linea' | null;
  requisitos: 'ninguno' | 'prueba' | 'otros' | null;
  /** Duración en horas, o null si no se pudo leer con seguridad. */
  horas: number | null;
  /** Número de sesiones que dice la ficha. */
  sesiones: number | null;
  /** Primer día (AAAA-MM-DD). */
  inicio: string | null;
  /** Último día (AAAA-MM-DD). */
  fin: string | null;
  horario: FranjaCitilab[] | null;
  /** Sin fechas y con un horario semanal: un servicio o un grupo que funciona todo el curso. */
  periodico: boolean;
  coste: CosteCitilab;
  lugar: LugarCitilab | null;
}

/** Los cursos de Citilab del paquete: los que admiten a personas adultas, de la copia de una fecha. */
export interface DatosCitilab {
  fuente: string;
  /** Fecha (AAAA-MM-DD) de la copia: el día en que se consultó la web. */
  copia: string;
  /** Página pública con todas las formaciones de Citilab. */
  listado: string;
  cursos: CursoCitilabOficial[];
}

/**
 * El momento de un curso de Citilab el día del informe, por sus fechas: «por-iniciar», «iniciado», «periodico» (sin
 * fechas, con horario semanal) o «consultar» (terminado o sin datos para decirlo: la próxima edición se pregunta a
 * Citilab). Nunca se da por disponible lo que no dicen sus fechas.
 */
export type MomentoCitilab = 'por-iniciar' | 'iniciado' | 'periodico' | 'consultar';

/**
 * En qué tramo del itinerario digital y de IA entra un curso con fechas vigentes: «para-empezar» (competencias
 * digitales) o «para-ir-mas-alla» (trata la IA); null si no entra.
 */
export type TramoCitilab = 'para-empezar' | 'para-ir-mas-alla' | null;

/** Un curso de Citilab en el informe. */
export interface CursoCitilab extends Omit<CursoCitilabOficial, 'modificado' | 'temas' | 'trata_ia' | 'periodico'> {
  momento: MomentoCitilab;
  tramo: TramoCitilab;
}

/** Los cursos de Citilab del informe, en el orden de las convocatorias, con la fecha de la consulta y su cita. */
export interface CitilabDelInforme {
  cursos: CursoCitilab[];
  /** Día de la copia en que se consultó la web (AAAA-MM-DD). */
  consultado: string;
  /** La copia supera el plazo de vigencia o su fecha no se puede leer. */
  copiaAntigua: boolean;
  listado: string;
  fuente: string;
}
