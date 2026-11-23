// Los índices del buscador de ocupaciones (ocupaciones.ts): el de los nombres en castellano del catálogo ESCO y, si el
// paquete trae la traducción de Faro (catalan.json), el de los títulos catalanes, que solo se usa de reserva. Cada uno
// guarda, por ocupación, las palabras de sus nombres en su forma común (palabras.ts) y sus frases sin género, la rareza
// de cada palabra en el catálogo y un índice invertido, para puntuar solo las ocupaciones que comparten alguna palabra
// con la búsqueda.
// Se construyen una vez por paquete de datos, al arrancar (prepararBuscador), y quedan en memoria: construirlos cuesta
// unas decenas de milisegundos de CPU, más de lo que admite una sola petición en un Worker gratuito.

import { textosOrdenados } from '../../../../src/comun/lista-ordenada.ts';
import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';
import { inicioDelComplemento } from './complemento.ts';
import { delSepe, formasCompletas } from './denominaciones.ts';
import { DENOMINACIONES_DE_DICCIONARIO, nombreRetirado } from './denominaciones-de-diccionario.ts';
import { denominacionesCastellanas, denominacionesCatalanas } from './denominaciones-oficiales.ts';
import { rarezaAjustada } from './genericas.ts';
import { enFormaComun, formaComun, fraseSinGenero, palabrasDe } from './palabras.ts';
import { palabrasDeNombre } from './palabras-de-nombre.ts';

/** Una ocupación del catálogo, ya preparada para puntuarla. */
export interface OcupacionIndexada {
  readonly esco: string;
  readonly isco08: string;
  /** Forma común de las palabras de cada nombre (título, sus formas y los alternativos). */
  readonly nombres: readonly string[][];
  /** Cada nombre entero y sin género, para reconocer una búsqueda que lo repite o lo contiene. */
  readonly frases: readonly string[];
  /** Las palabras de la descripción, sin repetir y ordenadas (textosOrdenados): se consultan con estaEnLosOrdenados. */
  readonly descripcion: readonly string[];
  /**
   * Rareza total de cada nombre (denominador de «explica»), en el orden de `nombres`, calculada una sola vez; las
   * palabras de su complemento cuentan FACTOR_COMPLEMENTO_NOMBRE.
   */
  readonly pesoNombres: readonly number[];
  /** Dónde empieza el complemento de cada nombre (complemento.ts), en el orden de `nombres`. */
  readonly inicioComplemento: readonly number[];
}

/**
 * Lo que cuenta una palabra de un nombre del catálogo según su posición: entera en el núcleo, FACTOR_COMPLEMENTO_NOMBRE
 * en el complemento.
 *
 * @param posicion - Posición de la palabra en el nombre.
 * @param inicio - Dónde empieza el complemento del nombre.
 * @returns El factor de su rareza.
 */
export function pesoEnElNombre(posicion: number, inicio: number): number {
  return posicion >= inicio ? FACTOR_COMPLEMENTO_NOMBRE : 1;
}

/**
 * Lo que cuenta la rareza de una palabra del complemento de un nombre del catálogo («educación primaria» en «maestro de
 * educación primaria») frente a una de su núcleo, al calcular cuánto del nombre explica la búsqueda. Elegido por
 * validación cruzada.
 */
const FACTOR_COMPLEMENTO_NOMBRE = 0.5;

/** Una ocupación con sus palabras ya preparadas, a falta del peso de sus nombres, que depende de todo el catálogo. */
type OcupacionSinPesos = Omit<OcupacionIndexada, 'pesoNombres'>;

/** El catálogo preparado para buscar en él: sus ocupaciones, la rareza de cada palabra y dónde aparece. */
export interface Indice {
  ocupaciones: OcupacionIndexada[];
  /** Rareza de cada palabra en los nombres del catálogo (IDF): «nóminas» pesa mucho más que «técnico». */
  rareza: Map<string, number>;
  /** Índice invertido: cada palabra de los nombres → las ocupaciones que la usan, en el orden del catálogo. */
  apariciones: Map<string, number[]>;
  /** Las mismas palabras, ordenadas, para encontrar las que empiezan por una raíz. */
  vocabulario: string[];
  /** Grupo ISCO-08 exacto → posiciones de sus ocupaciones, en el orden del catálogo. */
  porGrupo: Map<string, number[]>;
  /** Cada forma de un título doble de ESCO que es otra palabra, sin género → las formas de ese título. */
  formasDeTitulos: Map<string, string[]>;
}

