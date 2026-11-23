// Los datos que identifican por sí solos, con la forma que tienen: correos, teléfonos (también escritos con palabras),
// documentos de identidad, cuentas bancarias, tarjetas de pago, números de la Seguridad Social, enlaces con ruta y
// usuarios de redes.
// Cada uno se cambia por una marca que dice qué era («[teléfono eliminado]»). Los usa la limpieza de datos personales
// (privacidad.ts), que decide el orden.
//
// El número de la Seguridad Social (número de afiliación) son dos cifras de la provincia, el número (siete u ocho
// cifras) y dos de control, escrito junto o con espacios, barras, puntos o guiones («28/12345678/40»). Se quita de dos
// maneras:
//   - tras «Seguridad Social» o «Seguretat Social», «NUSS», «NSS», «NAF», «número de afiliación» o «número
//     d'afiliació», cualquier grupo de 10 a 12 cifras, aunque el control no cuadre (una errata no debe dejarlo pasar).
//     Así, «tramito 150 altas en la Seguridad Social» no pierde nada: hacen falta diez cifras seguidas;
//   - sin esas palabras, solo si el número es de verdad uno de afiliación: provincia del 01 al 53 y dígitos de control
//     correctos (el resto de dividir entre 97). Una cifra cualquiera de doce dígitos lo cumple una vez de cada cien.

import type { Limpieza } from './limpieza.ts';

/** Números escritos con palabras (castellano y catalán): siete o más seguidos se tratan como un teléfono. */
const CIFRA = '(?:cero|zero|uno|una|un|u|dos|tres|cuatro|quatre|cinco|cinc|seis|sis|siete|set|ocho|vuit|nueve|nou)';

/**
 * Lo que «\w» es en ASCII, para cualquier letra: letras de cualquier alfabeto con sus acentos (también un acento que
 * no se ha juntado con su letra), cifras, «_» y el punto volado de la ele geminada catalana («col·legi.cat»). Es lo que
 * forma el nombre de un correo o de un dominio: «\w» sin la bandera «u» es solo ASCII, se para en la primera letra con
 * acento y de «josé.garcía@gmail.com» quitaría «a@gmail.com»: «josé.garcí» llegaría al proveedor.
 */
const LETRA = String.raw`\p{L}\p{M}\p{Nd}_·`;
/** Letras y signos de la parte local literal: atext (RFC 5322, §3.2.3), puntos y letras Unicode ya admitidas. */
const LOCAL_DEL_CORREO = `${LETRA}.!#$%&'*+/=?^\`{|}~-`;
/** Una palabra entera: ni antes ni después hay otra LETRA (lo que es «\b» en ASCII). */
function palabra(texto: string): string {
  return `(?<![${LETRA}])${texto}(?![${LETRA}])`;
}
/** El punto de un correo dicho con palabras, en castellano, en catalán o en inglés. */
const PUNTO = String.raw`(?:\.|\(dot\)|\[dot\]|${palabra('(?:punto|punt|dot)')})`;

/** Lo que va antes de la arroba en un correo dicho con palabras: hasta siete partes unidas por PUNTO. */
const ANTES_DE_LA_ARROBA = String.raw`(?<![${LETRA}.+-])[${LETRA}+-]{1,64}(?:\s*${PUNTO}\s*[${LETRA}+-]{1,64}){0,6}`;
/** La arroba dicha: «(at)», «[at]», «arroba» o «arrova». */
const ARROBA_DICHA = String.raw`(?:\(at\)|\[at\]|${palabra('(?:arroba|arrova)')})`;
/** El dominio de primer nivel de un correo dicho: solo los conocidos («arroba» también es una unidad de peso). */
const DOMINIO_CONOCIDO = palabra('(?:com|es|cat|org|net|eu|info|me|io)');

/** Las etiquetas de un dominio, unidas por puntos: hasta 127, de hasta 253 caracteres cada una (cotas de reconocimiento). */
const ETIQUETAS_DEL_DOMINIO = String.raw`[${LETRA}-]{1,253}(?:\.[${LETRA}-]{1,253}){0,126}`;

