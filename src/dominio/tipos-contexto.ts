// Contratos de las cifras oficiales de grupos de ocupaciones: censos, encuesta TIC-H y salarios.
// Declaran las vistas del paquete y del informe; no calculan indicadores ni describen a una persona.

// ---------- Paquete ----------

/** Personas ocupadas de un grupo a 1 de enero de un año, con el porcentaje de mujeres. */
export interface OcupadosDelAnio {
  ocupados: number;
  pct_mujeres: number | null;
}

/** Las cifras de un grupo en cada año publicado, expresado como «AAAA». */
export type OcupadosPorAnio = Record<string, OcupadosDelAnio>;

/** Un territorio del censo anual, comarca o municipio, con sus personas ocupadas por grupo de 2 cifras. */
interface TerritorioOcupados {
  nombre: string;
  tipo: 'comarca' | 'municipio';
  comarca: string | null;
  cno2: Record<string, OcupadosPorAnio>;
}

/**
 * Personas ocupadas por grupo de la CNO-11 según el censo anual del Idescat:
 * Cataluña a 3 y a 2 cifras, con la suma de todos los grupos en `total`, y cada territorio a 2 cifras. Solo trae los
 * años comparables (desde `comparable_desde`, el primero con el método anual) y cifras de `min_personas` o más.
 */
export interface DatosOcupados {
  fuentes: { idescat: string };
  /** Los años del censo anual, cada uno como «AAAA». */
  anios: string[];
  /** Referencia temporal del recuento, expresada como «1 de enero de cada año». */
  fecha_de_referencia: string;
  comparable_desde: string;
  min_personas: number;
  cataluna_cno3: Record<string, OcupadosPorAnio>;
  cataluna_cno2: Record<string, OcupadosPorAnio>;
  territorios: Record<string, TerritorioOcupados>;
}

/** Nivel de estudios de las personas ocupadas de un grupo en el Censo 2021, en %. */
interface EstudiosCenso {
  hasta_secundaria_obligatoria: number;
  bachillerato: number;
  fp_grado_medio: number;
  /** Se declara porque el paquete lo trae (el JSON los suma); ningún código del motor lo lee. */
  postsecundaria_no_superior: number;
  fp_grado_superior: number;
  universitarios: number;
}

/** Situación profesional de las personas ocupadas de un grupo en el Censo 2021, en %. */
interface SituacionCenso {
  indefinido: number;
  temporal: number;
  cuenta_propia: number;
  /** Se declara porque el paquete lo trae; ningún código del motor lo lee. */
  otra: number;
}

/**
 * Perfil de un grupo de la CNO-11 en Cataluña según el Censo 2021. El paquete trae también su nacionalidad, que el
 * informe de una persona no muestra: queda fuera de esta vista de tipos, sin eliminarla del objeto en ejecución.
 */
export interface PerfilCenso {
  personas: number;
  estudios: EstudiosCenso;
  situacion: SituacionCenso;
}

/**
 * El Censo 2021 del INE por su API: el perfil de cada grupo de la CNO-11 en
 * Cataluña, a 3 cifras y a 2, solo con `min_personas_perfil` personas o más. Sus municipios no se declaran: el informe
 * da Cataluña y la comarca del Baix Llobregat, sin preguntar a la persona dónde vive.
 */
export interface DatosCenso {
  fuentes: { censo: string };
  /** Fecha de referencia del censo, expresada como «1 de enero de 2021». */
  fecha_de_referencia: string;
  min_personas_perfil: number;
  perfil_cno3: Record<string, PerfilCenso>;
  perfil_cno2: Record<string, PerfilCenso>;
  /** Todas las ocupaciones de Cataluña juntas (las personas de los grupos de 2 cifras, sumadas). */
  perfil_cataluna: PerfilCenso;
  /**
   * Ocupados, % de mujeres y edad de todas las ocupaciones juntas, sin «No consta»; los suma
   * plataforma_datos/mercado/fuentes/cataluna/lector.py.
   */
  ocupados_cataluna: { ocupados: number; pct_mujeres: number; pct_menores_30: number; pct_55_o_mas: number };
}

/** Uso declarado de la IA generativa en el trabajo en un grupo: % ponderado, intervalo del 95 % y respuestas. */
export interface UsoEnLaEncuesta {
  pct: number;
  ic95: [number, number];
  muestra: number;
}

