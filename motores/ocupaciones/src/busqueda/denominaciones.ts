// Los nombres con que se busca cada ocupación, además de los de ESCO: los títulos del SEPE y la forma completa de los
// títulos partidos por «/».
//
// **Títulos del SEPE (CO-SISPE).** El paquete trae en correspondencia-eures.json la correspondencia oficial de EURES
// entre cada ocupación ESCO y las ocupaciones del Catálogo de Ocupaciones del SISPE (CO-SISPE 2011) del SEPE, con su
// título y el tipo de enlace (© Unión Europea, correspondencia EURES ESCO ↔ CO-SISPE; títulos del SEPE). Son las
// denominaciones que se usan en España («cajeros de comercio», «conductores de camión», «teleoperadores», «médicos
// especialistas en medicina familiar»), que ESCO-es no siempre tiene. Solo se usan los enlaces exactos y estrechos: en
// los cercanos y amplios, el título del SEPE nombra otra ocupación o una más general. Solo sirven para encontrar: lo
// que se enseña sigue siendo el título oficial de ESCO. Los cuatro primeros dígitos del código SISPE son el grupo de la
// CNO-11 del INE.
//
// **Títulos partidos.** «técnico/técnica de alimentación» o «redactor/a de revista» se partían por la «/» y dejaban
// «técnico» o «redactor» como nombre completo de la ocupación: la búsqueda «técnico» la repetía entera y le daba el
// máximo. Aquí cada forma corta se completa con el resto de la larga («técnico de alimentación») y la terminación
// suelta («a de revista») se descarta.

import type { Datos } from '../../../../src/dominio/tipos-paquete.ts';

/** Los enlaces de la correspondencia EURES con que el título del SEPE nombra la misma ocupación ESCO o una más precisa. */
const ENLACES_QUE_NOMBRAN = new Set(['exacta', 'estrecha']);
/** Una terminación de género suelta, que queda al partir «técnico/a» o «redactor/as». */
const TERMINACION_SUELTA = /^(a|as|o|os)$/;
/** Letras de las palabras que se dejan como están («las», «los», «sus»). */
const MAX_LETRAS_SIN_SINGULAR = 3;
/** Cifras del grupo CNO-11 al principio de un código SISPE. */
const CIFRAS_CNO = 4;
/** Palabras en plural que no se pasan a singular. */
const SIN_SINGULAR = /(is|us|ss)$/;

/**
 * Las formas de un título partido por «/», cada una completa: «técnico/técnica de alimentación» da «técnico de
 * alimentación» y «técnica de alimentación»; «redactor/a de revista», «redactor de revista». Un título doble con el
 * mismo número de palabras en cada forma («cajero/cajera») se deja como está.
 *
 * @param titulo - El título del catálogo.
 * @returns Sus formas completas, sin vacías.
 */
export function formasCompletas(titulo: string): string[] {
  const formas = titulo
    .split('/')
    .map((forma) => forma.trim())
    .filter(Boolean);
  const larga = formas.reduce(
    (mayor, forma) => (forma.split(/\s+/).length > mayor.split(/\s+/).length ? forma : mayor),
    '',
  );
  const palabrasDeLaLarga = larga.split(/\s+/);
  const completas: string[] = [];
  for (const forma of formas) {
    const palabras = forma.split(/\s+/);
    if (TERMINACION_SUELTA.test(palabras[0] as string)) {
      continue;
    }
    completas.push(
      palabras.length === 1 && palabrasDeLaLarga.length > 1 ? [forma, ...palabrasDeLaLarga.slice(1)].join(' ') : forma,
    );
  }
  return completas;
}

/**
 * Una palabra en plural, en singular: «cajeros» → «cajero», «conductores» → «conductor», «pisos» → «piso». Las palabras
 * vacías («de», «en», «y»…) no acaban en «s», salvo las que se dejan por SIN_SINGULAR o son cortas («las», «los»).
 */
function enSingular(palabra: string): string {
  if (palabra.length <= MAX_LETRAS_SIN_SINGULAR || SIN_SINGULAR.test(palabra) || !palabra.endsWith('s')) {
    return palabra;
  }
  // Tras l, n, r, d, j o y, el plural añade «es» («conductores», «peones», «redes»); tras vocal u otra consonante, «s»
  // («cajeros», «jefes», «agentes»); «ces» viene de «z» («capataces»).
  if (/[lnrdjy]es$/.test(palabra)) {
    return palabra.slice(0, -2);
  }
  if (palabra.endsWith('ces')) {
    return `${palabra.slice(0, -'ces'.length)}z`;
  }
  return palabra.slice(0, -1);
}