/** Las cifras de una tarjeta de pago: de 13 a 19, sus longitudes (ISO/IEC 7812-1 fija el tope de 19). */
const MIN_CIFRAS_DE_TARJETA = 13;
/** El máximo de cifras de una tarjeta (véase MIN_CIFRAS_DE_TARJETA). */
const MAX_CIFRAS_DE_TARJETA = 19;
/** Las cifras del código de seguridad que se escribe tras la tarjeta: 3 (CVV, CVC) o 4 (CID de American Express). */
const MIN_CIFRAS_DEL_CODIGO = 3;
/** El máximo de cifras del código de seguridad (véase MIN_CIFRAS_DEL_CODIGO). */
const MAX_CIFRAS_DEL_CODIGO = 4;
/** Las cifras de un grupo de una tarjeta escrita con puntos («4111.1111.1111.1111»). */
const CIFRAS_POR_GRUPO = 4;

/** Un punto entre dos grupos de CIFRAS_POR_GRUPO cifras, como en «4111.1111.1111.1111». */
const PUNTO_ENTRE_GRUPOS = String.raw`(?<=(?<!\d)\d{${CIFRAS_POR_GRUPO}})\.(?=\d{${CIFRAS_POR_GRUPO}}(?!\d))`;
/**
 * Lo que separa dos grupos de cifras de una tarjeta: un espacio de cualquier anchura (también el fino y el de no
 * separación), un guion de cualquier tipo o, solo entre dos grupos de CIFRAS_POR_GRUPO cifras, un punto. Un punto entre
 * grupos de otra medida es el de un número de versión («10.0.19045.3803») o el de los millares, no el de una tarjeta.
 */
const SEPARADOR_DE_GRUPOS = String.raw`(?:[\p{Zs}\p{Pd}]|${PUNTO_ENTRE_GRUPOS})`;
/** La marca que deja un teléfono quitado. */
const MARCA_DE_TELEFONO = '[teléfono eliminado]';
/** El prefijo de España delante de un teléfono, si lo lleva. */
const PREFIJO_DE_ESPANA = String.raw`(?:(?:\+|00)\s?34[\s.-]?)?`;
/** Un teléfono de nueve cifras que empieza por 6, 7, 8 o 9, juntas o con un separador entre cada dos. */
const NUEVE_CIFRAS_DE_TELEFONO = String.raw`\b[6789](?:[\s.-]?\d){8}\b`;
/**
 * Un teléfono, salvo donde es la cola de una American Express (4-6-5) con su código de cuatro cifras detrás: tras un
 * grupo de cuatro cifras y otro de seis, cinco cifras y cuatro («3782 822463 70009 1234») tienen la forma de un
 * teléfono. Ahí lo leen antes las tarjetas, que la quitan entera, con su código; lo que no sea una tarjeta lo quita
 * después TELEFONO_TRAS_LAS_TARJETAS.
 */
const TELEFONO = new RegExp(
  String.raw`${PREFIJO_DE_ESPANA}(?!(?<=\b\d{4}[ -]\d{6}[ -])\d{5}[ -]\d{4}\b)${NUEVE_CIFRAS_DE_TELEFONO}`,
  'g',
);
/** Los teléfonos que quedan tras quitar las tarjetas: los que TELEFONO deja para ellas. */
const TELEFONO_TRAS_LAS_TARJETAS = new RegExp(`${PREFIJO_DE_ESPANA}${NUEVE_CIFRAS_DE_TELEFONO}`, 'g');
/**
 * Una tarjeta escrita como se suele escribir: de MIN_CIFRAS_DE_TARJETA a MAX_CIFRAS_DE_TARJETA cifras, juntas o en
 * grupos separados por un espacio o un guion (grupo `tarjeta`) y, si va pegado detrás, el código de seguridad: un
 * espacio o un guion y sus cifras, al final de la serie.
 */
