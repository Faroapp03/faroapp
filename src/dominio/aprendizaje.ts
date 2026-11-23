// Catálogo para elegir objetivos: propuestas editoriales por tarea y formación por ámbito. Cada objetivo dice de qué
// ámbitos puede elegir formación: el grupo ocupacional de su tarea (el de su referencia oficial, también si es de otro
// grupo) y, para el uso crítico de IA, además el bloque de formación digital transversal, igual para todas las
// ocupaciones (formacion-transversal.ts), con sus dos tramos: «para empezar» y «para ir más allá». En cada ámbito, las
// especialidades del SEPE, los cursos del SOC y, si el paquete los trae, las ediciones del Consorci para personas que
// trabajan. De cada fuente, el plan ofrece las primeras convocatorias del único orden del informe, por fecha de inicio
// (MAX_CONVOCATORIAS_EN_EL_PLAN: las abiertas que empiezan antes y, si faltan, las ya empezadas); en el informe están
// todas. La relación ocupacional nunca se convierte en evidencia de que un curso consiga un objetivo.
// La formación llega ya calculada por el motor de cursos (FormacionDelInforme): este módulo no importa ningún valor
// del motor.

import { CATALOGO_SEPE } from '../../compartido/contratos/formacion-del-informe.ts';
import type {
  CursoRelacionado,
  EdicionRelacionada,
  EspecialidadTransversal,
  FormacionDelInforme,
  FormacionRelacionada,
  FormacionTransversal,
  TramoTransversal,
} from '../../motores/cursos/src/index.ts';
import { huella } from '../comun/huella.ts';
import type { Idioma } from '../comun/idioma.ts';
import { compararPorCodigo } from '../comun/orden.js';
import { InvarianteRoto } from './errores.ts';
import { textosDelInforme } from './lengua.ts';
import type { OcupacionConfirmada } from './ocupacion-confirmada.ts';
import type { Entrada, TareaEntrada } from './tipos-entrada.ts';
import type { CatalogoAprendizaje, ObjetivoPropuesto, OpcionAprendizaje, TareaInforme } from './tipos-informe.ts';
import type { Datos } from './tipos-paquete.ts';

/** Ámbito de las opciones del bloque digital transversal: no es un grupo ocupacional. */
export const AMBITO_TRANSVERSAL = 'transversal';
/** Relación de una opción del bloque transversal: igual para todas las ocupaciones, sin relación con ninguna. */
export const RELACION_TRANSVERSAL = 'transversal';
/** Relación de una opción del tramo «para ir más allá» (nivel 3) del bloque transversal. */
export const RELACION_PARA_IR_MAS_ALLA = 'transversal-mas-alla';
/** Convocatorias de cada fuente (SOC y Consorci) que el plan ofrece en cada ámbito: las que empiezan antes. */
const MAX_CONVOCATORIAS_EN_EL_PLAN = 6;
/** Lo que una especialidad o un curso del SOC no dicen: si se sigue a distancia y el contacto de una entidad. */
const SIN_CONTACTO: Pick<OpcionAprendizaje, 'aDistancia' | 'web' | 'correo' | 'telefono'> = {
  aDistancia: null,
  web: null,
  correo: null,
  telefono: null,
};
/** La oferta prevista del Consorci de cada especialidad, por código, o null sin el Consorci. */
type OfertaPrevista = FormacionDelInforme['ofertaPrevista'];
/** Lo que una convocatoria no dice: cuántas entidades suelen ofrecer su especialidad sin fecha todavía. */
const SIN_OFERTA_PREVISTA: Pick<OpcionAprendizaje, 'entidadesQueLaOfrecen' | 'edicionesSinFecha'> = {
  entidadesQueLaOfrecen: null,
  edicionesSinFecha: null,
};

/** Identidad semántica: independiente del idioma y del orden de claves, sensible al alcance de la evidencia. */
function huellaDelContexto(original: TareaEntrada, tarea: TareaInforme, ocupacion: OcupacionConfirmada): string {
  const referencia = original.referencia;
  const competencias = tarea.competencias.map((competencia): [string, string, string] => [
    competencia.uri,
    competencia.relacion,
    competencia.alcance ?? 'ocupacion',
  ]);
  competencias.sort((a, b) => compararPorCodigo(a[0], b[0]));
  return huella(
    JSON.stringify({
      texto: referencia ? null : original.texto,
      referencia: referencia ? [referencia.tareaOit, referencia.relacion] : null,
      ocupacion: [ocupacion.esco, ocupacion.isco08, ocupacion.secundario],
      competencias,
    }),
  );
}

