// La formación de fuera del catálogo oficial como opciones del plan, en el ámbito transversal: lo que el informe pone
// en cada tramo del bloque digital y de IA. De Citilab, su itinerario, con
// fechas vigentes; de la formación abierta, las fichas que la configuración deja llegar al informe, «para empezar» las
// de iniciación y nivel básico y «para ir más allá» las demás. Van detrás de las opciones oficiales del mismo tramo, y
// solo existen si el informe las trae: apagada la formación abierta, el plan es el de siempre.

import { itinerarioCitilab } from '../../compartido/utilidades/orden-de-convocatorias.ts';
import type { CursoAbierto, CursoCitilab, NivelAbierto, TramoCitilab } from '../../motores/cursos/src/index.ts';
import { AMBITO_TRANSVERSAL, RELACION_PARA_IR_MAS_ALLA, RELACION_TRANSVERSAL } from './aprendizaje.ts';
import type { OpcionAprendizaje, OtraFormacion } from './tipos-informe.ts';

/** Los niveles de la formación abierta que son «para empezar»; los demás, «para ir más allá». */
const NIVELES_PARA_EMPEZAR: ReadonlySet<NivelAbierto> = new Set(['iniciacion', 'A1', 'A2']);
/** Lo que una opción de fuera del catálogo no tiene: contacto de una entidad ni oferta prevista del Consorci. */
const SIN_CONTACTO_NI_PREVISTA = {
  web: null,
  correo: null,
  telefono: null,
  entidadesQueLaOfrecen: null,
  edicionesSinFecha: null,
} as const;

/**
 * La modalidad de una opción, como dato de su curso: en la lengua de la ficha (catalán para lo que se publica en
 * catalán; si no, castellano), igual que las modalidades del SOC y del Consorci se dan como las publica la fuente.
 */
const MODALIDAD: Readonly<Record<'ca' | 'es', { enLinea: string; presencial: string }>> = Object.freeze({
  ca: { enLinea: 'En línia', presencial: 'Presencial' },
  es: { enLinea: 'En línea', presencial: 'Presencial' },
});

/**
 * Los rótulos de modalidad en la lengua de una ficha.
 *
 * @param idioma - Idioma de la ficha del curso.
 * @returns Los rótulos en catalán si la ficha es catalana; si no, en castellano.
 */
function modalidadEn(idioma: string): (typeof MODALIDAD)['es'] {
  return idioma === 'ca' ? MODALIDAD.ca : MODALIDAD.es;
}

/** Una cifra de horas como texto, con coma decimal si la lleva («18,75»). */
function horasDe(horas: number | null): string {
  return horas === null ? '' : String(horas).replace('.', ',');
}

/**
 * Un curso del itinerario de Citilab como opción, con sus fechas y su coste si lo publica. Si su ficha no dice con
 * seguridad la modalidad (null), la opción no la afirma: modalidad vacía y a distancia desconocido.
 */
function opcionCitilab(curso: CursoCitilab, relacion: string, consultado: string): OpcionAprendizaje {
  const { coste } = curso;
  const rotulos = modalidadEn('ca');
  return {
    id: `${AMBITO_TRANSVERSAL}:citilab:${curso.id}`,
    grupo: AMBITO_TRANSVERSAL,
    tipo: 'curso',
    fuente: 'citilab',
    nombre: curso.titulo,
    idioma: 'ca',
    enlace: curso.enlace,
    modalidad: curso.modalidad === null ? '' : rotulos[curso.modalidad === 'en-linea' ? 'enLinea' : 'presencial'],
    horas: horasDe(curso.horas),
    municipio: curso.lugar?.municipio ?? null,
    centro: curso.lugar?.nombre ?? 'Citilab',
    inicio: curso.inicio,
    fin: curso.fin,
    coste: coste.gratuito === true ? 0 : coste.precio_eur,
    relacion,
    adecuacion: 'sin-verificar',
    inscripcion: 'sin-verificar',
    // El itinerario solo lleva cursos con fechas vigentes: por iniciar o ya empezados.
    momento: curso.momento === 'por-iniciar' ? 'por-iniciar' : 'iniciado',
    destinatarios: null,
    comprobado: consultado,
    aDistancia: curso.modalidad === null ? null : curso.modalidad === 'en-linea',
    ...SIN_CONTACTO_NI_PREVISTA,
  };
}

/** Un curso abierto como opción: en línea, gratis como oyente, con la entidad y hasta cuándo, si lo dice. */
function opcionAbierta(curso: CursoAbierto): OpcionAprendizaje {
  return {
    id: `${AMBITO_TRANSVERSAL}:abierta:${curso.id}`,
    grupo: AMBITO_TRANSVERSAL,
    tipo: 'curso',
    fuente: 'abierta',
    nombre: curso.titulo,
    idioma: curso.idioma,
    enlace: curso.enlace,
    modalidad: modalidadEn(curso.idioma).enLinea,
    horas: horasDe(curso.horas),
    municipio: null,
    centro: curso.entidad,
    inicio: null,
    fin: curso.fin,
    coste: 0,
    relacion: NIVELES_PARA_EMPEZAR.has(curso.nivel) ? RELACION_TRANSVERSAL : RELACION_PARA_IR_MAS_ALLA,
    adecuacion: 'sin-verificar',
    inscripcion: 'sin-verificar',
    momento: null,
    destinatarios: null,
    comprobado: curso.comprobado,
    aDistancia: true,
    ...SIN_CONTACTO_NI_PREVISTA,
  };
}

/**
 * Las opciones del plan de la formación de fuera del catálogo oficial que lleva el informe.
 *
 * @param otra - La formación de fuera del catálogo que lleva el informe.
 * @param otra.citilab - El itinerario de Citilab, si el despliegue lo enseña.
 * @param otra.formacionAbierta - Las fichas de la formación abierta, si la configuración las deja llegar.
 * @returns Las opciones de Citilab («para empezar» y «para ir más allá») y, detrás, las de la formación abierta.
 */
export function opcionesDeOtraFormacion({ citilab, formacionAbierta }: OtraFormacion): OpcionAprendizaje[] {
  const delItinerario = (tramo: Exclude<TramoCitilab, null>, relacion: string) => {
    if (!citilab) {
      return [];
    }
    return itinerarioCitilab(citilab, tramo).map((curso) => opcionCitilab(curso, relacion, citilab.consultado));
  };
  return [
    ...delItinerario('para-empezar', RELACION_TRANSVERSAL),
    ...delItinerario('para-ir-mas-alla', RELACION_PARA_IR_MAS_ALLA),
    ...(formacionAbierta?.publica ?? []).map(opcionAbierta),
    ...(formacionAbierta?.noPublica ?? []).map(opcionAbierta),
  ];
}
