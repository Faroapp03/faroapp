/** Revisión editorial estática de una instantánea concreta; no modifica hechos ni certifica competencias. */

import { jsonCanonico } from '../comun/jcs.ts';
import revisada from './clasificacion-revisada.json' with { type: 'json' };
import type { HechoCatalogo, OfertaCatalogo } from './contrato.ts';
import { firmaEditorial, hechoEditorial, identidadEditorial } from './firma-editorial.ts';
import materias from './materias-revisadas.json' with { type: 'json' };
import type { TemaCurso } from './temas.ts';

export type NivelCurso = 'inicial' | 'intermedio' | 'avanzado';
export interface TextoClasificacion {
  readonly es: string;
  readonly ca: string;
}
export interface EvidenciaClasificacion {
  readonly url: string;
  readonly sha256: string;
  readonly capturadoEl: string | null;
  readonly naturaleza?: string;
  readonly localizador?: string;
}
export interface NivelClasificado {
  readonly valor: NivelCurso | null;
  readonly origen: 'fuente' | 'faro' | 'por-confirmar';
  readonly literal: string | null;
  readonly motivo: TextoClasificacion;
  readonly evidencia: EvidenciaClasificacion | null;
  readonly alcance: string | null;
  readonly escala: string | null;
}
export interface MetadatosClasificados {
  readonly temas: readonly TemaCurso[];
  readonly motivoTemas: TextoClasificacion;
  readonly nivel: NivelClasificado;
}
/** Complemento vinculado a una unidad; la orientación Faro nunca es una declaración del proveedor. */
export interface IdiomaClasificado {
  readonly unidadId: string;
  readonly tipoUnidad: OfertaCatalogo['unidad']['tipo'];
  readonly valorOriginal: HechoCatalogo['valor'];
  readonly motivoOriginal: HechoCatalogo['motivo'];
  readonly modalidadOriginal: HechoCatalogo;
  readonly sincroniaOriginal: HechoCatalogo;
  readonly valores: readonly string[];
  readonly origen: 'fuente' | 'faro';
  readonly alcance: 'edicion' | 'norma-general' | 'orientacion';
  readonly confianza: 'alta' | 'alta-en-la-norma-general' | 'baja';
  readonly literal: string | null;
  readonly motivo: TextoClasificacion;
  readonly resumen?: TextoClasificacion;
  readonly evidencias: readonly EvidenciaClasificacion[];
  readonly anclajesEnOferta: readonly number[];
}
interface ProgramaRevisado extends MetadatosClasificados {
  readonly programaId: string;
  readonly titulo: string;
  readonly proveedorId: string;
  readonly idiomasClasificados?: readonly IdiomaClasificado[];
}
interface SidecarClasificacion {
  readonly schemaVersion: 1;
  readonly catalogoSha256: string;
  readonly programas: readonly ProgramaRevisado[];
  readonly unidadesRevisadas: Readonly<Record<string, string>>;
}
const DATOS = revisada as SidecarClasificacion;
Object.freeze(DATOS.unidadesRevisadas);
export const CLASIFICACION_CATALOGO_SHA256 = DATOS.catalogoSha256;

/** Datos locales de la composición revisada: las pruebas contrastan su SHA con la entrega admitida. */
function congelar<T>(valor: T): T {
  if (valor && typeof valor === 'object') {
    for (const parte of Object.values(valor)) {
      congelar(parte);
    }
    Object.freeze(valor);
  }
  return valor;
}
const POR_TITULO = new Map(DATOS.programas.map((programa) => [programa.titulo, programa.temas]));
const SIN_REVISION: MetadatosClasificados = congelar({
  temas: ['no-indicado'],
  motivoTemas: {
    es: 'No hay una revisión de materia vinculada a esta oferta.',
    ca: 'No hi ha una revisió de matèria vinculada a aquesta oferta.',
  },
  nivel: {
    valor: null,
    origen: 'por-confirmar',
    literal: null,
    motivo: {
      es: 'No hay una revisión de dificultad vinculada a esta oferta. Consulta el programa y los requisitos.',
      ca: 'No hi ha una revisió de dificultat vinculada a aquesta oferta. Consulta el programa i els requisits.',
    },
    evidencia: null,
    alcance: null,
    escala: null,
  },
});
/** El anclaje exige el cuerpo pertinente, sin convertir otra recepción de esos bytes en una revisión nueva. */
function evidenciaEnOferta(evidencia: EvidenciaClasificacion, oferta: OfertaCatalogo): boolean {
  return oferta.referencias.some((r) => r.url === evidencia.url && r.sha256 === evidencia.sha256);
}

