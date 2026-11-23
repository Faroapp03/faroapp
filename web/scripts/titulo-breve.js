// Generado desde src/comun/titulo-breve.js; no editar esta copia.
// La forma breve de los títulos de ocupación. Muchos títulos de ESCO tienen formas masculina y femenina separadas
// por una barra: «bombero de brigada acuática/bombera de brigada acuática». Para leerlo de un vistazo, Faro escribe la
// forma que va delante entera y, tras la barra, solo lo que cambia en la otra: «bombero/a de brigada acuática», con la
// masculina delante, como las guías oficiales: es una decisión del proyecto.
//
// Solo cambia lo que se ve. El dato de ESCO no se toca: el paquete, las búsquedas y lo que se envía al motor siguen con
// el título entero, y quien lo filtra busca también en él. Lógica pura, sin DOM: la usan el motor (el título del
// informe) y las tarjetas de ocupación del recorrido, para que las reglas sean unas. La fuente vive en src/comun,
// sin depender de la web. La integración web debe publicar una copia exacta en web/scripts/titulo-breve.js para que
// el navegador, sin paso de compilación, use las mismas reglas.
//
// Las reglas:
// - Se fusiona palabra a palabra (los guiones también separan palabras), y solo si las dos formas tienen las mismas
//   palabras salvo la flexión de género. Basta una palabra sin forma breve segura para que el título se quede doble,
//   como está: «actor/actriz», «alcalde/alcaldesa», «mayordomo de hostelería/gobernanta de hostelería».
// - Castellano: las parejas o/a, e/a y +a, con la tilde de la última sílaba, que se pierde al añadir la a
//   (bombero/bombera, jefe/jefa, director/directora, capitán/capitana). Ninguna otra: «alcalde/alcaldesa» no. Con la
//   masculina delante: «bombero/a», «jefe/a», «director/a», «capitán/a».
// - Catalán: las formas dobles abreujades de la Generalitat, que van siempre con la masculina delante. +a y o/a, e/a
//   como en castellano; -essa en lugar de la vocal final («metge/essa»), y, si cambia algo más, la terminación desde la
//   vocal tónica («advocat/ada», «secretari/ària»), salvo que ahorre menos de tres letras («biòleg/biòloga»).
// - Una forma breve se da solo si se puede deshacer: `formasDeTituloBreve` vuelve a las dos formas normalizadas por
//   `formaComparable`, letra a letra. Lo que no vuelve se queda doble, con sus formas enteras en el mismo orden.
// - Lo que se ve está siempre en lo que se oye (WCAG 2.5.3, etiqueta en el nombre): el nombre accesible de una forma
//   breve es lo que se ve y, entre paréntesis, sus dos formas enteras: «Bombero/a de brigada acuática (bombero o
//   bombera de brigada acuática)».
//
// Fuente del catalán: Direcció General de Política Lingüística, «Guia d'usos no sexistes de la llengua en els textos de
// l'Administració de la Generalitat de Catalunya», apartat 3.2, «Formes dobles abreujades» (pàgs. 13 i 14),
// https://llengua.gencat.cat/permalink/c2f7c918-5382-11e4-8f3f-000c29cdf219, y la fitxa de l'Optimot «formes dobles
// abreujades: partició», que da las mismas pautas con más ejemplos: animador/a, sogre/a, alcalde/essa, metge/essa,
// beneficiari/ària, delegat/ada, directiu/iva, peruà/ana, ballarí/ina, filòleg/òloga, y las formas enteras de
// ranci/rància y llec/llega, «quan l'estalvi d'espai no és significatiu». Las dos forman la abreviatura «escrivint la
// terminació femenina després d'una barra», y los criterios lingüísticos de la UPC lo dicen sin rodeos: «Sempre és la
// forma masculina i després la femenina»:
// https://www.upc.edu/slt/ca/recursos-redaccio/criteris-linguistics/genere/formes-dobles
// En castellano no hay una guía oficial de formas abreviadas como la catalana.

