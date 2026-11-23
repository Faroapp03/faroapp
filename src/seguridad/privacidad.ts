// Minimización de datos: antes de procesar un relato se eliminan los datos identificativos que se
// reconocen sin duda, también cuando están escritos para esquivar filtros («arroba», teléfonos con puntos o en
// palabras, DNI con espacios). Esta pieza decide el orden; las demás quitan los identificadores con forma fija
// (identificadores.ts: correos, teléfonos, documentos, cuentas, Seguridad Social y enlaces), las direcciones
// (direcciones.ts), el nombre de la empresa (empresas.ts) y los nombres de persona, solo donde no hay duda
// (nombres-de-persona.ts). No sustituye el aviso a la persona.
// Pieza compartida por navegador y servidor. Limpiar dos veces da lo mismo que limpiar una.
// Antes de buscar nada, el texto pasa a la forma en que se busca (comoSeBusca): sin caracteres invisibles, selectores
// de variante ni etiquetas de Unicode, con los acentos compuestos, con las variantes tipográficas de las letras
// cambiadas por sus letras (y las de las cifras por sus cifras) y con las letras cirílicas o griegas metidas en una
// palabra latina cambiadas por la latina que imitan. Si no, «Me llamo \u202eLaura\u202c», «Lau\ufe0fra», un «José»
// escrito con el acento aparte, un nombre en negrita matemática, un teléfono o una tarjeta con cifras de ancho completo
// o «Me llаmo Laura» con la «а» cirílica podrían eludir la limpieza.

import { INVISIBLES } from '../comun/legible.ts';
import { quitarDirecciones } from './direcciones.ts';
import { quitarEmpresas } from './empresas.ts';
import { quitarCuentasAnunciadas, quitarIdentificadores, quitarNumerosDeAfiliacion } from './identificadores.ts';
import type { Limpieza } from './limpieza.ts';
import {
  quitarNombresDeLaLista,
  quitarNombresDeLosPatrones,
  quitarNombresDeOtrasPersonas,
} from './nombres-de-persona.ts';

/**
 * Lo que solo dice cómo dibujar el carácter anterior, o nada: los selectores de variante (la propiedad
 * Variation_Selector de Unicode: U+FE00–U+FE0F, U+E0100–U+E01EF y los del mongol) y la zona de etiquetas de Unicode
 * (U+E0000–U+E007F). En un relato de trabajo no dicen nada y, metidos dentro de un nombre («Lau\ufe0fra»,
 * «La\u{e0075}ura»), lo esconden a los patrones. Se retiran además de la lista común INVISIBLES
 * (comun/legible.ts). El emoji se conserva, aunque se puede
 * dibujar de otra forma («❤» por «❤️»; la bandera de Escocia, negra).
 */
const SELECTORES_Y_ETIQUETAS = /[\p{Variation_Selector}\u{e0000}-\u{e007f}]/gu;
/**
 * Fuera del latín básico y extendido: ahí están las variantes tipográficas de las letras y de las cifras, no las letras
 * ni las cifras de aquí.
 */
const FUERA_DEL_LATINO = /[\u0250-\u{10ffff}]/gu;
/** La forma normalizada de un carácter es una letra o varias (y no un número, un signo ni una unidad). */
const SOLO_LETRAS = /^\p{L}+$/u;
/** Una cifra decimal de cualquier sistema de escritura (categoría Nd de Unicode). */
const CIFRA_DECIMAL = /^\p{Nd}$/u;
/** Una cifra del 0 al 9. */
const CIFRA_ARABIGA = /^[0-9]$/;

/**
 * Si `normalizado` (la forma NFKC de `caracter`) es la letra o la cifra de la que `caracter` es una variante
 * tipográfica: letras, o una cifra decimal que pasa a su cifra del 0 al 9 («４» o «𝟒», no «²» ni «①», que no son cifras
 * decimales).
 */
function esVarianteTipografica(caracter: string, normalizado: string): boolean {
  if (normalizado === caracter) {
    return false;
  }
  return SOLO_LETRAS.test(normalizado) || (CIFRA_DECIMAL.test(caracter) && CIFRA_ARABIGA.test(normalizado));
}

/**
 * Las letras y las cifras escritas con una variante tipográfica, cambiadas por sus letras y sus cifras: negrita
 * matemática («Me llamo \u{1d40b}\u{1d41a}\u{1d42e}\u{1d42f}\u{1d41a}»), ancho completo («６１２ ３４５ ６７８»),
 * letras en círculo o ligaduras. Se normaliza carácter a carácter y solo cuando el resultado es una variante
 * (esVarianteTipografica), así que «m²», «℃» o «nº» se quedan como están y el relato no cambia por otro motivo.
 */
function normalizarVariantesTipograficas(texto: string): string {
  return texto.replace(FUERA_DEL_LATINO, (caracter) => {
    const normalizado = caracter.normalize('NFKC');
    return esVarianteTipografica(caracter, normalizado) ? normalizado : caracter;
  });
}

/**
 * Las letras cirílicas y griegas que se dibujan igual que una latina, cada una seguida de la latina que imita: un
 * subconjunto de las confusiones de Unicode (UTS #39, «confusables»), solo las de una letra latina sin tilde.
 */