export type MotivoRevisionNoAplicada =
  | 'programa-sin-revision'
  | 'titulo-distinto'
  | 'proveedor-distinto'
  | 'unidad-sin-revision'
  | 'firma-distinta'
  | 'evidencia-nivel-ausente'
  | 'nivel-por-confirmar'
  | 'contenido-distinto'
  | 'materia-sin-evidencia'
  | 'identidad-materia-distinta';
export type RevisionClasificacion =
  | { readonly estado: 'aplicada' }
  | { readonly estado: 'no-aplicada'; readonly motivo: MotivoRevisionNoAplicada };
export interface EvaluacionClasificacion {
  readonly metadatos: MetadatosClasificados;
  readonly revision: RevisionClasificacion;
  readonly revisionNivel: RevisionClasificacion;
  readonly revisionContenido: RevisionClasificacion | null;
}

type MotivoPrograma = Exclude<
  MotivoRevisionNoAplicada,
  | 'evidencia-nivel-ausente'
  | 'nivel-por-confirmar'
  | 'contenido-distinto'
  | 'materia-sin-evidencia'
  | 'identidad-materia-distinta'
>;
type ResultadoPrograma =
  | { readonly programa: ProgramaRevisado; readonly motivo: null }
  | { readonly programa: undefined; readonly motivo: MotivoPrograma };

/** El primer motivo explica la primera guarda que no se cumple. */
function programaRevisado(
  oferta: OfertaCatalogo,
  porPrograma: ReadonlyMap<string, ProgramaRevisado>,
  unidades: Readonly<Record<string, string>>,
): ResultadoPrograma {
  const programa = porPrograma.get(oferta.unidad.programa_id);
  if (!programa) {
    return { programa: undefined, motivo: 'programa-sin-revision' };
  }
  if (programa.titulo !== oferta.titulo_programa) {
    return { programa: undefined, motivo: 'titulo-distinto' };
  }
  if (programa.proveedorId !== oferta.proveedor_id) {
    return { programa: undefined, motivo: 'proveedor-distinto' };
  }
  const firma = unidades[identidadEditorial(oferta)];
  if (firma === undefined) {
    return { programa: undefined, motivo: 'unidad-sin-revision' };
  }
  if (firma !== firmaEditorial(oferta)) {
    return { programa: undefined, motivo: 'firma-distinta' };
  }
  return { programa, motivo: null };
}

interface MateriaRevisada {
  readonly programaId: string;
  readonly titulo: string;
  readonly proveedorId: string;
  readonly contenido: {
    readonly metodo: string;
    readonly sha256: string;
    readonly url: string;
    readonly sha256Captura: string;
    readonly capturadoEl: string;
    readonly localizador: string;
  };
  readonly temas: readonly TemaCurso[];
}
interface EvidenciaMateria {
  readonly version: 1;
  readonly actividad_id: string;
  readonly programa_id: string;
  readonly edicion_id: string;
  readonly contenido: { readonly metodo: string; readonly sha256: string } | null;
  readonly censo_ia: { readonly ambito: 'ia' } | null;
  readonly estado_censo: 'completo' | 'parcial' | 'sin-evidencia';
}
type OfertaConMateria = OfertaCatalogo & { readonly evidencia_materia?: EvidenciaMateria | null };
type MateriaActual = {
  temas: readonly TemaCurso[];
  revision: RevisionClasificacion;
  revisionContenido: RevisionClasificacion;
};

function identidadMateriaValida(oferta: OfertaConMateria, evidencia: EvidenciaMateria): boolean {
  return (
    evidencia.version === 1 &&
    oferta.unidad.tipo === 'edicion' &&
    evidencia.programa_id === oferta.unidad.programa_id &&
    evidencia.edicion_id === oferta.unidad.id &&
    Boolean(evidencia.actividad_id)
  );
}