/**
 * @typedef {'es' | 'ca'} IdiomaDelTitulo Castellano (ESCO) o catalán (la traducción de Faro). Repite el tipo `Idioma`
 * de comun/idioma.ts porque este archivo tiene una copia exacta en la web, que no puede importar un .ts.
 */

/** Lo que separa las dos formas de un título de ESCO y la terminación de una forma breve. */
const BARRA = '/';
/** Cómo se ven las formas de un título que se queda doble. */
const SEPARADOR_DOBLE = ` ${BARRA} `;
/**
 * Lo que separa las palabras de un título: espacios y guiones («bombero-conductor»). Se conservan tras normalizar la
 * forma con `formaComparable`.
 */
const ENTRE_PALABRAS = /(\s+|-)/;
/**
 * «o»: así se leen las dos formas, en castellano y en catalán («bombero o bombera de brigada acuática»). En castellano
 * se escribe «u» delante de o y ho («operario u operaria»).
 */
const DISYUNCION = ' o ';
/** La «u» que sustituye a la «o» delante de o y ho. */
const DISYUNCION_ANTE_O = ' u ';
/** Cuándo va la «u»: la palabra siguiente empieza por o u ho, con o sin tilde. */
const EMPIEZA_POR_O = /^h?[oó]/i;
/**
 * Lo mínimo que tiene que ahorrar una terminación de más de una letra: la Generalitat abrevia «filòleg/òloga», que
 * ahorra tres letras, y escribe enteras «llec/llega» y «ranci/rància», que ahorrarían dos y una.
 */
const AHORRO_MINIMO = 3;
/** La terminación que sustituye la vocal final de la masculina (alcalde/essa, metge/essa). */
const ESSA = 'essa';

/** Una vocal del castellano o del catalán, con tilde o diéresis. */
const VOCAL = /[aeiouáéíóúàèòïü]/;
/** Las vocales que cambian o se añaden en o/a, e/a y +a, sin tilde. */
const VOCAL_DE_GENERO = /^[aeo]$/;
/** La palabra acaba en una vocal de género (a, e, o). */
const ACABA_EN_VOCAL_DE_GENERO = /[aeo]$/;
/** Cómo acaba una forma femenina en catalán: en a, o en es en plural (directores, advocades). */
const FEMENINA_CATALANA = /(a|es)$/;
/** Una tilde (aguda o grave) marca la vocal tónica; la diéresis no. */
const TILDE = /[áéíóúàèò]/g;
/** Las marcas que NFD separa de la letra (tildes, diéresis): quitarlas deja la letra base. */
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;
/** Castellano: la tilde de la última sílaba de una palabra que acaba en consonante («capitán», «francés»). */
const TILDE_FINAL = /[áéíóú](?=[^aeiouáéíóúü]+$)/;

/** La letra sin tilde ni diéresis ("á" → "a"), para comparar vocales sin acento. @param {string} letra */
function sinTilde(letra) {
  return letra.normalize('NFD').replace(MARCAS_DIACRITICAS, '');
}
/** Si la letra es una vocal; `undefined` (fuera de la palabra) no lo es. @param {string | undefined} letra */
function esVocal(letra) {
  return letra !== undefined && VOCAL.test(letra);
}
/** Vocal fuerte (a, e, o): en un grupo de vocales, la que hace de núcleo de la sílaba. @param {string} letra */
function esFuerte(letra) {
  return 'aeo'.includes(sinTilde(letra));
}
/** El texto con la inicial en mayúscula, el resto como está. @param {string} texto */
function conMayuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ---------- La vocal tónica ----------

/**
 * Si la letra en el índice `i` es la u de que, qui, gue, gui, qua, gua o güe, que no forma sílaba propia: va entre
 * una q o una g y otra vocal.
 * @param {string} palabra @param {number} i
 */
function esUConsonante(palabra, i) {
  return 'uü'.includes(palabra[i] ?? '-') && 'qg'.includes(palabra[i - 1] ?? '-') && esVocal(palabra[i + 1]);
}

