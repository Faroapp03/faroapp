// Contrato del recurso estático público admitido. No contiene ocultas o decisiones internas.
/**
 * La 7 añade a la 6 el bloque opcional `clasificacion`. El productor emite la 7 y un catálogo publicado con la 6 se
 * sigue leyendo, así que este lector admite las dos.
 */
export const VERSION_CATALOGO_CON_CLASIFICACION = 7;
export const VERSION_CATALOGO = 6;
export const VERSION_CATALOGO_CON_MATERIA = 5;
export const VERSION_CATALOGO_ANTERIOR = 4;
export const MAX_BYTES_CATALOGO = 33_554_432;
export const MAX_FILAS_CATALOGO = 100_000;
export const MAX_TEXTO_CATALOGO = 2_048;
export const MAX_IDIOMAS_CATALOGO = 50;
export const CAMPOS_SIN_PROYECCION = ['acceso_fundae', 'marca_comercial', 'nivel_entrada', 'nivel_salida'] as const;
export const CAMPOS_CALENDARIO = ['calendario_matricula', 'calendario_formacion', 'calendario_aula'] as const;
export const CAMPOS_HECHOS = [
  'idiomas_declarados',
  'idiomas_material_observado',
  'modalidad',
  'sincronia',
  'horas_publicadas',
  'coste_formacion_tipo',
  'coste_formacion',
  'certificado_gratuito',
  'coste_certificado',
  'coste_practicas',
  'requiere_registro_previo',
  'requisitos_publicados',
  ...CAMPOS_SIN_PROYECCION,
  ...CAMPOS_CALENDARIO,
] as const;
export type CampoHecho = (typeof CAMPOS_HECHOS)[number];
export const MOTIVOS_HECHO = [
  'conocido',
  'no_consta_en_evidencia',
  'no_interpretable',
  'sin_soporte_de_campo',
  'texto_no_redistribuido',
  'declaraciones_contradictorias',
] as const;
export const ALCANCES_HECHO = ['unidad', 'edicion', 'declaracion_general', 'material_observado'] as const;
export const MODALIDADES = ['en-linea', 'presencial', 'mixta'] as const;
export const SINCRONIAS = ['asincrona', 'sincrona', 'mixta'] as const;
export const COSTES = [
  'gratis_formacion',
  'gratis_parcial',
  'gratis_parcial_temporal',
  'contenido_gratuito_practicas_por_confirmar',
  'de_pago',
] as const;

export interface PeriodoCalendario {
  readonly inicio: string | null;
  readonly fin: string | null;
}
export type CalendarioCatalogo =
  | (PeriodoCalendario & { readonly tipo: 'matricula' | 'periodo-formativo' | 'ventana-acceso' })
  | { readonly tipo: 'sesiones'; readonly sesiones: readonly PeriodoCalendario[] };