function contenidoCoincide(oferta: OfertaConMateria, ancla: MateriaRevisada, evidencia: EvidenciaMateria): boolean {
  return Boolean(
    evidencia.contenido &&
      ancla.proveedorId === oferta.proveedor_id &&
      ancla.titulo === oferta.titulo_programa &&
      ancla.contenido.metodo === evidencia.contenido.metodo &&
      ancla.contenido.sha256 === evidencia.contenido.sha256,
  );
}

function materiasDeContenido(
  oferta: OfertaConMateria,
  evidencia: EvidenciaMateria | null | undefined,
  ancla: MateriaRevisada | undefined,
) {
  if (!ancla) {
    return {
      temas: [] as TemaCurso[],
      revisionContenido: { estado: 'no-aplicada', motivo: 'programa-sin-revision' } as RevisionClasificacion,
    };
  }
  const coincide = Boolean(ancla && evidencia && contenidoCoincide(oferta, ancla, evidencia));
  const temas: TemaCurso[] = coincide && ancla ? [...ancla.temas] : [];
  const motivoContenido = ancla && evidencia?.contenido && !coincide ? 'contenido-distinto' : 'materia-sin-evidencia';
  const revisionContenido: RevisionClasificacion =
    coincide && ancla?.temas.length ? { estado: 'aplicada' } : { estado: 'no-aplicada', motivo: motivoContenido };
  return { temas, revisionContenido };
}