/**
 * Los dos objetivos de cada tarea de la entrada (el profesional y el de uso crítico de IA), en el orden de la entrada.
 */
function objetivosDe(
  tareas: TareaInforme[],
  entrada: Entrada,
  ocupacion: OcupacionConfirmada,
  idioma: Idioma,
): ObjetivoPropuesto[] {
  const porId = new Map(tareas.map((tarea) => [tarea.id, tarea]));
  const { objetivos: titulos } = textosDelInforme(idioma);
  return entrada.tareas.flatMap((original): ObjetivoPropuesto[] => {
    // La entrada fija el orden de elección; las notas de exposición no lo alteran.
    const tarea = porId.get(original.id);
    if (!tarea) {
      throw new InvarianteRoto(`Tarea sin informe de aprendizaje: ${original.id}`);
    }
    const grupo = tarea.referencia?.isco08 ?? ocupacion.isco08;
    const firma = huellaDelContexto(original, tarea, ocupacion);
    return (['profesional', 'ia'] as const).map((tipo) => ({
      id: `${tarea.id}:${tipo}`,
      huella: firma,
      tarea: { id: tarea.id, texto: tarea.texto, referencia: tarea.referencia?.tareaOit ?? null },
      grupo,
      ambitos: tipo === 'ia' ? [grupo, AMBITO_TRANSVERSAL] : [grupo],
      tipo,
      titulo: titulos[tipo](tarea.texto),
      // El uso crítico de IA es una propuesta de Faro: no se inventa una relación con ESCO o DigComp.
      competencias: tipo === 'profesional' ? tarea.competencias : [],
    }));
  });
}

/**
 * Una especialidad del SEPE como opción: programa de referencia, sin centro, fechas ni inscripción. Con el Consorci,
 * dice cuántas entidades suelen ofrecerla y cuántas ediciones suyas están programadas sin fecha todavía.
 */
function opcionEspecialidad(
  especialidad: EspecialidadTransversal,
  { ambito, relacion }: { ambito: string; relacion: string },
  previstas: OfertaPrevista,
): OpcionAprendizaje {
  const prevista = previstas && Object.hasOwn(previstas, especialidad.codigo) ? previstas[especialidad.codigo] : null;
  return {
    id: `${ambito}:sepe:${especialidad.codigo}`,
    grupo: ambito,
    tipo: 'especialidad',
    fuente: 'sepe',
    nombre: especialidad.nombre,
    idioma: 'es',
    // Su programa en PDF si se ha comprobado; si no, el buscador del catálogo, donde se encuentra por su código.
    enlace: especialidad.programa?.enlace ?? CATALOGO_SEPE,
    modalidad: especialidad.modalidad,
    horas: especialidad.horas,
    municipio: null,
    centro: null,
    inicio: null,
    fin: null,
    coste: null,
    relacion,
    adecuacion: 'sin-verificar',
    inscripcion: 'no-aplica',
    momento: null,
    destinatarios: null,
    comprobado: null,
    ...SIN_CONTACTO,
    entidadesQueLaOfrecen: previstas ? (prevista?.entidades ?? 0) : null,
    edicionesSinFecha: previstas ? (prevista?.sinFecha ?? 0) : null,
  };
}

/**
 * Un curso del SOC como opción: convocatoria con centro y fechas, su momento, a quién se dirige y de qué copia sale.
 */
function opcionCurso(curso: CursoRelacionado, ambito: string, relacion: string): OpcionAprendizaje {
  return {
    id: `${ambito}:soc:${curso.id}`,
    grupo: ambito,
    tipo: 'curso',
    fuente: 'soc',
    nombre: curso.nombre,
    idioma: 'ca',
    enlace: curso.enlace,
    modalidad: curso.modalidad,
    horas: curso.horas,
    municipio: curso.municipio,
    centro: curso.centro,
    inicio: curso.inicio,
    fin: curso.fin,
    coste: null,
    relacion,
    adecuacion: 'sin-verificar',
    inscripcion: 'sin-verificar',
    momento: curso.momento,
    destinatarios: curso.destinatarios,
    comprobado: curso.comprobado,
    ...SIN_CONTACTO,
    ...SIN_OFERTA_PREVISTA,
  };
}

