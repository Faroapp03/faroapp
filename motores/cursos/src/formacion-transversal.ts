// Bloque de formación digital transversal, el mismo para todas las ocupaciones: no recibe la ocupación. Las
// especialidades del catálogo del SEPE que elige su criterio (criterio-digital-transversal.ts), en dos tramos («para
// empezar» y, con la adenda, «para ir más allá»), cada uno con lo que hay de ellas en el SOC y en el Consorci: cursos
// y ediciones con fecha, acciones previstas sin fecha («suele ofrecerse: pregunta a la entidad») y cuántas ediciones
// están programadas sin fecha todavía. Así el bloque nunca se queda vacío los días en que no hay ninguna edición
// abierta: las especialidades son programas de referencia permanentes y las previstas dicen a quién preguntar. Al lado,
// si el paquete la trae, la acreditación oficial ACTIC de la Generalitat, con el nivel que encaja en cada tramo.

import type {
  CertificacionActic,
  CertificacionDelTramo,
  CursoRelacionado,
  DatosActic,
  DatosConsorci,
  DatosFormacion,
  EdicionRelacionada,
  EspecialidadTransversal,
  FormacionTransversal,
  PrevistaRelacionada,
  ProgramasSepe,
  TramoTransversal,
} from '../../../compartido/contratos/tipos-formacion.ts';
import { compararPorCodigo } from '../../../src/comun/orden.js';
import { InvarianteRoto } from '../../../src/dominio/errores.ts';
import {
  CRITERIO_VIGENTE,
  type CriterioDigitalTransversal,
  NIVELES_ACTIC_DEL_TRAMO,
  type TramoDelBloque,
  tramoDelBloque,
} from './criterio-digital-transversal.ts';
import { cursosOfrecidos, fichaDeEspecialidad, porEspecialidadElegida } from './formacion.ts';
import { edicionesDelConsorci, porPrimerCodigo, primerCodigo, programadasSinFecha } from './formacion-consorci.ts';

/**
 * Con qué criterio se elige el bloque, si trae el Consorci, qué programas del SEPE se han comprobado y si trae la
 * ACTIC. Sin opciones: el criterio vigente, sin el Consorci, sin enlazar ningún programa y sin la ACTIC.
 */
interface OpcionesTransversal {
  criterio?: CriterioDigitalTransversal;
  consorci?: DatosConsorci | null;
  programas?: ProgramasSepe;
  actic?: DatosActic | null;
}

/** Lo que hay de unas especialidades en el SOC y en el Consorci, sin las ediciones programadas sin fecha. */
type OfertaDelTramo = Pick<TramoTransversal, 'cursos' | 'ediciones' | 'previstas'>;

/**
 * La opción ACTIC de un tramo: los niveles que le tocan (criterio-digital-transversal.ts) y su prueba más larga.
 *
 * @param actic - La acreditación ACTIC del paquete.
 * @param tramo - El tramo del bloque.
 * @returns Los niveles del tramo y los minutos de su prueba más larga.
 * @throws {InvarianteRoto} Si el paquete no trae ninguno de los niveles del tramo: sin ellos no hay prueba que medir.
 */
function certificacionDelTramo(actic: DatosActic, tramo: TramoDelBloque): CertificacionDelTramo {
  const claves: readonly string[] = NIVELES_ACTIC_DEL_TRAMO[tramo];
  const niveles = actic.niveles.filter((nivel) => claves.includes(nivel.clave));
  if (!niveles.length) {
    throw new InvarianteRoto(`La ACTIC del paquete no trae ningún nivel del tramo ${tramo}`);
  }
  return { niveles, minutos: Math.max(...niveles.map((nivel) => nivel.minutos)) };
}

/**
 * «Certifica lo que sabes»: la acreditación oficial de la Generalitat, con el nivel que encaja en cada tramo. Es la
 * misma para todas las ocupaciones y no depende de que haya cursos abiertos: se puede certificar lo que ya se sabe.
 */
function certificacionActic(actic: DatosActic): CertificacionActic {
  return {
    paraEmpezar: certificacionDelTramo(actic, 'para-empezar'),
    paraIrMasAlla: certificacionDelTramo(actic, 'para-ir-mas-alla'),
    enlace: actic.enlace,
    vigenteDesde: actic.modelo.vigente_desde,
    areas: actic.areas.length,
    exencionDesempleo: actic.prueba.exencion.includes('desempleo'),
    fuente: actic.fuentes.actic,
  };
}

/** Las especialidades del catálogo de cada tramo, en el orden de su código: una sola pasada por el catálogo. */
function especialidadesDeLosTramos(
  formacion: DatosFormacion,
  criterio: CriterioDigitalTransversal,
  programas: ProgramasSepe | undefined,
): Record<TramoDelBloque, EspecialidadTransversal[]> {
  const tramos: Record<TramoDelBloque, EspecialidadTransversal[]> = { 'para-empezar': [], 'para-ir-mas-alla': [] };
  for (const [codigo, especialidad] of Object.entries(formacion.especialidades)) {
    const tramo = tramoDelBloque(codigo, especialidad, criterio);
    if (tramo) {
      tramos[tramo].push(fichaDeEspecialidad(codigo, especialidad, programas));
    }
  }
  for (const especialidades of Object.values(tramos)) {
    especialidades.sort((a, b) => compararPorCodigo(a.codigo, b.codigo));
  }
  return tramos;
}