/**
 * Si la vocal `i` empieza otra sílaba que la del grupo de vocales que tiene delante: dos fuertes juntas, una diéresis
 * y, en catalán, un grupo de una sola vocal débil seguido de fuerte (pe-ru-a-na, be-ne-fi-ci-à-ri).
 * @param {string} palabra @param {number[]} grupo @param {number} i @param {IdiomaDelTitulo} idioma
 */
function hayHiato(palabra, grupo, i, idioma) {
  // `silabas` pasa un grupo no vacío de posiciones de vocales y un índice de la palabra.
  const anterior = /** @type {number} */ (grupo[grupo.length - 1]);
  const previa = /** @type {string} */ (palabra[anterior]);
  const actual = /** @type {string} */ (palabra[i]);
  if ('ïü'.includes(actual)) {
    return true;
  }
  if (esFuerte(previa) && esFuerte(actual)) {
    return true;
  }
  return idioma === 'ca' && grupo.length === 1 && !esFuerte(previa) && esFuerte(actual);
}

/**
 * Las posiciones de vocales que agrupa esta heurística, en orden: grupos de vocales seguidas, partidos donde hay hiato.
 * @param {string} palabra @param {IdiomaDelTitulo} idioma @returns {number[][]}
 */
function silabas(palabra, idioma) {
  /** @type {number[][]} */
  const grupos = [];
  for (let i = 0; i < palabra.length; i++) {
    if (!esVocal(palabra[i]) || esUConsonante(palabra, i)) {
      continue;
    }
    const grupo = grupos.at(-1);
    const seguida = grupo !== undefined && grupo[grupo.length - 1] === i - 1;
    if (seguida && !hayHiato(palabra, grupo, i, idioma)) {
      grupo.push(i);
    } else {
      grupos.push([i]);
    }
  }
  return grupos;
}

/**
 * El núcleo de una sílaba: su vocal fuerte o, si solo tiene débiles (iu, ui), la segunda en castellano (ciu-dad) y la
 * primera en catalán (riu, cui-na).
 * @param {string} palabra @param {number[]} grupo @param {IdiomaDelTitulo} idioma
 */
function nucleo(palabra, grupo, idioma) {
  // Los grupos de `silabas` son no vacíos y contienen solo posiciones de la palabra.
  const fuerte = grupo.find((i) => esFuerte(/** @type {string} */ (palabra[i])));
  if (fuerte !== undefined) {
    return fuerte;
  }
  return /** @type {number} */ (idioma === 'es' ? grupo[grupo.length - 1] : grupo[0]);
}

/**
 * Si una palabra sin tilde es aguda. Castellano: acaba en consonante que no es n ni s. Catalán: no acaba en vocal,
 * vocal + s, -en ni -in, o acaba en diptongo (actriu, jueu), que cuenta como consonante.
 * @param {string} palabra @param {IdiomaDelTitulo} idioma
 */
function esAguda(palabra, idioma) {
  // `vocalTonica` solo llega aquí si la palabra contiene al menos una vocal.
  const final = /** @type {string} */ (palabra[palabra.length - 1]);
  if (idioma === 'es') {
    return !esVocal(final) && !'ns'.includes(final);
  }
  const raiz = final === 's' ? palabra.slice(0, -1) : palabra;
  const ultima = raiz.length - 1;
  if (/[ei]n$/.test(raiz)) {
    return false;
  }
  if (!esVocal(raiz[ultima])) {
    return true;
  }
  // La comprobación anterior acaba de reconocer una vocal en `ultima`.
  return (
    'iu'.includes(/** @type {string} */ (raiz[ultima])) && esVocal(raiz[ultima - 1]) && !esUConsonante(raiz, ultima - 1)
  );
}

/**
 * La posición de la vocal tónica de una palabra: la que lleva tilde o, si ninguna, la de la última sílaba (aguda) o
 * la de la penúltima (llana). -1 si no tiene vocales.
 * @param {string} palabra @param {IdiomaDelTitulo} idioma
 */
