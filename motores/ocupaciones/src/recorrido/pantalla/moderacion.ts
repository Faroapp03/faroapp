// La moderación del recorrido en el dispositivo, sin proveedor de IA: un moderador de reglas marca las mismas
// categorías que seguridad/moderacion.ts (moderarAntesDelModelo) y la MISMA política decide: «self-harm/intent» o
// «/instructions» → aviso del 024 y no se sigue; amenazas de violencia y contenido sexual con menores → no se sigue,
// con el aviso de que Faro solo ayuda con el trabajo. Igual que la política, no se para por hablar de violencia o de
// suicidio en el trabajo («atiendo intentos de suicidio», «investigo abusos a menores»): solo por la intención o las
// instrucciones en primera persona.
//
// Son reglas de alta precisión, no un clasificador: lo que no reconocen sigue. Están escritas en las dos lenguas de la
// web y se comparan sin mayúsculas, sin tildes y con los apóstrofos y guiones como espacios («treure’m» = «treure m»).

import type { Idioma } from '../../../../../src/comun/idioma.ts';
import type { Aviso } from '../../../../../src/seguridad/avisos.ts';
import { type Moderador, moderarAntesDelModelo } from '../../../../../src/seguridad/moderacion.ts';

/**
 * Frases hechas del trabajo que usan las mismas palabras sin hablar de quitarse la vida («me mato a trabajar»): se
 * quitan antes de aplicar las reglas.
 */
const FRASES_HECHAS = / (?:me mato|matarme|matandome|em mato|matar me) a (?:trabajar|currar|estudiar|treballar)/g;

/** El texto tal como se comparan las reglas: minúsculas, sin tildes y con apóstrofos y guiones como espacios. */
function formaDeModerar(texto: string): string {
  const forma = ` ${texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
  return forma.replace(FRASES_HECHAS, ' ');
}

const p = (fuente: string): RegExp => new RegExp(` (?:${fuente}) `);

/** Verbos de quitarse la vida, en infinitivo con pronombre y en primera persona. */
const MORIR_ES = 'morir|morirme|suicidarme|matarme|quitarme la vida|acabar con mi vida';
const MORIR_CA = 'morir|morir me|suicidar me|matar me|treure m la vida|acabar amb la meva vida';

/** Intención de autolesión o de suicidio, en primera persona (self-harm/intent). */
const INTENCION: readonly RegExp[] = [
  p(
    `(?:quiero|quisiera|necesito|deseo|tengo ganas de|me dan ganas de|pienso en|estoy pensando en|he pensado en|voy a) (?:${MORIR_ES})`,
  ),
  p('me (?:quiero|voy a) (?:morir|matar|suicidar|quitar la vida)'),
  p('me (?:matare|suicidare|suicido)'),
  p('no (?:quiero|puedo) (?:vivir|seguir viviendo|seguir con vida)'),
  p('(?:sin|no tengo) ganas de vivir'),
  p('(?:mejor|preferiria) (?:estar|estaria) muert[oa]'),
  p('me (?:corto|he cortado) (?:las venas|los brazos|las munecas)'),
  p(`(?:vull|voldria|necessito|tinc ganes de|penso en|estic pensant en|he pensat en|vaig a) (?:${MORIR_CA})`),
  p('em (?:vull|vaig a) (?:morir|matar|suicidar|treure la vida)'),
  p('em (?:matare|suicidare|suicido)'),
  p('no (?:vull|puc) (?:viure|continuar vivint|seguir vivint)'),
  p('(?:sense|no tinc) ganes de viure'),
];

/** Pedir o dar instrucciones para quitarse la vida (self-harm/instructions). */
const INSTRUCCIONES: readonly RegExp[] = [
  p(`(?:como|forma de|manera de|metodo para) (?:${MORIR_ES}|suicidarse|quitarse la vida)`),
  p(`(?:com|forma de|manera de|metode per) (?:${MORIR_CA}|suicidar se|treure s la vida)`),
];

/** Amenaza en primera persona de matar o agredir a alguien (harassment/threatening). */
const AMENAZA: readonly RegExp[] = [
  p('(?:voy a|vamos a|quiero) (?:matar|apunalar|pegar un tiro) a'),
  p('(?:le|la|lo|les|los|las) (?:voy a|vamos a|quiero) (?:matar|apunalar|pegar un tiro)'),
  p('(?:le|la|lo|les|los|las) (?:matare|mataremos)'),
  p('(?:vaig a|anem a|vull) (?:matar|apunyalar|disparar) a'),
  p('(?:el|la|els|les) (?:vaig a|vull) matar'),
  p('(?:el|la|els|les) matare'),
];

/** Contenido sexual con menores en primera persona (sexual/minors). */
const MENORES: readonly RegExp[] = [
  p('(?:tengo|tener|hago|hacer|busco|quiero) (?:sexo|relaciones sexuales) con (?:menores|ninos|ninas|crios)'),
  p('(?:tinc|tenir|faig|fer|busco|vull) (?:sexe|relacions sexuals) amb (?:menors|nens|nenes)'),
];

const REGLAS: readonly (readonly [string, readonly RegExp[]])[] = [
  ['self-harm/intent', INTENCION],
  ['self-harm/instructions', INSTRUCCIONES],
  ['harassment/threatening', AMENAZA],
  ['sexual/minors', MENORES],
];

/** Las categorías de moderación que marcan las reglas en un texto (con los nombres de la API de moderación). */
export function categoriasLocales(texto: string): string[] {
  const forma = formaDeModerar(texto);
  return REGLAS.filter(([, reglas]) => reglas.some((r) => r.test(forma))).map(([categoria]) => categoria);
}

/** El moderador de reglas: las categorías marcadas cuentan como de puntuación alta. */
const MODERADOR_LOCAL: Moderador = {
  moderar: (texto) => Promise.resolve({ categorias: categoriasLocales(texto) }),
};

/** El aviso con que se para lo escrito (el del 024 si hay riesgo), o null si se puede seguir. */
export async function avisoDeModeracion(texto: string, idioma: Idioma): Promise<Aviso | null> {
  return (await moderarAntesDelModelo(MODERADOR_LOCAL, texto, idioma)).aviso;
}