const PAREJAS_QUE_IMITAN =
  'аa еe оo рp сc уy хx іi јj ѕs һh ԁd ԛq ԝw ӏl АA ВB СC ЕE НH ІI ЈJ КK МM ОO РP ЅS ТT ХX УY ԚQ ԜW ӀI ' +
  'οo αa νv ιi ρp υu ΑA ΒB ΕE ΖZ ΗH ΙI ΚK ΜM ΝN ΟO ΡP ΤT ΥY ΧX';
/** La letra latina que imita cada letra cirílica o griega de PAREJAS_QUE_IMITAN. */
const LATINA_QUE_IMITA: ReadonlyMap<string, string> = new Map(
  PAREJAS_QUE_IMITAN.split(' ').map((pareja): [string, string] => [pareja.slice(0, 1), pareja.slice(1)]),
);
/** Una palabra: letras de cualquier alfabeto y sus acentos. */
const PALABRA = /[\p{L}\p{M}]+/gu;
/** Una letra del alfabeto latino. */
const LETRA_LATINA = /\p{Script=Latin}/u;
/** Una letra cirílica o griega; con la bandera `g`, todas las de la palabra. */
const LETRA_CIRILICA_O_GRIEGA = /[\p{Script=Cyrillic}\p{Script=Greek}]/gu;

/**
 * Las palabras latinas con letras cirílicas o griegas que imitan una latina («llаmo» con la «а» cirílica), escritas
 * solo con letras latinas (UTS #39, detección de palabras con alfabetos mezclados). Una palabra escrita entera en
 * cirílico o en griego se queda como está: es texto en otra lengua, y cambiarle letras lo estropearía.
 */
function plegarLetrasQueImitan(texto: string): string {
  return texto.replace(PALABRA, (palabra) => {
    LETRA_CIRILICA_O_GRIEGA.lastIndex = 0;
    if (!LETRA_LATINA.test(palabra) || !LETRA_CIRILICA_O_GRIEGA.test(palabra)) {
      return palabra;
    }
    return palabra.replace(LETRA_CIRILICA_O_GRIEGA, (letra) => LATINA_QUE_IMITA.get(letra) ?? letra);
  });
}

/**
 * El texto en la forma en que se buscan los datos, en un solo sitio: sin INVISIBLES ni SELECTORES_Y_ETIQUETAS, con los
 * acentos compuestos (NFC) y con las variantes tipográficas de las letras y de las cifras cambiadas por sus letras y
 * sus cifras. NFC y no NFKC del texto entero: «m²» o «℃» se quedan como están. NFC va antes y después de las variantes:
 * antes, para que una letra escrita con el acento aparte («Jose\u0301») sea un solo carácter; después, para juntar con
 * su acento la letra que sale de una variante («\uff2a\uff4f\uff53\uff45\u0301» → «José»), o de una letra cirílica o
 * griega cambiada por la latina que imita. Lo que devuelve ya está en esa forma: pasarlo otra vez no lo cambia, y por
 * eso limpiar dos veces da lo mismo que limpiar una.
 */
function comoSeBusca(texto: string): string {
  const sinOcultos = texto.replace(INVISIBLES, '').replace(SELECTORES_Y_ETIQUETAS, '').normalize('NFC');
  return plegarLetrasQueImitan(normalizarVariantesTipograficas(sinOcultos)).normalize('NFC');
}

/**
 * Las limpiezas, en el orden en que se aplican. El orden importa: los números (cuentas, Seguridad Social, documentos,
 * teléfonos) van antes que las direcciones, para que ninguno se lea como el número de un portal; y las direcciones y
 * las empresas, antes que los nombres, para que «c/ Dr. Fleming 5» o «Hermanos García S.L.» se quiten enteras.
 */
const LIMPIEZAS_EN_ORDEN: readonly ((texto: string) => Limpieza)[] = [
  quitarCuentasAnunciadas,
  quitarNumerosDeAfiliacion,
  quitarIdentificadores,
  quitarDirecciones,
  quitarEmpresas,
  quitarNombresDeLosPatrones,
  quitarNombresDeLaLista,
  quitarNombresDeOtrasPersonas,
];

/** Una limpieza tras otra, en orden, sumando lo que quita cada una. */
function enOrden(texto: string, limpiezas: readonly ((texto: string) => Limpieza)[]): Limpieza {
  return limpiezas.reduce(
    (hecho, limpiar) => {
      const siguiente = limpiar(hecho.texto);
      return { texto: siguiente.texto, eliminados: hecho.eliminados + siguiente.eliminados };
    },
    { texto, eliminados: 0 },
  );
}

/**
 * Quita del texto los datos personales que reconoce, en el orden de LIMPIEZAS_EN_ORDEN, y cuenta cada sustitución.
 *
 * @param texto - El texto que se limpia, tal como llega.
 * @returns El texto en la forma en que se busca (comoSeBusca), con cada dato cambiado por su marca, y cuántos datos
 *   se han quitado.
 */
export function limpiarDatosPersonales(texto: string): Limpieza {
  return enOrden(comoSeBusca(texto), LIMPIEZAS_EN_ORDEN);
}