function vocalTonica(palabra, idioma) {
  const conTilde = [...palabra.matchAll(TILDE)].at(-1);
  if (conTilde?.index !== undefined) {
    return conTilde.index;
  }
  const grupos = silabas(palabra, idioma);
  if (!grupos.length) {
    return -1;
  }
  const llana = !esAguda(palabra, idioma) && grupos.length > 1;
  // Hay grupos; solo se retrocede dos cuando hay al menos dos.
  const grupo = /** @type {number[]} */ (grupos[grupos.length - (llana ? 2 : 1)]);
  return nucleo(palabra, grupo, idioma);
}

// ---------- Una palabra: su forma breve y cómo se deshace ----------

/**
 * La otra forma de una palabra a partir de la que va entera y la terminación que va tras la barra, o null si la
 * terminación no cabe en ella. Cómo se lee la terminación:
 * - una vocal (o/a, e/a, +a): cambia la a, la e o la o final o, si no la hay, se añade; en castellano cae la tilde de
 *   la última sílaba (capitán/a → capitana);
 * - «essa»: sustituye la vocal final (metge/essa → metgessa);
 * - más letras: sustituyen la palabra desde su vocal tónica, que tiene que ser la misma vocal, sin contar tildes
 *   (advocat/ada → advocada, secretari/ària → secretària).
 * @param {string} entera @param {string} terminacion @param {IdiomaDelTitulo} idioma @returns {string | null}
 */
function deshacerPalabra(entera, terminacion, idioma) {
  if (!esVocal(terminacion[0])) {
    return null;
  }
  if (terminacion.length === 1) {
    if (ACABA_EN_VOCAL_DE_GENERO.test(entera)) {
      return entera.slice(0, -1) + terminacion;
    }
    const base = idioma === 'es' ? entera.replace(TILDE_FINAL, sinTilde) : entera;
    return base + terminacion;
  }
  if (terminacion === ESSA && ACABA_EN_VOCAL_DE_GENERO.test(entera)) {
    return entera.slice(0, -1) + ESSA;
  }
  const tonica = vocalTonica(entera, idioma);
  // Una tónica no negativa es una posición de `entera`; la terminación empieza por vocal desde la primera guarda.
  if (
    tonica < 0 ||
    sinTilde(/** @type {string} */ (entera[tonica])) !== sinTilde(/** @type {string} */ (terminacion[0]))
  ) {
    return null;
  }
  return entera.slice(0, tonica) + terminacion;
}

/**
 * Las terminaciones que se prueban, en el orden de la guía: una sola vocal (o/a, e/a, +a) y, si no, la terminación
 * desde la vocal tónica, si ahorra lo bastante.
 * @param {string} otra @param {IdiomaDelTitulo} idioma @returns {string[]}
 */
function terminacionesPosibles(otra, idioma) {
  const posibles = [];
  const ultima = otra[otra.length - 1] ?? '';
  if (VOCAL_DE_GENERO.test(ultima)) {
    posibles.push(ultima);
  }
  const tonica = vocalTonica(otra, idioma);
  const desdeLaTonica = tonica < 0 ? '' : otra.slice(tonica);
  if (desdeLaTonica.length > 1 && otra.length - desdeLaTonica.length >= AHORRO_MINIMO) {
    posibles.push(desdeLaTonica);
  }
  return posibles;
}

/**
 * La terminación con que `entera/terminación` vuelve a dar `otra`, o null si ninguna lo consigue.
 * @param {string} entera @param {string} otra @param {IdiomaDelTitulo} idioma @returns {string | null}
 */
function terminacion(entera, otra, idioma) {
  const posibles = terminacionesPosibles(otra, idioma);
  return posibles.find((posible) => deshacerPalabra(entera, posible, idioma) === otra) ?? null;
}

