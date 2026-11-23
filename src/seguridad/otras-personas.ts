// Dónde va el nombre de otra persona: tras su papel en la vida de quien escribe, en castellano y en catalán, en
// masculino, femenino y plural («mi jefe», «la clienta», «mis compañeros», «el meu cap», «la meva companya»), con lo
// que puede ir en medio («de cocina», «se llama», una coma o el artículo catalán: «el meu cap, en Jordi»). Esta pieza
// encuentra el papel y dice cuánto asegura; si lo que sigue es un nombre lo decide nombres-de-persona.ts, con la lista
// del INE y las mismas reglas que tras una presentación.

import { type SinMayusculas, sinDistinguirMayusculas } from '../comun/sin-distinguir-mayusculas.ts';

/**
 * Qué asegura el papel que va delante de un posible nombre. `cualquierOrigen`: vale uno que la lista no tiene, con
 * mayúscula. `minusculas`: vale uno de la lista en minúsculas, si acaba ahí. `llamado`: tras «se llama», lo que sigue
 * es el nombre, sin más.
 */
export interface ContextoDelRol {
  readonly cualquierOrigen: boolean;
  readonly minusculas: boolean;
  readonly llamado: boolean;
}

/** Un papel encontrado: dónde empieza lo que puede ser el nombre (`desde`, en unidades UTF-16) y cuánto lo asegura. */
export interface Papel {
  readonly desde: number;
  readonly contexto: ContextoDelRol;
}

/** Quienes rodean a la persona en el trabajo o en casa, cada uno con su femenino y su plural. */
const ROLES = [
  // Castellano.
  'jef[ea]s? encargad[oa]s? supervisor(?:a|as|es|s)? coordinador(?:a|as|es|s)? gerentes? director(?:a|as|es|s)?',
  'responsables? compañer[oa]s? compis? colegas? soci[oa]s? client[ea]s? pacientes? usuari[oa]s? residentes?',
  'alumn(?:o|a|os|as|e|es) estudiantes? niñ[oa]s? beb[eé]s? abuel[oa]s? señor(?:a|as|es)? marido mujer espos[oa]',
  'pareja novi[oa] hij[oa]s? padres? madres? herman[oa]s? t[ií][oa]s? prim[oa]s? sobrin[oa]s? vecin[oa]s? amig[oa]s?',
  'dueñ[oa]s? propietari[oa]s? emplead[oa]s? trabajador(?:a|as|es)? proveedor(?:a|as|es)? profesor(?:a|as|es|s)?',
  'maestr[oa]s? tutor(?:a|as|es|s)? m[eé]dic[oa]s? doctor(?:a|as|es|s)? enfermer[oa]s? cuidador(?:a|as|es|s)?',
  'becari[oa]s? ayudantes? aprendiz',
  // Catalán.
  'caps? encarrega(?:t|da|ts|des) gerents? compan(?:y|ya|ys|yes) clien(?:t|ta|ts|tes) pacients? usuaris?',
  'usuàri(?:a|es) residents? estudiants? nen(?:a|s|es)? avis? àvi(?:a|es) senyor(?:a|s|es)? marit dona parella',
  'fill(?:a|s|es)? pares? mares? germ(?:à|ana|ans|anes) tiet(?:a|s|es)? cos(?:í|ina|ins|ines) nebo(?:t|da|ts|des)',
  've(?:í|ïna|ïns|ïnes) amics? amig(?:a|ues) amo mestressa propietaris? propietàri(?:a|es) treballador(?:a|s|es)?',
  'proveïdor(?:a|s|es)? mestr(?:e|a|es) metges? metgess(?:a|es) infermer(?:a|s|es)? becaris? becàri(?:a|es)',
  'ajudants? aprenent(?:a|s|es)?',
]
  .flatMap((linea) => linea.split(' '))
  .join('|');
/** Lo que va delante del papel: «mi», «la», «al», «aquella», «el meu», «la meva»… */
const DETERMINANTES = [
  'mis? tus? sus? nuestr[oa]s? vuestr[oa]s? el la los las al del un una unos unas est[ea]s? estos es[ea]s? esos',
  'otr[oa]s? els les als dels uns unes aquest(?:a|s|es)? aquell(?:a|s|es)?',
  '(?:el|la|els|les)\\s+(?:meu|meva|meus|meves|teu|teva|teus|teves|seu|seva|seus|seves|nostre|nostra|nostres|vostre|vostra)',
]
  .flatMap((linea) => linea.split(' '))
  .join('|');