const TARJETA_ESCRITA = new RegExp(
  String.raw`(?<![\d\p{L}])` +
    String.raw`(?<tarjeta>\d(?:[ -]?\d){${MIN_CIFRAS_DE_TARJETA - 1},${MAX_CIFRAS_DE_TARJETA - 1}})(?![\d\p{L}])` +
    String.raw`(?:[ -]\d{${MIN_CIFRAS_DEL_CODIGO},${MAX_CIFRAS_DEL_CODIGO}}(?![\d\p{L}])(?![ -]\d))?`,
  'gu',
);
/**
 * Una serie de cifras con forma de tarjeta: MIN_CIFRAS_DE_TARJETA o más, juntas o en grupos con un separador entre cada
 * dos (SEPARADOR_DE_GRUPOS). La serie no tiene tope: una tarjeta seguida de su código («4111 1111 1111 1111 123») o de
 * otra tarjeta forma una serie de más de MAX_CIFRAS_DE_TARJETA cifras, y quitarTarjetasDeLaSerie busca dentro. El
 * coste es lineal: cada vuelta toma una sola cifra, con un separador como mucho delante, así que una serie se lee de
 * una sola manera.
 */
const SERIE_CON_FORMA_DE_TARJETA = new RegExp(
  String.raw`(?<![\d\p{L}])\d(?:${SEPARADOR_DE_GRUPOS}?\d){${MIN_CIFRAS_DE_TARJETA - 1},}(?![\d\p{L}])`,
  'gu',
);
/** Una cifra; con la bandera `g`, todas las de la tarjeta. */
const CIFRA_DE_LA_TARJETA = /\d/g;
/** Un grupo de cifras seguidas; con la bandera `g`, todos los de la serie. */
const GRUPO_DE_LA_SERIE = /\d+/g;
/** La marca que deja una tarjeta quitada. */
const MARCA_DE_TARJETA = '[tarjeta eliminada]';
/** La mayor cifra decimal: una cifra doblada que la pasa vale la suma de sus dos cifras (doblada − 9). */
const MAYOR_CIFRA = 9;
/** La base de las cifras: con el control de Luhn, la suma acaba en 0 en base 10. */
const BASE_DECIMAL = 10;

/** Un grupo de cifras seguidas de la serie: dónde empieza y acaba (en caracteres de la serie) y sus cifras. */
interface GrupoDeCifras {
  readonly inicio: number;
  readonly fin: number;
  readonly cifras: string;
}

/** Una cifra doblada en el control de Luhn: el doble o, si pasa de MAYOR_CIFRA, la suma de sus dos cifras. */
function doblada(cifra: number): number {
  return cifra * 2 > MAYOR_CIFRA ? cifra * 2 - MAYOR_CIFRA : cifra * 2;
}

/**
 * El control de Luhn (ISO/IEC 7812-1, anexo B: cada segunda cifra desde la derecha se dobla, y la suma acaba en 0)
 * llevado cifra a cifra, de izquierda a derecha, con dos sumas: una dobla las cifras de lugar par (contando desde 0) y
 * la otra las de lugar impar. Con un total par de cifras, las que se doblan son las de lugar par; con uno impar, las de
 * lugar impar. Así, alargar la serie un grupo cuesta lo que sus cifras, sin volver a sumar las anteriores.
 */
interface SumasDeLuhn {
  readonly doblandoPares: number;
  readonly doblandoImpares: number;
  readonly leidas: number;
}
/** Las sumas de Luhn antes de leer ninguna cifra. */
const SIN_CIFRAS: SumasDeLuhn = { doblandoPares: 0, doblandoImpares: 0, leidas: 0 };

/** Las sumas de Luhn con una cifra más a la derecha. */
function conLaCifra(sumas: SumasDeLuhn, cifra: number): SumasDeLuhn {
  const lugarPar = sumas.leidas % 2 === 0;
  return {
    doblandoPares: sumas.doblandoPares + (lugarPar ? doblada(cifra) : cifra),
    doblandoImpares: sumas.doblandoImpares + (lugarPar ? cifra : doblada(cifra)),
    leidas: sumas.leidas + 1,
  };
}

