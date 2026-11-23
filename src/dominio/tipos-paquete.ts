// Contrato en memoria del paquete que produce la cadena de actualización: ESCO, OIT, Cambra, censos y formación.
// Reúne datos y vistas que usa el motor; no valida los valores ni representa por sí solo su formato JSON.
// Solo declara tipos: las importaciones y declaraciones se eliminan al ejecutar.
// ESCO y los textos admiten undefined explícito en sus campos opcionales, igual que sus guardas de forma.

import type { DatosBarcelonaActiva } from '../../compartido/contratos/tipos-barcelona-activa.ts';
import type { DatosCitilab } from '../../compartido/contratos/tipos-citilab.ts';
import type { DatosComarcas, DatosTemarios } from '../../compartido/contratos/tipos-comarcas-y-temarios.ts';
import type { DatosEures } from '../../compartido/contratos/tipos-eures.ts';
import type {
  DatosActic,
  DatosConsorci,
  DatosFormacion,
  EnlacesComprobados,
  EnlacesComprobadosAnteriores,
} from '../../compartido/contratos/tipos-formacion.ts';
import type { DatosFormacionAbierta } from '../../compartido/contratos/tipos-formacion-abierta.ts';
import type { DatosFundae } from '../../compartido/contratos/tipos-fundae.ts';
import type { VectoresGuardados } from '../comun/vectores.ts';
import type { DatosAcreditacion, DatosCertificadosSepe2016, DatosPerfilesSepe } from './tipos-acreditacion.ts';
import type { DatosCenso, DatosOcupados, DatosSalarios, DatosTich } from './tipos-contexto.ts';
import type { DatosEmpresas, DatosSectores } from './tipos-contexto-empresarial.ts';
import type { DatosMercado } from './tipos-mercado.ts';
import type { DatosMetodos } from './tipos-metodos.ts';
import type { DatosNecesidades } from './tipos-necesidades.ts';
import type { DatosObservatori } from './tipos-provincias.ts';

/** Con qué tareas oficiales se calibra una estimación de Faro. */
export type PoliticaReferencias = 'ocupacion' | 'ampliada' | 'oit';

/** Tarea oficial con nota publicada por la OIT que se da al modelo para calibrar una estimación. */
export interface Referencia {
  id: string;
  texto: string;
  nota: number;
  grupo?: 'parecida' | 'extremo';
}

/** Ocupaciones y competencias de ESCO, con la relación de cada competencia con cada ocupación. */
export interface DatosEsco {
  competencias: [uri: string, titulo: string, tipo: string][];
  ocupaciones: Record<
    string,
    {
      uri: string;
      titulo: string;
      isco08: string;
      alternativos?: string[] | undefined;
      descripcion?: string | undefined;
      /**
       * Cada competencia de la ocupación: su posición en `competencias` y si es esencial («e») u opcional («o»), en el
       * orden del catálogo. Solo se recorre: así el Worker y el navegador pueden guardarla en poca memoria.
       */
      competencias: Iterable<[indice: number, relacion: 'e' | 'o']>;
    }
  >;
}

/** Índice de exposición de la OIT: nota media por ocupación y nota por tarea. */
export interface DatosOit {
  fuente: { cita: string; aviso_adaptacion: string };
  ocupaciones: Record<
    string,
    {
      titulo_en: string;
      /** Nota media publicada en la tabla A1 del WP140, en escala 0–1; null si no consta. */
      media: number | null;
      /** Desviación estándar publicada en la tabla A1, en la misma escala de la nota. */
      sd: number | null;
      gradiente: string | null;
    }
  >;
  tareas: Record<
    string,
    {
      isco08: string;
      indice: number;
      texto_en: string;
      nota: number | null;
      /** Mínimo y máximo de las notas de los dos modelos del autor; null si falta alguna. No es un intervalo de confianza. */
      margen: [number, number] | null;
      /** Método de la nota en la fuente: predicted o reconciled; null si no consta nota. */
      metodo: string | null;
    }
  >;
}

/** Clasificaciones de ocupaciones: CNO-11, ISCO-08 en castellano y la correspondencia oficial entre ellas. */
interface DatosClasificaciones {
  cno11: Record<string, { titulo: string; nivel: string; padre: string }>;
  isco08_es: Record<string, string>;
  /** Correspondencia del INE; tipo conserva su cardinalidad 1:1, n:1, 1:n o n:m. */
  isco08_a_cno11: Record<string, { cno11: string; tipo: string }[]>;
}

/**
 * La parte pública del estudio del ODEE y la Cambra de Comerç de Barcelona (exposicion-cambra.json): el nivel de
 * exposición agregado de cada grupo CNO-11 de 3 cifras, la escala, el reparto por sexo que publica el estudio y la
 * cita. Su permiso cubre mostrar ese nivel, no repartir la tabla: la cadena de datos no exporta nada más
 * (plataforma_datos/ia_y_trabajo/fuentes/cambra/exportacion.py).
 */
