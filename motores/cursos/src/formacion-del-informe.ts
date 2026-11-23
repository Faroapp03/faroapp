// La formación del informe en una sola llamada: lo que el informe enseña de formación (la oficial de la ocupación, el
// bloque digital transversal y la de fuera del catálogo oficial) y lo que su plan necesita de ella (la formación de los
// otros grupos de sus objetivos y la oferta prevista del Consorci de cada especialidad). La app la pide por la puerta
// del motor (src/plataforma/motor-de-cursos.ts) y la da a construirInforme (src/dominio/informe.ts), que no importa
// nada del motor: sin motor, el informe sale entero salvo la formación. Lo que sale de aquí es solo dato.

import type { FormacionRelacionada, FormacionTransversal } from '../../../compartido/contratos/tipos-formacion.ts';
import { consultaGrupo, consultaOcupacion } from '../../../src/dominio/consulta-de-vectores.ts';
import type { OcupacionConfirmada } from '../../../src/dominio/ocupacion-confirmada.ts';
import type { OtraFormacion } from '../../../src/dominio/tipos-informe.ts';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import type { CriterioDigitalTransversal } from './criterio-digital-transversal.ts';
import { consorciDe, formacionComprobada } from './enlaces-comprobados.ts';
import { formacionDelGrupo, formacionPara } from './formacion.ts';
import { formacionAbiertaDelInforme } from './formacion-abierta.ts';
import { citilabDelInforme } from './formacion-citilab.ts';
import { entidadesQueLaOfrecen, programadasSinFecha } from './formacion-consorci.ts';
import { formacionDigitalTransversal } from './formacion-transversal.ts';
import { OFERTA_POR_DEFECTO, type OfertaDeFormacion } from './oferta-de-formacion.ts';

/** Lo que el informe pide al motor: la ocupación comprobada, los otros grupos de su plan, el día y la oferta. */
export interface PeticionDeFormacion {
  readonly ocupacion: OcupacionConfirmada;
  /** Los grupos del plan que no son el principal (el segundo y los de las referencias de otro grupo), en su orden. */
  readonly otrosGrupos: readonly string[];
  /** El día del informe (AAAA-MM-DD). */
  readonly hoy: string;
  /** El criterio del bloque digital transversal; sin él, el vigente. */
  readonly criterio?: CriterioDigitalTransversal | undefined;
  /** La formación de fuera del catálogo oficial que permite el despliegue; sin ella, OFERTA_POR_DEFECTO. */
  readonly oferta?: OfertaDeFormacion | undefined;
}

/** Lo que el Consorci tiene previsto de una especialidad: cuántas entidades suelen ofrecerla y ediciones sin fecha. */
export interface OfertaPrevista {
  readonly entidades: number;
  readonly sinFecha: number;
}

/** La formación del informe, ya calculada. */
export interface FormacionDelInforme {
  /** La formación oficial de la ocupación (o de su grupo); null si el paquete no la trae. */
  readonly formacion: FormacionRelacionada | null;
  /** El bloque digital transversal; null si el paquete no trae la formación oficial. */
  readonly transversal: FormacionTransversal | null;
  /** Citilab y la formación abierta que deja la oferta; los campos sin nada no aparecen. */
  readonly otraFormacion: OtraFormacion;
  /** La formación de cada uno de los otros grupos pedidos, en su orden; vacía sin la formación oficial. */
  readonly otrosGrupos: readonly { readonly grupo: string; readonly formacion: FormacionRelacionada }[];
  /** La oferta prevista del Consorci de cada especialidad de todo lo anterior, por código; null sin el Consorci. */
  readonly ofertaPrevista: Readonly<Record<string, OfertaPrevista>> | null;
}

/**
 * Formación oficial de la ocupación; con vectores de formación, ordenada por parecido y con sugerencias de Faro. Sin
 * ocupación ESCO, a nivel de grupo: por la correspondencia del INE y el parecido con las tareas del grupo. Con el
 * Consorci en el paquete, también sus ediciones para personas que trabajan. Solo los cursos del SOC que siguen en su
 * oferta y las webs de entidades que responden (enlaces-comprobados.ts).
 *
 * @param datos - El paquete de datos.
 * @param ocupacion - La ocupación comprobada: con ocupación ESCO o solo con su grupo ISCO-08.
 * @param hoy - El día del informe (AAAA-MM-DD).
 * @returns La formación relacionada; null si el paquete no trae la formación oficial.
 * @throws {InvarianteRoto} Si la correspondencia del INE trae un tipo desconocido.
 */
export function formacionDeLaOcupacion(
  datos: Datos,
  ocupacion: OcupacionConfirmada,
  hoy: string,
): FormacionRelacionada | null {
  const formacion = formacionComprobada(datos);
  if (!formacion) {
    return null;
  }
  const consulta =
    ocupacion.esco === null ? consultaGrupo(datos, ocupacion.isco08) : consultaOcupacion(datos, ocupacion.esco);
  const relevancia =
    datos.vectoresFormacion && consulta ? { especialidades: datos.vectoresFormacion.especialidades, consulta } : null;
  const programas = datos.enlaces?.programas;
  const opciones = { relevancia, consorci: consorciDe(datos), ...(programas === undefined ? {} : { programas }) };
  if (ocupacion.esco !== null) {
    return formacionPara(formacion, ocupacion.esco, hoy, opciones);
  }
  const correspondencias = datos.clasificaciones.isco08_a_cno11[ocupacion.isco08] ?? [];
  return formacionDelGrupo(formacion, correspondencias, hoy, opciones);
}

