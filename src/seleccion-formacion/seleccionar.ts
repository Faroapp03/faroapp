/** Selector determinista de formación. La autoridad temporal sigue en el lector del catálogo. */

import { evaluarClasificacion } from '../catalogo-cursos/clasificacion.ts';
import { formacionGratuita } from '../catalogo-cursos/consulta.ts';
import type { EntregaCatalogo, OfertaCatalogo } from '../catalogo-cursos/contrato.ts';
import { temasParaFiltro } from '../catalogo-cursos/inferir-temas.ts';
import { ofertasVigentes } from '../catalogo-cursos/lectura.ts';
import { afirmacionUtilizable } from './aprendizaje.ts';
import {
  AprendizajeNoValido,
  type CaminoRevisado,
  type CaminoSeleccionado,
  type CompaneroAprendizaje,
  CRITERIOS,
  type FichaAprendizaje,
  type MotivoDescarte,
  type OpcionesPlan,
  type OpcionPlan,
  type PreferenciasSeleccion,
  type RecursoSeleccionado,
  type SeleccionFormacion,
} from './contrato.ts';
import { type IdiomaDeOferta, idiomaAceptado, idiomasDeLaEntrega } from './idioma-del-plan.ts';
import { datosPorConfirmar, modalidadNoCoincide, primeroLoQueConsta, registroNoAceptado } from './por-confirmar.ts';
import { pideConfirmacion, type Revision, requisitosDeFicha } from './requisitos.ts';
import { REVISION_REQUISITOS } from './requisitos-revisados.ts';

