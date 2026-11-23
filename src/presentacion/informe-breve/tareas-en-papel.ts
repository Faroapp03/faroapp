// Cuántas tareas de «Tus tareas, una a una» y cuántas de «Tus tareas menos expuestas» caben enteras en la hoja 1
// impresa, para que el informe ocupe sus dos hojas A4 con cualquier entrada que Faro admite. Lo decide el renderizador,
// sin JavaScript al imprimir: estima el alto de cada tarea con su texto y lo resta de lo que deja libre el resto de la
// hoja en su forma más alta. En pantalla se ven todas; en papel, las primeras que caben, en su orden, y una línea dice
// cuántas son.
//
// Modelo. En papel la hoja mide 210 mm de ancho y sus medidas van en cqi (1 cqi = 2,1 mm); el área útil de la página
// del informe es el A4 menos los márgenes de su @page informe (4 mm y 6 mm): 287 mm. Todo se cuenta en cqi.
// - Solo se estiman los textos hechos de caracteres medibles (INTERVALOS_MEDIBLES: latín hasta U+024F, la puntuación
//   general, las monedas, las fracciones y las flechas, y dos espacios más). Cada uno ocupa, como mucho, el avance de
//   su clase en Space Grotesk 400, la letra de la hoja: el espacio, estrechas (i, l, puntuación fina), medias (f, r, t,
//   î, ï, paréntesis, guiones), redondas (a, c, e, n, o, s, u…), corrientes (el resto de letras y cifras hasta U+00FF),
//   anchas (m, w, M, W, @, %, æ, œ, ©, «, », ¼, ½, ¾ y el latín extendido A) y las de los intervalos de más allá del
//   latín. En negrita, la de las menos expuestas, cada clase tiene su factor. La guardia de navegador
//   (informe-impreso.test.mjs) mide el avance de todos los caracteres de todos los intervalos en los tres motores y
//   exige que ninguno pase del que da el modelo. Un texto con un carácter que no es medible (emojis, otras escrituras,
//   controles…) no tiene estimación: la tarea que lo lleva no se imprime y cuenta entre las que están en pantalla.
// - Las líneas se llenan palabra a palabra, como el navegador (solo el espacio, el tabulador y los saltos de línea separan): una palabra que no cabe pasa a la línea siguiente y una
//   más larga que la columna se parte por caracteres (overflow-wrap: anywhere en papel). Como cada avance es una cota
//   superior, la cuenta de líneas nunca queda por debajo de la real.
// - Las marcas de la tarea (el sello de Faro y «Incierta») van detrás del nombre como un bloque que no se parte: si no
//   caben en la última línea, suman una. Una fila mide sus líneas y nunca menos que la cifra de su nota.
// - Lo que sigue siendo tuyo mide la más alta de sus dos columnas: «Lo que la IA no hace por ti», fija, o las tareas
//   menos expuestas, que escribe la persona y se estiman con el mismo modelo en negrita. Se imprimen las que caben
//   enteras (dos, una o ninguna) y, si falta alguna, una línea lo dice; las filas de la lista usan lo que queda.
// - El resto de la hoja 1 se cuenta en su forma más alta, medida en los tres motores y los dos idiomas: conclusiones
//   largas, la leyenda con los dos sellos y el pie, con holgura. Se suma lo que alargan la cabecera, con el título de la
//   ocupación partido en su columna, y el pie si son largos. Si faltan tareas, se reserva además la línea que lo dice.

import type { InformeBreve, TareaBreve } from '../../dominio/tipos-informe-breve.ts';

/** Una clase de caracteres con el avance máximo de los suyos, en em, y cuánto más ancha es su negrita. */
interface ClaseDeCaracteres {
  readonly avance: number;
  readonly negrita: number;
  readonly caracteres: ReadonlySet<string>;
}