/** El índice de los títulos catalanes y las palabras que solo tienen ellos, que dicen cuándo usarlo. */
interface ReservaCatalana {
  indice: Indice;
  propias: Set<string>;
}

/**
 * Los índices de cada paquete de datos, construidos una vez (en un Worker, al arrancar) y guardados en memoria. Su
 * dueño es este archivo (indiceDe y reservaCatalana) y viven lo que vive su paquete: la clave es el objeto `Datos`, y
 * al soltarlo el WeakMap suelta su índice. Hay uno por paquete cargado, así que no crecen.
 */
const indicesPorDatos = new WeakMap<Datos, Indice>();
/** La reserva catalana de cada paquete, con el mismo dueño y la misma vida; null si el paquete no la trae. */
const reservasCatalanas = new WeakMap<Datos, ReservaCatalana | null>();

/** Devuelve siempre la misma copia de cada texto que recibe: la que recibió primero. */
type UnaCopia = (texto: string) => string;

/** Añade la posición a la lista de la clave, creándola si no existe. */
function anotar(mapa: Map<string, number[]>, clave: string, posicion: number): void {
  const lista = mapa.get(clave);
  if (lista) {
    lista.push(posicion);
  } else {
    mapa.set(clave, [posicion]);
  }
}

/**
 * Una copia de cada palabra para todo un índice. Las mismas palabras salen en miles de nombres y descripciones, y cada
 * vez que se normaliza una sale una copia nueva: guardar una sola deja el índice en menos memoria, con las mismas
 * palabras.
 */
function unaCopiaDeCadaPalabra(): UnaCopia {
  const vistas = new Map<string, string>();
  return (palabra) => {
    const vista = vistas.get(palabra);
    if (vista !== undefined) {
      return vista;
    }
    vistas.set(palabra, palabra);
    return palabra;
  };
}

/** Las palabras de la descripción de una ocupación, en su forma común, sin repetir y ordenadas. */
function palabrasDeLaDescripcion(ocupacion: Datos['esco']['ocupaciones'][string], unaCopia: UnaCopia): string[] {
  return textosOrdenados(palabrasDe(ocupacion.descripcion ?? '').map((palabra) => unaCopia(formaComun(palabra))));
}

/**
 * Una ocupación del catálogo con sus nombres y las palabras de su descripción, cada palabra en una sola copia.
 *
 * @param esco - URI ESCO de la ocupación.
 * @param ocupacion - La ocupación del catálogo.
 * @param textos - Sus textos en el índice.
 * @param textos.nombres - Sus nombres en el idioma del índice; los vacíos no cuentan.
 * @param textos.descripcion - Las palabras de su descripción, ya preparadas (palabrasDeLaDescripcion).
 * @param unaCopia - La copia única de cada palabra del índice.
 * @returns La ocupación preparada, sin el peso de sus nombres.
 */
function prepararOcupacion(
  esco: string,
  ocupacion: Datos['esco']['ocupaciones'][string],
  { nombres, descripcion }: { nombres: readonly string[]; descripcion: readonly string[] },
  unaCopia: UnaCopia,
): OcupacionSinPesos {
  const variantes = nombres.map((variante) => variante.trim()).filter(Boolean);
  return {
    esco,
    isco08: ocupacion.isco08,
    nombres: variantes.map((variante) => palabrasDe(variante).map((palabra) => unaCopia(formaComun(palabra)))),
    frases: variantes.map(fraseSinGenero),
    inicioComplemento: variantes.map(inicioDelComplemento),
    descripcion,
  };
}

/**
 * Las dos formas de un título doble de ESCO, si lo es: dos formas con el mismo número de palabras («cajero/cajera»,
 * «mayordomo de hostelería/gobernanta de hostelería»). «técnico/técnica en terapias respiratorias» o «técnico/a de…»
 * no lo son: su primera parte, «técnico», no nombra esa ocupación.
 */
