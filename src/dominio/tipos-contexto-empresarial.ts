// Proyecciones admitidas para el informe: empresas y personas ocupadas del censo conservan bases separadas.

interface VigenciaContexto {
  periodo: string;
  publicado: string | null;
  siguiente_prevista: string | null;
  calendario: string;
  fuente: string;
}

/** Total catalán de la encuesta empresarial del INE, sin asignarlo a una ocupación. */
export interface DatosEmpresas {
  fuente: string;
  vigencia: VigenciaContexto;
  encuesta: {
    edicion: string;
    medida: string;
    poblacion: string;
    periodo: string;
    error: string;
    denominador: string | null;
    clasificacion: string | null;
    ruptura: string | null;
    ambito: string | null;
  };
  cataluna: { total: number | null };
  capturas: { tipo: 'tabla' | 'notas'; archivo: string; url: string; sha256: string; descargado_utc: string }[];
}

/** Reparto publicado: el resto es de la fuente, nunca una diferencia inventada por el consumidor. */
export interface RepartoSectorial {
  personas: number;
  sectores?: [actividad: string, porcentaje: number, personas: number][];
  otros_pct?: number;
  ver_cno2?: string;
  sin_reparto?: boolean;
}

/** Censo 2021 por lugar de trabajo del establecimiento, en Cataluña. */
export interface DatosSectores {
  fuente: string;
  vigencia: VigenciaContexto;
  fecha_de_referencia: string;
  lugar: string;
  clasificacion_actividad: 'CNAE-2009';
  clasificacion_ocupacion: 'CNO-11';
  min_personas_sector: number;
  min_pct_sector: number;
  min_personas_grupo: number;
  actividades: Record<string, string>;
  cataluna: { nombre: string; cno3: Record<string, RepartoSectorial>; cno2: Record<string, RepartoSectorial> };
}

/** Contexto del grupo seleccionado sin atribuirle un sector individual ni una tasa empresarial. */
export interface ContextoSectorial {
  fuente: string;
  fecha: string;
  periodo: string;
  grupoSolicitado: string;
  grupoMostrado: string;
  remision: boolean;
  personas: number;
  sectores: { codigo: string; nombre: string; porcentaje: number; personas: number }[];
  otros: number | null;
  minimoPersonas: number;
  minimoPorcentaje: number;
}
