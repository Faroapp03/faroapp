// Las expresiones de las presentaciones y los tratamientos tras los que va un nombre de persona («me llamo», «em dic»,
// «soy la», «me llaman», «el Sr.»), con las que nombres-de-persona.ts encuentra dónde empieza un nombre, y las
// terminaciones de oficio con que decide que una palabra no lo es. Cada expresión se construye con una función que
// recibe cómo escribir los trozos que no distinguen mayúsculas, para que la prueba de equivalencia las compare.

import type { SinMayusculas } from '../comun/sin-distinguir-mayusculas.ts';

// Nombres propios, solo en contextos inequívocos. Además de proteger a la persona, el modelo no ve su nombre,
// así que el nombre no puede influir en el resultado (un nombre extranjero, por ejemplo).
// Las presentaciones se reconocen sin distinguir mayúsculas («ME LLAMO», «Em Dic»): la limpieza las escribe con
// sinDistinguirMayusculas (comun/sin-distinguir-mayusculas.ts), que hace lo del modificador `(?i:…)` sin él; el
// nombre, en cambio, se lee distinguiéndolas, porque la mayúscula es lo que lo separa del resto de la frase.
// Las letras son las de cualquier alfabeto: un nombre se escribe con las suyas («Mădălina», «João», «Łukasz»). Con solo
// las del castellano y el catalán, el nombre se cortaría en la primera letra que no lo es y el resto se quedaría en el
// texto («Me llamo [nombre eliminado]ădălina»).
const LETRA = "[\\p{L}'’·-]";
const MAYUSCULA = '\\p{Lu}';
const MINUSCULA = '\\p{Ll}';
/** Final de palabra que también vale tras una letra con tilde (`\b` solo conoce las letras sin tilde). */
const FIN_DE_PALABRA = '(?!\\p{L})';
/** Una palabra con mayúscula inicial y lo demás en minúsculas («Pérez», «D'Amico», «Marcel·la»). */
const PALABRA_PROPIA = `${MAYUSCULA}(?:${MINUSCULA}|['’])${LETRA}*`;
// Hasta tres apellidos tras el nombre. Una palabra toda en mayúsculas no se toma por apellido: en un texto escrito
// en mayúsculas sería el relato («ME LLAMO LAURA Y TRABAJO DE CAJERA»).
const APELLIDOS = `(?:\\s+${PALABRA_PROPIA}){0,3}`;
/** Palabras que pueden seguir a «me llamo» sin ser un nombre («me llamo la atención»). */
const NO_SON_NOMBRE: readonly string[] = [
  ...['a', 'al', 'la', 'el', 'los', 'las', 'lo', 'le', 'les', 'de', 'del', 'que', 'así', 'asi', 'por', 'para'],
  ...['y', 'e', 'o', 'u', 'un', 'una', 'con', 'en', 'se', 'me', 'te', 'nos'],
];
/** Lo que impide que tras «me llamo» se tome por nombre una de NO_SON_NOMBRE, escrita como la escriba `sinMayusculas`. */
function noNombre(sinMayusculas: SinMayusculas): string {
  return `(?!${sinMayusculas(NO_SON_NOMBRE.join('|'))}${FIN_DE_PALABRA})`;
}
/** Presentaciones tras las que siempre va un nombre, aunque se escriba en minúsculas («me llamo cristina»). */
const PRESENTACIONES = [
  'me\\s*(?:ll|y|i)amo\\s+', // «me llamo», con faltas («me yamo», «me iamo») o junto («mellamo»)
  'mi\\s+nombre\\s+es\\s+',
  'mi\\s+nombre\\s*[:,]\\s*', // también entre comas: «repite mi nombre, Sergio Molina, en cada tarea»
  '(?:el\\s+meu|mi)\\s+nom\\s+[eé]s\\s+', // catalán, con tilde o sin ella, y mezclado («mi nom és»)
  '(?:el\\s+meu|mi)\\s+nom\\s*[:,]\\s*',
  'em\\s+dic\\s+',
  'my\\s+name\\s+is\\s+',
].join('|');
/** Cómo te llaman los demás: puede seguir un nombre o cualquier otra cosa («me llaman del almacén»). */
const APODOS = ['me\\s+llaman\\s+', 'me\\s+dicen\\s+', 'em\\s+diuen\\s+'].join('|');
/** El artículo ante un nombre de persona, frecuente en Cataluña: «la Montse», «el Jordi», «l'Anna». */
const ARTICULO = "(?:la\\s+|el\\s+|l['’])";
/**
 * El artículo personal catalán: «en Jordi», «na Maria» (en Baleares), «n'Andreu». Sin él, «Em dic en Jordi» o «Sóc en
 * Marc» no se quitarían y «Em dic la Montse» sí: el nombre de un hombre llegaría al proveedor y el de una mujer, no.
 */
const ARTICULO_PERSONAL = "(?:en\\s+|na\\s+|n['’])";
const ARTICULO_DE_NOMBRE = `(?:${ARTICULO}|${ARTICULO_PERSONAL})`;
/** «Soy» o «sóc», que pueden seguir de un nombre o de cualquier otra cosa («soy de Cornellà», «sóc paleta»). */
const SOY = '(?:soy|(?:jo\\s+)?s[oóò]c)\\s+';
/** «Soy la Montse», «jo sóc el Jordi», «soc l'Anna», «sóc en Marc». */
const SOY_CON_ARTICULO = `${SOY}${ARTICULO_DE_NOMBRE}`;
/**
 * Terminaciones de oficio en castellano y en catalán («Encargada», «Tècnic», «Cuiner»). Tras una presentación que
 * admite otra cosa que un nombre («soy la…», «me llaman…»), una palabra que acaba así no se quita: se prefiere dejar
 * pasar un nombre (Víctor, Mónica, Xavier) a quitar un oficio.
 */