const ESPACIO: ClaseDeCaracteres = { avance: 0.26, negrita: 1, caracteres: new Set(' ') };
const ESTRECHAS: ClaseDeCaracteres = { avance: 0.26, negrita: 1.16, caracteres: new Set("iljíìIÍÌ.,;:!¡|'‘’·") };
const MEDIAS: ClaseDeCaracteres = { avance: 0.47, negrita: 1.12, caracteres: new Set('ftrîïÎÏ()[]{}/\\-"“”') };
const REDONDAS: ClaseDeCaracteres = {
  avance: 0.62,
  negrita: 1.08,
  caracteres: new Set('acehknosuvxyzáàäâéèëêóòöôúùüûñç'),
};
const ANCHAS: ClaseDeCaracteres = { avance: 1.05, negrita: 1.08, caracteres: new Set('mwMW@%æÆœŒ—©«»¼½¾') };
const CLASES = [ESPACIO, ESTRECHAS, MEDIAS, REDONDAS, ANCHAS];
/** Cuánto más ancha es la negrita en los caracteres que no están en ninguna clase. */
const NEGRITA_DE_LOS_DEMAS = 1.08;

/** Índice por carácter de los avances de impresión que superan el máximo habitual de su clase. */
function cotasPorCaracter(grupos: readonly { caracteres: string; avance: number }[]): ReadonlyMap<string, number> {
  const cotas = new Map<string, number>();
  for (const { caracteres, avance } of grupos) {
    for (const caracter of caracteres) {
      cotas.set(caracter, avance);
    }
  }
  return cotas;
}

// Chromium en Linux ajusta estos avances de Space Grotesk a píxeles enteros al tamaño de papel.
// Además, el WOFF2 latino carece de ‱ y Ⅷ: los tres motores usan glifos de sustitución.
// Cada cota se redondea hacia arriba a la centésima de em, solo en el peso donde hace falta.
const COTAS_NORMALES = cotasPorCaracter([
  { caracteres: '-', avance: 0.49 },
  { caracteres: '@œ', avance: 1.06 },
  { caracteres: 'hnouyñòóôöùúûü', avance: 0.66 },
  { caracteres: '‱', avance: 1.74 },
]);
const COTAS_NEGRITAS = cotasPorCaracter([
  { caracteres: "!',.:;¡‘’", avance: 0.33 },
  { caracteres: '‱', avance: 1.89 },
  { caracteres: 'Ⅷ', avance: 1.68 },
]);

/** Un intervalo de puntos de código que la guardia mide entero, con el avance máximo de los que no están en una clase. */
export interface IntervaloMedible {
  readonly desde: number;
  readonly hasta: number;
  /** El avance máximo, en em, de los caracteres del intervalo que no están en una clase. */
  readonly avance: number;
}

/**
 * Los caracteres que el modelo sabe estimar: los intervalos que mide la guardia de navegador carácter a carácter, en los
 * tres motores. Se excluyen de ellos los controles, los separadores de línea y de párrafo y los puntos sin asignar. Las
 * letras y signos de uso corriente (latín hasta U+00FF y latín extendido A) y los símbolos de la tipografía propia del
 * informe; fuera de ellos, un carácter no tiene avance conocido.
 */
export const INTERVALOS_MEDIBLES: readonly IntervaloMedible[] = [
  { desde: 0x20, hasta: 0xff, avance: 0.67 },
  { desde: 0x100, hasta: 0x17f, avance: 1.05 },
  { desde: 0x180, hasta: 0x24f, avance: 1.5 },
  { desde: 0x1680, hasta: 0x1680, avance: 1.5 },
  { desde: 0x2000, hasta: 0x206f, avance: 1.5 },
  { desde: 0x20a0, hasta: 0x20bf, avance: 1.5 },
  { desde: 0x2150, hasta: 0x218f, avance: 1.5 },
  { desde: 0x2190, hasta: 0x21ff, avance: 1.5 },
  { desde: 0x3000, hasta: 0x3000, avance: 1.5 },
];

/** Lo que no tiene caja que medir: controles, separadores de línea y de párrafo y puntos sin asignar. */
const SIN_CAJA = /^[\p{Cc}\p{Zl}\p{Zp}\p{Cn}]$/u;

function intervaloDe(caracter: string): IntervaloMedible | undefined {
  const codigo = caracter.codePointAt(0) ?? 0;
  return INTERVALOS_MEDIBLES.find(({ desde, hasta }) => codigo >= desde && codigo <= hasta);
}

