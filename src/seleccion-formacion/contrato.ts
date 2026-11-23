/** Contrato propio del camino: sus etapas no son niveles oficiales ni acreditan dominio. */
import type { OfertaCatalogo, ReferenciaEntregaCatalogo } from '../catalogo-cursos/contrato.ts';
import type { IdiomaConOrigen } from '../catalogo-cursos/proyeccion-listado.ts';
import type { Aprendizaje, ReferenciaRegistro, RevisionAprendizaje } from './aprendizaje.ts';

export const ETAPAS = ['inicial', 'intermedio', 'avanzado'] as const;
export type Etapa = (typeof ETAPAS)[number];
export const CRITERIOS = {
  inicial: ['tarea_sencilla', 'privacidad', 'contraste'],
  intermedio: ['tarea_real', 'mejorar_instrucciones', 'criterios_explicitos'],
  avanzado: ['procedimiento_verificable', 'fuentes_y_limites', 'caso_complejo'],
} as const;
export type Criterio = (typeof CRITERIOS)[Etapa][number];
export type TextoRevisado = Readonly<Record<'es' | 'ca', string>>;
export type ViaAvanzada = 'verificacion_rigurosa' | 'automatizacion_supervisada';
export interface CoberturaRevisada {
  readonly criterio: Criterio;
  readonly afirmaciones: readonly string[];
  readonly justificacion: TextoRevisado;
  readonly via: ViaAvanzada | null;
}
/** V1: solo recurso sin edición; no presta requisitos o resultados entre convocatorias. */
export interface FichaAprendizaje {
  readonly programa_id: string;
  /** Lengua de la ficha observada, no de lecciones o materiales no consultados. */
  readonly idioma_ficha: string | null;
  readonly aprendizaje: Aprendizaje;
  /** Ausencia publicada no significa acceso personal acreditado. */
  readonly requisitos: 'publicados' | 'no_publicados' | 'sin_verificar';
  readonly cobertura: readonly CoberturaRevisada[];
  readonly revision: RevisionAprendizaje;
}
export interface CaminoRevisado {
  readonly id: string;
  readonly etapa: Etapa;
  /** Orden pedagógico revisado, sin puntuación ni clasificación por títulos. */
  readonly programas: readonly string[];
  readonly justificacion: TextoRevisado;
  readonly revision: RevisionAprendizaje;
}
export interface CompaneroAprendizaje {
  readonly schema_version: 1;
  readonly catalogo: ReferenciaEntregaCatalogo;
  readonly registro: ReferenciaRegistro;
  /** Bytes UTF-8 exactos del registro nativo, incluidos su procedencia y sus escalas. */
  readonly registro_json: string;
  readonly fichas: readonly FichaAprendizaje[];
  readonly caminos: readonly CaminoRevisado[];
}
export interface PreferenciasSeleccion {
  readonly etapa: Etapa;
  readonly idiomas: readonly string[];
  readonly modalidad: 'en-linea' | 'presencial' | 'cualquiera';
  /** null es «Prefiero revisarlo antes», el valor inicial del formulario: no es una negativa. */
  readonly aceptaRegistro: boolean | null;
  /** IDs de requisitos literales que la persona declara cumplir; nunca un diagnóstico. */
  readonly requisitosConfirmados: readonly string[];
  readonly excluidos: readonly string[];
}
export type MotivoDescarte =
  | 'sin_oferta_vigente'
  | 'coste_no_acreditado'
  | 'idioma_no_acreditado'
  | 'modalidad_no_coincide'
  | 'registro_no_aceptado'
  | 'requisitos_sin_verificar'
  | 'requisito_sin_confirmar'
  | 'aprendizaje_pendiente'
  | 'excluido';
export interface RecursoSeleccionado {
  readonly oferta: OfertaCatalogo;
  readonly ficha: FichaAprendizaje;
  readonly cobertura: readonly CoberturaRevisada[];
}
export interface CaminoSeleccionado {
  readonly id: string;
  readonly justificacion: TextoRevisado;
  readonly recursos: readonly RecursoSeleccionado[];
  readonly huecos: readonly Criterio[];
  readonly completo: boolean;
  readonly programasPendientes: readonly string[];
}
/**
 * Lo que decide la revisión editorial de una afirmación de requisito: una condición revisada, una información que no
 * condiciona el curso o una afirmación sin revisión vigente, que se trata con prudencia como condición.
 */
export type CasoRequisito = 'condicion' | 'informativa' | 'sin_revisar';
export interface RequisitoRevisado {
  /** Identificador compuesto que guarda la confirmación: JSON.stringify([programa_id, afirmacion.id]). */
  readonly id: string;
  readonly programa_id: string;
  readonly caso: CasoRequisito;
  /** El texto publicado en la ficha, en su idioma. */
  readonly descripcion: string;
  readonly idioma: string | null;
  /** Solo en una condición revisada: su resumen en castellano y en catalán. */
  readonly resumen: TextoRevisado | null;
}
export type BloquePlan = 'ia' | 'digital';
/** Un dato de la oferta que no consta: el curso se propone igualmente y la hoja lo dice. */
export type DatoPorConfirmar = 'registro_previo' | 'idioma' | 'modalidad';
export interface OpcionPlan {
  readonly bloque: BloquePlan;
  readonly oferta: OfertaCatalogo;
  readonly aprendizaje: FichaAprendizaje | null;
  /** Los requisitos publicados de su ficha, ya revisados; vacío si no hay ficha. */
  readonly requisitos: readonly RequisitoRevisado[];
  readonly proveedor: string;
  readonly motivo: TextoRevisado;
  /** Los idiomas que admiten la oferta y de dónde salen, con la misma decisión que pinta Cursos. */
  readonly idioma: IdiomaConOrigen;
  /** Lo que la fuente no publica de esta oferta, en un orden fijo; vacío si consta todo. */
  readonly porConfirmar: readonly DatoPorConfirmar[];
}
export interface OpcionesPlan {
  readonly ia: readonly OpcionPlan[];
  readonly digital: readonly OpcionPlan[];
}
export interface SeleccionFormacion {
  readonly schema_version: 2;
  readonly opciones: OpcionesPlan;
  readonly calculado_el: string;
  readonly etapa: Etapa;
  readonly estado: 'completa' | 'parcial' | 'sin_oferta';
  readonly camino: CaminoSeleccionado | null;
  readonly complementarios: readonly RecursoSeleccionado[];
  readonly descartes: readonly { readonly programa_id: string; readonly motivo: MotivoDescarte }[];
  readonly huecos: readonly Criterio[];
  /** Solo condiciones revisadas y afirmaciones sin revisar: lo informativo nunca pide confirmación. */
  readonly requisitosPendientes: readonly RequisitoRevisado[];
}
export class AprendizajeNoValido extends Error {}