/** Si las cifras leídas cumplen el control de Luhn (véase SumasDeLuhn). */
function cumpleLuhn(sumas: SumasDeLuhn): boolean {
  const suma = sumas.leidas % 2 === 0 ? sumas.doblandoPares : sumas.doblandoImpares;
  return suma % BASE_DECIMAL === 0;
}

/**
 * La tarjeta que empieza en el grupo `desde`: los grupos seguidos, de MIN_CIFRAS_DE_TARJETA a MAX_CIFRAS_DE_TARJETA
 * cifras entre todos, que cumplen el control de Luhn. Sin el control, cualquier serie larga de cifras del oficio (una
 * referencia, un lote) se tomaría por una tarjeta.
 *
 * @returns El índice del último grupo de la más larga, o -1 si ninguna cumple.
 */
function finDeLaTarjeta(grupos: readonly GrupoDeCifras[], desde: number): number {
  let sumas = SIN_CIFRAS;
  let fin = -1;
  for (let hasta = desde; hasta < grupos.length; hasta += 1) {
    for (const caracter of grupos[hasta]?.cifras ?? '') {
      sumas = conLaCifra(sumas, Number(caracter));
    }
    if (sumas.leidas > MAX_CIFRAS_DE_TARJETA) {
      return fin;
    }
    if (sumas.leidas >= MIN_CIFRAS_DE_TARJETA && cumpleLuhn(sumas)) {
      fin = hasta;
    }
  }
  return fin;
}

/**
 * Quita la tarjeta que encuentra TARJETA_ESCRITA, con el código pegado detrás si lo hay, si sus cifras cumplen el
 * control de Luhn; si no, la deja como está.
 *
 * @param hallazgo - Lo que ha encontrado TARJETA_ESCRITA, con el grupo `tarjeta`.
 * @param marca - La marca que sustituye la tarjeta.
 * @returns La marca, o lo encontrado tal cual, y cuántas tarjetas se han quitado.
 */
function quitarSiCumpleElControl(hallazgo: RegExpExecArray, marca: string): Limpieza {
  const cifras = hallazgo.groups?.tarjeta?.match(CIFRA_DE_LA_TARJETA) ?? [];
  const sumas = cifras.reduce((hechas, cifra) => conLaCifra(hechas, Number(cifra)), SIN_CIFRAS);
  return cumpleLuhn(sumas) ? { texto: marca, eliminados: 1 } : { texto: hallazgo[0], eliminados: 0 };
}

/** Si el grupo `indice` es el último de la serie y tiene las cifras de un código de seguridad. */
function esElCodigoFinal(grupos: readonly GrupoDeCifras[], indice: number): boolean {
  const cifras = grupos[indice]?.cifras.length ?? 0;
  return indice === grupos.length - 1 && cifras >= MIN_CIFRAS_DEL_CODIGO && cifras <= MAX_CIFRAS_DEL_CODIGO;
}

/**
 * Quita las tarjetas de una serie con forma de tarjeta (SERIE_CON_FORMA_DE_TARJETA). Se recorre la serie grupo a grupo:
 * desde cada uno, la tarjeta más larga que cumple el control (finDeLaTarjeta), que se cambia por la marca, y se sigue
 * tras ella; así, de «4111 1111 1111 1111 123» (diecinueve cifras que no cumplen el control) se quita la tarjeta, y de
 * «12 4111 1111 1111 1111», también. Si la serie entera es una tarjeta, se quita entera. Con la tarjeta se va, por
 * prudencia, el código de seguridad que la sigue pegado: el último grupo de la serie, si va justo tras ella y tiene de
 * MIN_CIFRAS_DEL_CODIGO a MAX_CIFRAS_DEL_CODIGO cifras. Lo demás se queda como estaba.
 *
 * @param hallazgo - La serie con forma de tarjeta que ha encontrado SERIE_CON_FORMA_DE_TARJETA.
 * @param marca - La marca que sustituye cada tarjeta.
 * @returns La serie con cada tarjeta cambiada por la marca, y cuántas se han quitado.
 */