/**
 * Si dos palabras distintas son las dos formas de género que el idioma deja abreviar, con la masculina primero, que es
 * como escriben sus reglas. En castellano, solo o/a, e/a y +a (con su tilde): «alcalde/alcaldesa» no. En catalán, la
 * femenina acaba en a (o en es, en plural): una pareja escrita al revés, con la femenina primero, nunca se abrevia.
 * @param {string} masculina @param {string} femenina @param {IdiomaDelTitulo} idioma
 */
function sonFormasDeGenero(masculina, femenina, idioma) {
  if (idioma === 'es') {
    return deshacerPalabra(masculina, 'a', idioma) === femenina;
  }
  return FEMENINA_CATALANA.test(femenina) && terminacion(masculina, femenina, idioma) !== null;
}

/**
 * Una palabra de la forma breve, con la masculina delante: la palabra tal cual si es igual en las dos formas,
 * «entera/terminación» si son sus dos formas de género, o null si no tiene forma breve segura.
 * @param {string} masculina @param {string} femenina @param {IdiomaDelTitulo} idioma @returns {string | null}
 */
function palabraBreve(masculina, femenina, idioma) {
  if (masculina === femenina) {
    return masculina;
  }
  if (!sonFormasDeGenero(masculina, femenina, idioma)) {
    return null;
  }
  const fin = terminacion(masculina, femenina, idioma);
  return fin === null ? null : `${masculina}${BARRA}${fin}`;
}

// ---------- Las formas de un título ----------

/**
 * Las formas de un título tal como las da ESCO, sin espacios a los lados, cada una una vez («X/X» es una, «X/Y/»,
 * dos).
 * @param {string} titulo @returns {string[]}
 */