/**
 * Si un carácter (un punto de código) es medible: está en un intervalo de INTERVALOS_MEDIBLES y tiene caja.
 *
 * @param caracter - Un punto de código.
 * @returns Si el modelo lo estima.
 */
export function esMedible(caracter: string): boolean {
  return intervaloDe(caracter) !== undefined && !SIN_CAJA.test(caracter);
}

/**
 * El avance máximo de un carácter medible en la letra de las tareas, en em. La guardia de navegador
 * (informe-impreso.test.mjs) lo compara con el avance medido de cada carácter en los tres motores.
 *
 * @param caracter - Un punto de código medible (esMedible).
 * @param negrita - Si la letra es negrita (la de las tareas menos expuestas) en vez de peso normal.
 * @returns Su avance, en em.
 */
export function avanceDelCaracter(caracter: string, negrita = false): number {
  const cota = (negrita ? COTAS_NEGRITAS : COTAS_NORMALES).get(caracter);
  if (cota !== undefined) {
    return cota;
  }
  const clase = CLASES.find((candidata) => candidata.caracteres.has(caracter));
  if (clase) {
    return clase.avance * (negrita ? clase.negrita : 1);
  }
  const intervalo = intervaloDe(caracter);
  if (!intervalo) {
    throw new RangeError(`El carácter «${caracter}» no es medible`);
  }
  return intervalo.avance * (negrita ? NEGRITA_DE_LOS_DEMAS : 1);
}

/**
 * Lo que el navegador toma por separador entre palabras: espacio, tabulador y saltos de línea, que trata como espacio
 * en blanco. Los demás espacios de Unicode (el no separable, el cuadratín, el ideográfico…) son un carácter más de la
 * palabra; el salto de página y el resto de controles ni se estiman.
 */
const SEPARADORES = /[ \t\n\r]+/u;

/**
 * Si todo el texto se puede estimar: cada carácter es medible o un separador entre palabras.
 *
 * @param texto - El texto, tal como se pinta.
 * @returns Si el modelo estima su alto.
 */
export function textoMedible(texto: string): boolean {
  return [...texto].every((caracter) => esMedible(caracter) || SEPARADORES.test(caracter));
}

/** El ancho de una palabra, en em, en peso normal o en negrita. */
function anchoDe(palabra: string, negrita: boolean): number {
  let ancho = 0;
  for (const caracter of palabra) {
    ancho += avanceDelCaracter(caracter, negrita);
  }
  return ancho;
}

/** Cómo queda un texto en su columna: cuántas líneas ocupa y cuánto de la última está lleno, en em. */
interface Lineas {
  lineas: number;
  ultima: number;
}

/** Parte en líneas una palabra más ancha que la columna, carácter a carácter, desde una línea nueva. */
function partirPalabra(palabra: string, columna: number, negrita: boolean): Lineas {
  let lineas = 1;
  let ultima = 0;
  for (const caracter of palabra) {
    const ancho = avanceDelCaracter(caracter, negrita);
    if (ultima + ancho > columna) {
      lineas += 1;
      ultima = 0;
    }
    ultima += ancho;
  }
  return { lineas, ultima };
}

/**
 * Las líneas de un texto en una columna de `columna` em, llenadas palabra a palabra con avances máximos.
 *
 * @param texto - El texto, tal como se pinta.
 * @param columna - El ancho de la columna, en em de la letra del texto.
 * @param negrita - Si la letra es negrita en vez de peso normal.
 * @returns Las líneas y lo ocupado de la última; infinitas si el texto no es medible (textoMedible).
 */
export function lineasDelTexto(texto: string, columna: number, negrita = false): Lineas {
  if (!textoMedible(texto)) {
    return { lineas: Number.POSITIVE_INFINITY, ultima: 0 };
  }
  return texto
    .split(SEPARADORES)
    .filter(Boolean)
    .reduce((hasta, palabra) => conLaPalabra(hasta, palabra, columna, negrita), { lineas: 1, ultima: 0 });
}

