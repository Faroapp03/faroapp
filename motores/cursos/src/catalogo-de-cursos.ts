// La sección «Cursos»: la bolsa de cursos (bolsa-de-cursos.ts) filtrada, en una sola lista por páginas (primero lo que
// se puede empezar o tiene fecha; después lo que hay que preguntar a la entidad) y con el recuento de cada opción de
// cada filtro. El recuento de un filtro cuenta con los demás filtros puestos, como en la biblioteca: dice cuántos
// cursos quedarían al elegir esa opción. La bolsa se prepara una vez por día y por oferta.

import { OPCIONES_DE_CURSOS } from '../../../compartido/contratos/filtros-de-cursos.ts';
import type { Datos } from '../../../src/dominio/tipos-paquete.ts';
import { bolsaDeCursos, type CursoDeLaBolsa } from './bolsa-de-cursos.ts';
import type { OfertaDeFormacion } from './oferta-de-formacion.ts';

// Las opciones de los filtros viven en compartido/contratos/filtros-de-cursos.ts: la app las usa sin cargar este motor.
export { OPCIONES_DE_CURSOS };

/** Lo que filtra la persona; lo que no viene, no filtra. `tema` es «ia» o el nombre de una familia profesional. */
export interface FiltrosDeCursos {
  texto?: string;
  cuando?: (typeof OPCIONES_DE_CURSOS.cuando)[number];
  modalidad?: (typeof OPCIONES_DE_CURSOS.modalidad)[number];
  tema?: string;
  nivel?: (typeof OPCIONES_DE_CURSOS.nivel)[number];
  quien?: (typeof OPCIONES_DE_CURSOS.quien)[number];
  fuente?: CursoDeLaBolsa['fuente'];
}

type Filtro = Exclude<keyof FiltrosDeCursos, 'texto'>;
const FILTROS: readonly Filtro[] = ['cuando', 'modalidad', 'tema', 'nivel', 'quien', 'fuente'];
/** El tema de los cursos que hablan de inteligencia artificial. */
const TEMA_IA = 'ia';

/** La página de la sección «Cursos». */
interface PaginaDeCursos {
  /** El día de la bolsa (AAAA-MM-DD). */
  fecha: string;
  /** Cuántos cursos hay en la bolsa y cuántos quedan con los filtros. */
  enLaBolsa: number;
  total: number;
  /** La página que se da (desde 1), cuántas hay y sus fichas, en el orden de la bolsa. */
  pagina: number;
  paginas: number;
  fichas: CursoDeLaBolsa[];
  /** Por filtro, cuántos cursos quedarían con cada opción (con los demás filtros puestos). */
  recuentos: Record<Filtro, Record<string, number>>;
}

/** Lo que se pide: el día y la oferta de la bolsa, los filtros, la página y cuántas fichas tiene. */
interface ConsultaDeCursos {
  /** El día (AAAA-MM-DD). */
  hoy: string;
  /** La oferta del despliegue (formación abierta y cursos de pago de Citilab). */
  oferta: OfertaDeFormacion;
  filtros?: FiltrosDeCursos;
  pagina?: number;
  porPagina?: number;
}

const POR_PAGINA = 24;
const BOLSAS_EN_MEMORIA = 2;

/** Las bolsas preparadas de cada paquete, por día y oferta: la última pedida y la anterior (cambio de día). */
const bolsas = new WeakMap<Datos, Map<string, CursoDeLaBolsa[]>>();

/** La bolsa del día, preparada una vez. */
function bolsaDelDia(datos: Datos, hoy: string, oferta: OfertaDeFormacion): CursoDeLaBolsa[] {
  const clave = `${hoy}|${oferta.formacionAbierta}|${oferta.citilabDePago}`;
  const delPaquete = bolsas.get(datos) ?? new Map<string, CursoDeLaBolsa[]>();
  bolsas.set(datos, delPaquete);
  const guardada = delPaquete.get(clave);
  if (guardada) {
    return guardada;
  }
  const bolsa = bolsaDeCursos(datos, hoy, oferta);
  delPaquete.set(clave, bolsa);
  for (const vieja of [...delPaquete.keys()].slice(0, Math.max(0, delPaquete.size - BOLSAS_EN_MEMORIA))) {
    delPaquete.delete(vieja);
  }
  return bolsa;
}

