// Saludos, cortesía y preguntas sobre Faro en lo que escribe la persona, con reglas fijas y sin modelo de lenguaje:
// Faro no es un chat abierto. Antes de buscar el oficio se quita la parte de cortesía («hola, ¿cómo estás? corto
// verdura» → «corto verdura»): «hola», «como» y «estas» ensuciaban la búsqueda y los vectores (proponían astrólogos y
// actividades culturales). Si no queda nada más, la pantalla responde con amabilidad en la
// misma entrada y no gasta la aclaración.
//
// Se quita solo al principio y al final de cada trozo de la frase (lo que va entre comas, puntos, interrogaciones…),
// nunca en medio; al final un saludo no se quita («trabajo en una tienda de buenos días» no cambia) y al principio
// tampoco un «gracias» seguido de más («gracias a mi curso»). Lo que no lleva cortesía vuelve tal cual, letra a
// letra, para que la búsqueda y la medición no cambien. Las reglas se comparan como las de moderacion.ts: sin
// mayúsculas, sin tildes y con los apóstrofos como espacios.

/** Qué clase de cortesía ha escrito la persona. */
export type TipoDeCortesia = 'saludo' | 'como_estas' | 'gracias' | 'despedida' | 'sobre_faro';

/** Lo escrito sin la cortesía y la cortesía que se ha quitado, en el orden en que aparece y sin repetir. */
interface TextoSinCortesia {
  readonly texto: string;
  readonly cortesia: readonly TipoDeCortesia[];
}

/**
 * Una frase de cortesía. `ligada`: solo se quita si va pegada a otra cortesía del mismo trozo o si es el trozo entero.
 * «como estas» abre también frases de trabajo («como estas cajas…»), y «faro», «y tu» o «tambien» solo son cortesía
 * junto a un saludo.
 */
interface Frase {
  readonly palabras: readonly string[];
  readonly tipo: TipoDeCortesia;
  readonly ligada: boolean;
}

const LIBRES: Readonly<Record<TipoDeCortesia, readonly string[]>> = {
  saludo: [
    'hola',
    'holi',
    'buenas',
    'buenos dias',
    'buen dia',
    'buenas tardes',
    'buenas noches',
    'saludos',
    'hey',
    'ey',
    'hello',
    'bon dia',
    'bona tarda',
    'bona nit',
    'bon vespre',
    'ei',
    'salutacions',
  ],
  como_estas: [
    'que tal',
    'que tal estas',
    'que tal va',
    'que tal todo',
    'como estas tu',
    'como te va',
    'como andas',
    'com et va',
    'com anem',
    'que tal tot',
    'tot be',
    'how are you',
  ],
  gracias: ['gracias', 'muchas gracias', 'mil gracias', 'gracies', 'moltes gracies', 'merci', 'thanks', 'thank you'],
  despedida: [
    'adios',
    'hasta luego',
    'hasta pronto',
    'hasta manana',
    'chao',
    'chau',
    'adeu',
    'fins aviat',
    'fins dema',
    'fins despres',
    'bye',
    'ciao',
  ],
  sobre_faro: [
    'quien eres',
    'que eres',
    'que haces',
    'que es faro',
    'como funciona',
    'como funcionas',
    'para que sirves',
    'para que sirve',
    'eres un robot',
    'eres una ia',
    'eres una persona',
    'ayudame',
    'necesito ayuda',
    'qui ets',
    'que ets',
    'que fas',
    'que es el faro',
    'com funciona',
    'com funciones',
    'per a que serveixes',
    'per que serveixes',
    'ets un robot',
    'ets una ia',
    'ets una persona',
    'ajuda m',
    'necessito ajuda',
  ],
};

