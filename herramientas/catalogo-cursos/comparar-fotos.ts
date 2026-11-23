/** Resumen y comparación de dos fotos de la clasificación: qué se pierde, qué cambia y qué se gana. */
import { jsonCanonico } from '../../src/comun/jcs.ts';
import type { DatoFotografiado, EstadoDato, UnidadFotografiada } from './foto-cursos.ts';

export interface FotoClasificacion {
  readonly catalogo: { readonly sha256: string; readonly corte_proyeccion_utc: string };
  readonly soc: { readonly fecha_cursos: string };
  readonly unidades: { readonly cursos: readonly UnidadFotografiada[]; readonly soc: readonly UnidadFotografiada[] };
}
export interface Diferencia {
  readonly seccion: string;
  readonly clave: string;
  readonly dato: string;
  readonly antes: DatoFotografiado | null;
  readonly despues: DatoFotografiado | null;
}
export interface Comparacion {
  readonly perdidas: readonly Diferencia[];
  readonly cambios: readonly Diferencia[];
  readonly ganancias: readonly Diferencia[];
}
type Resumen = Record<string, Record<string, Record<EstadoDato, number>>>;

const ESTADOS: readonly EstadoDato[] = ['fuente', 'orientacion-faro', 'por-confirmar'];

/** Recuento por fuente y dato de cuántas unidades llegan de la fuente, orientadas por Faro o por confirmar. */
export function resumirUnidades(unidades: readonly UnidadFotografiada[]): Resumen {
  const resumen: Resumen = {};
  for (const unidad of unidades) {
    const porDato = resumen[unidad.fuente] ?? {};
    resumen[unidad.fuente] = porDato;
    for (const [dato, valor] of Object.entries(unidad.datos)) {
      const cuentas = porDato[dato] ?? (Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoDato, number>);
      cuentas[valor.estado] += 1;
      porDato[dato] = cuentas;
    }
  }
  return resumen;
}

/** Un dato está clasificado si la persona ve un valor, venga de la fuente o de una orientación de Faro. */
function clasificado(dato: DatoFotografiado | null): boolean {
  return dato !== null && dato.estado !== 'por-confirmar';
}

/** Clasifica una diferencia según si el dato se veía clasificado antes y si se ve después. */
function diferenciaDe(diferencia: Diferencia) {
  const { antes, despues } = diferencia;
  if (jsonCanonico(antes) === jsonCanonico(despues)) {
    return null;
  }
  if (clasificado(antes) && !clasificado(despues)) {
    return { lista: 'perdidas', diferencia } as const;
  }
  if (!clasificado(antes) && clasificado(despues)) {
    return { lista: 'ganancias', diferencia } as const;
  }
  return { lista: 'cambios', diferencia } as const;
}

function porClave(unidades: readonly UnidadFotografiada[]): ReadonlyMap<string, UnidadFotografiada> {
  return new Map(unidades.map((unidad) => [unidad.clave, unidad]));
}

/** Diferencias de una sección; una unidad que desaparece pierde sus datos y una nueva los gana. */
function compararSeccion(
  seccion: string,
  antes: readonly UnidadFotografiada[],
  despues: readonly UnidadFotografiada[],
) {
  const previas = porClave(antes);
  const nuevas = porClave(despues);
  const claves = [...new Set([...previas.keys(), ...nuevas.keys()])].sort();
  return claves.flatMap((clave) => {
    const a = previas.get(clave)?.datos ?? {};
    const b = nuevas.get(clave)?.datos ?? {};
    const datos = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return datos.flatMap(
      (dato) => diferenciaDe({ seccion, clave, dato, antes: a[dato] ?? null, despues: b[dato] ?? null }) ?? [],
    );
  });
}

export function compararFotos(antes: FotoClasificacion, despues: FotoClasificacion): Comparacion {
  const listas: Record<keyof Comparacion, Diferencia[]> = { perdidas: [], cambios: [], ganancias: [] };
  for (const seccion of ['cursos', 'soc'] as const) {
    for (const { lista, diferencia } of compararSeccion(seccion, antes.unidades[seccion], despues.unidades[seccion])) {
      listas[lista].push(diferencia);
    }
  }
  return listas;
}

/** JSON con las claves ordenadas y una unidad por línea, para que la fixture se pueda revisar con un diff. */
export function serializarFoto(foto: FotoClasificacion): string {
  const lineas = (unidades: readonly UnidadFotografiada[]) =>
    [...unidades]
      .sort((a, b) => (a.clave < b.clave ? -1 : 1))
      .map((unidad) => jsonCanonico(unidad))
      .join(',\n');
  const resumen = { cursos: resumirUnidades(foto.unidades.cursos), soc: resumirUnidades(foto.unidades.soc) };
  return [
    `{"catalogo":${jsonCanonico(foto.catalogo)},`,
    `"resumen":${jsonCanonico(resumen)},`,
    `"soc":${jsonCanonico(foto.soc)},`,
    `"unidades":{"cursos":[\n${lineas(foto.unidades.cursos)}\n],`,
    `"soc":[\n${lineas(foto.unidades.soc)}\n]}}\n`,
  ].join('\n');
}
