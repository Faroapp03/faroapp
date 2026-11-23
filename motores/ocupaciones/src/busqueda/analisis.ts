// La salida del buscador para quien decide con ella (el motor de preguntas adaptativas y la interfaz): las candidatas
// con sus grupos CIUO-08 y CNO-11, agrupadas también por grupo CIUO-08, las pistas de sector del texto y, si la
// búsqueda es una sola palabra genérica, la palabra con que hay que pedir precisión. ResultadoDeBusqueda y
// OpcionesDeContexto definen aquí la salida y las opciones de buscarConContexto.

import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';
import type { Area } from './area.ts';
import type { Correccion } from './consulta.ts';
import type { PistaDeSector } from './contexto.ts';
import { delSepe } from './denominaciones.ts';
import { buscarConTodo, type Candidata, type OpcionesDeBusqueda } from './ocupaciones.ts';

/** Una candidata con sus grupos CNO-11. */
interface CandidataDeBusqueda extends Candidata {
  /**
   * Grupos CNO-11 de 4 cifras: los de los títulos del SEPE enlazados con la ocupación y, si no hay, los de la
   * correspondencia oficial CIUO-08 → CNO-11 del INE.
   */
  cno11: string[];
}

/** Un grupo CIUO-08 de las candidatas. */
interface GrupoDeBusqueda {
  isco08: string;
  /** Los de su mejor candidata. */
  puntos: number;
  /** Sus candidatas, en orden. */
  esco: string[];
  /** Los grupos CNO-11 de sus candidatas, sin repetir. */
  cno11: string[];
}

/** Lo que el buscador sabe de un texto. */
export interface ResultadoDeBusqueda {
  candidatas: CandidataDeBusqueda[];
  grupos: GrupoDeBusqueda[];
  pistasDeSector: PistaDeSector[];
  /** Solo si la búsqueda es una sola palabra genérica: su clave («tecnico»). */
  necesitaPrecision?: string;
  /** El tramo del texto leído como lugar de trabajo, normalizado («en la generalitat»). */
  lugar?: string;
  /** Las palabras que se han buscado como otra por una falta. */
  correcciones?: Correccion[];
  /** Los índices consultados y fusionados. */
  idiomasBuscados: ('es' | 'ca')[];
  /** Si la búsqueda nombra un área y no un puesto («recursos humanos»): el área y sus ocupaciones. */
  area?: Area;
  /** Si el texto solo nombra un sector («hostelería»): la forma escrita; las candidatas son sus oficios comunes. */
  soloSector?: string;
  /** Con un sector solo: cómo se dice dónde o con quién en cada idioma («en la hostelería», «amb gent gran»). */
  fraseDelSector?: { readonly es: string; readonly ca: string };
  /** Si no hay ninguna candidata. */
  sinComprension?: true;
}

/** Opciones de buscarConContexto. */
interface OpcionesDeContexto extends OpcionesDeBusqueda {
  /** Cuántas candidatas como máximo; por defecto, 8. */
  limite?: number;
}

/** Los grupos CNO-11 de una ocupación: los del SEPE o, si no hay, los de la correspondencia del INE. */
function gruposCno(datos: Datos, esco: string, isco08: string): string[] {
  const delSepeDeEsta = delSepe(datos).get(esco)?.cno11 ?? [];
  if (delSepeDeEsta.length) {
    return delSepeDeEsta;
  }
  return [...new Set((datos.clasificaciones.isco08_a_cno11[isco08] ?? []).map(({ cno11 }) => cno11))];
}

/** Las candidatas agrupadas por grupo CIUO-08, en el orden de la mejor de cada uno. */
function agrupar(candidatas: readonly CandidataDeBusqueda[]): GrupoDeBusqueda[] {
  const grupos = new Map<string, GrupoDeBusqueda>();
  for (const candidata of candidatas) {
    const grupo = grupos.get(candidata.isco08);
    if (grupo) {
      grupo.esco.push(candidata.esco);
      grupo.cno11 = [...new Set([...grupo.cno11, ...candidata.cno11])];
    } else {
      grupos.set(candidata.isco08, {
        isco08: candidata.isco08,
        puntos: candidata.puntos,
        esco: [candidata.esco],
        cno11: [...candidata.cno11],
      });
    }
  }
  return [...grupos.values()];
}

/**
 * Busca ocupaciones y devuelve ResultadoDeBusqueda. Síncrona, determinista y sin red.
 *
 * @param datos - El paquete de datos.
 * @param texto - El texto ya limpio de datos personales (textoParaBuscar) y recortado a MAX_BUSQUEDA.
 * @param opciones - El idioma de la página y el límite de candidatas.
 * @returns Las candidatas, sus grupos, las pistas de sector y, si hace falta, la precisión que falta.
 */
export function buscarConContexto(
  datos: Datos,
  texto: string,
  { limite, ...opciones }: OpcionesDeContexto = {},
): ResultadoDeBusqueda {
  const busqueda = buscarConTodo(datos, texto, limite, opciones);
  const candidatas = busqueda.candidatas.map((candidata) => ({
    ...candidata,
    cno11: gruposCno(datos, candidata.esco, candidata.isco08),
  }));
  return {
    candidatas,
    grupos: agrupar(candidatas),
    pistasDeSector: busqueda.pistasDeSector,
    ...(busqueda.necesitaPrecision ? { necesitaPrecision: busqueda.necesitaPrecision } : {}),
    ...(busqueda.partido.lugar ? { lugar: busqueda.partido.lugar } : {}),
    ...(busqueda.correcciones.length ? { correcciones: busqueda.correcciones } : {}),
    idiomasBuscados: busqueda.idiomasBuscados,
    ...(busqueda.area ? { area: busqueda.area } : {}),
    ...(busqueda.sinComprension ? { sinComprension: true as const } : {}),
  };
}