function quitarTarjetasDeLaSerie(hallazgo: RegExpExecArray, marca: string): Limpieza {
  const [serie] = hallazgo;
  const grupos: readonly GrupoDeCifras[] = Array.from(serie.matchAll(GRUPO_DE_LA_SERIE), (grupo) => ({
    inicio: grupo.index,
    fin: grupo.index + grupo[0].length,
    cifras: grupo[0],
  }));
  let texto = '';
  let copiado = 0;
  let eliminados = 0;
  let desde = 0;
  while (desde < grupos.length) {
    const fin = finDeLaTarjeta(grupos, desde);
    if (fin < 0) {
      desde += 1;
      continue;
    }
    const ultimo = esElCodigoFinal(grupos, fin + 1) ? fin + 1 : fin;
    texto += serie.slice(copiado, grupos[desde]?.inicio) + marca;
    copiado = grupos[ultimo]?.fin ?? serie.length;
    eliminados += 1;
    desde = ultimo + 1;
  }
  return { texto: texto + serie.slice(copiado), eliminados };
}

/**
 * Un dato con forma fija: lo que lo encuentra, la marca que lo sustituye y, si hace falta, la función que decide qué
 * parte de cada hallazgo (con sus grupos) se cambia por la marca (sin ella, se cambia todo lo que encaja).
 */
interface Sustitucion {
  readonly patron: RegExp;
  readonly marca: string;
  readonly quitarDe?: (hallazgo: RegExpExecArray, marca: string) => Limpieza;
}

/**
 * Cambia cada hallazgo de una sustitución por su marca, o por lo que decida su `quitarDe`, de izquierda a derecha y sin
 * solaparse (como `String.prototype.replace` con un patrón global).
 *
 * @param texto - El texto que se limpia.
 * @param sustitucion - El patrón (con la bandera `g`), la marca y, si la hay, la función que decide qué se quita.
 * @returns El texto con lo quitado cambiado por la marca, y cuántos datos se han quitado.
 */
function sustituir(texto: string, { patron, marca, quitarDe }: Sustitucion): Limpieza {
  let limpio = '';
  let copiado = 0;
  let eliminados = 0;
  for (const hallazgo of texto.matchAll(patron)) {
    const hecho = quitarDe === undefined ? { texto: marca, eliminados: 1 } : quitarDe(hallazgo, marca);
    limpio += texto.slice(copiado, hallazgo.index) + hecho.texto;
    copiado = hallazgo.index + hallazgo[0].length;
    eliminados += hecho.eliminados;
  }
  return { texto: limpio + texto.slice(copiado), eliminados };
}