/** Las que solo son cortesía junto a otra («hola faro», «muy bien, ¿y tú?») o si son todo el trozo. */
const LIGADAS: Readonly<Record<TipoDeCortesia, readonly string[]>> = {
  // «hi» es también el «hi» catalán («hi treballo»); «ola», «bones», palabras corrientes.
  saludo: ['faro', 'de nuevo', 'otra vez', 'a todos', 'a tots', 'una altra vegada', 'holis', 'ola', 'hi', 'bones'],
  como_estas: [
    ...['como estas', 'como esta', 'como va', 'com estas', 'com esta', 'com va'],
    ...['y tu', 'i tu', 'bien', 'muy bien', 'molt be', 'be', 'todo bien', 'bien y tu', 'tambien', 'tambe'],
  ],
  gracias: ['de nada', 'de res', 'vale', 'ok', 'perfecto', 'perfecte', 'genial'],
  despedida: ['nos vemos', 'ens veiem'],
  // «ayuda a domicilio» es un oficio: «ayuda» solo es pedir ayuda si va sola o junto a un saludo.
  sobre_faro: ['ayuda', 'ajuda', 'help'],
};

function frases(): Frase[] {
  const lista: Frase[] = [];
  for (const [tabla, ligada] of [
    [LIBRES, false],
    [LIGADAS, true],
  ] as const) {
    for (const [tipo, textos] of Object.entries(tabla) as [TipoDeCortesia, readonly string[]][]) {
      for (const t of textos) {
        lista.push({ palabras: t.split(' '), tipo, ligada });
      }
    }
  }
  // La más larga primero: «buenas tardes» antes que «buenas», «como estas tu» antes que «como estas».
  return lista.sort((a, b) => b.palabras.length - a.palabras.length);
}

const FRASES = frases();

/** Una palabra de lo escrito: su forma para comparar y dónde empieza y acaba en el texto original. */
interface Palabra {
  readonly forma: string;
  readonly desde: number;
  readonly hasta: number;
}

