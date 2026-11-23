// El nombre de la empresa, solo donde el texto lo presenta sin duda:
//   - con su forma jurídica detrás: «Mercadona S.A.», «Neteges del Vallès, SL», «Fruites Puig SCCL»;
//   - tras «la empresa», «la compañía», «l'empresa» o «la cooperativa», también con «se llama» o «es diu» en medio:
//     «trabajo en la empresa Limpiezas Sol», «a l'empresa Serveis Integrals».
// El nombre son las palabras con mayúscula inicial o en mayúsculas («SEAT», «BBVA»), con las uniones de un nombre
// («de», «del», «i», «&»), y se cambia por «[empresa]». Lo que se queda, a propósito:
//   - una empresa nombrada sin más («trabajo en Mercadona»): no se distingue con seguridad de un lugar o de una sección
//     («trabajo en Cornellà», «trabajo en Urgencias»);
//   - tras «la empresa», una sola palabra corriente con mayúscula («una empresa Familiar»): no es un nombre;
//   - en un texto escrito todo en mayúsculas, lo que sigue a «LA EMPRESA», que no se distingue del relato. La forma
//     jurídica sí lo distingue: «TRABAJO EN MERCADONA S.A.» pierde «MERCADONA S.A.».
// Las palabras gramaticales y los verbos con que empieza una frase no forman parte del nombre: «En Acme S.L. limpio»
// pierde «Acme S.L.», no «En».

import { segunLaLista } from '../comun/nombres-propios.ts';
import { type SinMayusculas, sinDistinguirMayusculas } from '../comun/sin-distinguir-mayusculas.ts';
import type { Limpieza } from './limpieza.ts';

/** La marca que deja un nombre de empresa quitado. */
const MARCA = '[empresa]';

/** Palabras que nunca forman parte del nombre de una empresa, aunque se escriban con mayúscula al empezar la frase. */
const NO_SON_DE_LA_EMPRESA = [
  ...['a', 'al', 'ante', 'con', 'contra', 'de', 'del', 'desde', 'durante', 'e', 'el', 'en', 'entre', 'hacia', 'hasta'],
  ...['la', 'las', 'le', 'les', 'lo', 'los', 'me', 'mi', 'mis', 'o', 'para', 'pero', 'por', 'que', 'se', 'si', 'sin'],
  ...['sobre', 'su', 'sus', 'tu', 'tus', 'u', 'un', 'una', 'y', 'ya', 'yo', 'amb', 'als', 'dels', 'els', 'i', 'jo'],
  ...['per', 'pel', 'pels', 'sense', 'soy', 'sóc', 'soc', 'estoy', 'estic', 'trabajo', 'treballo', 'es', 'és'],
].join('|');
/** Una palabra de un nombre de empresa: con mayúscula inicial o en mayúsculas («Acme», «BBVA»), o «3M». */
function palabra(sinMayusculas: SinMayusculas): string {
  return `(?!${sinMayusculas(NO_SON_DE_LA_EMPRESA)}(?![\\p{L}\\d]))(?:\\p{Lu}[\\p{L}\\d'’·&]*|\\d+\\p{L}[\\p{L}\\d]*)(?![\\p{L}\\d])`;
}
/** Lo que une las palabras de un nombre de empresa: un espacio, «de la», «del», «i», «&», un guion o un apóstrofo. */
const UNION = "(?:\\s+(?:de(?:\\s+(?:la|las|los|les))?|del|dels|y|e|i)\\s+|\\s*&\\s*|\\s*-\\s*|\\s+(?:d|l)['’]|\\s+)";
/** El nombre: hasta seis palabras. */
function nombreDeEmpresa(sinMayusculas: SinMayusculas): string {
  return `${palabra(sinMayusculas)}(?:${UNION}${palabra(sinMayusculas)}){0,5}`;
}
/** Formas jurídicas españolas, con puntos o sin ellos: S.A., S.L., S.A.U., S.L.U., S.L.L., S.Coop., SCCL, S.C.P., C.B. */
const FORMA_JURIDICA = [
  ...['S\\.\\s?A\\.(?:\\s?U\\.)?', 'S\\.\\s?L\\.(?:\\s?[UL]\\.)?', 'S\\.\\s?Coop\\.?', 'S\\.\\s?C\\.\\s?C\\.\\s?L\\.'],
  ...['S\\.\\s?C\\.\\s?P\\.', 'C\\.\\s?B\\.', 'S\\.[AL]', 'SAU', 'SLU', 'SLL', 'SCCL', 'SCP', 'SA', 'SL', 'CB'],
].join('|');
/** La forma jurídica tras el nombre, con una coma o un espacio delante y sin otra letra o cifra detrás. */
const CON_FORMA_JURIDICA = `(?:,\\s*|\\s+)(?:${FORMA_JURIDICA})(?![\\p{L}\\d])`;
/** El nombre con su forma jurídica detrás, en cualquier parte del texto. */
function expresionConForma(sinMayusculas: SinMayusculas): RegExp {
  return new RegExp(`(?<![\\p{L}\\d])${nombreDeEmpresa(sinMayusculas)}${CON_FORMA_JURIDICA}`, 'gu');
}