/** Lo que puede ir entre el papel y el nombre: «de turno», «de la tarde». */
function complemento(sinMayusculas: SinMayusculas): string {
  return `\\s+${sinMayusculas('de|del')}(?:\\s+${sinMayusculas('la|el|los|las|les|els')})?\\s+\\p{Ll}+`;
}
/** «Mi jefe se llama…», «el meu cap es diu…»: lo que sigue es su nombre. */
function llamado(sinMayusculas: SinMayusculas): string {
  return `\\s*,?\\s+${sinMayusculas('(?:que\\s+)?(?:se\\s+llama|es\\s+diu)')}`;
}
/** «Mi jefa es Pilar», «la meva cap és la Montse»: lo que sigue puede ser su nombre o cualquier otra cosa. */
function es(sinMayusculas: SinMayusculas): string {
  return `\\s+${sinMayusculas('es|és')}`;
}
/** El artículo que el catalán pone ante un nombre: «la Montse», «el Jordi», «en Pau», «na Maria», «l'Anna». */
const ARTICULO_DEL_NOMBRE = "(?:la|el|en|na)\\s+|[ln]['’]";
/**
 * El papel de otra persona, con cada parte en su grupo para saber cuánto asegura: el papel (`rol`, en singular o en
 * plural), lo que lo completa, «se llama» (o «es»), la coma y el artículo del nombre. «Don» y «doña» valen sin nada
 * delante. La función permite comprobar la equivalencia con la versión escrita con el modificador `(?i:…)`.
 *
 * @param sinMayusculas - Cómo se escriben los trozos que no distinguen mayúsculas.
 * @returns La expresión, con las banderas `g` y `u` y los grupos con nombre `rol`, `complemento`, `llamado`, `coma` y
 *   `articulo`.
 */
function expresionDelPapel(sinMayusculas: SinMayusculas): RegExp {
  const tras =
    `(?<complemento>${complemento(sinMayusculas)})?` +
    `(?:(?<llamado>${llamado(sinMayusculas)})|${es(sinMayusculas)})?`;
  return new RegExp(
    `(?<!\\p{L})(?:${sinMayusculas(`(?:${DETERMINANTES})\\s+|l['’]`)}(?<rol>${sinMayusculas(ROLES)})${tras}` +
      `|${sinMayusculas('don|doña')})(?!\\p{L})(?<coma>\\s*,)?\\s+(?<articulo>${sinMayusculas(ARTICULO_DEL_NOMBRE)})?`,
    'gu',
  );
}
const PAPEL = expresionDelPapel(sinDistinguirMayusculas);
/** Los papeles que solo lo son en catalán: «pares» y «mares». */
const SOLO_EN_CATALAN = /^(?:pares|mares)$/i;
/** Un determinante catalán en plural al principio del papel: «els», «les», «als», «dels», «uns», «aquests»… */
const DETERMINANTE_CATALAN = /^(?:els|les|als|dels|uns|unes|aquest(?:s|es)|aquell(?:s|es))\s/i;

/**
 * Los pronombres que pueden seguir a un nombre en minúsculas y lo cierran: «mi jefe juan me dice». No están los que
 * son también artículos («lo», «la», «los», «les»): tras «mi jefe evita los conflictos», «evita» no es un nombre.
 */
export const PRONOMBRES_TRAS_EL_NOMBRE: ReadonlySet<string> = new Set(
  ['me te se le nos os', 'em et es li ens us ho hi'].flatMap((linea) => linea.split(' ')),
);

/**
 * Qué asegura un papel encontrado, según sus grupos. En plural («los clientes»), con lo que lo completa sin coma
 * detrás («los profesores de colegio Montessori») o con el artículo catalán («en», «la»), solo vale un nombre de la
 * lista; en plural o con el complemento sin coma, además, solo con mayúscula: «los clientes an dejao» es una falta de
 * ortografía, no una clienta llamada An.
 */
function contextoDelRol(grupos: Record<string, string | undefined>): ContextoDelRol {
  const plural = /s$/i.test(grupos.rol ?? '');
  const llamado = grupos.llamado !== undefined;
  const complementoSinComa = grupos.complemento !== undefined && grupos.coma === undefined && !llamado;
  const minusculas = !plural && !complementoSinComa;
  return { cualquierOrigen: minusculas && grupos.articulo === undefined, minusculas, llamado };
}

/**
 * Si el papel encontrado lo es en su lengua: «pares» y «mares» son los padres en catalán («els meus pares Joan i
 * Maria»), pero en castellano son otra cosa («unos pares Nike y Adidas», «los mares Mediterráneo y Cantábrico»), así que
 * solo valen tras un determinante catalán.
 */
function enSuLengua(encontrado: RegExpMatchArray): boolean {
  return !SOLO_EN_CATALAN.test(encontrado.groups?.rol ?? '') || DETERMINANTE_CATALAN.test(encontrado[0]);
}

/**
 * Los papeles de otras personas que hay en el texto, cada uno con dónde puede empezar el nombre que lo sigue.
 *
 * @param texto - El texto donde se buscan.
 * @returns Los papeles, en el orden en que aparecen.
 */
export function papelesDeOtrasPersonas(texto: string): Papel[] {
  return [...texto.matchAll(PAPEL)].filter(enSuLengua).map((encontrado) => ({
    desde: encontrado.index + encontrado[0].length,
    contexto: contextoDelRol(encontrado.groups ?? {}),
  }));
}