export interface DatosCambra {
  fuente: string;
  escala?: { cortes: number[] };
  ocupaciones_cno3?: Record<string, { nivel: number }>;
  genero: { mujeres_exposicion_media_o_alta: number; hombres_exposicion_media_o_alta: number; pagina_impresa: number };
}

/** Personas ocupadas de un grupo del Censo 2021 del INE en Cataluña. */
export interface CensoGrupo {
  ocupados: number;
  pct_mujeres: number | null;
  pct_menores_30: number | null;
  pct_55_o_mas: number | null;
}

/**
 * Datos oficiales por ocupación en Cataluña: censo del INE y Observatori del Treball.
 */
export interface DatosCataluna {
  fuentes: { censo: string; observatori: string };
  /** Etiqueta del periodo que cubre la contratación, por ejemplo «12 meses a junio de 2026». */
  periodo_contratacion: string;
  /** Mínimo de personas contratadas exigido en ambos periodos para publicar la variación porcentual. */
  min_variacion: number;
  /** Variación anual de la suma de personas contratadas en todas las ocupaciones (referencia para comparar). */
  variacion_conjunto_ocupaciones: number;
  ocupados_cno3: Record<string, CensoGrupo>;
  /** A 2 cifras: para los grupos que el INE no publica a 3 (591–599, fuerzas armadas). */
  ocupados_cno2: Record<string, CensoGrupo>;
  contratacion_cno4: Record<
    string,
    {
      personas_contratadas: number | null;
      personas_contratadas_anterior: number | null;
      variacion_pct: number | null;
      pct_indefinidos: number | null;
      pct_mujeres_contratos: number | null;
    }
  >;
}

/** Cómo se hizo el texto en castellano de una tarea oficial. */
export type EstadoTexto = 'redacción manual' | 'redactado con IA' | 'traducido con IA';

/** Textos en castellano de las tareas oficiales y competencias ESCO de cada tarea en cada ocupación. */
export interface DatosTextos {
  /**
   * Textos en castellano de las tareas oficiales. «ia_podria» y «lo_tuyo» solo existen si ya se redactaron con las
   * justificaciones de la OIT.
   */
  tareas: Record<
    string,
    {
      corto: string;
      texto_es: string;
      ia_podria?: string | undefined;
      lo_tuyo?: string | undefined;
      estado?: EstadoTexto | undefined;
    }
  >;
  competencias_por_ocupacion: Record<string, Record<string, string[]>>;
  /**
   * Aviso de traducción que exige la licencia de la OIT, literal y entero: los textos de las tareas son una traducción
   * de Faro.
   */
  aviso_traduccion: string;
}

/**
 * Textos del paquete en catalán: traducciones de Faro con IA y denominaciones oficiales del Idescat.
 * La cadena de datos prepara y valida el contenido antes de cargarlo. Lo que falta se muestra en castellano,
 * marcado; este contrato conserva tanto el origen de las traducciones como la fuente de los nombres oficiales.
 */
export interface DatosCatalan {
  idioma: 'ca';
  /** «traducido con IA»: el origen de las traducciones, que se dice una vez donde se enseñan. */
  marca: string;
  /** Qué se ha hecho con el conjunto («traducido con IA»). */
  estado: string;
  /** Aviso de traducción que exige la licencia de la OIT, literal. */
  aviso_traduccion: string;
  /** Por tarea oficial, los textos que ya están traducidos: cada uno puede faltar. */
  tareas: Record<
    string,
    {
      corto?: string | undefined;
      texto?: string | undefined;
      ia_podria?: string | undefined;
      lo_tuyo?: string | undefined;
    }
  >;
  /** Nombre oficial de cada grupo ISCO-08, de 1 a 4 cifras: el de la CIUO-2008 (ca) del Idescat, literal. */
  grupos: Record<string, string>;
  /** Título de cada ocupación ESCO. */
  ocupaciones: Record<string, string>;
  /**
   * Nombre oficial de los grupos CNO-11 que tienen uno solo en la CCO-2011 (ca) del Idescat, literal; los 4 que la
   * CCO parte en dos no están y se enseñan en castellano.
   */
  grupos_cno11: Record<string, string>;
  /** De dónde salen `grupos` y `grupos_cno11`: la cita del Idescat, sus condiciones y la fecha de la consulta. */
  fuente_grupos: { cita: string; licencia: string; consultado: string };
}

/**
 * Datos cargados para el motor. ESCO puede representar sus relaciones como iterable en memoria.
 * La carga y validación pertenecen a sus consumidores: el tipo no comprueba los valores ni elimina campos extra.
 */
