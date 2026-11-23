// Expresiones de varias palabras con que la gente nombra su sector u oficio y que los títulos oficiales de ESCO dicen
// de otra forma. Buscadas palabra a palabra se pierden: «bienes raíces» llevaba a «clasificadores de productos» por
// «bienes», y a ningún agente inmobiliario. Cada una sale del diccionario normativo.
// Solo preparan lo que se busca; lo que la persona ve escrito no cambia.

import vocabulario from './vocabulario-calle.json' with { type: 'json' };

/** Letras de cualquier alfabeto: una expresión solo se cambia entera, nunca dentro de otra palabra. */
const SIN_LETRA_ANTES = '(?<!\\p{L})';
const SIN_LETRA_DESPUES = '(?!\\p{L})';

/** Cada expresión, la forma con que la nombra ESCO y su fuente. */
const FRASES: readonly { readonly expresion: string; readonly forma: string; readonly fuente: string }[] = [
  {
    expresion: 'bienes\\s+ra[ií]ces',
    forma: 'inmobiliario',
    fuente: 'DLE (RAE), «bienes raíces»: bienes inmuebles; ESCO nombra el oficio «agente inmobiliario» (3334).',
  },
  // Personas mayores: palabra a palabra, «trabajo con gente mayor» llevaba a «mayorista» y a
  // «comandante del Ejército», y «treballo amb gent gran» a «limpiador de granos de cacao».
  {
    expresion: 'gente\\s+mayor',
    forma: 'personas mayores',
    fuente:
      'DLE (RAE), «mayor»: dicho de una persona, de edad avanzada. ESCO nombra a este colectivo «personas mayores» ' +
      '(«director de residencia de personas mayores», 1343).',
  },
  {
    expresion: 'con\\s+mayores',
    forma: 'con personas mayores',
    fuente: 'DLE (RAE), «mayor»: dicho de una persona, de edad avanzada. ESCO dice «personas mayores».',
  },
  {
    expresion: 'gent\\s+gran',
    forma: 'persones grans',
    fuente: "DIEC (IEC), «gran»: dit d'una persona, d'edat avançada. ESCO en catalán dice «persones grans».",
  },
];

/** Una expresión escrita en texto llano como patrón: los signos, tal cual; los espacios, uno o más; el apóstrofo, recto o curvo. */
function patronDe(texto: string): string {
  return texto
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/['’]/g, "['’]");
}

/**
 * Las expresiones de la calle (vocabulario-calle.json: «con el toro» → «con la carretilla elevadora», «de cara al
 * público»…), detrás de las de esta lista; fuera las ambiguas y las que no tienen forma.
 */
const DE_LA_CALLE = vocabulario.expresiones.map(({ expresion, forma, fuente }) => ({
  expresion: patronDe(expresion),
  forma,
  fuente,
}));

const PATRONES = [...FRASES, ...DE_LA_CALLE].map(({ expresion, forma }) => ({
  patron: new RegExp(`${SIN_LETRA_ANTES}${expresion}${SIN_LETRA_DESPUES}`, 'giu'),
  forma,
}));

/**
 * El texto con cada expresión de la lista cambiada por la forma de ESCO.
 *
 * @param texto - Lo que escribe la persona.
 * @returns El mismo texto, con las expresiones cambiadas; igual si no tiene ninguna.
 */
export function conFrasesDeDiccionario(texto: string): string {
  return PATRONES.reduce((resto, { patron, forma }) => resto.replace(patron, forma), texto);
}