/**
 * El bloque de formación digital transversal del informe, con el criterio pedido (sin él, el vigente) y el Consorci si
 * está en el paquete.
 */
function transversalDe(
  datos: Datos,
  hoy: string,
  criterio: CriterioDigitalTransversal | undefined,
): FormacionTransversal | null {
  const formacion = formacionComprobada(datos);
  if (!formacion) {
    return null;
  }
  return formacionDigitalTransversal(formacion, hoy, {
    ...(criterio === undefined ? {} : { criterio }),
    consorci: consorciDe(datos),
    ...(datos.enlaces?.programas === undefined ? {} : { programas: datos.enlaces.programas }),
    ...(datos.actic === undefined ? {} : { actic: datos.actic }),
  });
}

/**
 * La formación de fuera del catálogo oficial que permite la oferta del despliegue: los cursos de Citilab y la
 * formación abierta. Los campos que no llevan nada no aparecen.
 */
function otraFormacionDe(datos: Datos, hoy: string, oferta: OfertaDeFormacion): OtraFormacion {
  const citilab = citilabDelInforme(datos.citilab, hoy, oferta);
  const abierta = formacionAbiertaDelInforme(
    () => datos.formacionAbierta,
    oferta.formacionAbierta,
    hoy,
    () => datos.barcelonaActiva,
  );
  return { ...(citilab ? { citilab } : {}), ...(abierta ? { formacionAbierta: abierta } : {}) };
}

/**
 * La formación de los otros grupos del plan, en el orden pedido, sin orden por parecido (no hay vectores de esos
 * grupos en el informe).
 */
function formacionDeOtrosGrupos(
  datos: Datos,
  grupos: readonly string[],
  hoy: string,
): FormacionDelInforme['otrosGrupos'] {
  const formacion = formacionComprobada(datos);
  if (!formacion) {
    return [];
  }
  const consorci = consorciDe(datos);
  const programas = datos.enlaces?.programas;
  return grupos.map((grupo) => ({
    grupo,
    formacion: formacionDelGrupo(formacion, datos.clasificaciones.isco08_a_cno11[grupo] ?? [], hoy, {
      consorci,
      ...(programas ? { programas } : {}),
    }),
  }));
}

/** La oferta prevista del Consorci de cada especialidad de la formación del informe; null sin el Consorci. */
function ofertaPrevistaDe(
  datos: Datos,
  formaciones: readonly (FormacionRelacionada | null)[],
  transversal: FormacionTransversal | null,
): FormacionDelInforme['ofertaPrevista'] {
  const consorci = consorciDe(datos);
  if (!consorci) {
    return null;
  }
  const tramos = transversal ? [transversal, ...(transversal.paraIrMasAlla ? [transversal.paraIrMasAlla] : [])] : [];
  const codigos = new Set([
    ...formaciones.flatMap((formacion) => formacion?.especialidades ?? []).map(({ codigo }) => codigo),
    ...tramos.flatMap((tramo) => tramo.especialidades).map(({ codigo }) => codigo),
  ]);
  return Object.fromEntries(
    [...codigos].map((codigo) => [
      codigo,
      { entidades: entidadesQueLaOfrecen(consorci, codigo), sinFecha: programadasSinFecha(consorci, codigo) },
    ]),
  );
}

/**
 * La formación del informe en una sola llamada: la oficial de la ocupación, la transversal, la de fuera del catálogo
 * oficial, la de los otros grupos del plan y la oferta prevista del Consorci de cada especialidad.
 *
 * @param datos - El paquete de datos.
 * @param peticion - La ocupación, los otros grupos, el día, el criterio transversal y la oferta del despliegue.
 * @returns La formación del informe, solo datos.
 * @throws {InvarianteRoto} Si la correspondencia del INE trae un tipo desconocido.
 */
export function formacionDelInforme(datos: Datos, peticion: PeticionDeFormacion): FormacionDelInforme {
  const { ocupacion, hoy } = peticion;
  const formacion = formacionDeLaOcupacion(datos, ocupacion, hoy);
  const transversal = transversalDe(datos, hoy, peticion.criterio);
  const otraFormacion = otraFormacionDe(datos, hoy, peticion.oferta ?? OFERTA_POR_DEFECTO);
  const otrosGrupos = formacionDeOtrosGrupos(datos, peticion.otrosGrupos, hoy);
  const ofertaPrevista = ofertaPrevistaDe(
    datos,
    [formacion, ...otrosGrupos.map((otro) => otro.formacion)],
    transversal,
  );
  return { formacion, transversal, otraFormacion, otrosGrupos, ofertaPrevista };
}