/**
 * Una edición del Consorci como opción: convocatoria gratuita para personas que trabajan, con su entidad y el contacto
 * con que se inscribe la persona. Sin enlace: la edición no tiene página propia.
 */
function opcionEdicion(edicion: EdicionRelacionada, ambito: string, relacion: string): OpcionAprendizaje {
  return {
    id: `${ambito}:consorci:${edicion.id}`,
    grupo: ambito,
    tipo: 'curso',
    fuente: 'consorci',
    nombre: edicion.nombre,
    idioma: 'ca',
    enlace: null,
    modalidad: edicion.modalidad,
    horas: edicion.horas,
    municipio: edicion.municipio,
    centro: edicion.contacto.entidad,
    inicio: edicion.inicio,
    fin: edicion.fin,
    coste: null,
    relacion,
    adecuacion: 'sin-verificar',
    inscripcion: 'sin-verificar',
    momento: edicion.momento,
    destinatarios: edicion.destinatarios,
    comprobado: edicion.comprobado,
    aDistancia: edicion.aDistancia,
    web: edicion.contacto.web,
    correo: edicion.contacto.correo,
    telefono: edicion.contacto.telefono,
    ...(edicion.contacto.contacto_oficial ? { contactoOficial: edicion.contacto.contacto_oficial } : {}),
    ...SIN_OFERTA_PREVISTA,
  };
}

/** Opciones de un ámbito ocupacional, con la relación oficial de cada una o la marca de sugerencia de Faro. */
function opcionesDe(
  formacion: FormacionRelacionada | null,
  grupo: string,
  previstas: OfertaPrevista,
): OpcionAprendizaje[] {
  if (!formacion) {
    return [];
  }
  const relacion = (convocatoria: { sugerencia: boolean }) => (convocatoria.sugerencia ? 'sugerencia' : 'ocupacional');
  const ediciones = formacion.consorci;
  return [
    ...formacion.especialidades.map((especialidad) =>
      opcionEspecialidad(especialidad, { ambito: grupo, relacion: especialidad.relacion }, previstas),
    ),
    ...formacion.cursos
      .slice(0, MAX_CONVOCATORIAS_EN_EL_PLAN)
      .map((curso) => opcionCurso(curso, grupo, relacion(curso))),
    ...(ediciones?.ediciones ?? [])
      .slice(0, MAX_CONVOCATORIAS_EN_EL_PLAN)
      .map((edicion) => opcionEdicion(edicion, grupo, relacion(edicion))),
  ];
}

/** Las opciones de un tramo del bloque transversal, todas con la misma relación. */
function opcionesDelTramo(tramo: TramoTransversal, relacion: string, previstas: OfertaPrevista): OpcionAprendizaje[] {
  const ambito = { ambito: AMBITO_TRANSVERSAL, relacion };
  return [
    ...tramo.especialidades.map((especialidad) => opcionEspecialidad(especialidad, ambito, previstas)),
    ...tramo.cursos.map((curso) => opcionCurso(curso, AMBITO_TRANSVERSAL, relacion)),
    ...tramo.ediciones.map((edicion) => opcionEdicion(edicion, AMBITO_TRANSVERSAL, relacion)),
  ];
}

/** El bloque digital transversal como opciones, las mismas para cualquier ocupación: sus dos tramos. */
function opcionesTransversales(
  transversal: FormacionTransversal | null,
  delConsorci: OfertaPrevista,
): OpcionAprendizaje[] {
  if (!transversal) {
    return [];
  }
  const masAlla = transversal.paraIrMasAlla;
  return [
    ...opcionesDelTramo(transversal, RELACION_TRANSVERSAL, delConsorci),
    ...(masAlla ? opcionesDelTramo(masAlla, RELACION_PARA_IR_MAS_ALLA, delConsorci) : []),
  ];
}

/** Las citas del bloque transversal: el SEPE y el SOC y, si trae algo suyo, el Consorci. */
function fuentesTransversalesDe(transversal: FormacionTransversal | null, datos: Datos): string[] {
  if (!transversal || !datos.formacion) {
    return [];
  }
  const delConsorci = transversal.fuenteConsorci ? [transversal.fuenteConsorci] : [];
  return [datos.formacion.fuentes.sepe, datos.formacion.fuentes.soc, ...delConsorci];
}

