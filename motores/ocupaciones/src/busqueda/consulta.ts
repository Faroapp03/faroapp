// Lo que se busca, preparado para puntuar con ello las ocupaciones de un índice (indice.ts): las palabras de la
// búsqueda en su forma común, sin las que son de un nombre propio, cada una con su peso (su rareza en el catálogo, o la
// de la palabra del catálogo con la que mejor encaja), y las ocupaciones que comparten alguna palabra con ella, que son
// las únicas que se puntúan (puntuacion.ts).

import { inicioDelComplemento } from './complemento.ts';
import { partirOficioYLugar, type TextoPartido } from './contexto.ts';
import { corregir } from './correccion.ts';
import { expresionesFijas } from './expresiones.ts';
import type { Indice } from './indice.ts';
import {
  derivada,
  formaComun,
  fraseSinGenero,
  MIN_LETRAS_PREFIJO,
  palabrasDe,
  sinPresentacion,
  VALOR_DEL_PREFIJO,
} from './palabras.ts';
import { palabrasDeNombre } from './palabras-de-nombre.ts';

/**
 * Peso de cada palabra en la puntuación: la coincidencia exacta del nombre se mantiene separada
 * de la aportación de palabras sueltas.
 */
const FACTOR_LUGAR = 1;

/**
 * Lo que vale una palabra del complemento del oficio («oficinas» en «limpiador de oficinas», «d'oficines» en «neteja
 * d'oficines») frente a una del núcleo («limpiador», «neteja»): la actividad dice más del oficio que el objeto o el
 * sitio sobre el que se hace. Se elige por validación cruzada (FACTOR_SOLO_COMPLEMENTO, puntuacion.ts, castiga además
 * los nombres que solo coinciden con el complemento).
 */
const FACTOR_COMPLEMENTO = 0.75;

/** Una palabra que no estaba en el vocabulario y se ha buscado como otra (correccion.ts), en sus formas comunes. */
export interface Correccion {
  de: string;
  a: string;
}

/**
 * Expansiones de tres tokens de consulta que pierden una raíz corta al tratar su plural.
 * Solo preparan la consulta: no cambian palabras.ts, los índices ni las descripciones.
 * No es una regla general de singularización; la frase sigue conservando su número.
 */
const EXPANSIONES_DE_CONSULTA: ReadonlyMap<string, string> = new Map([
  ['guias', 'guia'],
  ['jefes', 'jefe'],
  ['jefas', 'jefe'],
]);

/**
 * Equivalencias de diccionario: palabras con que la gente nombra su oficio y que los títulos oficiales de ESCO no usan
 * en ese sentido. Cada una sale del diccionario normativo (DLE de la RAE, DIEC del IEC), no del banco de pruebas:
 * - «bus»: «autobús» (DLE y DIEC). Sin ella, «chofer de bus» no encontraba «conductor de autobús».
 * - «chófer» / «xofer»: «persona que, por oficio, conduce un automóvil» (DLE; DIEC «conductor d'un automòbil»): en
 *   ESCO solo nombra al chófer privado, así que «chofer de autobús» acababa en él.
 * - «docente»: «que enseña» (DLE); en ESCO solo aparece en «secretario de centro docente», y «docente» llevaba a
 *   secretaría.
 * - «profe»: «profesor», coloquial (DLE). «poli»: «agente de policía», coloquial (DLE).
 * Solo preparan la consulta: lo que la persona ve escrito no cambia.
 */
const EQUIVALENCIAS_DE_DICCIONARIO: ReadonlyMap<string, string> = new Map([
  ['bus', 'autobus'],
  ['buses', 'autobus'],
  ['busos', 'autobus'],
  ['chofer', 'conductor'],
  ['choferes', 'conductor'],
  ['xofer', 'conductor'],
  ['xofers', 'conductor'],
  ['docente', 'profesor'],
  ['docentes', 'profesor'],
  // En catalán, «docent» (DIEC: «que ensenya») también solo aparece en «secretari de centre docent».
  ['docent', 'professor'],
  ['docents', 'professor'],
  ['profe', 'profesor'],
  ['profes', 'profesor'],
  ['poli', 'policia'],
]);

/** Forma de un token ya normalizado, con la misma expansión para palabras y nombres de la consulta. */
function formaComunDeConsulta(palabra: string): string {
  return formaComun(EQUIVALENCIAS_DE_DICCIONARIO.get(palabra) ?? EXPANSIONES_DE_CONSULTA.get(palabra) ?? palabra);
}