// Correos y enlaces, con el coste acotado: cada repetición lleva tope («{1,253}», nunca «+» cuando le sigue algo) y
// cada patrón empieza anclado al principio de la cadena de caracteres («(?<![LETRA.+-])», la misma clase con que
// empieza el patrón). Sin las dos cosas, el patrón prueba cada posición del texto y retrocede dentro de cada una: el
// coste crece con el cuadrado del texto (44 ms con 4.000 caracteres de «a-a.a-a…», MAX_RELATO, frente a 0,05 ms con
// las dos), y la limpieza se llama cuatro veces por petición en un Worker con 10 ms de CPU. Las cotas limitan el
// coste del reconocimiento; no validan la longitud canónica de un dominio DNS. El detector conserva
// estos topes y las formas que reconoce: partes locales literales con letras Unicode, puntos y signos de atext, y los
// dominios con punto de los patrones. No valida ni reconoce toda la sintaxis de RFC 5322: quedan fuera las partes
// locales entre comillas, las formas obsoletas y los dominios literales. El ancla evita empezar dentro de la cadena;
// las letras de cualquier alfabeto (LETRA) permiten quitar entero un correo o dominio con acentos, «ñ» o «ç».
//
// Las tarjetas, en dos pasadas: primero la tarjeta escrita como se suele escribir (TARJETA_ESCRITA), que se quita si
// cumple el control; después, en lo que queda, la tarjeta dentro de una serie más larga o con otros separadores
// (SERIE_CON_FORMA_DE_TARJETA). La segunda solo ve las cifras que deja la primera, así que no cambia nada de lo que la
// primera quita.
//
// Las tarjetas van tras los teléfonos: dos teléfonos seguidos («964990873 0034 859-009-000») suman las cifras de una
// tarjeta y, si la serie cumple el control, se quitarían como tarjeta hasta donde cuadra y quedaría el resto («-000»).
// Un teléfono no puede comerse parte de una tarjeta escrita como se escriben (juntas o en grupos de 4, 4-6-5 o
// 4-6-4): ninguna suma de grupos seguidos da las nueve cifras, entre límites de palabra, que pide el teléfono. Con el
// código de cuatro cifras detrás, una American Express sí las da (5 + 4), y TELEFONO no lee un teléfono ahí (véase
// TELEFONO y TELEFONO_TRAS_LAS_TARJETAS).
const SUSTITUCIONES: readonly Sustitucion[] = [
  {
    patron: new RegExp(
      String.raw`(?<![${LOCAL_DEL_CORREO}])[${LOCAL_DEL_CORREO}]{1,253}@[${LETRA}-]{1,253}\.[${LETRA}.-]+`,
      'gu',
    ),
    marca: '[correo eliminado]',
  },
  // «arroba» también es una unidad de peso («cobro por arroba de aceituna»): solo cuenta si acaba en un dominio real.
  // Las partes del correo antes de la arroba también pueden ir dichas con palabras («nuria punto gil arroba…», «laia
  // [dot] roca [at]…»): se quitan todas, o el nombre de la persona se quedaría delante de la marca.
  {
    patron: new RegExp(
      String.raw`${ANTES_DE_LA_ARROBA}\s*${ARROBA_DICHA}\s*[${LETRA}-]{1,253}\s*${PUNTO}\s*${DOMINIO_CONOCIDO}`,
      'giu',
    ),
    marca: '[correo eliminado]',
  },
  { patron: /\bES\s?\d{2}(?:[\s-]?\d{4}){5}\b/gi, marca: '[cuenta eliminada]' },
  // Una cuenta de otro país de la zona SEPA: dos letras del país en mayúsculas, dos cifras de control y de 10 a 30
  // letras o cifras, juntas o en grupos de cuatro («FR76 3000 6000 0112 3456 7890 189»).
  { patron: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, marca: '[cuenta eliminada]' },
  { patron: /\b[XYZ][\s.-]?\d{7}[\s.-]?[A-Z]\b/gi, marca: '[documento eliminado]' },
  { patron: /\b\d(?:[\s.-]?\d){7}[\s.-]?[A-HJ-NP-TV-Z]\b/gi, marca: '[documento eliminado]' },
  { patron: TELEFONO, marca: MARCA_DE_TELEFONO },
  { patron: TARJETA_ESCRITA, marca: MARCA_DE_TARJETA, quitarDe: quitarSiCumpleElControl },
  { patron: SERIE_CON_FORMA_DE_TARJETA, marca: MARCA_DE_TARJETA, quitarDe: quitarTarjetasDeLaSerie },
  { patron: TELEFONO_TRAS_LAS_TARJETAS, marca: MARCA_DE_TELEFONO },
  { patron: new RegExp(`\\b${CIFRA}(?:[\\s,.-]+${CIFRA}){6,}\\b`, 'gi'), marca: MARCA_DE_TELEFONO },
  // Enlaces: solo los que tienen ruta (perfiles, páginas personales). «Publico en www.idealista.com» no es un dato
  // personal.
  {
    patron: new RegExp(String.raw`\b(?:https?:\/\/|www\.)[${LETRA}.-]{1,253}\.\p{L}{2,63}\/[^\s,;)]+`, 'giu'),
    marca: '[enlace eliminado]',
  },
  {
    patron: new RegExp(
      String.raw`(?<![${LETRA}.-])\.?${ETIQUETAS_DEL_DOMINIO}\.(?:com|es|cat|org|net|eu)\/[^\s,;)]+`,
      'giu',
    ),
    marca: '[enlace eliminado]',
  },
  { patron: /(?<![\w.])@[A-Za-z0-9_]{3,}\b/g, marca: '[usuario eliminado]' },
];

