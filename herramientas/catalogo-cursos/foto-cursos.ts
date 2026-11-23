/** Fotografía, unidad a unidad, de la clasificación que muestra Cursos y de lo que el plan de formación admite. */
import { evaluarClasificacion } from '../../src/catalogo-cursos/clasificacion.ts';
import type { EntregaCatalogo, OfertaCatalogo } from '../../src/catalogo-cursos/contrato.ts';
import type { FichaListado } from '../../src/catalogo-cursos/listado.ts';
import { formacionGratuita, proyectarListado } from '../../src/catalogo-cursos/proyeccion-listado.ts';
import type { CompaneroAprendizaje, MotivoDescarte } from '../../src/seleccion-formacion/contrato.ts';
import { seleccionarFormacion } from '../../src/seleccion-formacion/seleccionar.ts';

/** Las tres maneras en que la persona recibe un dato: declarado por la fuente, orientado por Faro o sin confirmar. */
export type EstadoDato = 'fuente' | 'orientacion-faro' | 'por-confirmar';
export interface DatoFotografiado {
  readonly valor: unknown;
  readonly origen: string | null;
  readonly estado: EstadoDato;
}
export interface UnidadFotografiada {
  readonly clave: string;
  readonly fuente: string;
  readonly titulo: string;
  readonly datos: Readonly<Record<string, DatoFotografiado>>;
}

const HUELLA_NULA = '0000000000000000000000000000000000000000000000000000000000000000';
// El orden fijo de los idiomas que la persona puede pedir en su plan.
const IDIOMAS_DEL_PLAN = ['ca', 'en', 'es'] as const;
// Descartes que no dicen nada del idioma: la oferta no llega a la comprobación de idioma.
const DESCARTES_PREVIOS_AL_IDIOMA: readonly MotivoDescarte[] = ['coste_no_acreditado', 'sin_oferta_vigente'];
// Lo que la web rotula como declarado por la fuente, a la escala que sea (edición, programa o norma general).
const ORIGENES_IDIOMA_DE_LA_FUENTE = new Set(['edicion', 'programa', 'norma-general']);

/** Idioma tal como lo pinta la web: sus valores visibles y el origen que acompaña al rótulo. */
function idiomaDeLaFicha(ficha: FichaListado): DatoFotografiado {
  const valores = ficha.idiomas.filter((idioma) => idioma !== 'no-indicado');
  const origen = ficha.origenIdioma;
  if (valores.length === 0) {
    return { valor: [], origen, estado: 'por-confirmar' };
  }
  const estado = origen === null || ORIGENES_IDIOMA_DE_LA_FUENTE.has(origen) ? 'fuente' : 'orientacion-faro';
  return { valor: valores, origen, estado };
}

/** Nivel tal como lo pinta la web: sin valor, la ficha solo muestra el motivo. */
function nivelDeLaFicha(ficha: FichaListado): DatoFotografiado {
  const { valor, origen, literal } = ficha.nivel;
  if (valor === null) {
    return { valor: null, origen, estado: 'por-confirmar' };
  }
  return { valor: { literal, nivel: valor }, origen, estado: origen === 'fuente' ? 'fuente' : 'orientacion-faro' };
}