/** Letras del plural de una palabra corta: la palabra (hasta 4 letras, que se dejan enteras) y su «s». */
const LETRAS_DE_UN_PLURAL_CORTO = MIN_LETRAS_PREFIJO + 1;

/**
 * La forma con que se busca un token en un índice: la de formaComunDeConsulta y, si el índice no la tiene y es el
 * plural de una palabra corta que sí tiene («mozos» → «mozo», «pisos» → «piso»), esa palabra. Generaliza las
 * expansiones de arriba con el vocabulario del índice: la raíz de un plural corto («moz», «pis») no está en ningún
 * nombre y la búsqueda perdía la palabra entera. La frase con que se reconoce un nombre idéntico conserva el número.
 */
function formaEnElIndice(catalogo: Indice): (palabra: string) => string {
  return (palabra) => {
    const forma = formaComunDeConsulta(palabra);
    const singular = palabra.slice(0, -1);
    const pluralCorto = palabra.length === LETRAS_DE_UN_PLURAL_CORTO && palabra.endsWith('s');
    return !catalogo.apariciones.has(forma) && pluralCorto && catalogo.apariciones.has(singular) ? singular : forma;
  };
}

/** Lo que se busca, preparado una vez para puntuar con ello todas las ocupaciones. */
export interface Consulta {
  /** Las palabras de la búsqueda en su forma común, sin repetir y sin las que no valen. */
  palabras: string[];
  /** La búsqueda entera, sin género. */
  frase: string;
  /** El peso de una palabra: su rareza en el catálogo o la de la palabra del catálogo con la que mejor encaja. */
  peso: (palabra: string) => number;
  /** Peso que un nombre del catálogo podría cubrir (denominador de «cubre»): lo que ningún nombre tiene no cuenta. */
  pesoTotal: number;
  /** Palabras que probablemente son un nombre propio: su principio solo cuenta con una terminación derivada. */
  nombres: Set<string>;
  /** Las palabras del vocabulario parecidas a cada palabra buscada (parecidas), calculadas una sola vez. */
  parecidas: ReadonlyMap<string, readonly string[]>;
  /** Las palabras del oficio (las demás son del lugar de trabajo y pesan FACTOR_LUGAR). */
  oficio: readonly string[];
  /** Las palabras del oficio que son su complemento («oficinas» en «limpiador de oficinas»); pesan FACTOR_COMPLEMENTO. */
  complemento: ReadonlySet<string>;
  /** Las expresiones fijas del oficio («recursos humanos»): un nombre que solo lleva una de sus palabras cae. */
  expresiones: readonly (readonly [string, string])[];
  /** Las palabras corregidas por faltas. */
  correcciones: readonly Correccion[];
}

/** Lo que aporta una palabra buscada: su rareza y lo mejor que puede cubrirla un nombre del catálogo. */
interface PalabraBuscada {
  /** Rareza (IDF) de la palabra, o la de la palabra del catálogo con la que mejor encaja si no está en ninguno. */
  peso: number;
  /** 1 si algún nombre lleva la misma palabra, VALOR_DEL_PREFIJO si solo la empieza o la continúa, 0 si ninguno. */
  cobertura: number;
}

/** Posición de la primera palabra del vocabulario (ordenado) que no va antes de `palabra`: búsqueda binaria. */
function primeraDesde(vocabulario: string[], palabra: string): number {
  let desde = 0;
  let hasta = vocabulario.length;
  // Cada vuelta deja el intervalo [desde, hasta) en la mitad: termina en log₂ del tamaño del vocabulario vueltas.
  while (desde < hasta) {
    const medio = (desde + hasta) >> 1;
    // medio está dentro del intervalo [desde, hasta) del vocabulario.
    if ((vocabulario[medio] as string) < palabra) {
      desde = medio + 1;
    } else {
      hasta = medio;
    }
  }
  return desde;
}

/** Los principios de `palabra` (de MIN_LETRAS_PREFIJO letras o más) que son palabras del vocabulario. */
function principiosEnElVocabulario(catalogo: Indice, palabra: string, soloDerivadas: boolean): string[] {
  const principios: string[] = [];
  for (let letras = MIN_LETRAS_PREFIJO; letras < palabra.length; letras++) {
    const principio = palabra.slice(0, letras);
    if (catalogo.apariciones.has(principio) && (!soloDerivadas || derivada(principio, palabra))) {
      principios.push(principio);
    }
  }
  return principios;
}