/**
 * Clase de la TIC-H: grupos 0 a 5 no manuales; del 6 al 9, manuales. `no_manual` conserva la clave del paquete.
 */
export type ClaseDeOcupacion = 'manual' | 'no_manual';

/**
 * Quienes no usaron la IA generativa porque no sabían cómo, en Cataluña, por clase de ocupación: Idescat, Enquesta TIC
 * a les llars (tabla 3.4.2), con su procedencia. Su manual y no manual (grandes
 * grupos 6 a 9 y 0 a 5) es la clase de `clase_por_isco2`; la validación lo comprueba.
 */
interface MotivosDeNoUso {
  /** La cita de la fuente, como la pide el Idescat. */
  fuente: string;
  tabla: string;
  url: string;
  /** La huella del original que se leyó. */
  sha256: string;
  /** Fecha ISO de la consulta. */
  consultado: string;
  /** Año de la encuesta («AAAA»), en texto como en el resto de la TIC-H (los salarios lo llevan como número). */
  anio: string;
  /** De quiénes es el porcentaje: quienes usaron internet y no usaron la IA generativa. */
  base: string;
  no_sabia_como_utilizarlas: Record<ClaseDeOcupacion, number>;
}

/**
 * La encuesta TIC-H del INE: uso declarado de la IA generativa en el trabajo en
 * España por grupo ISCO-08 de 2 cifras y de 1 (cálculo de Faro con los microdatos, con `min_muestra` respuestas o más)
 * y, de quienes no la usaron, cuántos no sabían cómo en Cataluña por clase de ocupación (`motivos_no_uso`, del
 * Idescat). El uso de Cataluña por clase no se declara: es tan amplio (manual o no manual) que en el informe de una
 * persona confundiría. Su omisión del tipo no retira esos campos del objeto en ejecución.
 *
 * La entrevista anota la ocupación a 2 cifras a su manera, y en algunos grupos pone a otra gente que las demás
 * estadísticas. Esos grupos no tienen cifra propia: los grandes grupos de `grandes_grupos_enteros` se dan enteros
 * (en `espana_isco1`), y los grupos de `bloque_por_isco2`, juntos en su bloque (en `espana_bloques`).
 */
export interface DatosTich {
  fuentes: { tich: string };
  anio: string;
  /**
   * Los años de la encuesta que trae el dato, del más antiguo al más reciente. Un paquete que no lo declara trae solo
   * la edición de `anio`.
   */
  anios_medidos?: string[];
  /** La edición del INE más reciente que el dato y aún sin incorporar, observada en su catálogo (opcional). */
  edicion_nueva?: EdicionNuevaDeLaTich;
  min_muestra: number;
  espana_isco2: Record<string, UsoEnLaEncuesta>;
  espana_isco1: Record<string, UsoEnLaEncuesta>;
  espana_bloques: Record<string, UsoEnLaEncuesta>;
  /**
   * Cataluña, por gran grupo ISCO-08, solo los que llegan a las respuestas mínimas (opcional): lo lee el informe breve
   * (informe-breve.ts) antes que la cifra de España.
   */
  cataluna_isco1?: Record<string, UsoEnLaEncuesta>;
  bloque_por_isco2: Record<string, string>;
  grandes_grupos_enteros: string[];
  motivos_no_uso: MotivosDeNoUso;
  clase_por_isco2: Record<string, ClaseDeOcupacion>;
  /**
   * Los grupos ISCO-08 de 2 cifras que en esta edición no tienen clase: el INE clasifica a sus personas unas como
   * manuales y otras como no manuales. No están en `clase_por_isco2`, así que el informe no da su motivo de no uso
   * (opcional: un paquete que no lo declara no tiene ninguno).
   */
  grupos_sin_clase?: string[];
}

/**
 * Una edición de la TIC-H que el INE ya ha publicado y que el dato aún no incorpora: sin microdatos todavía, o con
 * ellos y pendiente de incorporar. `observado_utc` es la primera vez que Faro vio ese catálogo, no la fecha del INE.
 */
export interface EdicionNuevaDeLaTich {
  estado: 'publicada-sin-microdatos' | 'pendiente-de-incorporar';
  anio: string;
  observado_utc: string;
  sha256_catalogo: string;
}