function formasDeEsco(titulo) {
  return [
    ...new Set(
      titulo
        .split(BARRA)
        .map((forma) => forma.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Una forma tal como se compara: con un espacio entre palabras, como la pinta el navegador, y la inicial en minúscula,
 * porque ESCO escribe alguna en mayúscula en una sola de las dos formas («Inspector de sanidad/inspectora de
 * sanidad») y el título se ve siempre con mayúscula inicial. Una sigla («TIC») se queda como está.
 * @param {string} forma
 */
function formaComparable(forma) {
  return forma.replace(/\s+/g, ' ').replace(/^\p{Lu}(?=\p{Ll})/u, (inicial) => inicial.toLowerCase());
}

/**
 * La barra separa una sola palabra («comprador/compradora de café verde») o ya va abreviada («redactor/a de revista»):
 * las dos formas enteras, si la palabra y la que la sigue son formas de género. null si no.
 * @param {string[]} izquierda @param {string[]} derecha @param {IdiomaDelTitulo} idioma
 * @returns {[string, string] | null}
 */
function formasConBarraEnUnaPalabra(izquierda, derecha, idioma) {
  // `split` devuelve al menos un trozo en cada una de las dos formas.
  const masculina = /** @type {string} */ (izquierda[izquierda.length - 1]);
  const tras = /** @type {string} */ (derecha[0]);
  const femenina = sonFormasDeGenero(masculina, tras, idioma) ? tras : deshacerPalabra(masculina, tras, idioma);
  if (femenina === null || !sonFormasDeGenero(masculina, femenina, idioma)) {
    return null;
  }
  const antes = izquierda.slice(0, -1).join('');
  const despues = derecha.slice(1).join('');
  return [`${antes}${masculina}${despues}`, `${antes}${femenina}${despues}`];
}

/**
 * Las dos formas enteras de un título, masculina y femenina, o null si no tiene dos. ESCO las escribe enteras
 * («bombero de brigada acuática/bombera de brigada acuática») o con la barra en una sola palabra («comprador/compradora
 * de café verde», «redactor/a de revista»).
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {[string, string] | null}
 */
export function dosFormasDelTitulo(titulo, idioma) {
  const formas = [...new Set(formasDeEsco(titulo).map(formaComparable))];
  if (formas.length !== 2) {
    return null;
  }
  // La guarda limita `formas` a dos entradas; `map` conserva esa longitud.
  const [izquierda, derecha] = /** @type {[string[], string[]]} */ (formas.map((forma) => forma.split(ENTRE_PALABRAS)));
  if (izquierda.length === derecha.length) {
    return /** @type {[string, string]} */ ([formas[0], formas[1]]);
  }
  return formasConBarraEnUnaPalabra(izquierda, derecha, idioma);
}

/**
 * Las dos formas de una forma breve, masculina y femenina, o null si no tiene ninguna palabra con barra o no se puede
 * deshacer. Por ejemplo, «bombero/a de brigada acuática» →
 * «bombero de brigada acuática», «bombera de brigada acuática».
 * @param {string} breve @param {IdiomaDelTitulo} idioma @returns {[string, string] | null}
 */
export function formasDeTituloBreve(breve, idioma) {
  if (!breve.includes(BARRA)) {
    return null;
  }
  const enteras = [];
  const otras = [];
  for (const parte of breve.split(ENTRE_PALABRAS)) {
    // `split` tiene siempre su primer trozo; el segundo puede faltar.
    const [entera, fin] = /** @type {[string, ...string[]]} */ (parte.split(BARRA));
    const otra = fin === undefined ? entera : deshacerPalabra(entera, fin, idioma);
    if (otra === null) {
      return null;
    }
    enteras.push(entera);
    otras.push(otra);
  }
  const primera = enteras.join('');
  const segunda = otras.join('');
  return [primera, segunda];
}

/**
 * Una palabra o un separador de la forma breve: la palabra fusionada, el separador si es el mismo en las dos formas,
 * o null.
 * @param {string} masculina @param {string} femenina @param {boolean} esSeparador @param {IdiomaDelTitulo} idioma
 */
function parteBreve(masculina, femenina, esSeparador, idioma) {
  if (!esSeparador) {
    return palabraBreve(masculina, femenina, idioma);
  }
  return masculina === femenina ? masculina : null;
}

/**
 * La fusión de un título: sus dos formas, en el orden en que se ven (la masculina delante), partidas en palabras y
 * separadores, y su forma breve; o null si no tiene una segura.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma
 * @returns {{ partes: [string[], string[]], breve: string } | null}
 */
function fusion(titulo, idioma) {
  const formas = dosFormasDelTitulo(titulo, idioma);
  if (!formas) {
    return null;
  }
  // `formas` es una pareja y `map` conserva sus dos entradas.
  const [masculinas, femeninas] = /** @type {[string[], string[]]} */ (
    formas.map((forma) => forma.split(ENTRE_PALABRAS))
  );
  if (masculinas.length !== femeninas.length) {
    return null;
  }
  // `split` con grupo de captura alterna palabras (posiciones pares) y separadores (impares), incluso con trozos
  // vacíos.
  const esSeparador = (/** @type {number} */ i) => i % 2 === 1;
  // La guarda anterior asegura que existe la parte femenina de cada posición.
  const breves = masculinas.map((parte, i) =>
    parteBreve(parte, /** @type {string} */ (femeninas[i]), esSeparador(i), idioma),
  );
  if (breves.includes(null)) {
    return null;
  }
  const breve = breves.join('');
  // La comprobación de que se conservan las formas normalizadas: si al deshacerla no salen las dos formas, el título se
  // queda doble.
  const deshecha = formasDeTituloBreve(breve, idioma);
  if (deshecha?.[0] !== formas[0] || deshecha?.[1] !== formas[1]) {
    return null;
  }
  /** @type {[string[], string[]]} */
  const partes = [masculinas, femeninas];
  return { partes, breve };
}

// ---------- Lo que se ve y lo que se lee ----------

/**
 * Las formas enteras de un título, cada una una vez, con la masculina delante. Con dos formas, las enteras aunque
 * ESCO ponga la barra en una sola palabra («comprador de café verde», «compradora de café verde»); si no se entienden
 * como dos formas de género, las que da ESCO, que escribe siempre la masculina primero.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string[]}
 */
function formasEnteras(titulo, idioma) {
  const deEsco = formasDeEsco(titulo);
  if (deEsco.length !== 2) {
    return deEsco;
  }
  // Si no hay pareja reconocida, `deEsco` tiene las dos entradas de la guarda.
  const [masculina, femenina] = /** @type {[string, string]} */ (dosFormasDelTitulo(titulo, idioma) ?? deEsco);
  return [masculina, femenina];
}

/**
 * El título con sus formas enteras, cada una una vez, con la masculina delante, separadas por « / » y con mayúscula
 * inicial: así se ve un título que se queda doble, y así lo escribe el texto corrido de la conversación, que un lector
 * de pantalla lee tal cual.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string}
 */
export function tituloDoble(titulo, idioma) {
  return conMayuscula(formasEnteras(titulo, idioma).join(SEPARADOR_DOBLE));
}

/**
 * El título como se ve dentro de una frase, sin añadir una mayúscula inicial: la forma breve si es segura y, si no,
 * sus formas enteras separadas por « / ».
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string}
 */
export function tituloEnUnaFrase(titulo, idioma) {
  return fusion(titulo, idioma)?.breve ?? formasEnteras(titulo, idioma).join(SEPARADOR_DOBLE);
}

/**
 * El título de una ocupación como se ve en una tarjeta, una lista o el informe: la forma breve si es segura y, si no,
 * el título doble. Con mayúscula inicial.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string}
 */
export function tituloParaVer(titulo, idioma) {
  return conMayuscula(tituloEnUnaFrase(titulo, idioma));
}

/**
 * Une textos con «o» (o «u», en castellano, delante de o y ho).
 * @param {string[]} textos @param {IdiomaDelTitulo} idioma
 */
function unirConO(textos, idioma) {
  return textos.reduce((unido, texto) => {
    const enlace = idioma === 'es' && EMPIEZA_POR_O.test(texto) ? DISYUNCION_ANTE_O : DISYUNCION;
    return `${unido}${enlace}${texto}`;
  });
}

/**
 * Dos formas partidas en palabras dichas una vez, con lo que comparten al principio y al final fuera de la «o»:
 * «bombero o bombera de brigada acuática», «director técnico o directora técnica».
 * @param {[string[], string[]]} partes @param {IdiomaDelTitulo} idioma
 */
function leerJuntas([primeras, segundas], idioma) {
  const distintas = primeras.flatMap((parte, i) => (parte === segundas[i] ? [] : [i]));
  const desde = distintas[0] ?? 0;
  const hasta = (distintas[distintas.length - 1] ?? 0) + 1;
  const tramo = (/** @type {string[]} */ palabras) => palabras.slice(desde, hasta).join('');
  const centro = unirConO([tramo(primeras), tramo(segundas)], idioma);
  return `${primeras.slice(0, desde).join('')}${centro}${primeras.slice(hasta).join('')}`;
}

/**
 * Las dos formas enteras de un título que se ve en su forma breve, unidas por «o», con la masculina delante y con
 * lo que comparten dicho una vez, con la inicial de las formas normalizadas: «bombero o bombera de brigada acuática».
 * null si el título no se abrevia: entonces lo que se ve ya son sus formas enteras.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string | null}
 */
export function formasLeidas(titulo, idioma) {
  const fusionado = fusion(titulo, idioma);
  return fusionado ? leerJuntas(fusionado.partes, idioma) : null;
}

/**
 * El nombre accesible de una ocupación en una tarjeta o una lista: lo que se ve y, si es la forma breve, sus dos formas
 * enteras entre paréntesis («Bombero/a de brigada acuática (bombero o bombera de brigada acuática)»). Contiene lo que
 * se ve, como pide WCAG 2.5.3, y el lector de pantalla oye las dos formas enteras.
 * @param {string} titulo @param {IdiomaDelTitulo} idioma @returns {string}
 */
export function nombreAccesible(titulo, idioma) {
  const formas = formasLeidas(titulo, idioma);
  const visto = tituloParaVer(titulo, idioma);
  return formas === null ? visto : `${visto} (${formas})`;
}
