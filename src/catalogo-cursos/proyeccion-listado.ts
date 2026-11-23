/** Prepara únicamente los datos que muestra Cursos, después de acreditar el catálogo y los anclajes editoriales. */
import { sinAcentos } from '../comun/texto.ts';
import { evaluarClasificacion, type IdiomaClasificado, idiomaClasificadoDelCurso } from './clasificacion.ts';
import type { EntregaCatalogo, OfertaCatalogo } from './contrato.ts';
import { idiomaAcademy } from './idioma-academy.ts';
import { type OrientadorIdioma, orientadorDelCatalogo } from './idioma-cibernarium.ts';
import {
  enriquecerIdiomaNivel,
  type IdiomaEdicionObservado,
  type IdiomaEnriquecido,
  type IdiomaProgramaObservado,
  idiomaDeImparticion,
  type NivelContenidoObservado,
} from './idioma-nivel.ts';
import idiomasEdicion from './idiomas-edicion.json' with { type: 'json' };
import idiomasPrograma from './idiomas-programa.json' with { type: 'json' };
import { temasParaFiltro } from './inferir-temas.ts';
import { CAMPOS_FICHA, type FichaListado, type ListadoCursos, type OrigenIdiomaFicha } from './listado.ts';
import { nivelAcademy } from './nivel-academy.ts';
import nivelesContenido from './niveles-contenido.json' with { type: 'json' };

const NOMBRES_IDIOMA: Readonly<Record<string, string>> = {
  espanol: 'es',
  castellano: 'es',
  castella: 'es',
  spanish: 'es',
  castilian: 'es',
  catala: 'ca',
  catalan: 'ca',
  ingles: 'en',
  angles: 'en',
  english: 'en',
};
/**
 * Normaliza declaraciones completas: un nombre conocido o un código con, como mucho, su escritura y su región. No
 * interpreta palabras sueltas de una frase o un horario, ni subetiquetas arbitrarias como «es-english».
 */
function idiomaComparable(valor: string): string {
  const literal = valor.trim();
  const nombre = sinAcentos(literal).replace(/\s+/gu, ' ');
  const codigo = /^(es|ca|en)(?:[-_][a-z]{4})?(?:[-_](?:[a-z]{2}|[0-9]{3}))?$/u.exec(nombre)?.[1];
  return codigo ?? (Object.hasOwn(NOMBRES_IDIOMA, nombre) ? (NOMBRES_IDIOMA[nombre] ?? literal) : literal);
}
/** Prioriza las declaraciones; usa el complemento solo con sus guardas originales.
 * La procedencia y las limitaciones de normas e inferencias se consultan en idiomaClasificadoDelCurso. */
function idiomasDe(oferta: OfertaCatalogo, clasificacion: IdiomaClasificado | null): readonly string[] {
  const idioma = oferta.hechos.idiomas_declarados;
  if (idioma.motivo !== 'conocido' || !Array.isArray(idioma.valor)) {
    return clasificacion?.valores ?? ['no-indicado'];
  }
  const valores = [...new Set(idioma.valor.map(idiomaComparable).filter(Boolean))];
  return valores.length ? valores : (clasificacion?.valores ?? ['no-indicado']);
}
/** «Gratis parcial» y costes desconocidos no se convierten en gratuidad. Una cantidad positiva contradice la etiqueta. */
export function formacionGratuita(oferta: OfertaCatalogo): boolean {
  const tipo = oferta.hechos.coste_formacion_tipo;
  const coste = oferta.hechos.coste_formacion;
  return (
    tipo.motivo === 'conocido' &&
    tipo.valor === 'gratis_formacion' &&
    (coste.motivo !== 'conocido' || coste.valor === 0)
  );
}
const EDITORIAL = { evaluarClasificacion, idiomaClasificadoDelCurso };
function indexar<T extends { readonly unidad: { readonly id: string } }>(registros: readonly T[]): Map<string, T[]> {
  const indice = new Map<string, T[]>();
  for (const registro of registros) {
    const lista = indice.get(registro.unidad.id) ?? [];
    lista.push(registro);
    indice.set(registro.unidad.id, lista);
  }
  return indice;
}
const IDIOMAS_EDICION = indexar(idiomasEdicion.registros as unknown as readonly IdiomaEdicionObservado[]);
const IDIOMAS_PROGRAMA = indexar(idiomasPrograma.registros as unknown as readonly IdiomaProgramaObservado[]);
const NIVELES_CONTENIDO = indexar(nivelesContenido.registros as unknown as readonly NivelContenidoObservado[]);
/** Lo observado del idioma de una oferta: su revisión y las fichas de edición y de programa que la nombran. */
function opcionesDeIdioma(oferta: OfertaCatalogo, editorial: typeof EDITORIAL, orientarIdioma?: OrientadorIdioma) {
  return {
    idiomaRevisado: editorial.idiomaClasificadoDelCurso(oferta) ?? idiomaAcademy(oferta),
    idiomasEdicion: IDIOMAS_EDICION.get(oferta.unidad.id) ?? [],
    idiomasPrograma: IDIOMAS_PROGRAMA.get(oferta.unidad.id) ?? [],
    ...(orientarIdioma ? { orientarIdioma } : {}),
  };
}
function enriquecer(oferta: OfertaCatalogo, editorial = EDITORIAL, orientarIdioma?: OrientadorIdioma) {
  const evaluacion = editorial.evaluarClasificacion(oferta);
  const delIdioma = opcionesDeIdioma(oferta, editorial, orientarIdioma);
  const nivelRevisado =
    evaluacion.metadatos.nivel.valor !== null
      ? evaluacion.metadatos.nivel
      : (nivelAcademy(oferta) ?? evaluacion.metadatos.nivel);
  return {
    evaluacion,
    datos: enriquecerIdiomaNivel(oferta, {
      ...delIdioma,
      nivelRevisado,
      nivelesContenido: NIVELES_CONTENIDO.get(oferta.unidad.id) ?? [],
    }),
    idiomaRevisado: delIdioma.idiomaRevisado,
  };
}
function idiomasVisibles(oferta: OfertaCatalogo, datos: IdiomaEnriquecido, revisado: IdiomaClasificado | null) {
  const directos = oferta.hechos.idiomas_declarados;
  if (directos.motivo === 'conocido' && directos.alcance !== 'material_observado' && Array.isArray(directos.valor)) {
    return idiomasDe(oferta, revisado);
  }
  return datos.valores.length ? datos.valores : ['no-indicado'];
}
function origenDe(idioma: IdiomaEnriquecido): FichaListado['origenIdioma'] {
  if (idioma.origen === 'por-confirmar') {
    return null;
  }
  if (idioma.alcance === 'historial-cibernarium') {
    return 'historial-cibernarium';
  }
  if (idioma?.origen === 'faro') {
    return 'faro';
  }
  if (idioma.alcance === 'programa') {
    return 'programa';
  }
  if (idioma?.alcance === 'norma-general') {
    return 'norma-general';
  }
  return idioma ? 'edicion' : null;
}
/** Los idiomas que se enseñan de una oferta y de dónde salen. */
export interface IdiomaConOrigen {
  readonly idiomas: readonly string[];
  readonly origen: OrigenIdiomaFicha;
}
function conOrigen(oferta: OfertaCatalogo, idioma: IdiomaEnriquecido, revisado: IdiomaClasificado | null) {
  return { idiomas: idiomasVisibles(oferta, idioma, revisado), origen: origenDe(idioma) };
}
/**
 * La única decisión del idioma de una oferta y de su origen: Cursos la pinta y el plan de formación la usa para
 * admitir la oferta. El orientador es el de la entrega completa, porque las declaraciones de una edición corrigen el
 * historial de las demás.
 */
