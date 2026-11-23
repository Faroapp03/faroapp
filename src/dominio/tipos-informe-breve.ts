// Contrato del informe breve «La IA y tu trabajo» (sus dos primeras hojas): las cifras y las decisiones que toma
// dominio/informe-breve.ts con reglas fijas, iguales para todas las ocupaciones. Los textos los escribe la
// presentación (presentacion/informe-breve/). Tipos y versión propia del objeto breve.

import type { ContextoSectorial, DatosEmpresas } from './tipos-contexto-empresarial.ts';
import type { Tiempo } from './tipos-entrada.ts';
import type { Franja } from './tipos-informe.ts';
import type { Tercio } from './tipos-metodos.ts';

/** Versión del objeto breve de REST, independiente del informe completo y del transporte. */
export const VERSION_INFORME_BREVE = 2;

/** Hacia dónde ha ido un dato en un año. «sin-dato»: no hay con qué comparar. */
export type Direccion = 'sube' | 'baja' | 'estable' | 'sin-dato';

/** Confianza de una conclusión, en tres niveles. */
export type Confianza = 'alta' | 'media' | 'baja';

/** De quién es la nota de una tarea: de la OIT o una estimación de Faro con la rúbrica de la OIT. */
export type OrigenDeLaNota = 'oit' | 'faro';

/** Una tarea de la persona, con su nota de 0 a 100 (null: sin nota) y de quién es esa nota. */
export interface TareaBreve {
  nombre: string;
  tiempo: Tiempo;
  valor: number | null;
  franja: Franja | null;
  /** null: la tarea no tiene nota. */
  origen: OrigenDeLaNota | null;
  /** Estimación de Faro cuyas repeticiones difirieron mucho. */
  incierta: boolean;
}

/** Conclusión 01: la exposición media de las tareas, ponderada por el tiempo que la persona dedica a cada una. */
export interface ExposicionBreve {
  /** De 0 a 100. */
  valor: number;
  minimo: number;
  maximo: number;
  nivel: Franja;
  confianza: Confianza;
  /** Por qué esa confianza. */
  motivo: 'modelos' | 'margen-ancho' | 'tareas-sin-nota' | 'metodos';
  /**
   * Cuántos métodos publicados (contando la OIT) sitúan la ocupación en el mismo tercio de exposición que la OIT, de
   * cuántos con dato; null si no hay al menos tres con dato.
   */
  metodos: { coinciden: number; total: number; tercio: Tercio } | null;
  conNota: number;
  sinNota: number;
  /** Cuántas de las tareas con nota tienen una estimación de Faro y no la nota de la OIT. */
  estimadasPorFaro: number;
}

/** Conclusión 02: cuántas personas de su grupo dicen usar la IA generativa para trabajar (encuesta TIC-H del INE). */
export interface UsoBreve {
  /** De cada 100, redondeado. */
  deCada100: number;
  intervalo: [number, number];
  anio: string;
  /** Los años de la encuesta que trae el paquete, del más antiguo al más reciente: los que el informe puede afirmar. */
  aniosMedidos: string[];
  ambito: 'cataluna' | 'espana';
  /** Gran grupo ISCO-08 (1 cifra) si la cifra es de un gran grupo; si no, null. */
  granGrupo: string | null;
  /** Título oficial del grupo cuando no es un gran grupo (cifras de España por grupo o bloque). */
  grupo: string | null;
  confianza: Confianza;
}

/** Conclusión 03: lo que completa hoy la IA en trabajos largos de ordenador (dato general, el mismo para todos). */
export interface CapacidadBreve {
  deCada100: number;
  /** Horas que tarda una persona en esas tareas (mediana). */
  horasPersona: number;
  anio: number;
  /** La que admite el tipo de afirmación del registro de hechos. */
  confianza: Confianza;
}

/** Contratación de la ocupación en los últimos 12 meses (Observatori del Treball). */
export interface ContratacionBreve {
  /** Grupos cuyos recuentos se suman; no acredita personas únicas entre grupos. */
  gruposCno: string[];
  personas: number;
  /** Variación anual en %, sin redondear; null si no se publica. */
  variacion: number | null;
  direccion: Direccion;
  /** Mes y año del final del periodo, como los da la fuente («junio de 2026»). */
  hasta: string | null;
}

/**
 * Comparación de recuentos de personas contratadas y demandantes no ocupadas en el mismo periodo y ocupación.
 * Son poblaciones distintas: la relación no mide colocación ni probabilidades individuales.
 */
export interface ComparacionContratacionDemandaBreve {
  /** Grupos cuyos recuentos se suman; no hay deduplicación acreditada entre ellos. */
  gruposCno: string[];
  personasContratadas: number;
  personasDemandantes: number;
  /** Relación entre los recuentos, sin redondear; puede superar uno. */
  contratadasPorDemandante: number;
  anteriorContratadasPorDemandante: number | null;
  /** Variación anual de la ratio, en %, sin redondear; null si no se publica para todos sus grupos. */
  variacion: number | null;
  direccion: Direccion;
  /** Periodo común de los dos recuentos («12 meses a junio de 2026»). */
  periodo: string;
}

/** Peso de la ocupación en las ofertas del servicio público de empleo. */
export interface OfertasBreve {
  /** De cada 100 ofertas, este año y el anterior (sin redondear). */
  pct: number;
  pctAnterior: number | null;
  direccion: Direccion;
  /** El nivel de la cifra: la ocupación o un grupo más amplio (con su nombre). */
  nivel: 'ocupacion' | 'grupo';
  grupo: string | null;
  periodo: string;
}