/**
 * Cómo quedan las líneas al poner una palabra más: en la misma línea si cabe con su espacio; si no, en la siguiente; y,
 * si es más ancha que la columna, partida por caracteres desde una línea nueva.
 */
function conLaPalabra({ lineas, ultima }: Lineas, palabra: string, columna: number, negrita: boolean): Lineas {
  const ancho = anchoDe(palabra, negrita);
  const empezada = ultima > 0;
  const delante = empezada ? avanceDelCaracter(' ', negrita) : 0;
  if (ultima + delante + ancho <= columna) {
    return { lineas, ultima: ultima + delante + ancho };
  }
  if (ancho <= columna) {
    return { lineas: lineas + (empezada ? 1 : 0), ultima: ancho };
  }
  const partida = partirPalabra(palabra, columna, negrita);
  return { lineas: lineas + partida.lineas - (empezada ? 0 : 1), ultima: partida.ultima };
}

/** Las medidas de la hoja impresa, en cqi (informe-breve.css, con @media print), medidas en los tres motores. */
const PAPEL = Object.freeze({
  /** El área útil de la página del informe: 287 mm, a 2,1 mm por cqi (136,67 cqi, redondeado hacia abajo). */
  altoUtil: 136.66,
  /** La columna del nombre de la tarea y su letra (--ib-s) con su interlineado. */
  columnaDeLaTarea: 36.5,
  letraDeLaTarea: 1.55,
  interlineadoDeLaTarea: 1.2,
  /** Lo que mide como poco una fila (la cifra de su nota, en Sora) y lo que la alarga la línea de sus marcas. */
  filaMinima: 2.45,
  extraDeLasMarcas: 0.6,
  huecoEntreFilas: 0.55,
  /** El sello de Faro y «Incierta», el más ancho de los dos idiomas (12,3 em en castellano), en em de la tarea. */
  anchoDeLasMarcas: 13,
  /** La línea de papel con las tareas que faltan: 1 cqi de margen y hasta dos líneas de --t-xs (1,42 cqi × 1,45). */
  lineaDePapel: 5.12,
  /** La de las menos expuestas, en su columna de 45 cqi: 1 cqi de margen y hasta cuatro líneas de --t-xs. */
  lineaDeLasMenos: 9.24,
  /**
   * El resto de la hoja 1 en su forma más alta, sin las filas, la línea de papel ni «Lo que sigue siendo tuyo»: banda,
   * cabecera, «En pocas palabras», las tres conclusiones en su forma más larga, el título, la cabecera y la leyenda de
   * las tareas con sus dos sellos y el pie (96,1 cqi), con 3 cqi de holgura para una línea más en las conclusiones y
   * para lo que el catálogo alarga «En pocas palabras» (hasta 2,5 cqi). Es con un título de ocupación y un pie de una
   * línea; si no, se suma lo que alargan la cabecera y el pie (alturaDeLosTextos).
   */
  restoDeLaHoja: 99.1,
  /**
   * La cabecera de la hoja 1: su ancho útil (93 cqi), el hueco entre columnas (4) y la columna de los rótulos de la
   * ocupación con su hueco (10). La columna del título de la hoja no baja de lo que mide su texto en una línea (30,7 cqi
   * en castellano y 34,1 en catalán) y el título de la ocupación se parte en lo que queda, con la letra de --t-xs (1,42
   * cqi) y 2,13 cqi por línea. El pie ocupa 86 cqi (58 em de --t-xs) y también suma 2,13 cqi por línea.
   */
  anchoDeLaCabecera: 93,
  huecoDeLaCabecera: 4,
  rotulosDeLaOcupacion: 10,
  tituloDeLaHoja: { es: 30.7, ca: 34.1 },
  letraDeLaOcupacion: 1.42,
  lineaDeLosTextos: 2.13,
  columnaDelPie: 58,
  /** «Lo que la IA no hace por ti», que no depende de la persona: 13,23 cqi en los dos idiomas. */
  loQueNoHace: 13.3,
  /**
   * «Tus tareas menos expuestas», al lado: su título y su frase (7,3 cqi, con una línea de holgura) y sus nombres, en
   * su columna (45 cqi), con la letra de la tarea en negrita y su interlineado.
   */
  menosSinNombres: 9.4,
  columnaDeLasMenos: 45,
  interlineadoDeLasMenos: 1.4,
});