function mismaLista(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

/**
 * Las materias no llevan rótulo de origen en la web. Se distingue solo lo que el evaluador acredita: la revisión
 * editorial aplicada; el resto (título, objetivos, tablas de proveedor) es otra orientación de Faro.
 */
function materiaDeLaFicha(ficha: FichaListado, oferta: OfertaCatalogo): DatoFotografiado {
  const temas = ficha.temas.filter((tema) => tema !== 'no-indicado');
  if (temas.length === 0) {
    return { valor: [], origen: null, estado: 'por-confirmar' };
  }
  const evaluacion = evaluarClasificacion(oferta);
  const revisada =
    (evaluacion.revision.estado === 'aplicada' || evaluacion.revisionContenido?.estado === 'aplicada') &&
    mismaLista(ficha.temas, evaluacion.metadatos.temas);
  return {
    valor: temas,
    origen: revisada ? 'revision-editorial' : 'otra-orientacion-de-faro',
    estado: 'orientacion-faro',
  };
}

/** Compañero mínimo: una ficha sin requisitos ni coberturas, para que el único descarte posible sea el de la oferta. */
function companeroDe(catalogo: EntregaCatalogo, oferta: OfertaCatalogo): CompaneroAprendizaje {
  // El selector no lee la huella del registro; una huella nula deja claro que no remite a ningún registro real.
  const registro = { id: 'foto-clasificacion', version: '1', sha256: HUELLA_NULA };
  const metodo = { nombre: 'foto-clasificacion', version: '1' };
  const revision = { tipo: 'automatizada', referencia: 'foto', metodo, fecha_utc: '' } as const;
  return {
    schema_version: 1,
    catalogo: { sha256: '', bytes: 0, revision: catalogo.revision },
    registro,
    registro_json: '',
    fichas: [
      {
        programa_id: oferta.unidad.programa_id,
        idioma_ficha: null,
        aprendizaje: { schema_version: 1, registro, contenido_observado: true, afirmaciones: [] },
        requisitos: 'publicados',
        cobertura: [],
        revision,
      },
    ],
    caminos: [],
  };
}

/** Pasa la oferta sola por el selector real del plan; null si la admite. */
function descarteDelPlan(catalogo: EntregaCatalogo, oferta: OfertaCatalogo, idiomas: readonly string[], ahora: number) {
  const aislado = { ...catalogo, ofertas: [oferta] };
  const preferencias = {
    etapa: 'inicial',
    idiomas,
    modalidad: 'cualquiera',
    aceptaRegistro: true,
    requisitosConfirmados: [],
    excluidos: [],
  } as const;
  const seleccion = seleccionarFormacion(aislado, companeroDe(catalogo, oferta), preferencias, ahora);
  return seleccion.descartes[0]?.motivo ?? null;
}

/** Idiomas con los que el plan admitiría la oferta y el motivo con que la descarta si la persona acepta los tres. */
function seleccionDelPlan(catalogo: EntregaCatalogo, oferta: OfertaCatalogo, ahora: number): DatoFotografiado {
  const motivo = descarteDelPlan(catalogo, oferta, IDIOMAS_DEL_PLAN, ahora);
  const admitidos = IDIOMAS_DEL_PLAN.filter((idioma) => {
    const descarte = descarteDelPlan(catalogo, oferta, [idioma], ahora);
    return descarte !== 'idioma_no_acreditado' && !DESCARTES_PREVIOS_AL_IDIOMA.includes(descarte as MotivoDescarte);
  });
  return { valor: admitidos, origen: motivo, estado: admitidos.length ? 'fuente' : 'por-confirmar' };
}

export function claveDeUnidad(tipo: string, id: string): string {
  return JSON.stringify([tipo, id]);
}

/** El plan se evalúa en el primer milisegundo posterior al corte, el instante en que la entrega empieza a valer. */
export function instanteDeLaFoto(catalogo: EntregaCatalogo): number {
  return Date.parse(catalogo.corte_proyeccion_utc) + 1;
}

/** Unidades del listado de Cursos, con la misma proyección que viaja en la página. */
export function fotoDeCursos(catalogo: EntregaCatalogo): UnidadFotografiada[] {
  const ofertas = new Map(catalogo.ofertas.map((o) => [claveDeUnidad(o.unidad.tipo, o.unidad.id), o]));
  const ahora = instanteDeLaFoto(catalogo);
  return proyectarListado(catalogo).ofertas.map((ficha) => {
    const oferta = ofertas.get(ficha.identidad);
    if (!oferta || !formacionGratuita(oferta)) {
      throw new Error('Ficha del listado sin oferta gratuita en el catálogo');
    }
    return {
      clave: ficha.identidad,
      fuente: oferta.proveedor_id,
      titulo: ficha.titulo_programa,
      datos: {
        idioma: idiomaDeLaFicha(ficha),
        materia: materiaDeLaFicha(ficha, oferta),
        nivel: nivelDeLaFicha(ficha),
        plan_idioma: seleccionDelPlan(catalogo, oferta, ahora),
      },
    };
  });
}