/** Personas ocupadas en el gran grupo de la ocupación en Cataluña (EPA) o en su grupo del censo (Idescat). */
export interface EmpleoBreve {
  personas: number;
  variacion: number | null;
  direccion: Direccion;
  /** EPA: las personas de la misma media un año antes; null en el censo o si falta algún trimestre. */
  anterior: number | null;
  fuente: 'epa' | 'censo';
  /** Gran grupo CNO-11 (EPA) o código del grupo del censo. */
  codigo: string;
  /** Nombre oficial del grupo (censo) o null (EPA: la presentación lo nombra por su gran grupo). */
  grupo: string | null;
  /** Periodo: «2T 2026» (EPA, último trimestre) o el año del censo. */
  hasta: string;
}

/** Ganancia media anual del grupo de la EAES, en España. */
export interface SalarioBreve {
  euros: number;
  variacion: number | null;
  direccion: Direccion;
  anio: number;
  anioAnterior: number;
  /** Cuánto menos cobran las mujeres que los hombres, en %, redondeado; negativo si cobran más. */
  brecha: number | null;
  grupo: string;
}

/** Contratos por periodos de doce meses al corte de la fuente. */
export interface AnualBreve {
  /** Corte de la fuente; ausente en los breves anteriores, que solo admitían julio-junio. */
  periodo?: string;
  etiquetas: string[];
  valores: number[];
  publicado: boolean[];
}

/** Dónde se firman los contratos: las tres primeras comarcas y el resto, de cada 100. */
export interface ComarcasBreve {
  primeras: { nombre: string; deCada100: number }[];
  resto: { comarcas: number; deCada100: number };
}

/** Una fila del perfil: el dato del grupo y el de todas las ocupaciones de Cataluña, en %. */
export interface FilaPerfil {
  dato: 'mujeres' | 'menores30' | 'mayores55' | 'universitarios';
  grupo: number;
  conjunto: number;
}

/** Quién trabaja en la ocupación (censo). */
export interface PerfilBreve {
  filas: FilaPerfil[];
  grupo?: { cno: string; nombre: string };
  /** Los años de los datos («2021», «2023»), de menos a más reciente. */
  cuando: string[];
  /** Por cada 10 menores de 30, cuántas personas de 55 o más: en el grupo y en todas las ocupaciones. */
  relevo: { grupo: number; conjunto: number } | null;
}

export interface GrupoOdeeBreve {
  cno: string;
  nombre: string | null;
  nivel: number;
  niveles: number;
  gruposEnElNivel: number;
  gruposEstudiados: number;
  desde: number | null;
}

export interface ContratosMensualesBreve {
  meses: string[];
  valores: number[];
}

export interface TiposDeContratoBreve {
  indefinidos: number;
  diasTemporales: number | null;
  periodo: string;
}

/** Una señal de «Qué vigilar». */
export interface SenalBreve {
  clave: 'empresas' | 'personas' | 'ofertas-ia' | 'normas';
  /** Fecha AAAA-MM-DD del próximo dato o de la aplicación de la norma; null si no tiene fecha fija. */
  proxima: string | null;
  /**
   * Solo en la de las personas: la edición nueva que el INE ya ha publicado y el dato aún no incorpora, con la fecha
   * AAAA-MM-DD (día de Barcelona) en que Faro la observó. Pesa más que la fecha prevista si no es posterior a la
   * fecha del informe.
   */
  publicada?: { anio: string; observada: string; conMicrodatos: boolean };
  /**
   * Solo en la de las personas: el año de la edición cuyo evento ya pasado del calendario del INE trae los valores
   * publicados, si es posterior a la que trae el dato.
   */
  publicadaSegunCalendario?: string;
}

/** El informe breve entero. */
export interface InformeBreve {
  version: typeof VERSION_INFORME_BREVE;
  idioma: 'es' | 'ca';
  fecha: string;
  ocupacion: {
    titulo: string;
    esco: string | null;
    isco08: string;
    /** Grupos CNO-11 de 4 cifras de la estadística que corresponden a la ocupación. */
    cno4: string[];
    /** Gran grupo CNO-11 (1 cifra) de esos grupos, si es uno solo. */
    granGrupo: string | null;
  };
  exposicion: ExposicionBreve | null;
  grupoOdee?: GrupoOdeeBreve;
  uso: UsoBreve | null;
  capacidad: CapacidadBreve;
  tareas: TareaBreve[];
  menosExpuestas: TareaBreve[];
  mercado: {
    contratacion: ContratacionBreve | null;
    comparacionContratacionDemanda: ComparacionContratacionDemandaBreve | null;
    /** Las ofertas del SOC: no salen en el informe breve (solo las 50 ocupaciones más ofertadas tienen cifra propia). */
    ofertas: OfertasBreve | null;
    empleo: EmpleoBreve | null;
    salario: SalarioBreve | null;
    anual: AnualBreve | null;
    mensual?: ContratosMensualesBreve;
    tiposDeContrato?: TiposDeContratoBreve;
    comarcas: ComarcasBreve | null;
    perfil: PerfilBreve | null;
  };
  /** Encuesta empresarial general admitida; no es un atributo de la persona ni de su ocupación. */
  empresas: DatosEmpresas | null;
  /** Reparto censal del grupo, para consulta exterior a las hojas impresas. */
  sectores: ContextoSectorial | null;
  senales: SenalBreve[];
  /** Mes y año de los datos más recientes que usa («septiembre de 2026»). */
  datosHasta: string | null;
}
