/** Modelo de lectura de Cursos. La publicación ya acreditó la gratuidad y las fuentes. El reloj, los filtros y el idioma siguen siendo del visitante. */
import type { Idioma } from '../comun/idioma.ts';
import { RelojAtrasado } from '../comun/reloj-atrasado.ts';
import { contieneBusqueda, palabrasBuscadas } from './busqueda.ts';
import { diaDeCursado } from './calendarios.ts';
import type { NivelClasificado } from './clasificacion.ts';
import type { EntregaCatalogo, HechoCatalogo, OfertaCatalogo } from './contrato.ts';
import type { TemaCurso } from './temas.ts';
import { instanteCatalogo, relojCatalogo } from './vigencia.ts';

export interface FiltrosCatalogo {
  readonly texto: string;
  readonly idioma: string;
  readonly modalidad: string;
  readonly nivel?: string;
  readonly tema?: string;
  readonly orden?: string;
}
export const CAMPOS_FILTRO = ['idioma', 'nivel', 'modalidad', 'tema'] as const;
export type CampoFiltro = (typeof CAMPOS_FILTRO)[number];
export interface ContextoConsulta {
  readonly idioma: Idioma;
  readonly nombresTemas: ReadonlyMap<TemaCurso, string>;
}
export const CAMPOS_FICHA = [
  'horas_publicadas',
  'modalidad',
  'sincronia',
  'certificado_gratuito',
  'coste_certificado',
  'calendario_formacion',
  'calendario_aula',
  'calendario_matricula',
] as const;
export type HechoFicha = Pick<HechoCatalogo, 'valor' | 'motivo' | 'alcance' | 'moneda'>;
export type OrigenIdiomaFicha = 'faro' | 'norma-general' | 'edicion' | 'programa' | 'historial-cibernarium' | null;
export interface FichaListado
  extends Pick<
    OfertaCatalogo,
    'titulo_programa' | 'url' | 'comprobado_el' | 'cierra_el' | 'incidencia_enlace_el' | 'preinscripcion'
  > {
  readonly identidad: string;
  readonly proveedor: string;
  readonly hechos: Readonly<Record<(typeof CAMPOS_FICHA)[number], HechoFicha>>;
  readonly temas: readonly TemaCurso[];
  readonly nivel: Pick<NivelClasificado, 'valor' | 'origen' | 'literal' | 'motivo'>;
  readonly idiomas: readonly string[];
  readonly origenIdioma: OrigenIdiomaFicha;
}
export interface ListadoCursos extends Pick<EntregaCatalogo, 'corte_proyeccion_utc'> {
  readonly ofertas: readonly FichaListado[];
}
export interface ConsultaListado<T = FichaListado> {
  readonly ofertas: readonly T[];
  readonly total: number;
  readonly cuentas: ReadonlyMap<CampoFiltro, ReadonlyMap<string, number>>;
}
const CONTEXTO_POR_DEFECTO: ContextoConsulta = { idioma: 'es', nombresTemas: new Map() };
const MICROS_POR_MILI = 1_000n;
const MAX_ESPERA_MS = 2_147_483_647;
/** Sincronía no acredita fechas, matrícula abierta ni disponibilidad «cuando quieras». */
function valoresDeFiltro(fila: FichaListado, campo: CampoFiltro): readonly string[] {
  const { hechos } = fila;
  switch (campo) {
    case 'tema':
      return fila.temas;
    case 'nivel':
      return [fila.nivel.valor ?? 'no-indicado'];
    case 'idioma':
      return fila.idiomas;
    case 'modalidad': {
      const modalidad = hechos.modalidad;
      if (modalidad.motivo !== 'conocido') {
        return [];
      }
      return modalidad.valor === 'mixta' ? ['en-linea', 'presencial'] : [String(modalidad.valor)];
    }
  }
}
function cumple(fila: FichaListado, filtros: FiltrosCatalogo, salvo?: CampoFiltro): boolean {
  return CAMPOS_FILTRO.every(
    (campo) => !filtros[campo] || campo === salvo || valoresDeFiltro(fila, campo).includes(filtros[campo]),
  );
}
function cuentasDe(filas: readonly FichaListado[], filtros: FiltrosCatalogo) {
  return new Map(
    CAMPOS_FILTRO.map((campo) => {
      const resto = filas.filter((fila) => cumple(fila, filtros, campo));
      const cuentas = new Map<string, number>([['todo', resto.length]]);
      for (const fila of resto) {
        for (const valor of valoresDeFiltro(fila, campo)) {
          cuentas.set(valor, (cuentas.get(valor) ?? 0) + 1);
        }
      }
      return [campo, cuentas] as const;
    }),
  );
}
function compararFechas(x: string | undefined, y: string | undefined): number {
  if (x === y) {
    return 0;
  }
  if (x === undefined) {
    return 1;
  }
  if (y === undefined) {
    return -1;
  }
  return x < y ? -1 : 1;
}
/** También sirve a la consulta del catálogo completo. El orden y los recuentos tienen una sola implementación. */
export function consultarFichas(
  vigentes: readonly FichaListado[],
  filtros: FiltrosCatalogo,
  ahora: number,
  contexto: ContextoConsulta = CONTEXTO_POR_DEFECTO,
): ConsultaListado {
  const palabras = palabrasBuscadas(filtros.texto);
  const filas = palabras.length
    ? vigentes.filter((fila) => {
        const texto = [
          fila.titulo_programa,
          fila.proveedor,
          ...fila.temas,
          ...fila.temas.map((tema) => contexto.nombresTemas.get(tema) ?? ''),
        ].join(' ');
        return contieneBusqueda(texto, palabras);
      })
    : vigentes;
  const ofertas = filas.filter((fila) => cumple(fila, filtros));
  const orden = new Intl.Collator(contexto.idioma, { sensitivity: 'base', numeric: true });
  const fechas = filtros.orden === 'nombre' ? undefined : new Map(ofertas.map((o) => [o, diaDeCursado(o, ahora)]));
  ofertas.sort(
    (a, b) =>
      (fechas && compararFechas(fechas.get(a), fechas.get(b))) ||
      orden.compare(a.titulo_programa, b.titulo_programa) ||
      orden.compare(a.identidad, b.identidad),
  );
  return { ofertas, total: vigentes.length, cuentas: cuentasDe(filas, filtros) };
}
export function consultarListado(
  listado: ListadoCursos,
  filtros: FiltrosCatalogo,
  ahora: number,
  contexto?: ContextoConsulta,
) {
  const reloj = relojCatalogo(ahora);
  if (reloj < instanteCatalogo(listado.corte_proyeccion_utc)) {
    throw new RelojAtrasado('Reloj anterior al corte de la entrega');
  }
  const vigentes = listado.ofertas.filter((o) => o.cierra_el === null || reloj < instanteCatalogo(o.cierra_el));
  return consultarFichas(vigentes, filtros, ahora, contexto);
}
/** Primer vencimiento estrictamente futuro, con la precisión temporal de la fuente. */
export function esperaHastaCierre(ofertas: readonly Pick<OfertaCatalogo, 'cierra_el'>[], ahora: number): number | null {
  const reloj = relojCatalogo(ahora);
  let menor: bigint | undefined;
  for (const oferta of ofertas) {
    if (oferta.cierra_el !== null) {
      const diferencia = instanteCatalogo(oferta.cierra_el) - reloj;
      if (diferencia > 0n && (menor === undefined || diferencia < menor)) {
        menor = diferencia;
      }
    }
  }
  return menor === undefined ? null : Math.min(Number((menor + MICROS_POR_MILI - 1n) / MICROS_POR_MILI), MAX_ESPERA_MS);
}