export interface HechoCatalogo {
  readonly valor: string | number | boolean | readonly string[] | CalendarioCatalogo | null;
  readonly motivo: (typeof MOTIVOS_HECHO)[number];
  readonly unidad: 'h' | null;
  readonly moneda: string | null;
  readonly alcance: (typeof ALCANCES_HECHO)[number];
  readonly vigencia?: { readonly comprobado_el: string };
}
export type HechosCatalogo = Readonly<Record<CampoHecho, HechoCatalogo>>;
export interface ReferenciaCatalogo {
  readonly url: string;
  readonly sha256: string;
  readonly fecha_referencia: string;
  readonly alcance: 'entidad';
  readonly naturaleza_fecha: 'no_acreditada' | 'declarada_historica' | 'recepcion_conservada';
  readonly naturaleza_documento: 'no_acreditada' | 'derivado_negocio';
}
export interface ProveedorCatalogo {
  readonly id: string;
  readonly nombre: string;
}
export interface EvidenciaMateriaCatalogo {
  readonly version: 1;
  readonly actividad_id: string;
  readonly programa_id: string;
  readonly edicion_id: string;
  readonly vinculo: {
    readonly url: string;
    readonly sha256: string;
    readonly capturado_utc: string;
    readonly localizador: string;
  };
  readonly contenido: {
    readonly metodo: 'cibernarium-descripcion-api-v1';
    /** Orientación reproducible, anclada al contenido y a la huella canónica del tesauro. */
    readonly nivel_sugerido?: {
      readonly valor: 'inicial' | 'intermedio' | 'avanzado';
      readonly origen: 'categoria' | 'descripcion';
      readonly regla: 'nivel-cibernarium-v1' | 'nivel-cibernarium-v2' | 'nivel-cibernarium-v3';
    };
    readonly temas_sugeridos?: readonly import('./temario.ts').TemaCurso[];
    readonly reglas_sha256?: string;
    readonly sha256: string;
    readonly url: string;
    readonly sha256_captura: string;
    readonly capturado_utc: string;
    readonly localizador: string;
  } | null;
  readonly censo_ia: {
    readonly ambito: 'ia';
    readonly url: string;
    readonly sha256: string;
    readonly capturado_utc: string;
    readonly localizador: string;
  } | null;
  readonly estado_censo: 'completo' | 'parcial' | 'sin-evidencia';
}
export const COLECTIVOS_FUNDAE = [
  'asalariados',
  'autonomos',
  'economia-social',
  'administracion-publica',
  'desempleados',
  'erte',
] as const;
export interface PreinscripcionFundae {
  readonly inicio: string;
  readonly fin: string;
  readonly centro: string;
  readonly colectivos: readonly (typeof COLECTIVOS_FUNDAE)[number][];
  readonly sector: string;
}
/** Códigos que viajan en `clasificacion`: los textos que lee la persona los pone la web a partir de ellos. */
export const IDIOMAS_CLASIFICACION = ['ca', 'en', 'es'] as const;
export const NIVELES_CLASIFICACION = ['inicial', 'intermedio', 'avanzado'] as const;
export const ESTADOS_CLASIFICACION = ['fuente', 'orientacion-faro', 'por-confirmar'] as const;
export const ALCANCES_CLASIFICACION = ['edicion', 'programa', 'norma-general', 'actividad'] as const;
export const CERTEZAS_CLASIFICACION = ['alta', 'media', 'baja'] as const;
export const MOTIVOS_POR_CONFIRMAR = ['fuente_no_publica', 'conflicto_evidencias', 'sin_captura'] as const;
export interface EvidenciaClasificacionCatalogo {
  readonly url: string;
  readonly sha256: string;
  readonly capturado_utc: string;
  readonly localizador: string;
}
export interface ReglaClasificacionCatalogo {
  readonly id: string;
  readonly version: number;
  readonly sha256: string;
}
/** Quién afirma el dato y en qué se apoya; un dato por confirmar no lleva valor, alcance, certeza ni regla. */
export interface ApoyoClasificacionCatalogo {
  readonly estado: (typeof ESTADOS_CLASIFICACION)[number];
  readonly alcance: (typeof ALCANCES_CLASIFICACION)[number] | null;
  readonly certeza: (typeof CERTEZAS_CLASIFICACION)[number] | null;
  readonly regla: ReglaClasificacionCatalogo | null;
  readonly evidencias: readonly EvidenciaClasificacionCatalogo[];
  readonly motivo_por_confirmar: (typeof MOTIVOS_POR_CONFIRMAR)[number] | null;
}
export type MateriaClasificacion = Exclude<import('./temario.ts').TemaCurso, 'no-indicado'>;
export interface ClasificacionCatalogo {
  readonly idioma?: ApoyoClasificacionCatalogo & {
    readonly valores: readonly (typeof IDIOMAS_CLASIFICACION)[number][] | null;
  };
  readonly nivel?: ApoyoClasificacionCatalogo & { readonly valor: (typeof NIVELES_CLASIFICACION)[number] | null };
  readonly materia?: ApoyoClasificacionCatalogo & { readonly valores: readonly MateriaClasificacion[] | null };
}
export interface OfertaCatalogo {
  readonly unidad: {
    readonly tipo: 'recurso' | 'edicion';
    readonly id: string;
    readonly programa_id: string;
  };
  readonly proveedor_id: string;
  readonly titulo_programa: string;
  readonly tipo_unidad: string;
  readonly url: string;
  readonly hechos: HechosCatalogo;
  readonly referencias: readonly ReferenciaCatalogo[];
  /** Obligatorio en v5; ausente en la entrega histórica v4. */
  readonly evidencia_materia?: EvidenciaMateriaCatalogo | null;
  /** Trámite de la edición y del centro publicados por FUNDAE desde la versión 6. */
  readonly preinscripcion?: PreinscripcionFundae;
  readonly nivel_actividad?: {
    readonly valor: 'inicial' | 'intermedio' | 'avanzado';
    readonly literal: 'Básico' | 'Intermedio' | 'Avanzado';
    readonly actividad_id: string;
    readonly material_id: string;
    readonly url: string;
    readonly sha256: string;
    readonly capturado_utc: string;
    readonly localizador: string;
  };
  /** Orientación por continuidad en un itinerario propio, anclada a la ficha. */
  readonly nivel_itinerario?: {
    readonly unidad_id: string;
    readonly programa_id: string;
    readonly titulo: string;
    readonly url: string;
    readonly sha256: string;
    readonly localizador: string;
    readonly valor: 'inicial' | 'intermedio';
    readonly version: 'cibernarium-itinerario-v1' | 'cibernarium-ficha-tareas-v1';
  };
  /** Orientación Faro por el objetivo del programa; no es un nivel declarado. */
  readonly nivel_objetivos?: {
    readonly unidad_id: string;
    readonly programa_id: string;
    readonly titulo: string;
    readonly url: string;
    readonly sha256: string;
    readonly localizador: string;
    readonly reglas_sha256: string;
    readonly valor: 'inicial' | 'intermedio' | 'avanzado';
    readonly regla: string;
    readonly version: string;
  };
  readonly evidencia_temas?: {
    readonly unidad_id: string;
    readonly programa_id: string;
    readonly titulo: string;
    readonly url: string;
    readonly sha256: string;
    readonly localizador: string;
    readonly reglas_sha256: string;
    readonly temas: readonly import('./temario.ts').TemaCurso[];
  };
  readonly idioma_programa?: { readonly valores: readonly ['es']; readonly url: string; readonly sha256: string };
  /** Idioma, nivel y materia decididos en el productor, desde la versión 7; cada dato es opcional. */
  readonly clasificacion?: ClasificacionCatalogo;
  readonly comprobado_el: string;
  /** Límite publicado aplicable más próximo; null si la fuente no publica ninguno. */
  readonly cierra_el: string | null;
  /**
   * Última revisión en que el enlace no respondió como se esperaba (UTC); null si no hubo incidencia. Solo avisa:
   * la oferta se sigue mostrando con su enlace.
   */
  readonly incidencia_enlace_el: string | null;
  readonly corte_evaluacion_utc: string;
}
export interface EntregaCatalogo {
  readonly schema_version:
    | typeof VERSION_CATALOGO_CON_CLASIFICACION
    | typeof VERSION_CATALOGO
    | typeof VERSION_CATALOGO_CON_MATERIA
    | typeof VERSION_CATALOGO_ANTERIOR;
  readonly corte_proyeccion_utc: string;
  readonly revision: string;
  readonly derechos: {
    readonly alcance: 'indices_y_hechos_estructurados';
    readonly licencia_contenidos: null;
    readonly redistribuye_contenidos: false;
  };
  readonly proveedores: readonly ProveedorCatalogo[];
  readonly ofertas: readonly OfertaCatalogo[];
  readonly cobertura: Readonly<Record<'recurso' | 'edicion', number>>;
}
/** Solo la composición de una entrega admitida suministra esta referencia de bytes. */
export interface ReferenciaEntregaCatalogo {
  readonly sha256: string;
  readonly bytes: number;
  readonly revision: string;
}
export class CatalogoNoValido extends Error {}