/** El alto de una fila de tarea, en cqi: sus líneas, con las de las marcas, y nunca menos que la fila mínima. */
function altoDeLaFila(tarea: TareaBreve): number {
  const columna = PAPEL.columnaDeLaTarea / PAPEL.letraDeLaTarea;
  const { lineas, ultima } = lineasDelTexto(tarea.nombre, columna);
  const conMarcas = tarea.origen === 'faro' || tarea.incierta;
  const marcas = conMarcas && ultima + ESPACIO.avance + PAPEL.anchoDeLasMarcas > columna ? 1 : 0;
  const linea = PAPEL.letraDeLaTarea * PAPEL.interlineadoDeLaTarea;
  return Math.max(PAPEL.filaMinima, (lineas + marcas) * linea + (conMarcas ? PAPEL.extraDeLasMarcas : 0));
}

/**
 * El alto de «Lo que sigue siendo tuyo» con las menos expuestas `impresas` de las `total` que tiene el informe: la más
 * alta de sus dos columnas, en cqi. Si falta alguna, cuenta la línea que lo dice.
 */
function altoDeLoTuyo(impresas: readonly TareaBreve[], total: number): number {
  if (!total) {
    return PAPEL.loQueNoHace;
  }
  const columna = PAPEL.columnaDeLasMenos / PAPEL.letraDeLaTarea;
  const linea = PAPEL.letraDeLaTarea * PAPEL.interlineadoDeLasMenos;
  const nombres = impresas.map((tarea) => lineasDelTexto(tarea.nombre, columna, true).lineas * linea);
  const faltan = impresas.length < total ? PAPEL.lineaDeLasMenos : 0;
  const menos =
    PAPEL.menosSinNombres +
    nombres.reduce((suma, alto) => suma + alto, 0) +
    Math.max(0, nombres.length - 1) * PAPEL.huecoEntreFilas +
    faltan;
  return Math.max(PAPEL.loQueNoHace, menos);
}

/** Lo que la hoja 1 escribe con el título de la ocupación, en texto plano, y el idioma que decide el ancho de su cabecera. */
export interface TextosDeLaHoja {
  idioma: 'es' | 'ca';
  /** El título de la ocupación y su código, como los lleva la cabecera. */
  ocupacion: string;
  /** El pie de la hoja, con el título de la ocupación. */
  pie: string;
}

/**
 * El resto de la hoja 1 en cqi: PAPEL.restoDeLaHoja y, por cada línea más que ocupan el título de la ocupación en su
 * columna de la cabecera y el pie, lo que mide una línea.
 */
function restoDeLaHoja({ idioma, ocupacion, pie }: TextosDeLaHoja): number {
  const columnaDelTitulo = PAPEL.anchoDeLaCabecera - PAPEL.huecoDeLaCabecera - PAPEL.tituloDeLaHoja[idioma];
  const columna = (columnaDelTitulo - PAPEL.rotulosDeLaOcupacion) / PAPEL.letraDeLaOcupacion;
  const lineasDeLaCabecera = lineasDelTexto(ocupacion, columna, true).lineas;
  const lineasDelPie = lineasDelTexto(pie, PAPEL.columnaDelPie).lineas;
  return PAPEL.restoDeLaHoja + (lineasDeLaCabecera + lineasDelPie - 2) * PAPEL.lineaDeLosTextos;
}

/** Los índices de las tareas cuyo nombre se puede estimar, en su orden: las demás no se imprimen. */
function indicesMedibles(tareas: readonly TareaBreve[]): number[] {
  return tareas.flatMap((tarea, i) => (textoMedible(tarea.nombre) ? [i] : []));
}

/** Una marca por tarea: `true` en las que se imprimen. */
function marcas(total: number, impresas: readonly number[]): boolean[] {
  return Array.from({ length: total }, (_, i) => impresas.includes(i));
}