/**
 * Formación de los ámbitos que no son el grupo principal: el segundo grupo confirmado y los grupos de las referencias
 * equivalentes de otro grupo, para que ningún objetivo quede sin las opciones de su ámbito. En el orden en que
 * aparecen, sin orden por parecido (no hay vectores de esos grupos en el informe). La formación de cada grupo la ha
 * calculado el motor de cursos; un grupo que no trae no tiene opciones.
 */
function opcionesDeOtrosGrupos(
  grupos: string[],
  { otrosGrupos, ofertaPrevista }: Pick<ContextoDelCatalogo, 'otrosGrupos' | 'ofertaPrevista'>,
): { opciones: OpcionAprendizaje[]; fuentes: string[] } {
  const porGrupo = new Map(otrosGrupos.map((otro) => [otro.grupo, otro.formacion]));
  const deCadaGrupo = grupos.flatMap((grupo) => {
    const formacion = porGrupo.get(grupo);
    return formacion ? [{ grupo, formacion }] : [];
  });
  return {
    opciones: deCadaGrupo.flatMap(({ grupo, formacion: delGrupo }) => opcionesDe(delGrupo, grupo, ofertaPrevista)),
    fuentes: deCadaGrupo.flatMap(({ formacion: delGrupo }) => delGrupo.fuentes),
  };
}

/** Lo que el catálogo toma del informe: la ocupación, sus tareas, la formación relacionada y las opciones de fuera. */
export interface ContextoDelCatalogo {
  ocupacion: OcupacionConfirmada;
  tareas: TareaInforme[];
  formacion: FormacionRelacionada | null;
  transversal: FormacionTransversal | null;
  /** Las opciones de fuera del catálogo oficial (opciones-otra-formacion.ts), que van detrás de todas. */
  otrasOpciones: OpcionAprendizaje[];
  /** La formación de los otros grupos del plan, calculada por el motor de cursos. */
  otrosGrupos: FormacionDelInforme['otrosGrupos'];
  /** La oferta prevista del Consorci de cada especialidad, calculada por el motor de cursos; null sin el Consorci. */
  ofertaPrevista: OfertaPrevista;
}

/**
 * Catálogo determinista de todos los ámbitos; no depende de la exposición ni de atributos personales.
 *
 * @param entrada - La entrada del informe.
 * @param datos - El paquete de datos.
 * @param contexto - La ocupación, sus tareas y la formación ya relacionada.
 * @param idioma - El idioma del informe.
 * @returns El catálogo, con sus fuentes.
 */
export function catalogoAprendizaje(
  entrada: Entrada,
  datos: Datos,
  contexto: ContextoDelCatalogo,
  idioma: Idioma,
): CatalogoAprendizaje {
  const { ocupacion, tareas, formacion, transversal } = contexto;
  const objetivos = objetivosDe(tareas, entrada, ocupacion, idioma);
  // El segundo grupo va siempre; después, los de las referencias equivalentes que no son ninguno de los dos.
  const otros = [
    ...new Set([...(ocupacion.secundario ? [ocupacion.secundario] : []), ...objetivos.map(({ grupo }) => grupo)]),
  ].filter((grupo) => grupo !== ocupacion.isco08);
  const otrosGrupos = opcionesDeOtrosGrupos(otros, contexto);
  const transversales = opcionesTransversales(transversal, contexto.ofertaPrevista);
  const fuentesTransversales = fuentesTransversalesDe(transversal, datos);
  return {
    version: 3,
    idioma,
    fecha: entrada.fecha,
    fechaCursos: datos.formacion?.fecha_cursos ?? null,
    objetivos,
    opciones: [
      ...opcionesDe(formacion, ocupacion.isco08, contexto.ofertaPrevista),
      ...otrosGrupos.opciones,
      ...transversales,
      ...contexto.otrasOpciones,
    ],
    fuentes: [...new Set([...(formacion?.fuentes ?? []), ...otrosGrupos.fuentes, ...fuentesTransversales])].map(
      (texto) => ({ texto, idioma: 'es' }),
    ),
  };
}