function comprobarOferta(
  oferta: OfertaCatalogo,
  p: PreferenciasSeleccion,
  idiomaDe: IdiomaDeOferta,
): MotivoDescarte | null {
  if (!formacionGratuita(oferta)) {
    return 'coste_no_acreditado';
  }
  if (!idiomaAceptado(idiomaDe(oferta), p.idiomas)) {
    return 'idioma_no_acreditado';
  }
  if (modalidadNoCoincide(oferta, p.modalidad)) {
    return 'modalidad_no_coincide';
  }
  if (registroNoAceptado(oferta, p.aceptaRegistro)) {
    return 'registro_no_aceptado';
  }
  return null;
}
/** Solo una condición revisada o una afirmación sin revisión vigente pueden dejar el curso a la espera de confirmar. */
function comprobarFicha(ficha: FichaAprendizaje, p: PreferenciasSeleccion, revision: Revision): MotivoDescarte | null {
  if (!ficha.aprendizaje.contenido_observado) {
    return 'aprendizaje_pendiente';
  }
  if (ficha.requisitos === 'sin_verificar') {
    return 'requisitos_sin_verificar';
  }
  const requisitos = ficha.aprendizaje.afirmaciones.filter((a) => a.dimension === 'requisito_entrada');
  if (requisitos.some((a) => !afirmacionUtilizable(a))) {
    return 'requisitos_sin_verificar';
  }
  if (requisitosDeFicha(ficha, revision).some((r) => pideConfirmacion(r) && !p.requisitosConfirmados.includes(r.id))) {
    return 'requisito_sin_confirmar';
  }
  return null;
}
function recurso(ficha: FichaAprendizaje, oferta: OfertaCatalogo, p: PreferenciasSeleccion): RecursoSeleccionado {
  const criterios: readonly string[] = CRITERIOS[p.etapa];
  const utilizables = new Set(
    ficha.aprendizaje.afirmaciones
      .filter((a) => a.dimension === 'resultado_previsto' && afirmacionUtilizable(a))
      .map((a) => a.id),
  );
  return {
    oferta,
    ficha,
    cobertura: ficha.cobertura.filter(
      (c) =>
        criterios.includes(c.criterio) &&
        c.afirmaciones.length > 0 &&
        c.afirmaciones.every((id) => utilizables.has(id)),
    ),
  };
}
const MAX_COMPLEMENTARIOS = 3;
interface Elegibles {
  readonly recursos: ReadonlyMap<string, RecursoSeleccionado>;
  readonly descartes: readonly { programa_id: string; motivo: MotivoDescarte }[];
}
function elegirOferta(ofertas: readonly OfertaCatalogo[], p: PreferenciasSeleccion, idiomaDe: IdiomaDeOferta) {
  let motivo: MotivoDescarte = 'sin_oferta_vigente';
  for (const oferta of primeroLoQueConsta(ofertas, (o) => datosPorConfirmar(o, idiomaDe(o), p.modalidad).length)) {
    const fallo = comprobarOferta(oferta, p, idiomaDe);
    if (fallo === null) {
      return { oferta, motivo: null };
    }
    motivo = fallo;
  }
  return { oferta: null, motivo };
}
/** Índice de una consulta: conserva el orden y evita recorrer el catálogo por cada ficha. */
function ofertasPorPrograma(vigentes: readonly OfertaCatalogo[]): ReadonlyMap<string, readonly OfertaCatalogo[]> {
  const porPrograma = new Map<string, OfertaCatalogo[]>();
  for (const oferta of vigentes) {
    const id = oferta.unidad.programa_id;
    const anteriores = porPrograma.get(id);
    if (anteriores) {
      anteriores.push(oferta);
    } else {
      porPrograma.set(id, [oferta]);
    }
  }
  return porPrograma;
}
/** Lo que recibe una selección: las dos entregas, las preferencias, el reloj y la revisión de requisitos. */
export interface Consulta {
  readonly catalogo: EntregaCatalogo;
  readonly companero: CompaneroAprendizaje;
  readonly p: PreferenciasSeleccion;
  readonly ahora: number;
  readonly revision: Revision;
}
function recursosElegibles({ catalogo, companero, p, ahora, revision }: Consulta, idiomaDe: IdiomaDeOferta): Elegibles {
  const porPrograma = ofertasPorPrograma(ofertasVigentes(catalogo, ahora));
  const descartes: { programa_id: string; motivo: MotivoDescarte }[] = [];
  const recursos = new Map<string, RecursoSeleccionado>();
  for (const ficha of companero.fichas) {
    const ofertas = porPrograma.get(ficha.programa_id) ?? [];
    const { oferta, motivo: descarteOferta } = elegirOferta(ofertas, p, idiomaDe);
    const descarteFicha = p.excluidos.includes(ficha.programa_id)
      ? ('excluido' as const)
      : comprobarFicha(ficha, p, revision);
    const motivo = descarteFicha ?? descarteOferta;
    if (motivo || !oferta) {
      descartes.push({ programa_id: ficha.programa_id, motivo: motivo ?? 'sin_oferta_vigente' });
    } else {
      recursos.set(ficha.programa_id, recurso(ficha, oferta, p));
    }
  }
  return { recursos, descartes };
}
function prepararCamino(c: CaminoRevisado, elegibles: ReadonlyMap<string, RecursoSeleccionado>): CaminoSeleccionado {
  const recursos = c.programas.flatMap((id) => {
    const r = elegibles.get(id);
    return r && r.cobertura.length > 0 ? [r] : [];
  });
  const cubiertos = new Set(recursos.flatMap((r) => r.cobertura.map((cobertura) => cobertura.criterio)));
  const huecos = CRITERIOS[c.etapa].filter((criterio) => !cubiertos.has(criterio));
  const programasPendientes = c.programas.filter((id) => !recursos.some((r) => r.ficha.programa_id === id));
  return {
    id: c.id,
    justificacion: c.justificacion,
    recursos,
    huecos,
    programasPendientes,
    completo: huecos.length === 0 && programasPendientes.length === 0,
  };
}
/** Las identidades de requisitos son compuestas: el mismo ID local no confirma otro programa. */
function requisitosPendientes(
  { companero, p, revision }: Consulta,
  descartes: Elegibles['descartes'],
): SeleccionFormacion['requisitosPendientes'] {
  const ids = new Set(descartes.filter((d) => d.motivo === 'requisito_sin_confirmar').map((d) => d.programa_id));
  return companero.fichas
    .filter((f) => ids.has(f.programa_id))
    .flatMap((f) =>
      requisitosDeFicha(f, revision).filter((r) => pideConfirmacion(r) && !p.requisitosConfirmados.includes(r.id)),
    );
}
const TEMAS_DIGITALES = new Set(['digital', 'ofimatica', 'datos', 'seguridad', 'sistemas', 'web', 'diseno']);
function bloqueDeOferta(oferta: OfertaCatalogo): 'ia' | 'digital' | null {
  const temas = temasParaFiltro(oferta, evaluarClasificacion(oferta));
  if (temas.includes('ia')) {
    return 'ia';
  }
  return temas.some((tema) => TEMAS_DIGITALES.has(tema)) ? 'digital' : null;
}
function fichaDeOferta(fichas: ReadonlyMap<string, FichaAprendizaje>, oferta: OfertaCatalogo): FichaAprendizaje | null {
  if (oferta.unidad.tipo !== 'recurso') {
    return null;
  }
  return fichas.get(oferta.unidad.programa_id) ?? null;
}
interface ContextoOpciones {
  readonly fichas: ReadonlyMap<string, FichaAprendizaje>;
  readonly proveedores: ReadonlyMap<string, string>;
  readonly preferencias: PreferenciasSeleccion;
  readonly revision: Revision;
  readonly idiomaDe: IdiomaDeOferta;
}
function opcionDeOferta(oferta: OfertaCatalogo, contexto: ContextoOpciones): OpcionPlan | null {
  const { preferencias, fichas, proveedores, revision, idiomaDe } = contexto;
  if (preferencias.excluidos.includes(oferta.unidad.programa_id) || comprobarOferta(oferta, preferencias, idiomaDe)) {
    return null;
  }
  const bloque = bloqueDeOferta(oferta);
  if (!bloque) {
    return null;
  }
  const proveedor = proveedores.get(oferta.proveedor_id);
  if (!proveedor) {
    throw new AprendizajeNoValido('Proveedor ausente del catálogo');
  }
  const aprendizaje = fichaDeOferta(fichas, oferta);
  if (aprendizaje && comprobarFicha(aprendizaje, preferencias, revision)) {
    return null;
  }
  const motivo =
    bloque === 'ia'
      ? {
          es: 'La materia está clasificada como inteligencia artificial.',
          ca: 'La matèria està classificada com a intel·ligència artificial.',
        }
      : {
          es: 'La materia está clasificada como herramientas o competencias digitales.',
          ca: 'La matèria està classificada com a eines o competències digitals.',
        };
  const requisitos = aprendizaje ? requisitosDeFicha(aprendizaje, revision) : [];
  const idioma = idiomaDe(oferta);
  const porConfirmar = datosPorConfirmar(oferta, idioma, preferencias.modalidad);
  return { bloque, oferta, aprendizaje, requisitos, proveedor, motivo, idioma, porConfirmar };
}
/** El catálogo y los bloques de navegación comparten materia; el camino personal requiere aprendizaje acreditado. */
function opcionesDelCatalogo(consulta: Consulta, idiomaDe: IdiomaDeOferta): OpcionesPlan {
  const { catalogo, companero, p: preferencias, ahora, revision } = consulta;
  const opciones: { ia: OpcionPlan[]; digital: OpcionPlan[] } = { ia: [], digital: [] };
  const contexto = {
    fichas: new Map(companero.fichas.map((f) => [f.programa_id, f])),
    proveedores: new Map(catalogo.proveedores.map((v) => [v.id, v.nombre])),
    preferencias,
    revision,
    idiomaDe,
  };
  for (const oferta of ofertasVigentes(catalogo, ahora)) {
    const opcion = opcionDeOferta(oferta, contexto);
    if (opcion) {
      opciones[opcion.bloque].push(opcion);
    }
  }
  const pendientes = (opcion: OpcionPlan) => opcion.porConfirmar.length;
  return { ia: primeroLoQueConsta(opciones.ia, pendientes), digital: primeroLoQueConsta(opciones.digital, pendientes) };
}
/** La selección con una revisión de requisitos dada: la publicada con el motor o, en las pruebas, una sintética. */
export function seleccionarConRevision(consulta: Consulta): SeleccionFormacion {
  const { catalogo, companero, p, ahora } = consulta;
  if (companero.catalogo.revision !== catalogo.revision) {
    throw new AprendizajeNoValido('El aprendizaje pertenece a otra entrega');
  }
  const idiomaDe = idiomasDeLaEntrega(catalogo);
  const { recursos, descartes } = recursosElegibles(consulta, idiomaDe);
  const candidatos = companero.caminos.filter((c) => c.etapa === p.etapa).map((c) => prepararCamino(c, recursos));
  // El orden de los caminos procede de la revisión, no de una nota calculada.
  const camino = candidatos.find((c) => c.completo) ?? candidatos.find((c) => c.recursos.length > 0) ?? null;
  const usados = new Set(camino?.recursos.map((r) => r.ficha.programa_id) ?? []);
  const complementarios = [...recursos.values()]
    .filter((r) => !usados.has(r.ficha.programa_id) && r.cobertura.length > 0)
    .slice(0, MAX_COMPLEMENTARIOS);
  let estado: SeleccionFormacion['estado'] = 'sin_oferta';
  if (camino) {
    estado = camino.completo ? 'completa' : 'parcial';
  }
  return {
    schema_version: 2,
    opciones: opcionesDelCatalogo(consulta, idiomaDe),
    calculado_el: new Date(ahora).toISOString(),
    etapa: p.etapa,
    estado,
    camino,
    complementarios,
    descartes,
    requisitosPendientes: requisitosPendientes(consulta, descartes),
    huecos: camino?.huecos ?? [...CRITERIOS[p.etapa]],
  };
}
/** No interpreta títulos, no inventa fechas, no suma puntuaciones ni convierte un hueco en aprendizaje. */
export function seleccionarFormacion(
  catalogo: EntregaCatalogo,
  companero: CompaneroAprendizaje,
  p: PreferenciasSeleccion,
  ahora: number,
): SeleccionFormacion {
  return seleccionarConRevision({ catalogo, companero, p, ahora, revision: REVISION_REQUISITOS });
}