function formasDelTitulo(titulo: string): string[] {
  const formas = titulo.split('/').map((forma) => forma.trim());
  const palabras = formas.map((forma) => forma.split(/\s+/).length);
  return formas.length === 2 && formas.every(Boolean) && palabras[0] === palabras[1] ? formas : [];
}

/**
 * Títulos dobles de ESCO cuyas formas siguen siendo distintas sin género («mayordomo de hostelería/gobernanta de
 * hostelería»): cada forma, sin género → las formas de su título, para puntuar una búsqueda que repite una con todas,
 * porque nombran la misma ocupación. «cajero/cajera» no hace falta: sin género ya son la misma.
 */
function formasDeTitulos(datos: Datos): Map<string, string[]> {
  const formas = new Map<string, Map<string, string>>();
  for (const { titulo } of Object.values(datos.esco.ocupaciones)) {
    const delTitulo = formasDelTitulo(titulo).map((forma) => [fraseSinGenero(forma), forma] as const);
    for (const [clave] of delTitulo) {
      const distintas = formas.get(clave) ?? new Map<string, string>();
      for (const [claveDeLaForma, forma] of delTitulo) {
        if (!distintas.has(claveDeLaForma)) {
          distintas.set(claveDeLaForma, forma);
        }
      }
      formas.set(clave, distintas);
    }
  }
  return new Map(
    [...formas]
      .filter(([, distintas]) => distintas.size > 1)
      .map(([clave, distintas]) => [clave, [...distintas.values()]]),
  );
}

/**
 * El índice de los nombres que da `nombresDe`. Las descripciones y los títulos dobles son los del catálogo en
 * castellano en los dos índices: si se da el índice castellano (`castellano`), se toman de él y no se recalculan.
 */
function construirIndice(datos: Datos, nombresDe: (esco: string) => string[], castellano?: Indice): Indice {
  const unaCopia = unaCopiaDeCadaPalabra();
  // Dos pasadas: la rareza de cada palabra depende de todo el catálogo, y el peso de cada nombre, de la rareza.
  const preparadas = Object.entries(datos.esco.ocupaciones).map(([esco, ocupacion], posicion) =>
    prepararOcupacion(
      esco,
      ocupacion,
      {
        nombres: nombresDe(esco),
        // Ambos índices recorren las mismas entradas del paquete en el mismo orden.
        descripcion:
          (castellano ? (castellano.ocupaciones[posicion] as OcupacionIndexada).descripcion : undefined) ??
          palabrasDeLaDescripcion(ocupacion, unaCopia),
      },
      unaCopia,
    ),
  );
  const apariciones = new Map<string, number[]>();
  const porGrupo = new Map<string, number[]>();
  for (const [posicion, ocupacion] of preparadas.entries()) {
    for (const palabra of new Set(ocupacion.nombres.flat())) {
      anotar(apariciones, palabra, posicion);
    }
    anotar(porGrupo, ocupacion.isco08, posicion);
  }
  // La rareza de las palabras de rango o de función («técnico», «auxiliar») se rebaja (genericas.ts).
  const rareza = new Map(
    [...apariciones].map(([palabra, donde]) => [
      palabra,
      rarezaAjustada(palabra, Math.log(1 + preparadas.length / donde.length)),
    ]),
  );
  const ocupaciones: OcupacionIndexada[] = preparadas.map((ocupacion) => ({
    ...ocupacion,
    pesoNombres: ocupacion.nombres.map((nombre, i) =>
      nombre.reduce(
        (suma, palabra, j) =>
          suma + (rareza.get(palabra) ?? 0) * pesoEnElNombre(j, ocupacion.inicioComplemento[i] ?? nombre.length),
        0,
      ),
    ),
  }));
  const vocabulario = [...apariciones.keys()].sort();
  const titulosDobles = castellano?.formasDeTitulos ?? formasDeTitulos(datos);
  return { ocupaciones, rareza, apariciones, vocabulario, porGrupo, formasDeTitulos: titulosDobles };
}

/**
 * El índice de los nombres en castellano del catálogo: las formas completas del título (formasCompletas), los
 * alternativos de ESCO, los títulos del SEPE enlazados con la ocupación (delSepe), en singular, y las denominaciones
 * oficiales del INE ligadas a ella (denominaciones-oficiales.ts).
 *
 * @param datos - Paquete de datos cargado.
 * @returns El índice, construido la primera vez y el mismo después para el mismo paquete.
 */