/** Las palabras del vocabulario que continúan `palabra`: en el vocabulario ordenado, van seguidas a partir de ella. */
function continuacionesEnElVocabulario(catalogo: Indice, palabra: string, soloDerivadas: boolean): string[] {
  const { vocabulario } = catalogo;
  const continuaciones: string[] = [];
  // El recorrido solo lee posiciones menores que vocabulario.length.
  for (
    let i = primeraDesde(vocabulario, palabra);
    i < vocabulario.length && (vocabulario[i] as string).startsWith(palabra);
    i++
  ) {
    if (vocabulario[i] !== palabra && (!soloDerivadas || derivada(palabra, vocabulario[i] as string))) {
      continuaciones.push(vocabulario[i] as string);
    }
  }
  return continuaciones;
}

/**
 * Palabras del vocabulario que `coincidencia` (palabras.ts) da por parecidas a `palabra`: la misma, sus principios y
 * las que la continúan. Con `soloDerivadas` (un probable nombre propio), solo las que difieren en una terminación
 * derivada.
 */
function parecidas(catalogo: Indice, palabra: string, soloDerivadas: boolean): string[] {
  const encontradas = catalogo.apariciones.has(palabra) ? [palabra] : [];
  if (palabra.length < MIN_LETRAS_PREFIJO) {
    return encontradas;
  }
  return [
    ...encontradas,
    ...principiosEnElVocabulario(catalogo, palabra, soloDerivadas),
    ...continuacionesEnElVocabulario(catalogo, palabra, soloDerivadas),
  ];
}

/**
 * Ocupaciones con alguna palabra del nombre entre las aproximaciones de la búsqueda, en el orden del catálogo
 * (el mismo desempate que si se puntuaran todas).
 *
 * @param catalogo - El índice del catálogo.
 * @param consulta - La búsqueda ya preparada.
 * @returns Las posiciones del catálogo, en su orden.
 */
export function posicionesCandidatas(catalogo: Indice, consulta: Consulta): number[] {
  const posiciones = new Set<number>();
  for (const palabra of consulta.palabras) {
    for (const parecida of consulta.parecidas.get(palabra) ?? []) {
      for (const posicion of catalogo.apariciones.get(parecida) ?? []) {
        posiciones.add(posicion);
      }
    }
  }
  return [...posiciones].sort((a, b) => a - b);
}

/**
 * Lo que aporta una palabra buscada. Si está en algún nombre, su rareza; si solo la empiezan o la continúan otras
 * (`suyas`, sus parecidas: «ingl» en «ingletadora»), la rareza de la que mejor encaja, y cubrirla vale lo que un
 * prefijo; si ningún nombre la tiene, nada: una palabra que ninguna ocupación lleva no distingue una de otra.
 */
function palabraBuscada(catalogo: Indice, palabra: string, suyas: readonly string[]): PalabraBuscada {
  const propia = catalogo.rareza.get(palabra);
  if (propia !== undefined) {
    return { peso: propia, cobertura: 1 };
  }
  const pesos = suyas.map((parecida) => catalogo.rareza.get(parecida) ?? 0);
  return pesos.length
    ? { peso: pesos.reduce((mayor, peso) => Math.max(mayor, peso), 0), cobertura: VALOR_DEL_PREFIJO }
    : { peso: 0, cobertura: 0 };
}

/**
 * La palabra con que se busca: la misma si el vocabulario la tiene, si alguna palabra la continúa («limpi» →
 * «limpiador»), si es un probable nombre propio o si es corta; si no, la más parecida del vocabulario (correccion.ts),
 * si la hay, y se anota en `correcciones`.
 */
function corregida(
  catalogo: Indice,
  palabra: string,
  nombres: ReadonlySet<string>,
  correcciones: Correccion[],
): string {
  if (
    catalogo.apariciones.has(palabra) ||
    nombres.has(palabra) ||
    continuacionesEnElVocabulario(catalogo, palabra, false).length > 0
  ) {
    return palabra;
  }
  const otra = corregir(catalogo, palabra);
  if (!otra) {
    return palabra;
  }
  correcciones.push({ de: palabra, a: otra });
  return otra;
}