function revisionDeNivel(oferta: OfertaCatalogo, resultado: ResultadoPrograma): RevisionClasificacion {
  if (!resultado.programa) {
    return { estado: 'no-aplicada', motivo: resultado.motivo };
  }
  if (
    resultado.programa.nivel.valor !== null &&
    (!resultado.programa.nivel.evidencia || !evidenciaEnOferta(resultado.programa.nivel.evidencia, oferta))
  ) {
    return { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' };
  }
  if (resultado.programa.nivel.valor === null) {
    return { estado: 'no-aplicada', motivo: 'nivel-por-confirmar' };
  }
  return { estado: 'aplicada' };
}

function materiaActual(
  oferta: OfertaConMateria,
  porContenido: ReadonlyMap<string, MateriaRevisada>,
): MateriaActual | null {
  if (oferta.proveedor_id !== 'cibernarium' || !('evidencia_materia' in oferta)) {
    return null;
  }
  const evidencia = oferta.evidencia_materia;
  if (evidencia && !identidadMateriaValida(oferta, evidencia)) {
    const revision = { estado: 'no-aplicada' as const, motivo: 'identidad-materia-distinta' as const };
    return { temas: [], revision, revisionContenido: revision };
  }
  const { temas, revisionContenido } = materiasDeContenido(
    oferta,
    evidencia,
    porContenido.get(oferta.unidad.programa_id),
  );
  if (evidencia?.censo_ia?.ambito === 'ia' && evidencia.estado_censo !== 'sin-evidencia' && !temas.includes('ia')) {
    temas.push('ia');
  }
  if (temas.length) {
    return { temas, revision: { estado: 'aplicada' }, revisionContenido };
  }
  return { temas, revision: revisionContenido, revisionContenido };
}

function datosDeMateria(actual: MateriaActual | null, resultado: ResultadoPrograma) {
  if (actual) {
    return {
      revision: actual.revision,
      temas: actual.temas.length ? actual.temas : SIN_REVISION.temas,
      motivoTemas: actual.temas.length
        ? { es: 'Materia vinculada a la evidencia de la fuente.', ca: 'Matèria vinculada a l’evidència de la font.' }
        : SIN_REVISION.motivoTemas,
    };
  }
  return {
    revision: resultado.programa
      ? { estado: 'aplicada' as const }
      : { estado: 'no-aplicada' as const, motivo: resultado.motivo },
    temas: resultado.programa?.temas ?? SIN_REVISION.temas,
    motivoTemas: resultado.programa?.motivoTemas ?? SIN_REVISION.motivoTemas,
  };
}

function faltaSoporteHistorico(oferta: OfertaCatalogo, programa: ProgramaRevisado | undefined): boolean {
  return Boolean(programa?.nivel.evidencia && !evidenciaEnOferta(programa.nivel.evidencia, oferta));
}

function evaluarPrograma(
  oferta: OfertaCatalogo,
  resultado: ResultadoPrograma,
  porContenido: ReadonlyMap<string, MateriaRevisada>,
): EvaluacionClasificacion {
  const revisionNivel = revisionDeNivel(oferta, resultado);
  const actual = materiaActual(oferta, porContenido);
  if (!actual && faltaSoporteHistorico(oferta, resultado.programa)) {
    return {
      metadatos: SIN_REVISION,
      revision: { estado: 'no-aplicada', motivo: 'evidencia-nivel-ausente' },
      revisionNivel,
      revisionContenido: null,
    };
  }
  if (!actual && resultado.programa && revisionNivel.estado === 'aplicada') {
    return { metadatos: resultado.programa, revision: { estado: 'aplicada' }, revisionNivel, revisionContenido: null };
  }
  const { revision, temas, motivoTemas } = datosDeMateria(actual, resultado);
  const nivel =
    revisionNivel.estado === 'aplicada' && resultado.programa ? resultado.programa.nivel : SIN_REVISION.nivel;
  return {
    metadatos: { temas, motivoTemas, nivel },
    revision,
    revisionNivel,
    revisionContenido: actual?.revisionContenido ?? null,
  };
}

/** El idioma conserva su propio anclaje, independiente del soporte de la dificultad. */
function idiomaDelPrograma(oferta: OfertaCatalogo, programa: ProgramaRevisado | undefined): IdiomaClasificado | null {
  const hecho = oferta.hechos.idiomas_declarados;
  return (
    programa?.idiomasClasificados?.find(
      (idioma) =>
        idioma.unidadId === oferta.unidad.id &&
        idioma.tipoUnidad === oferta.unidad.tipo &&
        idioma.motivoOriginal === hecho.motivo &&
        JSON.stringify(idioma.valorOriginal) === JSON.stringify(hecho.valor) &&
        jsonCanonico(hechoEditorial(idioma.modalidadOriginal)) ===
          jsonCanonico(hechoEditorial(oferta.hechos.modalidad)) &&
        jsonCanonico(hechoEditorial(idioma.sincroniaOriginal)) ===
          jsonCanonico(hechoEditorial(oferta.hechos.sincronia)) &&
        idioma.anclajesEnOferta.length > 0 &&
        idioma.anclajesEnOferta.every((i) => {
          const evidencia = idioma.evidencias[i];
          return evidencia !== undefined && evidenciaEnOferta(evidencia, oferta);
        }),
    ) ?? null
  );
}

/** La revisión se vincula a una unidad concreta y conserva las firmas recibidas al crear el evaluador. */
export function crearEvaluadorClasificacion(
  datos: Pick<SidecarClasificacion, 'programas' | 'unidadesRevisadas'>,
  nuevas: readonly MateriaRevisada[] = materias.programas as unknown as readonly MateriaRevisada[],
) {
  const porPrograma = new Map(
    datos.programas.map((programa) => [programa.programaId, congelar(structuredClone(programa))]),
  );
  const porContenido = new Map(nuevas.map((programa) => [programa.programaId, congelar(structuredClone(programa))]));
  const unidades = Object.freeze({ ...datos.unidadesRevisadas });
  const revisar = (oferta: OfertaCatalogo) => programaRevisado(oferta, porPrograma, unidades);
  return {
    evaluarClasificacion: (oferta: OfertaCatalogo) => evaluarPrograma(oferta, revisar(oferta), porContenido),
    idiomaClasificadoDelCurso: (oferta: OfertaCatalogo) => idiomaDelPrograma(oferta, revisar(oferta).programa),
  };
}

const EVALUADOR = crearEvaluadorClasificacion(DATOS);
export const evaluarClasificacion = EVALUADOR.evaluarClasificacion;
/** Distingue declaración de la fuente, orientación de Faro y dificultad por confirmar. */
export function metadatosClasificados(oferta: OfertaCatalogo): MetadatosClasificados {
  return evaluarClasificacion(oferta).metadatos;
}
/** Permite conservar la API de títulos sin convertir un título nuevo en una revisión ya hecha. */
export function temasRevisados(titulo: string): readonly TemaCurso[] | null {
  return POR_TITULO.get(titulo) ?? null;
}
/** No sustituye hechos nuevos ni traslada una norma o inferencia a otra modalidad o sincronía. */
export const idiomaClasificadoDelCurso = EVALUADOR.idiomaClasificadoDelCurso;