/** Las palabras que nombran una empresa, en castellano y en catalán. */
const EMPRESA = [
  ...['empresa', 'compañía', 'compania', 'companyia', 'cooperativa', 'sociedad', 'societat', 'firma', 'contrata'],
  ...['subcontrata', 'gestoría', 'gestoria', 'asesoría', 'assessoria', 'consultora', 'constructora', 'multinacional'],
  ...['franquicia', 'franquícia', 'agencia', 'agència'],
].join('|');
/** Lo que va delante: «la empresa», «mi empresa», «l'empresa», «la meva empresa», con «se llama» o «:» si los lleva. */
function antesDelNombre(sinMayusculas: SinMayusculas): string {
  return `(?<!\\p{L})${sinMayusculas(
    "(?:(?:la|una|mi|tu|su|nuestra|esta|esa|otra|aquella|meva|teva|seva|nostra|aquesta)\\s+|l['’])" +
      `(?:${EMPRESA})(?:\\s+(?:que\\s+)?(?:se\\s+llama|es\\s+diu)|\\s+(?:llamada|anomenada))?`,
  )}\\s*[:,]?\\s*["“«']?`;
}
/** Tras «la empresa», el nombre (en el segundo grupo), con su forma jurídica si la lleva. */
function expresionPresentada(sinMayusculas: SinMayusculas): RegExp {
  return new RegExp(
    `(${antesDelNombre(sinMayusculas)})(${nombreDeEmpresa(sinMayusculas)}(?:${CON_FORMA_JURIDICA})?)`,
    'gu',
  );
}

/** Las dos expresiones de las empresas: la del nombre presentado con «la empresa» y la del nombre con forma jurídica. */
export interface ExpresionesDeEmpresa {
  /** Tras «la empresa»: el primer grupo es lo que va delante y el segundo, el nombre. */
  readonly presentada: RegExp;
  /** El nombre con su forma jurídica detrás. */
  readonly conForma: RegExp;
}

/**
 * Las dos expresiones de las empresas. Es una función para que la prueba de equivalencia
 * las compare escritas con el modificador `(?i:…)`.
 *
 * @param sinMayusculas - Cómo se escriben los trozos que no distinguen mayúsculas.
 * @returns La expresión del nombre presentado y la del nombre con su forma jurídica, con las banderas `g` y `u`.
 */
export function expresionesDeEmpresa(sinMayusculas: SinMayusculas): ExpresionesDeEmpresa {
  return { presentada: expresionPresentada(sinMayusculas), conForma: expresionConForma(sinMayusculas) };
}
const { presentada: EMPRESA_PRESENTADA, conForma: EMPRESA_CON_FORMA } = expresionesDeEmpresa(sinDistinguirMayusculas);

/**
 * Si lo que va delante del nombre tiene minúsculas: en un texto todo en mayúsculas, lo que sigue a «LA EMPRESA» no se
 * distingue del relato.
 */
const TIENE_MINUSCULAS = /\p{Ll}/u;
/** Si el nombre tiene más de una palabra. */
const VARIAS_PALABRAS = /\s/;
/**
 * Tras una forma jurídica con punto final, el final del texto u otra frase: «Trabajo en Acme S.L. Limpio oficinas». En
 * un texto en mayúsculas no se distingue, y el punto no se pone. Se mira desde el principio de lo que sigue al nombre.
 */
const SIGUE_OTRA_FRASE = /^(?:$|\s+\p{Lu}\p{Ll})/u;

/** Si lo que sigue a «la empresa» es un nombre: varias palabras, o una que no sea una palabra corriente («Glovo»). */
function esNombreDeEmpresa(nombre: string): boolean {
  return VARIAS_PALABRAS.test(nombre.trim()) || !segunLaLista(nombre).noEsNombre;
}

/**
 * La marca que sustituye un nombre que acaba en `fin`. Si acababa en la forma jurídica con punto («Acme S.L.») y detrás
 * empieza otra frase, el punto se queda: era también el final de la frase.
 */
function marcaPara(nombre: string, texto: string, fin: number): string {
  return nombre.endsWith('.') && SIGUE_OTRA_FRASE.test(texto.slice(fin)) ? `${MARCA}.` : MARCA;
}

/**
 * Cambia cada coincidencia del patrón por lo que devuelva `cambio` (con `null`, la deja como está) y cuenta los
 * cambios. `cambio` recibe la coincidencia y dónde acaba.
 */
function cambiarCadaUna(
  texto: string,
  patron: RegExp,
  cambio: (encontrado: RegExpExecArray, fin: number) => string | null,
): Limpieza {
  let resultado = '';
  let hecho = 0;
  let eliminados = 0;
  for (const encontrado of texto.matchAll(patron)) {
    const fin = encontrado.index + encontrado[0].length;
    const sustituto = cambio(encontrado, fin);
    if (sustituto === null) {
      continue;
    }
    resultado += texto.slice(hecho, encontrado.index) + sustituto;
    hecho = fin;
    eliminados += 1;
  }
  return { texto: resultado + texto.slice(hecho), eliminados };
}

/**
 * Quita los nombres de empresa presentados con «la empresa» o con su forma jurídica, y cuenta cada uno.
 *
 * @param texto - El texto que se limpia.
 * @returns El texto con cada nombre cambiado por «[empresa]», y cuántos se han quitado.
 */
export function quitarEmpresas(texto: string): Limpieza {
  const presentadas = cambiarCadaUna(texto, EMPRESA_PRESENTADA, (encontrado, fin) => {
    // EMPRESA_PRESENTADA exige ambos grupos: el contexto y el nombre de la empresa.
    const antes = encontrado[1] as string;
    const nombre = encontrado[2] as string;
    return TIENE_MINUSCULAS.test(antes) && esNombreDeEmpresa(nombre) ? antes + marcaPara(nombre, texto, fin) : null;
  });
  const conForma = cambiarCadaUna(presentadas.texto, EMPRESA_CON_FORMA, ([nombre], fin) =>
    marcaPara(nombre, presentadas.texto, fin),
  );
  return { texto: conForma.texto, eliminados: presentadas.eliminados + conForma.eliminados };
}