/**
 * Lo que se busca, con el peso de cada palabra y el peso que un nombre podría cubrir. Las palabras del lugar de
 * trabajo (`partido.lugar`) pesan FACTOR_LUGAR; la frase con que se reconoce un nombre idéntico es la del oficio. Sin
 * ninguna palabra que el catálogo pueda cubrir no hay nada que buscar («de la y», o un relato sin oficios): no hay
 * consulta.
 */
function prepararConsulta(catalogo: Indice, texto: string, partido: TextoPartido): Consulta | null {
  const { probables, sinValor } = palabrasDeNombre(texto);
  const enElIndice = formaEnElIndice(catalogo);
  const queNoCuentan = new Set([...sinValor].map(enElIndice));
  const nombres = new Set([...probables].map(enElIndice));
  const correcciones: Correccion[] = [];
  const palabrasDeLaParte = (parte: string) =>
    [...new Set(palabrasDe(parte).map(enElIndice))].filter((palabra) => !queNoCuentan.has(palabra));
  // Solo se corrigen las palabras del oficio: las del lugar solo desempatan, y corregirlas metería ruido.
  const delOficio = palabrasDeLaParte(partido.oficio);
  const corregidas = new Map(
    delOficio.map((palabra) => [palabra, corregida(catalogo, palabra, nombres, correcciones)]),
  );
  const oficio = [...new Set(corregidas.values())];
  const enElComplemento = new Set(
    palabrasDe(partido.oficio).slice(inicioDelComplemento(partido.oficio)).map(enElIndice),
  );
  const complemento = new Set(
    delOficio.filter((palabra) => enElComplemento.has(palabra)).map((palabra) => corregidas.get(palabra) as string),
  );
  const lugar = new Set(palabrasDeLaParte(partido.lugar).filter((palabra) => !oficio.includes(palabra)));
  const palabras = [...oficio, ...lugar];
  const suyas = new Map(palabras.map((palabra) => [palabra, parecidas(catalogo, palabra, nombres.has(palabra))]));
  const factor = (palabra: string) => {
    if (lugar.has(palabra)) {
      return FACTOR_LUGAR;
    }
    return complemento.has(palabra) ? FACTOR_COMPLEMENTO : 1;
  };
  const buscadas = new Map(
    palabras.map((palabra) => {
      const buscada = palabraBuscada(catalogo, palabra, suyas.get(palabra) ?? []);
      return [palabra, { ...buscada, peso: buscada.peso * factor(palabra) }];
    }),
  );
  const pesoTotal = [...buscadas.values()].reduce((suma, { peso, cobertura }) => suma + peso * cobertura, 0);
  if (pesoTotal === 0) {
    return null;
  }
  const peso = (palabra: string) => buscadas.get(palabra)?.peso ?? catalogo.rareza.get(palabra) ?? 0;
  // Sin la fórmula de presentación: «Soy cajera» repite el nombre «cajera».
  const frase = fraseSinGenero(sinPresentacion(partido.oficio || texto));
  const enOrden = palabrasDe(partido.oficio)
    .map((palabra) => corregidas.get(enElIndice(palabra)) ?? enElIndice(palabra))
    .filter((palabra) => oficio.includes(palabra));
  const expresiones = expresionesFijas(catalogo, enOrden);
  return {
    palabras,
    frase,
    peso,
    pesoTotal,
    nombres,
    parecidas: suyas,
    oficio,
    complemento,
    expresiones,
    correcciones,
  };
}

/**
 * Lo que se busca con un texto: si repite una forma de un título doble de ESCO, todas las formas de ese título; si
 * no, el texto, con su oficio separado de su lugar de trabajo (contexto.ts). Así «gobernanta de hostelería» y
 * «mayordomo de hostelería» dan lo mismo.
 *
 * @param catalogo - El índice del catálogo.
 * @param texto - El texto que escribe la persona.
 * @param partido - El texto ya partido en oficio y lugar; si no se da, se parte aquí.
 * @returns Las consultas que se puntúan; ninguna si no hay palabras que el catálogo pueda cubrir.
 */
export function consultasDe(catalogo: Indice, texto: string, partido?: TextoPartido): Consulta[] {
  const formas = catalogo.formasDeTitulos.get(fraseSinGenero(texto));
  if (formas) {
    return formas
      .map((forma) => prepararConsulta(catalogo, forma, { oficio: forma, lugar: '' }))
      .filter((consulta): consulta is Consulta => consulta !== null);
  }
  const consulta = prepararConsulta(catalogo, texto, partido ?? partirOficioYLugar(texto));
  return consulta ? [consulta] : [];
}
