// Cursos de Citilab según fechas, coste y requisitos: gratuitos primero y pago solo si lo permite la oferta.
// El itinerario digital e IA incluye únicamente cursos por iniciar o iniciados, de menos a más requisitos.
// Las fichas se trasladan por lista blanca; la selección temporal no comprueba plazas ni inscripción.

import type {
  CitilabDelInforme,
  CursoCitilab,
  CursoCitilabOficial,
  DatosCitilab,
  MomentoCitilab,
  TramoCitilab,
} from '../../../compartido/contratos/tipos-citilab.ts';
import { compararPorCodigo } from '../../../src/comun/orden.js';
import { compararTexto } from '../../../src/comun/orden-alfabetico.ts';
import type { OfertaDeFormacion } from './oferta-de-formacion.ts';
import { esCopiaAntigua } from './vigencia-cursos.ts';

/** El término de Citilab para las competencias digitales generales. */
const TEMA_DIGITAL = 'competencies-digitals';
/** El orden de los momentos: lo que está por empezar antes que lo empezado; lo que hay que consultar, al final. */
const ORDEN_MOMENTO: Readonly<Record<MomentoCitilab, number>> = {
  'por-iniciar': 0,
  iniciado: 1,
  periodico: 2,
  consultar: 3,
};

/**
 * El momento de un curso el día `hoy`, solo por sus fechas. Las fechas reales AAAA-MM-DD se comparan como
 * texto, que es su orden cronológico.
 *
 * @param curso - Las fechas del curso y si funciona todo el año con un horario semanal.
 * @param hoy - El día del informe (AAAA-MM-DD).
 * @returns Su momento: por iniciar, iniciado, periódico o para consultar.
 */
export function momentoCitilab(
  curso: Pick<CursoCitilabOficial, 'inicio' | 'fin' | 'periodico'>,
  hoy: string,
): MomentoCitilab {
  const { inicio, fin } = curso;
  if (inicio && inicio > hoy) {
    return 'por-iniciar';
  }
  if (inicio && fin && fin >= hoy) {
    return 'iniciado';
  }
  if (!inicio && !fin && curso.periodico) {
    return 'periodico';
  }
  return 'consultar';
}

/**
 * El tramo del itinerario digital y de IA: solo cursos con fechas vigentes de competencias digitales o de IA.
 *
 * @param curso - Los temas del curso y si trata la IA.
 * @param momento - Su momento el día del informe (momentoCitilab).
 * @returns «para-ir-mas-alla» si trata la IA, «para-empezar» si es de competencias digitales, o null.
 */
export function tramoCitilab(
  curso: Pick<CursoCitilabOficial, 'temas' | 'trata_ia'>,
  momento: MomentoCitilab,
): TramoCitilab {
  if (momento !== 'por-iniciar' && momento !== 'iniciado') {
    return null;
  }
  if (curso.trata_ia) {
    return 'para-ir-mas-alla';
  }
  return curso.temas.includes(TEMA_DIGITAL) ? 'para-empezar' : null;
}

/** Primero lo gratuito: los cursos de pago o sin un coste claro van detrás (criterios de Citilab). */
function ordenPorCoste(curso: CursoCitilab): number {
  return curso.coste.gratuito === true ? 0 : 1;
}

/** Compara inicios conocidos y deja las ausencias detrás, también frente al año 9999. */
function ordenPorInicio(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return compararPorCodigo(a, b);
}

/** El desempate de los dos órdenes: por fecha de inicio (los cursos sin ella, al final) y por título. */
function porInicioYTitulo(a: CursoCitilab, b: CursoCitilab): number {
  return ordenPorInicio(a.inicio, b.inicio) || compararTexto(a.titulo, b.titulo, 'ca');
}

/** El orden de las convocatorias de Citilab: lo gratuito primero; después, por momento, fecha de inicio y título. */
function ordenCitilab(a: CursoCitilab, b: CursoCitilab): number {
  return (
    ordenPorCoste(a) - ordenPorCoste(b) || ORDEN_MOMENTO[a.momento] - ORDEN_MOMENTO[b.momento] || porInicioYTitulo(a, b)
  );
}

/**
 * Un curso del paquete en el informe, con su momento y su tramo. Se copia campo a campo (lista blanca): un campo nuevo
 * de la ficha no llega al informe ni a la API sin añadirlo aquí y en CursoCitilab.
 */
function cursoCitilab(curso: CursoCitilabOficial, hoy: string): CursoCitilab {
  const momento = momentoCitilab(curso, hoy);
  return {
    id: curso.id,
    titulo: curso.titulo,
    enlace: curso.enlace,
    publico: curso.publico,
    modalidad: curso.modalidad,
    requisitos: curso.requisitos,
    horas: curso.horas,
    sesiones: curso.sesiones,
    inicio: curso.inicio,
    fin: curso.fin,
    horario: curso.horario,
    coste: curso.coste,
    lugar: curso.lugar,
    momento,
    tramo: tramoCitilab(curso, momento),
  };
}

/**
 * Los cursos de Citilab del informe el día `hoy`, en el orden de las convocatorias. `consultado` es el día de la copia
 * del paquete.
 *
 * @param datos - Los cursos de Citilab del paquete, o undefined si no los trae.
 * @param hoy - El día del informe (AAAA-MM-DD).
 * @param oferta - La oferta del despliegue: sin `citilabDePago`, solo los cursos que la ficha dice gratuitos, y de los
 *   demás no queda nada en el informe.
 * @returns Los cursos con su cita; null tanto si el paquete no los trae como si la oferta no deja ninguno.
 */
export function citilabDelInforme(
  datos: DatosCitilab | undefined,
  hoy: string,
  { citilabDePago }: Pick<OfertaDeFormacion, 'citilabDePago'>,
): CitilabDelInforme | null {
  if (!datos) {
    return null;
  }
  const cursos = datos.cursos
    .filter((curso) => citilabDePago || curso.coste.gratuito === true)
    .map((curso) => cursoCitilab(curso, hoy))
    .sort(ordenCitilab);
  if (!cursos.length) {
    return null;
  }
  return {
    cursos,
    consultado: datos.copia,
    copiaAntigua: esCopiaAntigua(datos.copia, hoy),
    listado: datos.listado,
    fuente: datos.fuente,
  };
}

// El itinerario es un orden puro de los cursos ya elegidos: vive en compartido/ (la presentación del informe lo usa
// sin cargar el motor) y se reexporta aquí.
export { itinerarioCitilab } from '../../../compartido/utilidades/orden-de-convocatorias.ts';
