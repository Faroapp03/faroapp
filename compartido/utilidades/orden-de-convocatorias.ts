// Órdenes puros de las convocatorias que enseña el informe, sin lógica de ningún motor: el de las convocatorias del SOC
// y del Consorci (por momento, inicio y nombre) y el del itinerario de Citilab (por requisitos, inicio y título). Los
// usan la presentación del informe y el motor de cursos (motores/cursos/), que los reexporta. No importa nada de
// motores/ ni de src/: los dos comparadores que necesita (por código y alfabético) son los de src/comun/orden.js y
// src/comun/orden-alfabetico.ts, escritos aquí igual.

/** El momento de una convocatoria del SOC o del Consorci (MomentoCurso en el motor de cursos). */
type MomentoDeLaConvocatoria = 'por-iniciar' | 'iniciado' | 'sin-fecha';

/** Prioridad de los momentos: por iniciar, iniciado y sin fecha. */
const ORDEN_MOMENTO: Readonly<Record<MomentoDeLaConvocatoria, number>> = {
  'por-iniciar': 0,
  iniciado: 1,
  'sin-fecha': 2,
};

/** El orden alfabético de cada idioma de Faro, como compararTexto (src/comun/orden-alfabetico.ts). */
const ALFABETICO = Object.freeze({ es: new Intl.Collator('es'), ca: new Intl.Collator('ca') });

/** Compara por unidades de código UTF-16, como compararPorCodigo (src/comun/orden.js). */
function porCodigo(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

/** Compara inicios conocidos por código y deja las ausencias detrás, incluso en el año 9999. */
function ordenPorInicio(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return Number(a === null) - Number(b === null);
  }
  return porCodigo(a, b);
}

/** Lo que decide el orden de una convocatoria. */
export interface ClavesDeOrden {
  momento: MomentoDeLaConvocatoria;
  inicio: string | null;
  nombre: string;
}

/**
 * Ordena por momento, inicio y nombre en castellano. A igual momento, el inicio desconocido va al final.
 * Si empatan las tres claves devuelve 0: un sort estable conserva el orden recibido.
 * `momento` debe ser uno de los valores de MomentoCurso; no se reciben cursos terminados.
 *
 * @param a - Claves de una convocatoria.
 * @param b - Claves de la otra.
 * @returns Negativo si `a` va antes, positivo si va después y 0 si empatan.
 */
export function ordenDeConvocatorias(a: ClavesDeOrden, b: ClavesDeOrden): number {
  return (
    ORDEN_MOMENTO[a.momento] - ORDEN_MOMENTO[b.momento] ||
    ordenPorInicio(a.inicio, b.inicio) ||
    ALFABETICO.es.compare(a.nombre, b.nombre)
  );
}

/** Lo que el itinerario de Citilab mira de cada curso (CursoCitilab en el motor de cursos). */
export interface CursoDelItinerario {
  tramo: 'para-empezar' | 'para-ir-mas-alla' | null;
  requisitos: 'ninguno' | 'prueba' | 'otros' | null;
  inicio: string | null;
  titulo: string;
}

/**
 * En el itinerario, primero lo que no pide requisitos; después, y juntos, lo que pide una prueba u otros conocimientos
 * y lo que la ficha no dice («sin-dato»).
 */
const ORDEN_REQUISITOS: Readonly<Record<NonNullable<CursoDelItinerario['requisitos']> | 'sin-dato', number>> = {
  ninguno: 0,
  prueba: 1,
  otros: 1,
  'sin-dato': 1,
};

/** El orden del itinerario: de menos a más requisitos y, a igualdad, por fecha de inicio y título. */
function ordenDelItinerario(a: CursoDelItinerario, b: CursoDelItinerario): number {
  return (
    ORDEN_REQUISITOS[a.requisitos ?? 'sin-dato'] - ORDEN_REQUISITOS[b.requisitos ?? 'sin-dato'] ||
    ordenPorInicio(a.inicio, b.inicio) ||
    ALFABETICO.ca.compare(a.titulo, b.titulo)
  );
}

/**
 * Los cursos del itinerario digital y de IA de un tramo, en su orden.
 *
 * @param citilab - Los cursos de Citilab del informe, o null.
 * @param tramo - El tramo del itinerario.
 * @returns Los cursos del tramo, de menos a más requisitos; ninguno sin cursos de Citilab.
 */
export function itinerarioCitilab<Curso extends CursoDelItinerario>(
  citilab: { readonly cursos: readonly Curso[] } | null,
  tramo: NonNullable<CursoDelItinerario['tramo']>,
): Curso[] {
  return (citilab?.cursos ?? []).filter((curso) => curso.tramo === tramo).sort(ordenDelItinerario);
}