export function indiceDe(datos: Datos): Indice {
  const guardado = indicesPorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const nuevo = construirIndice(datos, nombresCastellanosDe(datos));
  indicesPorDatos.set(datos, nuevo);
  return nuevo;
}

/**
 * Los nombres en castellano de cada ocupación, tal como se escriben, con que se construye el índice castellano
 * (indiceDe): el área (area.ts) los mira con su vocal de género, que la forma común del índice ya no tiene.
 *
 * @param datos - Paquete de datos cargado.
 * @returns Una función que da los nombres de una ocupación por su URI ESCO; vacía si no está en el catálogo.
 */
export function nombresCastellanosDe(datos: Datos): (esco: string) => string[] {
  const sepe = delSepe(datos);
  const oficiales = denominacionesCastellanas(datos);
  return (esco) => {
    const ocupacion = datos.esco.ocupaciones[esco];
    if (!ocupacion) {
      return [];
    }
    return [
      ...new Set([
        ...formasCompletas(ocupacion.titulo),
        ...(ocupacion.alternativos ?? []),
        ...(sepe.get(esco)?.nombres ?? []),
        ...(oficiales.get(esco) ?? []),
        ...(DENOMINACIONES_DE_DICCIONARIO.get(esco)?.es ?? []),
      ]),
    ].filter((n) => !nombreRetirado(esco, n, 'es'));
  };
}

/**
 * Las palabras de los títulos catalanes que ningún nombre castellano del catálogo tiene («forner», «infermer»,
 * «fuster», «caixer»): las que dicen que un texto está en catalán. Las que comparten los dos idiomas («casa»,
 * «particular», «pintor») no lo dicen, y un texto castellano que no encuentra nada no debe buscarse con ellas en el
 * índice catalán: allí pesan distinto y le proponen oficios ajenos («Limpio casas particulares» → profesor particular).
 */
function palabrasPropiasDelCatalan(catalan: Indice, castellano: Indice): Set<string> {
  return new Set(catalan.vocabulario.filter((palabra) => !castellano.apariciones.has(palabra)));
}

/**
 * El índice de los títulos catalanes de reserva, o null si el paquete no trae la traducción de Faro.
 *
 * @param datos - Paquete de datos cargado.
 * @returns La reserva, construida la primera vez y la misma después para el mismo paquete, o null.
 */
export function reservaCatalana(datos: Datos): ReservaCatalana | null {
  if (reservasCatalanas.has(datos)) {
    return reservasCatalanas.get(datos) ?? null;
  }
  const catalan = datos.catalan;
  let nueva: ReservaCatalana | null = null;
  if (catalan) {
    const castellano = indiceDe(datos);
    const oficiales = denominacionesCatalanas(datos);
    const indice = construirIndice(
      datos,
      (esco) =>
        [
          ...formasCompletas(catalan.ocupaciones[esco] ?? ''),
          ...(oficiales.get(esco) ?? []),
          ...(DENOMINACIONES_DE_DICCIONARIO.get(esco)?.ca ?? []),
        ].filter((n) => !nombreRetirado(esco, n, 'ca')),
      castellano,
    );
    nueva = { indice, propias: palabrasPropiasDelCatalan(indice, castellano) };
  }
  reservasCatalanas.set(datos, nueva);
  return nueva;
}

/**
 * Si el texto está en catalán: alguna de sus palabras solo existe en los títulos catalanes. No cuentan las que parecen
 * un nombre propio (palabras-de-nombre.ts): «Pau» o «Montse» no hacen catalán un texto, y la pista no puede depender
 * del nombre de la persona.
 *
 * @param reserva - Reserva catalana del paquete.
 * @param texto - Texto de la búsqueda.
 * @returns Si alguna palabra que no es un nombre propio solo está en los títulos catalanes.
 */
export function escritoEnCatalan(reserva: ReservaCatalana, texto: string): boolean {
  const { probables, sinValor } = palabrasDeNombre(texto);
  const nombres = enFormaComun(new Set([...probables, ...sinValor]));
  return palabrasDe(texto)
    .map(formaComun)
    .some((palabra) => reserva.propias.has(palabra) && !nombres.has(palabra));
}