export function idiomaConOrigen(
  oferta: OfertaCatalogo,
  orientarIdioma?: OrientadorIdioma,
  editorial = EDITORIAL,
): IdiomaConOrigen {
  const opciones = opcionesDeIdioma(oferta, editorial, orientarIdioma);
  return conOrigen(oferta, idiomaDeImparticion(oferta, opciones), opciones.idiomaRevisado);
}
export function idiomasDelCurso(oferta: OfertaCatalogo, editorial = EDITORIAL) {
  return idiomaConOrigen(oferta, undefined, editorial).idiomas;
}
export function origenIdiomaDelCurso(oferta: OfertaCatalogo, editorial = EDITORIAL) {
  return idiomaConOrigen(oferta, undefined, editorial).origen;
}
export function fichaDelListado(
  oferta: OfertaCatalogo,
  proveedor: string,
  editorial = EDITORIAL,
  orientarIdioma?: OrientadorIdioma,
): FichaListado {
  const { evaluacion, datos, idiomaRevisado } = enriquecer(oferta, editorial, orientarIdioma);
  const temas = temasParaFiltro(oferta, evaluacion);
  const { nivel } = datos;
  const { idiomas, origen } = conOrigen(oferta, datos.idioma, idiomaRevisado);
  const hechos = {} as Record<(typeof CAMPOS_FICHA)[number], FichaListado['hechos']['modalidad']>;
  for (const campo of CAMPOS_FICHA) {
    const { valor, motivo, alcance, moneda } = oferta.hechos[campo];
    hechos[campo] = { valor, motivo, alcance, moneda };
  }
  return {
    identidad: JSON.stringify([oferta.unidad.tipo, oferta.unidad.id]),
    titulo_programa: oferta.titulo_programa,
    url: oferta.url,
    proveedor,
    comprobado_el: oferta.comprobado_el,
    cierra_el: oferta.cierra_el,
    incidencia_enlace_el: oferta.incidencia_enlace_el,
    ...(oferta.preinscripcion ? { preinscripcion: oferta.preinscripcion } : {}),
    hechos,
    temas,
    nivel: { valor: nivel.valor, origen: nivel.origen, literal: nivel.literal, motivo: nivel.motivo },
    idiomas,
    origenIdioma: origen,
  };
}
/** El lector ya comprobó admisión, corte y relaciones de cada unidad. Su fecha de cierre sigue en la ficha. */
export function proyectarListado(catalogo: EntregaCatalogo, editorial = EDITORIAL): ListadoCursos {
  const proveedores = new Map(catalogo.proveedores.map((p) => [p.id, p.nombre]));
  const orientarIdioma = orientadorDelCatalogo(catalogo);
  return {
    corte_proyeccion_utc: catalogo.corte_proyeccion_utc,
    ofertas: catalogo.ofertas
      .filter(formacionGratuita)
      .map((o) => fichaDelListado(o, proveedores.get(o.proveedor_id) ?? '', editorial, orientarIdioma)),
  };
}