/** Lo que anuncia una cuenta o una tarjeta, en castellano y en catalán. */
const ANUNCIOS_DE_CUENTA: readonly string[] = [
  'iban',
  'n[uú]mero de cuenta',
  'cuenta bancaria',
  'compte bancari',
  'n[uú]mero de compte',
  'n[uú]mero de tarjeta',
  'n[uú]mero de targeta',
];
/**
 * Una cuenta troceada con palabras en medio («ES58 1234, luego va 5678-0101…») no la atrapa ningún patrón: tras
 * «IBAN», «número de cuenta», «cuenta bancaria» o «número de tarjeta», se borran los grupos de cifras hasta el final de
 * la frase, pero solo si de verdad hay una cuenta: un «ES» con dos cifras o al menos MIN_CIFRAS_CUENTA cifras. Así, una
 * contable que escribe «reviso el IBAN de los proveedores y cuadro 1500 movimientos» no pierde nada.
 */
const CONTEXTO_CUENTA = new RegExp(String.raw`\b(${ANUNCIOS_DE_CUENTA.join('|')})\b[^.\n]{0,160}`, 'gi');
/** Un «ES» con sus dos cifras de control: el principio de una cuenta española. */
const ES_Y_CONTROL = /\bES\s?\d{2}\b/i;
/** Un grupo de cifras de una cuenta, con el país delante si lo lleva: lo que se borra del tramo. */
const GRUPO_DE_CUENTA = /\b(?:[A-Z]{2}\s?)?\d[\d\s-]{2,}\d\b/gi;
/** Una cifra; con la bandera `g`, todas las del tramo. */
const UNA_CIFRA = /\d/g;
/** Cifras a partir de las cuales un tramo tras «IBAN» o «número de tarjeta» se trata como una cuenta. */
const MIN_CIFRAS_CUENTA = 16;

/** La marca que deja un número de afiliación quitado. */
const MARCA_DE_AFILIACION = '[número de la Seguridad Social eliminado]';

/** Las palabras que anuncian un número de afiliación, en castellano y en catalán. */
const ANUNCIOS_DE_AFILIACION: readonly string[] = [
  String.raw`seguridad\s+social`,
  String.raw`seguretat\s+social`,
  String.raw`n[uú]mero\s+de\s+afiliaci[oó]n`,
  String.raw`n[uú]mero\s+d['’]afiliaci[oó]`,
  'nuss',
  'nss',
  'naf',
];
/**
 * Lo que anuncia el número, en castellano y en catalán, y lo que lo sigue hasta el final de la frase (un punto entre
 * cifras no la acaba: «28.12345678.40»).
 */
const CONTEXTO_AFILIACION = new RegExp(
  String.raw`(?<!\p{L})(?:${ANUNCIOS_DE_AFILIACION.join('|')})(?!\p{L})(?:[^.\n]|\.(?=\d)){0,80}`,
  'giu',
);
/** Un grupo de 10 a 12 cifras, con un separador como mucho entre cada dos. */
const GRUPO_DE_CIFRAS = /(?<!\d)\d(?:[\s/.-]?\d){9,11}(?!\d)/g;
/** Un número con la forma de uno de afiliación: provincia, número y control, cada parte en su grupo. */
const CON_FORMA_DE_AFILIACION = /(?<![\d\p{L}])(\d{2})[\s/.-]?(\d{7,8})[\s/.-]?(\d{2})(?![\d\p{L}])/gu;

/** La primera provincia de la Seguridad Social: el 01 (Álava). */
const PRIMERA_PROVINCIA = 1;
/** La última provincia de la Seguridad Social: el 53. */
const ULTIMA_PROVINCIA = 53;
/**
 * El control es el resto de dividir entre 97 la provincia seguida del número: con un número de siete cifras (menor que
 * NUMERO_CORTO), la provincia vale NUMERO_CORTO veces; con uno de ocho, NUMERO_LARGO veces.
 */