/** Los salarios medios brutos anuales de un gran grupo: por estudios, en total y, si los hay, por antigüedad. */
interface SalariosDeUnGranGrupo {
  estudios: Record<string, number>;
  total: number;
  antiguedad?: Record<string, number>;
}

/**
 * Salario medio bruto anual en Cataluña por gran grupo de la CNO-11 y nivel de estudios, de ambos sexos, según la
 * Encuesta de Estructura Salarial del INE. Sin las cifras que el INE marca como
 * poco fiables. El salario por sexo no se declara: el informe no depende del sexo de la persona.
 */
export interface DatosSalarios {
  fuentes: { salarios: string };
  /** Año de la encuesta («AAAA»), como número. */
  anio: number;
  grandes_grupos: Record<string, SalariosDeUnGranGrupo>;
}

// ---------- Informe ----------

/** Variación de las personas ocupadas de un grupo en Cataluña entre dos años del censo anual, en %. */
export interface VariacionOcupados {
  desde: string;
  hasta: string;
  pct: number;
  /** La de todos los grupos de Cataluña juntos, para comparar. */
  conjunto: number;
}

/**
 * Personas ocupadas en la comarca del Baix Llobregat de un grupo de 2 cifras, lo más detallado que publica el Idescat
 * por comarca. `amplio`: el grupo reúne más ocupaciones que el de Cataluña que da el informe.
 */
export interface OcupadosEnLaZona {
  comarca: string;
  cno11: string;
  grupo: string;
  amplio: boolean;
  personas: number;
  anio: string;
}

/** Estudios de las personas ocupadas de un grupo, en %. */
interface EstudiosDelGrupo {
  obligatoria: number;
  bachillerato: number;
  fpGradoMedio: number;
  fpGradoSuperior: number;
  universitarios: number;
}

/**
 * Quién hace un trabajo como el tuyo: estudios y situación profesional de las personas ocupadas de un grupo en
 * Cataluña, en % (Censo 2021). `amplio`: el perfil es del grupo de 2 cifras, porque el INE no da el del grupo de 3.
 */
export interface PerfilDelGrupo {
  cno11: string;
  grupo: string;
  amplio: boolean;
  estudios: EstudiosDelGrupo;
  situacion: { indefinido: number; temporal: number; cuentaPropia: number };
}

/** Un escalón de estudios de la Encuesta de Estructura Salarial, de menos a más. */
export type EscalonDeEstudios = 'obligatoria' | 'secundaria' | 'fpSuperior' | 'grado';

/**
 * Lo que cobraban de media en Cataluña las personas del gran grupo con dos escalones de estudios seguidos: el más
 * frecuente en el grupo de la persona y su vecino. Es una media del grupo, no una promesa.
 */
export interface SalarioPorEstudios {
  anio: number;
  granGrupo: string;
  titulo: string;
  escalones: { escalon: EscalonDeEstudios; euros: number }[];
}

/**
 * De quién es la cifra del uso declarado: del grupo de 2 cifras de la persona; de su gran grupo, porque su grupo no
 * llega a las respuestas mínimas; o de un conjunto (un bloque de grupos o un gran grupo entero), porque la entrevista
 * reparte a esas personas entre sus grupos de otra forma que las demás estadísticas.
 */
export type AlcanceDelUso = 'grupo' | 'gran-grupo' | 'conjunto';

/**
 * Uso declarado de la IA generativa en el trabajo en el grupo ISCO-08 de la persona, en España (TIC-H). Es lo que
 * dicen las personas del grupo en una encuesta, no lo que pasa en su puesto.
 */
export interface UsoDeclaradoDeLaIa {
  anio: string;
  /** El código de la cifra: un grupo ISCO-08 de 2 cifras, un gran grupo o un bloque («25+35»). */
  codigo: string;
  /** Su título oficial; en un bloque, los de sus grupos. */
  grupo: string;
  alcance: AlcanceDelUso;
  pct: number;
  intervalo: [number, number];
  /**
   * De quienes no la usaron en Cataluña en ocupaciones de su clase, cuántos dijeron que no sabían cómo (Idescat), con
   * el año de esa encuesta.
   */
  noSabianComo: { clase: ClaseDeOcupacion; pct: number; anio: string } | null;
}