/**
 * Cuáles de las menos expuestas, en su orden, caben enteras: las medibles que dejan sitio al resto de la hoja y, por
 * si no cabe ninguna fila de tareas, a la línea de papel de la lista.
 */
function menosQueCaben(breve: InformeBreve, resto: number): number[] {
  const libre = PAPEL.altoUtil - resto - PAPEL.lineaDePapel;
  const menos = breve.menosExpuestas;
  let caben = indicesMedibles(menos);
  while (
    caben.length > 0 &&
    altoDeLoTuyo(
      caben.map((i) => menos[i] as TareaBreve),
      menos.length,
    ) > libre
  ) {
    caben = caben.slice(0, -1);
  }
  return caben;
}

/**
 * Cuáles de las tareas de la lista, en su orden, caben enteras en `libre` cqi: todas, o las primeras medibles con la
 * línea de papel.
 */
function filasQueCaben(breve: InformeBreve, libre: number): number[] {
  const medibles = indicesMedibles(breve.tareas);
  const altos = medibles.map((i) => altoDeLaFila(breve.tareas[i] as TareaBreve));
  const ocupado = (cuantas: number) =>
    altos.slice(0, cuantas).reduce((suma, alto) => suma + alto, 0) + Math.max(0, cuantas - 1) * PAPEL.huecoEntreFilas;
  if (medibles.length === breve.tareas.length && ocupado(altos.length) <= libre) {
    return medibles;
  }
  let caben = 0;
  while (caben < altos.length && ocupado(caben + 1) <= libre - PAPEL.lineaDePapel) {
    caben += 1;
  }
  return medibles.slice(0, caben);
}

/** Lo que imprime la hoja 1: una marca por tarea de la lista y por tarea menos expuesta, `true` si va en papel. */
export interface RepartoEnPapel {
  tareas: readonly boolean[];
  menos: readonly boolean[];
}

/** El reparto de la hoja 1 y lo que queda libre, en cqi, antes de las filas de la lista y de la línea de papel. */
function presupuesto(breve: InformeBreve, textos: TextosDeLaHoja): { menos: number[]; libre: number } {
  const resto = restoDeLaHoja(textos);
  const menos = menosQueCaben(breve, resto);
  const impresas = menos.map((i) => breve.menosExpuestas[i] as TareaBreve);
  return { menos, libre: PAPEL.altoUtil - resto - altoDeLoTuyo(impresas, breve.menosExpuestas.length) };
}

/**
 * El sitio que queda en la hoja 1 para las filas de la lista, en cqi, con la línea de papel que dice cuántas faltan,
 * después del resto de la hoja y de «Lo que sigue siendo tuyo» con las menos expuestas que caben. Negativo, la hoja
 * pasa de su área útil aun sin filas.
 *
 * @param breve - El informe breve.
 * @param textos - El título de la ocupación y el pie de la hoja.
 * @returns Los cqi libres para las filas.
 */
export function huecoParaLasFilas(breve: InformeBreve, textos: TextosDeLaHoja): number {
  return presupuesto(breve, textos).libre - PAPEL.lineaDePapel;
}

/**
 * Qué tareas de la lista y qué menos expuestas caben enteras en la hoja 1 impresa. Primero las menos expuestas, que van
 * en el cierre de la hoja; después, en lo que queda, las filas de la lista. Las que llevan un carácter que no es
 * medible no se imprimen; en pantalla están todas.
 *
 * @param breve - El informe breve, con sus tareas en el orden de la hoja y sus menos expuestas.
 * @param textos - El título de la ocupación y el pie de la hoja: si son largos, dejan menos sitio a las tareas.
 * @returns Una marca por tarea y por menos expuesta: se imprimen las que valen `true`.
 */
export function repartoEnPapel(breve: InformeBreve, textos: TextosDeLaHoja): RepartoEnPapel {
  const { menos, libre } = presupuesto(breve, textos);
  return {
    tareas: marcas(breve.tareas.length, filasQueCaben(breve, libre)),
    menos: marcas(breve.menosExpuestas.length, menos),
  };
}