export interface Datos {
  /** Total empresarial del INE para la señal general del informe. */
  empresas?: DatosEmpresas;
  /** Contexto censal del grupo por lugar de trabajo; no identifica el sector de una persona. */
  sectores?: DatosSectores;
  esco: DatosEsco;
  oit: DatosOit;
  clasificaciones: DatosClasificaciones;
  cambra: DatosCambra;
  textos: DatosTextos;
  /** Vectores de significado de las tareas oficiales (opcional): para buscar las más parecidas, como hace la OIT. */
  vectores?: VectoresGuardados;
  /**
   * La correspondencia EURES entre ESCO y CO-SISPE (opcional): los títulos del SEPE con que busca la búsqueda de
   * ocupaciones y los códigos con que el contexto desempata. Va aparte de formacion.json, que solo lee el motor de
   * cursos, para que un fallo de la formación no deje sin ella a la búsqueda.
   */
  eures?: DatosEures;
  /** Formación oficial (opcional): ocupación → especialidades del SEPE → cursos del SOC. Solo la lee el motor de cursos. */
  formacion?: DatosFormacion;
  /** Cursos del Consorci para personas que trabajan (opcional): ediciones con fecha de las mismas especialidades. */
  consorci?: DatosConsorci;
  /**
   * Lo comprobado de los enlaces de los datos (opcional): los programas del SEPE que responden, los únicos que se
   * enlazan, y las webs de entidades que no, que no se enseñan. Sin el archivo, no se
   * enlaza ningún programa y se enseñan todas las webs.
   */
  enlaces?: EnlacesComprobados | EnlacesComprobadosAnteriores;
  /** Cursos de Citilab en Cornellà para personas adultas (opcional): solo hechos, con el enlace a su ficha. */
  citilab?: DatosCitilab;
  /**
   * Formación abierta en línea (opcional): fichas redactadas por Faro con su criterio. El informe solo la usa si la
   * configuración del despliegue la enciende.
   */
  formacionAbierta?: DatosFormacionAbierta;
  /**
   * Barcelona Activa, solo enlaces (opcional): la ficha de cada ocupación en su Catàleg d'ocupacions y las formaciones
   * de IA del Cibernàrium, que solo llegan al informe con la formación abierta encendida.
   */
  barcelonaActiva?: DatosBarcelonaActiva;
  /**
   * FUNDAE (opcional): ediciones en teleformación de la oferta estatal para personas trabajadoras, solo hechos y enlaces.
   * La hoja de ruta las da como convocatoria de su programa del SEPE mientras su preinscripción está abierta.
   */
  fundae?: DatosFundae;
  /** La comarca de cada municipio, del Idescat (opcional): la hoja de ruta filtra con ella lo presencial. */
  comarcas?: DatosComarcas;
  /** «Qué aprenderás» de cada especialidad, literal de su ficha oficial (opcional): lo enseña la hoja de ruta. */
  temarios?: DatosTemarios;
  /** Vectores de los nombres de especialidades y ocupaciones (opcional): ordenar por parecido y sugerir. */
  vectoresFormacion?: { especialidades: VectoresGuardados; ocupaciones: VectoresGuardados };
  /** Datos por ocupación en Cataluña (opcional): personas ocupadas, mujeres, edad y contratación. */
  cataluna?: DatosCataluna;
  /** Censo anual del Idescat (opcional): personas ocupadas por grupo en Cataluña y en la comarca del Baix Llobregat. */
  ocupados?: DatosOcupados;
  /** Perfil de cada grupo en el Censo 2021 (opcional): estudios y situación profesional. */
  censo?: DatosCenso;
  /** Encuesta TIC-H del INE (opcional): uso declarado de la IA generativa en el trabajo por grupo. */
  tich?: DatosTich;
  /** Encuesta de Estructura Salarial del INE (opcional): salario medio por gran grupo y estudios en Cataluña. */
  salarios?: DatosSalarios;
  /** Observatori del Treball (opcional): contratos de cada ocupación por provincia. */
  observatori?: DatosObservatori;
  /**
   * Mercado de trabajo por ocupación (opcional): empleo de la EPA, salario de la EAES, contratos por año y por comarca y
   * ofertas del servicio público de empleo. Lo lee el informe breve «La IA y tu trabajo» (informe-breve.ts).
   */
  mercado?: DatosMercado;
  /** Consenso de los métodos de exposición a la IA por ocupación (opcional): la confianza del informe breve. */
  metodos?: DatosMetodos;
  /** Traducciones de Faro al catalán (opcional): sin ellas, en catalán los datos se muestran en castellano. */
  catalan?: DatosCatalan;
  /**
   * Acreditación de competencias (opcional): certificados profesionales del SOC y las ocupaciones que les relaciona su
   * real decreto: el bloque «Acreditar lo que ya sabes hacer» del informe.
   */
  acreditacion?: DatosAcreditacion;
  /**
   * Certificados que el SEPE relaciona con cada ocupación ESCO en sus perfiles de la oferta de empleo (opcional),
   * aparte de los comprobados por Faro: el bloque de acreditación los enseña con su aviso.
   */
  perfilesSepe?: DatosPerfilesSepe;
  /** Certificados que el SEPE relacionó con cada ocupación ESCO en su informe de necesidades de 2016 (opcional). */
  certificadosSepe2016?: DatosCertificadosSepe2016;
  /**
   * Necesidades formativas que el SEPE publica por ocupación de la CNO-11 (opcional): «Lo que se pide en tu
   * ocupación».
   */
  necesidades?: DatosNecesidades;
  /**
   * La acreditación oficial de competencias digitales de la Generalitat, ACTIC (opcional): la lee el bloque digital.
   */
  actic?: DatosActic;
}