const NUMERO_CORTO = 10_000_000;
/** El peso de la provincia con un número de ocho cifras (véase NUMERO_CORTO). */
const NUMERO_LARGO = 100_000_000;
/** El divisor del control: los dos dígitos de control son el resto de dividir entre 97. */
const MODULO_DE_CONTROL = 97;

/**
 * Si provincia, número y control forman un número de afiliación válido. Las cuentas caben de sobra en un número de
 * JavaScript (53 · 10⁸ + 10⁸ está muy por debajo de 2⁵³), así que son exactas.
 */
function esNumeroDeAfiliacion(provincia: string, numero: string, control: string): boolean {
  const codigo = Number(provincia);
  if (codigo < PRIMERA_PROVINCIA || codigo > ULTIMA_PROVINCIA) {
    return false;
  }
  const cifras = Number(numero);
  const base = codigo * (cifras < NUMERO_CORTO ? NUMERO_CORTO : NUMERO_LARGO) + cifras;
  return base % MODULO_DE_CONTROL === Number(control);
}

/** Borra las cifras de un tramo que sigue a «IBAN» o similar, si de verdad contiene una cuenta. */
function limpiarTramoDeCuenta(tramo: string): Limpieza {
  const cifras = (tramo.match(UNA_CIFRA) ?? []).length;
  if (!ES_Y_CONTROL.test(tramo) && cifras < MIN_CIFRAS_CUENTA) {
    return { texto: tramo, eliminados: 0 };
  }
  const limpio = tramo.replace(GRUPO_DE_CUENTA, '[cifras eliminadas]');
  return { texto: limpio, eliminados: limpio === tramo ? 0 : 1 };
}

/**
 * Quita las cuentas troceadas tras «IBAN», «número de cuenta» o «número de tarjeta» (CONTEXTO_CUENTA).
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con las cifras de esas cuentas cambiadas por una marca, y cuántos tramos se han limpiado.
 */
export function quitarCuentasAnunciadas(texto: string): Limpieza {
  let eliminados = 0;
  const limpio = texto.replace(CONTEXTO_CUENTA, (tramo) => {
    const tramoLimpio = limpiarTramoDeCuenta(tramo);
    eliminados += tramoLimpio.eliminados;
    return tramoLimpio.texto;
  });
  return { texto: limpio, eliminados };
}

/**
 * Quita los correos, cuentas, documentos, teléfonos, tarjetas, enlaces y usuarios de redes, en el orden de
 * SUSTITUCIONES.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada dato cambiado por la marca que dice qué era, y cuántos se han quitado.
 */
export function quitarIdentificadores(texto: string): Limpieza {
  return SUSTITUCIONES.reduce(
    (hecho, sustitucion) => {
      const siguiente = sustituir(hecho.texto, sustitucion);
      return { texto: siguiente.texto, eliminados: hecho.eliminados + siguiente.eliminados };
    },
    { texto, eliminados: 0 },
  );
}

/**
 * Quita los números de afiliación a la Seguridad Social: tras las palabras que los anuncian, o por su forma y su
 * control.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada número cambiado por MARCA_DE_AFILIACION, y cuántos se han quitado.
 */
export function quitarNumerosDeAfiliacion(texto: string): Limpieza {
  let eliminados = 0;
  const marcar = (): string => {
    eliminados += 1;
    return MARCA_DE_AFILIACION;
  };
  const trasContexto = texto.replace(CONTEXTO_AFILIACION, (tramo) => tramo.replace(GRUPO_DE_CIFRAS, marcar));
  const limpio = trasContexto.replace(
    CON_FORMA_DE_AFILIACION,
    (numero, provincia: string, cifras: string, control: string) =>
      esNumeroDeAfiliacion(provincia, cifras, control) ? marcar() : numero,
  );
  return { texto: limpio, eliminados };
}