/**
 * Un título del SEPE como nombre de búsqueda: en minúsculas, sin «, en general», sin las aclaraciones entre paréntesis
 * ni las excepciones («, excepto…»), con «y/o» como «y», y en singular, porque el SEPE titula en plural («CAMAREROS DE
 * PISOS» → «camarero de piso»).
 *
 * @param titulo - El título del SEPE.
 * @returns El nombre preparado, o una cadena vacía si no queda nada.
 */
export function nombreDelSepe(titulo: string): string {
  return enPluralDelSepe(titulo).split(/\s+/).filter(Boolean).map(enSingular).join(' ');
}

/**
 * Un título del SEPE limpio, en el plural en que lo escribe el SEPE: la misma limpieza que nombreDelSepe, sin pasar a
 * singular. Solo se indexa el singular: el plural metería en el vocabulario raíces cortas de plurales («moz», «cas»)
 * que la forma común no iguala con su singular (palabras.ts), y en el banco de desarrollo no aporta nada.
 *
 * @param titulo - El título del SEPE.
 * @returns El nombre preparado, en plural.
 */
function enPluralDelSepe(titulo: string): string {
  return titulo
    .toLocaleLowerCase('es')
    .replace(/\([^)]*\)?/gu, ' ')
    .replace(/,?\s*excepto\b.*$/u, '')
    .replace(/,?\s*en general\b/gu, ' ')
    .replace(/\by\/o\b/gu, 'y')
    .replace(/-/gu, ' ')
    .replace(/[.,]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Lo que el SEPE dice de una ocupación ESCO: sus títulos como nombres de búsqueda y sus grupos CNO-11. */
export interface DelSepe {
  /** Sus títulos, en singular (nombreDelSepe). */
  nombres: string[];
  /** Grupos CNO-11 de 4 cifras: los primeros dígitos de sus códigos SISPE. */
  cno11: string[];
}

/** Lo del SEPE de cada paquete, preparado una vez. */
const sepePorDatos = new WeakMap<Datos, ReadonlyMap<string, DelSepe>>();

/**
 * Los títulos del SEPE y los grupos CNO-11 de cada ocupación ESCO, de los enlaces exactos y estrechos de la
 * correspondencia EURES. Vacío si el paquete no trae correspondencia-eures.json.
 *
 * @param datos - El paquete de datos.
 * @returns Código ESCO → sus nombres del SEPE (sin repetir) y sus grupos CNO-11 (sin repetir, en orden).
 */
export function delSepe(datos: Datos): ReadonlyMap<string, DelSepe> {
  const guardado = sepePorDatos.get(datos);
  if (guardado) {
    return guardado;
  }
  const porOcupacion = new Map<string, DelSepe>();
  for (const [esco, enlaces] of Object.entries(datos.eures?.ocupaciones ?? {})) {
    const deEsta = datos.esco.ocupaciones[esco] ? deLosEnlaces(enlaces) : null;
    if (deEsta && (deEsta.nombres.length || deEsta.cno11.length)) {
      porOcupacion.set(esco, deEsta);
    }
  }
  sepePorDatos.set(datos, porOcupacion);
  return porOcupacion;
}

/** Los enlaces EURES de una ocupación, como los guarda correspondencia-eures.json: código SISPE, relación y título. */
type Enlaces = NonNullable<Datos['eures']>['ocupaciones'][string];

/** Los nombres y los grupos CNO-11 de los enlaces que nombran la ocupación (ENLACES_QUE_NOMBRAN). */
function deLosEnlaces(enlaces: Enlaces): DelSepe {
  const nombres = new Set<string>();
  const cno11 = new Set<string>();
  for (const [codigo, , titulo] of enlaces.filter(([, relacion]) => ENLACES_QUE_NOMBRAN.has(relacion))) {
    nombres.add(nombreDelSepe(titulo));
    if (/^\d{4}/.test(codigo)) {
      cno11.add(codigo.slice(0, CIFRAS_CNO));
    }
  }
  nombres.delete('');
  return { nombres: [...nombres], cno11: [...cno11] };
}