/** Ninguna especialidad del bloque transversal es una sugerencia de Faro: las elige su criterio. */
function noEsSugerencia(): boolean {
  return false;
}

/**
 * Lo que hay de unas especialidades en el SOC y en el Consorci. Los cursos del SOC citan la especialidad por su primer
 * código («CTRD0042»), y el catálogo del SEPE guarda las transversales con los dos («CTRD0042 (FCOI0042)»). Cada curso,
 * edición o prevista lleva el código de una de `especialidades`.
 */
function ofertaDe(
  formacion: DatosFormacion,
  especialidades: EspecialidadTransversal[],
  hoy: string,
  consorci: DatosConsorci | null,
): OfertaDelTramo {
  const delPrimerCodigo = new Map(
    especialidades.map((especialidad) => [primerCodigo(especialidad.codigo), especialidad]),
  );
  const cursos = cursosOfrecidos(formacion, hoy, porEspecialidadElegida(delPrimerCodigo, noEsSugerencia));
  if (!consorci) {
    return { cursos, ediciones: [], previstas: [] };
  }
  const codigos = especialidades.map((especialidad) => especialidad.codigo);
  const { ediciones, previstas } = edicionesDelConsorci(consorci, porPrimerCodigo(especialidades), hoy, codigos);
  return { cursos, ediciones, previstas };
}

/** Un tramo con sus especialidades, su oferta y cuántas ediciones de ellas están programadas sin fecha. */
function tramoDe(
  especialidades: EspecialidadTransversal[],
  { cursos, ediciones, previstas }: OfertaDelTramo,
  consorci: DatosConsorci | null,
): TramoTransversal {
  const sinFecha = consorci
    ? especialidades.reduce((suma, especialidad) => suma + programadasSinFecha(consorci, especialidad.codigo), 0)
    : 0;
  return { especialidades, cursos, ediciones, previstas, programadasSinFecha: sinFecha };
}

/**
 * «Para ir más allá» (nivel 3): solo las especialidades que el SOC o el Consorci ofrecen en Cataluña (un curso o una
 * edición con fecha, o una acción prevista), para no llenar el plan de programas sin convocatoria. Null si el criterio
 * no tiene este tramo o ninguna tiene oferta. La oferta se busca una vez, con todas las candidatas: cada convocatoria
 * es de una especialidad con oferta, así que la de las ofrecidas es la misma.
 */
function paraIrMasAlla(
  formacion: DatosFormacion,
  candidatas: EspecialidadTransversal[],
  hoy: string,
  consorci: DatosConsorci | null,
): TramoTransversal | null {
  const oferta = ofertaDe(formacion, candidatas, hoy, consorci);
  const convocatorias: readonly (CursoRelacionado | EdicionRelacionada | PrevistaRelacionada)[] = [
    ...oferta.cursos,
    ...oferta.ediciones,
    ...oferta.previstas,
  ];
  const conOferta = new Set(convocatorias.map((convocatoria) => convocatoria.especialidad));
  const ofrecidas = candidatas.filter((especialidad) => conOferta.has(especialidad.codigo));
  return ofrecidas.length ? tramoDe(ofrecidas, oferta, consorci) : null;
}

/**
 * Bloque de formación digital transversal con un criterio (por defecto, el vigente), igual para todas las ocupaciones.
 *
 * @param formacion - El catálogo y los cursos del paquete.
 * @param hoy - El día de la consulta (AAAA-MM-DD): deja fuera los cursos y las ediciones ya terminados.
 * @param opciones - El criterio, el Consorci (con él, también sus ediciones y sus acciones previstas), los programas
 *   del SEPE comprobados y la ACTIC; sin opciones, el criterio vigente y nada más.
 * @returns El tramo «para empezar», el tramo «para ir más allá» (o null), la ACTIC y las citas del Consorci.
 * @throws {InvarianteRoto} Si la ACTIC del paquete no trae ningún nivel de un tramo.
 */
export function formacionDigitalTransversal(
  formacion: DatosFormacion,
  hoy: string,
  { criterio = CRITERIO_VIGENTE, consorci = null, programas, actic = null }: OpcionesTransversal = {},
): FormacionTransversal {
  const tramos = especialidadesDeLosTramos(formacion, criterio, programas);
  const deParaEmpezar = tramos['para-empezar'];
  const paraEmpezar = tramoDe(deParaEmpezar, ofertaDe(formacion, deParaEmpezar, hoy, consorci), consorci);
  const masAlla = paraIrMasAlla(formacion, tramos['para-ir-mas-alla'], hoy, consorci);
  const citaElConsorci = [paraEmpezar, masAlla].some(
    (tramo) => tramo !== null && tramo.ediciones.length + tramo.previstas.length > 0,
  );
  return {
    ...paraEmpezar,
    paraIrMasAlla: masAlla,
    certificacion: actic ? certificacionActic(actic) : null,
    fuenteConsorci: consorci && citaElConsorci ? consorci.fuente : null,
    buscadorConsorci: consorci ? consorci.buscador : null,
  };
}
