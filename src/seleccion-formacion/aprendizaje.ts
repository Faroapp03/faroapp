/** La forma nativa de contrato_aprendizaje.py, sin equivalencias entre escalas o etapas. */
export interface ReferenciaRegistro {
  readonly id: string;
  readonly version: string;
  readonly sha256: string;
}
export interface IdentidadCompetencia {
  readonly marco: string;
  readonly version: string;
  readonly codigo: string;
}
export interface MetodoAprendizaje {
  readonly nombre: string;
  readonly version: string;
}
export interface RevisionAprendizaje {
  readonly tipo: 'humana' | 'automatizada';
  readonly referencia: string;
  readonly metodo: MetodoAprendizaje;
  readonly fecha_utc: string;
}
export interface EvidenciaAprendizaje {
  readonly url: string;
  readonly capturado_utc: string;
  readonly sha256: string;
  readonly localizador: { readonly tipo: 'objetivo' | 'modulo' | 'requisito'; readonly valor: string };
  readonly fragmento: string;
}
export interface AfirmacionAprendizaje {
  readonly id: string;
  readonly competencia: IdentidadCompetencia | null;
  readonly dimension: 'requisito_entrada' | 'resultado_previsto';
  readonly descripcion: string | null;
  readonly nivel: {
    readonly escala: { readonly id: string; readonly version: string } | null;
    readonly valor: string | null;
  };
  readonly origen: 'extraccion_oficial' | 'inferencia';
  readonly estado: 'extraida' | 'propuesta' | 'revisada';
  readonly metodo: MetodoAprendizaje;
  readonly revision: RevisionAprendizaje | null;
  readonly evidencias: readonly EvidenciaAprendizaje[];
  readonly discrepancias: readonly {
    readonly descripcion: string;
    readonly evidencias: readonly EvidenciaAprendizaje[];
  }[];
  readonly revision_requerida: boolean;
}
export interface Aprendizaje {
  readonly schema_version: 1;
  readonly registro: ReferenciaRegistro;
  readonly contenido_observado: boolean;
  readonly afirmaciones: readonly AfirmacionAprendizaje[];
}
/** Una extracción o inferencia revisada y sin discrepancias no demuestra dominio personal. */
export function afirmacionUtilizable(afirmacion: AfirmacionAprendizaje): boolean {
  return (
    afirmacion.descripcion !== null &&
    afirmacion.evidencias.length > 0 &&
    !afirmacion.revision_requerida &&
    afirmacion.discrepancias.length === 0 &&
    ((afirmacion.origen === 'extraccion_oficial' && afirmacion.estado === 'extraida') ||
      (afirmacion.origen === 'inferencia' && afirmacion.estado === 'revisada' && afirmacion.revision !== null))
  );
}
