// Etiquetas léxicas del nombre oficial del curso, en castellano o catalán, para clasificar las fichas factuales.
// Distinguen prevención, habilitaciones, idiomas, IA, competencias digitales, iniciación y restricciones.
// Son reglas de clasificación del título; no acreditan por sí solas requisitos ni disponibilidad.

/** Lo que dice el nombre de un curso. */
type EtiquetaFormacion =
  | 'prevencion'
  | 'habilitacion'
  | 'idioma'
  | 'ia'
  | 'digital'
  | 'iniciacion'
  | 'colectivo'
  | 'otro-territorio'
  | 'desfasada';

/** Una palabra o expresión entera: sin letras ni cifras pegadas delante o detrás (también con tildes). */
function entera(fuente: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${fuente})(?![\\p{L}\\p{N}])`, 'iu');
}

/** Las reglas, en castellano y en catalán. Un nombre puede llevar varias etiquetas. */
const REGLAS: readonly (readonly [EtiquetaFormacion, RegExp])[] = [
  [
    'prevencion',
    entera(
      'prevenci[oó]n? de r(?:iesgos|iscos)|riesgos laborales|riscos laborals|prl|renovaci[oó]n?(?! energ)|actualizaci[oó]n de carn[eé]t?',
    ),
  ],
  // Los cursos de prevención de los convenios se llaman «C.13. Talleres…»; en el Consorci, a veces con «: » delante.
  ['prevencion', /^[\s:]*c\.\s?\d/iu],
  // «Reciclaje» es prevención cuando es el reciclaje de un curso obligatorio, no el de residuos o materiales
  // («Gestión de residuos y reciclaje»).
  [
    'prevencion',
    /^(?!.*(?:residu|envas|env[aà]s|pl[aà]stic|vidr|papel|paper|cart[oó]n|materia))(?=.*(?<![\p{L}\p{N}])(?:formaci[oó]n de reciclaje|reciclaje en|reciclatge (?:de|en))(?![\p{L}\p{N}]))/iu,
  ],
  ['prevencion', /^(?!.*(?:residu|envas|env[aà]s|pl[aà]stic|vidr|papel|paper|cart[oó]n|materia)).*reciclaje\.?$/iu],
  [
    'habilitacion',
    entera(
      'adr|cap|carn[eé]t?|permiso de conducir|tac[oó]grafo|carretill(?:a|as|es)|carretons? elevadors?|plataformas? elevadoras?|gr[uú]as?|pont grua|manipulador(?:es|a)? de alimentos|fitosanitari(?:o|os|s)|legionel·?la|mercanc[ií]as peligrosas|mercaderies perilloses',
    ),
  ],
  [
    'idioma',
    entera(
      'ingl[eé]s|franc[eé]s|alem[aá]n|italiano|portugu[eé]s|ruso|chino|japon[eé]s|[aá]rabe|catal[aá]n|angl[eè]s|franc[eè]s|alemany|itali[aà]|portugu[eè]s|rus|xin[eè]s|japon[eè]s|[aà]rab|catal[aà]|lenguas? extranjeras?|lleng(?:ua|ües) estrangeres?|lengua de signos|llengua de signes',
    ),
  ],
  [
    'ia',
    entera(
      'inteligencia artificial|intel·lig[eè]ncia artificial|ia generativa|chatgpt|copilot|machine[ -]learning|deep learning|aprendizaje autom[aá]tico|aprenentatge autom[aà]tic',
    ),
  ],
  // «IA» suelta, salvo la errata del catálogo «INDUSTR IA».
  ['ia', /(?<![\p{L}\p{N}])(?<!industr )ia(?![\p{L}\p{N}])/iu],
  [
    'digital',
    entera(
      'digital(?:es|s)?|ofim[aá]tica|ofim[aà]tica|excel|word|powerpoint|actic|ciberseguridad|ciberseguretat|internet|inform[aá]tica|inform[aà]tica',
    ),
  ],
  [
    'iniciacion',
    entera(
      'b[aá]sic[oa]s?|b[aà]sica?|b[aà]siques|iniciaci[oó]n?|introducci[oó]n?|elemental|nivel inicial|primeros pasos|operaciones auxiliares|actividades auxiliares|tareas auxiliares|operacions auxiliars|activitats auxiliars',
    ),
  ],
  // «Auxiliar» al comienzo del título es una etiqueta léxica, no un nivel acreditado.
  ['iniciacion', /^[\s:]*auxiliar/iu],
  [
    'colectivo',
    entera(
      'para (?:personas|persones) (?:con|amb) discapacidad|per a persones amb discapacitat|para (?:j[oó]venes|mujeres|inmigrantes|personas desempleadas|desempleados)|lectura (?:f[aá]cil|accesible)|inserci[oó]n (?:socio)?laboral|orientaci[oó]n sociolaboral',
    ),
  ],
  // «Atención a personas con discapacidad» es un curso para quien las atiende, no para un colectivo; y la versión
  // «(accesible)» por sí solo no señala un colectivo de admisión.
  // Lenguas y costumbres de otro territorio. La cocina de otra región es contenido, no elegibilidad: «Cocina
  // gallega» le
  // puede servir a un cocinero de aquí.
  ['otro-territorio', entera('euskera|gallego|galego|escanciad(?:o|or|ora)|sidra')],
  [
    'otro-territorio',
    /(?<!(?:cocina|cuina|gastronom[ií]a|reposter[ií]a|productos?|productes|vinos?|vins?)\s)(?<![\p{L}\p{N}])(?:andaluz|andaluza|aragon[eé]s|aragonesa|asturian[oa]|gallega)(?![\p{L}\p{N}])/iu,
  ],
  ['desfasada', entera('covid(?:-?19)?|coronavirus|sars-cov-2|post-?covid(?:-?19)?|crisis sanitaria')],
];

/**
 * Las etiquetas de un curso por su nombre.
 *
 * @param nombre - El nombre oficial, en castellano o en catalán, en mayúsculas o no.
 * @returns Sus etiquetas, sin repetir.
 */
export function etiquetasDe(nombre: string): Set<EtiquetaFormacion> {
  const etiquetas = new Set<EtiquetaFormacion>();
  for (const [etiqueta, regla] of REGLAS) {
    if (regla.test(nombre)) {
      etiquetas.add(etiqueta);
    }
  }
  return etiquetas;
}