/** Minúsculas y sin tildes («Dïas» → «dias»), como en moderacion.ts. */
function forma(palabra: string): string {
  return palabra.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

/** Lo que separa los trozos de una frase: puntuación de frase y saltos de línea. */
const SEPARADOR = /[.,;:!?¡¿…\n()"«»]+/gu;
/** Las palabras: letras y cifras; los apóstrofos y guiones separan («ajuda'm» → «ajuda m»). */
const PALABRA = /[\p{L}\p{N}]+/gu;

/** Los trozos del texto, con sus límites en el original. */
function trozos(texto: string): { desde: number; hasta: number }[] {
  const lista: { desde: number; hasta: number }[] = [];
  let desde = 0;
  for (const m of texto.matchAll(SEPARADOR)) {
    lista.push({ desde, hasta: m.index });
    desde = m.index + m[0].length;
  }
  lista.push({ desde, hasta: texto.length });
  return lista;
}

function palabrasDe(texto: string, desde: number, hasta: number): Palabra[] {
  return [...texto.slice(desde, hasta).matchAll(PALABRA)].map((m) => ({
    forma: forma(m[0]),
    desde: desde + m.index,
    hasta: desde + m.index + m[0].length,
  }));
}

/** La frase de cortesía que empieza (o acaba, `alFinal`) en la posición `i` de las palabras, o null. */
function fraseEn(palabras: readonly Palabra[], i: number, alFinal: boolean): Frase | null {
  for (const f of FRASES) {
    const n = f.palabras.length;
    const inicio = alFinal ? i - n : i;
    if (inicio < 0 || inicio + n > palabras.length) {
      continue;
    }
    if (f.palabras.every((p, k) => palabras[inicio + k]?.forma === p)) {
      return f;
    }
  }
  return null;
}

/** Los tipos de cortesía si el trozo entero son frases de cortesía, ligadas o no («muy bien, ¿y tú?»), o null. */
function trozoEntero(palabras: readonly Palabra[]): TipoDeCortesia[] | null {
  const tipos: TipoDeCortesia[] = [];
  let i = 0;
  for (let f = fraseEn(palabras, i, false); f; f = fraseEn(palabras, i, false)) {
    tipos.push(f.tipo);
    i += f.palabras.length;
  }
  return palabras.length > 0 && i === palabras.length ? tipos : null;
}

/** Hasta dónde llega la cortesía del principio del trozo, y la quitada. */
function alPrincipio(palabras: readonly Palabra[]): { inicio: number; tipos: TipoDeCortesia[] } {
  const tipos: TipoDeCortesia[] = [];
  let inicio = 0;
  for (let f = fraseEn(palabras, inicio, false); f; f = fraseEn(palabras, inicio, false)) {
    const n = f.palabras.length;
    // Al principio, «gracias» y «adiós» van como ligados: «gracias a mi curso» no da las gracias.
    const ligada = f.ligada || f.tipo === 'gracias' || f.tipo === 'despedida';
    if (ligada && tipos.length === 0 && inicio + n < palabras.length) {
      break;
    }
    tipos.push(f.tipo);
    inicio += n;
  }
  return { inicio, tipos };
}

/** Desde dónde empieza la cortesía del final del trozo (sin pasar de `inicio`), y la quitada. */
function alFinal(
  palabras: readonly Palabra[],
  inicio: number,
  yaQuitada: boolean,
): { fin: number; tipos: TipoDeCortesia[] } {
  const tipos: TipoDeCortesia[] = [];
  let fin = palabras.length;
  for (let f = fraseEn(palabras, fin, true); f && fin - f.palabras.length >= inicio; f = fraseEn(palabras, fin, true)) {
    const n = f.palabras.length;
    // Al final, un saludo va como ligado: «una tienda de buenos días» no saluda.
    const ligada = f.ligada || f.tipo === 'saludo';
    if (ligada && !yaQuitada && tipos.length === 0 && fin - n > inicio) {
      break;
    }
    tipos.push(f.tipo);
    fin -= n;
  }
  return { fin, tipos };
}

/** Lo que queda de un trozo sin su cortesía del principio y del final, y la cortesía quitada. */
function limpiarTrozo(palabras: readonly Palabra[]): { inicio: number; fin: number; tipos: TipoDeCortesia[] } {
  const entero = trozoEntero(palabras);
  if (entero) {
    return { inicio: palabras.length, fin: palabras.length, tipos: entero };
  }
  const principio = alPrincipio(palabras);
  const final = alFinal(palabras, principio.inicio, principio.tipos.length > 0);
  return { inicio: principio.inicio, fin: final.fin, tipos: [...principio.tipos, ...final.tipos] };
}

/** Un trozo sin su cortesía, tal cual lo escribió la persona y con el separador que lo seguía, o null si no queda nada. */
function restoDelTrozo(
  texto: string,
  palabras: readonly Palabra[],
  limpio: { inicio: number; fin: number },
  separador: string,
) {
  const primera = palabras[limpio.inicio];
  const ultima = palabras[limpio.fin - 1];
  return primera && ultima && limpio.fin > limpio.inicio ? texto.slice(primera.desde, ultima.hasta) + separador : null;
}

/**
 * Lo escrito sin saludos, cortesía ni preguntas sobre Faro al principio y al final de cada trozo. Sin cortesía,
 * devuelve el mismo texto. Si todo era cortesía, el texto queda vacío.
 */
export function quitarCortesia(texto: string): TextoSinCortesia {
  const tipos = new Set<TipoDeCortesia>();
  const quedan: string[] = [];
  const lista = trozos(texto);
  for (const [k, t] of lista.entries()) {
    const palabras = palabrasDe(texto, t.desde, t.hasta);
    const limpio = limpiarTrozo(palabras);
    for (const tipo of limpio.tipos) {
      tipos.add(tipo);
    }
    const siguiente = lista[k + 1];
    const resto = restoDelTrozo(texto, palabras, limpio, siguiente ? texto.slice(t.hasta, siguiente.desde) : '');
    if (resto !== null) {
      quedan.push(resto);
    }
  }
  if (tipos.size === 0) {
    return { texto, cortesia: [] };
  }
  const limpio = quedan
    .join(' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.,;:!?¡¿…]+|[\s,;:¡¿]+$/gu, '')
    .trim();
  return { texto: limpio, cortesia: [...tipos] };
}