/** Un texto en minúsculas y sin tildes, para buscar. */
function normalizado(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Los valores de un curso en cada filtro: uno o ninguno, salvo en el tema («ia» y su familia). */
const VALORES: Readonly<Record<Filtro, (curso: CursoDeLaBolsa) => string[]>> = {
  cuando: (curso) => [curso.conFecha ? 'con-fecha' : 'sin-fecha'],
  modalidad: (curso) => (curso.aDistancia === null ? [] : [curso.aDistancia ? 'a-distancia' : 'presencial']),
  tema: (curso) => [...(curso.conIa ? [TEMA_IA] : []), ...(curso.familia ? [curso.familia] : [])],
  nivel: (curso) => (curso.nivel ? [String(curso.nivel)] : []),
  quien: (curso) => (curso.destinatarios ? [curso.destinatarios] : []),
  fuente: (curso) => [curso.fuente],
};

/** Los valores de un curso en un filtro. */
function valoresDe(curso: CursoDeLaBolsa, filtro: Filtro): string[] {
  return VALORES[filtro](curso);
}

/** Si un curso cumple los filtros elegidos, menos el que se cuenta (para el recuento de ese filtro). */
function cumpleLosFiltros(curso: CursoDeLaBolsa, filtros: FiltrosDeCursos, salvo?: Filtro): boolean {
  return FILTROS.every((filtro) => {
    const elegido = filtros[filtro];
    return filtro === salvo || elegido === undefined || valoresDe(curso, filtro).includes(elegido);
  });
}

/** Si el nombre, las entidades, la familia o el código de un curso contienen todas las palabras buscadas. */
function tieneLasPalabras(curso: CursoDeLaBolsa, palabras: readonly string[]): boolean {
  if (!palabras.length) {
    return true;
  }
  const texto = normalizado([curso.nombre, ...curso.entidades, curso.familia ?? '', curso.especialidad].join(' '));
  return palabras.every((palabra) => texto.includes(palabra));
}

/** Si un curso cumple los filtros y la búsqueda, menos el filtro que se cuenta. */
function cumple(curso: CursoDeLaBolsa, filtros: FiltrosDeCursos, palabras: readonly string[], salvo?: Filtro): boolean {
  return cumpleLosFiltros(curso, filtros, salvo) && tieneLasPalabras(curso, palabras);
}

/** Por filtro, cuántos cursos quedarían con cada opción. */
function recuentosDe(
  bolsa: readonly CursoDeLaBolsa[],
  filtros: FiltrosDeCursos,
  palabras: readonly string[],
): PaginaDeCursos['recuentos'] {
  const recuentos = Object.fromEntries(
    FILTROS.map((f) => [f, {} as Record<string, number>]),
  ) as PaginaDeCursos['recuentos'];
  for (const filtro of FILTROS) {
    const cuenta = recuentos[filtro];
    for (const curso of bolsa) {
      if (cumple(curso, filtros, palabras, filtro)) {
        for (const valor of valoresDe(curso, filtro)) {
          cuenta[valor] = (cuenta[valor] ?? 0) + 1;
        }
      }
    }
  }
  return recuentos;
}

/**
 * La página de la sección «Cursos» del día: cuántos cursos cumplen los filtros, la página pedida (la última si se pide
 * una de más) y el recuento de cada opción de cada filtro.
 *
 * @param datos - El paquete de datos.
 * @param consulta - El día, la oferta, los filtros y la página pedida.
 * @returns La página.
 */
export function catalogoDeCursos(
  datos: Datos,
  { hoy, oferta, filtros = {}, pagina = 1, porPagina = POR_PAGINA }: ConsultaDeCursos,
): PaginaDeCursos {
  const bolsa = bolsaDelDia(datos, hoy, oferta);
  const palabras = normalizado(filtros.texto ?? '')
    .split(/[^\p{L}\d]+/u)
    .filter(Boolean);
  const quedan = bolsa.filter((curso) => cumple(curso, filtros, palabras));
  const paginas = Math.max(1, Math.ceil(quedan.length / porPagina));
  const suya = Math.min(Math.max(1, pagina), paginas);
  return {
    fecha: hoy,
    enLaBolsa: bolsa.length,
    total: quedan.length,
    pagina: suya,
    paginas,
    fichas: quedan.slice((suya - 1) * porPagina, suya * porPagina),
    recuentos: recuentosDe(bolsa, filtros, palabras),
  };
}