const TERMINACIONES_DE_OFICIO: readonly string[] = [
  ...['ero', 'era', 'ista', 'or', 'ora', 'ante', 'anta', 'ente', 'enta', 'ico', 'ica', 'ario', 'aria', 'ado', 'ada'],
  ...['ivo', 'iva', 'ble', 'efe', 'efa', 'er', 'at', 'ari', 'ària', 'iu', 'ic', 'ent', 'ant'],
];
const NO_OFICIO = `(?!${MAYUSCULA}${LETRA}*(?:${TERMINACIONES_DE_OFICIO.join('|')})${FIN_DE_PALABRA})`;
/**
 * Una palabra que acaba como un oficio, ya sin tildes y en minúsculas: «cajera», «encargado», «dependienta». Sin
 * bandera `g` ni `y`: no guarda estado entre llamadas.
 */
export const ACABA_COMO_UN_OFICIO: RegExp = new RegExp(`(?:${TERMINACIONES_DE_OFICIO.join('|')})$`);
/** Tras «soy la Montse», la presentación acaba: puntuación, final del texto o «y» («soy la Montse y limpio»). */
function finDePresentacion(sinMayusculas: SinMayusculas): string {
  return `(?=[^\\S\\n]*(?:[,.;:!?)\\n]|$)|\\s+${sinMayusculas('y|e|i')}${FIN_DE_PALABRA})`;
}
/** Lo que va delante de un nombre que solo se quita si la presentación acaba tras él. */
const APODO_O_SOY = `(?:${APODOS})${ARTICULO}?|${SOY_CON_ARTICULO}`;
/** Un patrón de nombre y si lo que encuentra es un tratamiento («el Sr. García»), cuyo nombre es ya un apellido. */
interface PatronDeNombre {
  patron: RegExp;
  tratamiento: boolean;
}

/**
 * Los patrones de las presentaciones y los tratamientos tras los que va un nombre. Cada patrón lleva la presentación
 * en su primer grupo y el nombre en el segundo; un tratamiento, el apellido. Los trozos que no distinguen mayúsculas,
 * como los escriba `sinMayusculas`: la función permite comprobar la equivalencia con la versión escrita con `(?i:…)`.
 *
 * @param sinMayusculas - Cómo se escribe un trozo de expresión que no distingue mayúsculas de minúsculas.
 * @returns Los patrones, con la bandera `gu`, en el orden en que se aplican.
 */
export function patronesDeNombres(sinMayusculas: SinMayusculas): PatronDeNombre[] {
  return [
    // «Me llamo Laura Pérez», «em dic Jordi»; también con faltas («me yamo»), en minúsculas («me llamo cristina») o
    // en mayúsculas («ME LLAMO LAURA»).
    {
      patron: new RegExp(
        `\\b(${sinMayusculas(PRESENTACIONES)})${noNombre(sinMayusculas)}(${LETRA}+${APELLIDOS})`,
        'gu',
      ),
      tratamiento: false,
    },
    // «Em dic la Montse», «em dic en Jordi»: con artículo, solo un nombre con mayúscula que no sea un oficio.
    {
      patron: new RegExp(
        `\\b(${sinMayusculas(`(?:${PRESENTACIONES})${ARTICULO_DE_NOMBRE}`)})${NO_OFICIO}(${PALABRA_PROPIA}${APELLIDOS})`,
        'gu',
      ),
      tratamiento: false,
    },
    // «Me llaman Montse», «soy la Montse y limpio»: pueden seguir otras cosas, así que además la presentación tiene que
    // acabar tras el nombre. «Me llaman del almacén», «me dicen Hola por la mañana», «soy la Responsable de calidad» o
    // «soy el de mantenimiento» no pierden nada.
    {
      patron: new RegExp(
        `\\b(${sinMayusculas(APODO_O_SOY)})${NO_OFICIO}(${PALABRA_PROPIA}${APELLIDOS})${finDePresentacion(sinMayusculas)}`,
        'gu',
      ),
      tratamiento: false,
    },
    // Tratamientos: «el Sr. García», «la Dra. Puig».
    {
      patron: new RegExp(
        `\\b((?:Sr|Sra|Srta|Sres|Dr|Dra|Dña|Don|Doña)\\.?\\s+)(${MAYUSCULA}${LETRA}+(?:\\s+${MAYUSCULA}${LETRA}+){0,2})`,
        'gu',
      ),
      tratamiento: true,
    },
  ];
}
/**
 * Una presentación y, si lo lleva, el artículo del nombre; cada parte en su grupo, para saber cuánto asegura: tras
 * «soy» o «sóc» y tras «me llaman» o «em diuen» puede ir un nombre o cualquier otra cosa.
 *
 * @param sinMayusculas - Cómo se escribe un trozo de expresión que no distingue mayúsculas de minúsculas.
 * @returns La expresión, con la bandera `gu` y los grupos con nombre `inequivoca`, `apodo`, `personal` y `comun`.
 */
export function expresionDePresentacion(sinMayusculas: SinMayusculas): RegExp {
  return new RegExp(
    `\\b(?:(?<inequivoca>${sinMayusculas(PRESENTACIONES)})|${sinMayusculas(SOY)}|(?<apodo>${sinMayusculas(APODOS)}))` +
      `(?:(?<personal>${sinMayusculas(ARTICULO_PERSONAL)})|(?<comun>${sinMayusculas(ARTICULO)}))?`,
    'gu',
  );
}
