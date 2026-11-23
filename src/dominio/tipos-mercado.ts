// Contrato de mercado.json: las cifras del mercado de trabajo de cada ocupación que lee el informe breve «La IA y tu
// trabajo» (dominio/informe-breve.ts). Lo escribe la cadena de datos
// (plataforma_datos/orquestacion/exportacion/mercado.py) a partir de originales guardados con su procedencia:
// EPA y EAES del INE y ficheros del Observatori del Treball. Solo tipos.

/** Personas ocupadas de un gran grupo de la CNO-11 en Cataluña según la EPA: media de cuatro trimestres. */
export interface EmpleoDeUnGranGrupo {
  /** Nombre del gran grupo, literal del INE. */
  nombre: string;
  /** Media de los cuatro últimos trimestres publicados, en personas (redondeada a la centena). */
  personas: number;
  /** La misma media un año antes; null si falta algún trimestre. */
  anterior: number | null;
  /** Variación entre las dos medias, en %, con un decimal; null si falta algún trimestre del año anterior. */
  variacion_pct: number | null;
}

/** Ganancia media anual por trabajador de un grupo de ocupación de la EAES, en España, en euros. */
export interface SalarioDeUnGrupo {
  /** Nombre del grupo, literal del INE. */
  nombre: string;
  /** Subgrupos principales de la CNO-11 (2 cifras) que forman el grupo. */
  cno2: string[];
  /** null si el INE no lo publica por tener menos de 100 observaciones (ocupaciones militares). */
  total: number | null;
  anterior: number | null;
  mujeres: number | null;
  hombres: number | null;
  /** Las cifras que el INE marca como de gran variabilidad (entre 100 y 500 observaciones): «mujeres», «hombres»… */
  gran_variabilidad?: string[];
}

/** Contratos de una ocupación CNO-11 de 4 cifras por comarca en 12 meses. */
export interface ComarcasDeUnaOcupacion {
  total: number;
  /** Comarcas con algún contrato. */
  con_contratos: number;
  /** Todas las comarcas con contratos, de más a menos: [nombre literal, contratos]. */
  todas?: [nombre: string, contratos: number][];
  /** Solo las tres primeras (versión anterior del contrato). */
  primeras?: [nombre: string, contratos: number][];
}

/** Puestos ofertados en el servicio público de empleo (SOC y Feina Activa) de una ocupación o un grupo. */
export interface OfertasDeUnGrupo {
  puestos: number;
  anterior: number | null;
  /** Puesto entre las ocupaciones más ofertadas, si la fuente lo publica. */
  puesto?: number | null;
}

/** Las ofertas del Observatori: periodo, totales y cada nivel que la fuente publica completo. */
export interface DatosOfertas {
  periodo: string;
  periodo_anterior: string;
  total: number;
  total_anterior: number;
  /** Las ocupaciones de 4 cifras que publica la fuente (las más ofertadas). */
  cno4?: Record<string, OfertasDeUnGrupo>;
  cno3?: Record<string, OfertasDeUnGrupo>;
  cno2?: Record<string, OfertasDeUnGrupo>;
  cno1?: Record<string, OfertasDeUnGrupo>;
}

/** El archivo mercado.json del paquete. */
export interface DatosMercado {
  fuentes: { epa: string; eaes: string; observatori: string; ofertas?: string | null };
  empleo?: {
    trimestres: string[];
    anteriores: string[];
    grandes_grupos: Record<string, EmpleoDeUnGranGrupo>;
  };
  salarios?: {
    anio: number;
    anio_anterior: number;
    grupos: Record<string, SalarioDeUnGrupo>;
    todas?: Omit<SalarioDeUnGrupo, 'nombre' | 'cno2'>;
  };
  contratacion?: { periodo: string; cno4: Record<string, { variacion_exacta: number | null }> };
  /** Contratos por doce meses al corte de contratacion.periodo: el último publicado y los anteriores reconstruidos por Faro. */
  anual?: { etiquetas: string[]; publicado: boolean[]; cno4: Record<string, number[]> };
  comarcas?: { periodo: string; cno4: Record<string, ComarcasDeUnaOcupacion> };
  /**
   * Personas demandantes de empleo no ocupadas en 12 meses, su variación anual en fracción y la ratio de personas
   * contratadas por persona demandante (C_P2_MES_IND), sin redondear.
   */
  demandantes?: {
    periodo: string;
    medida: string;
    cno4: Record<string, { personas_12m: number; variacion_exacta: number | null; ratio: number | null }>;
  };
  /** null mientras no haya originales de las ofertas (el robots.txt del Observatori no permite descargarlos). */
  ofertas?: DatosOfertas | null;
}
