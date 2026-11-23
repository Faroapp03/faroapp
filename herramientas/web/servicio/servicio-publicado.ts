// El service worker publicado (service-worker.js de la web construida) es un derivado de src/service-worker/: se
// construye con construirServicio en dos pasadas. La primera, con la plantilla neutra, da el texto que entra en la
// VERSION; la segunda, con los valores reales, es la que se publica. La comprobación rehace las dos y exige igualdad
// byte a byte.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Expression, parseExpressionAt } from 'acorn';
import { rutaFueraDeLaCopia } from '../../../src/plataforma/politica-cache-web.ts';
import { construirServicio } from './construir-servicio.ts';

const ENTRADA = realpathSync(fileURLToPath(new URL('../../../src/service-worker/servicio.js', import.meta.url)));
const PLANTILLA = realpathSync(fileURLToPath(new URL('../../../src/service-worker/generado.js', import.meta.url)));

/** Una lista de rutas con su huella SHA-256. */
type ConHuella = readonly (readonly [string, string])[];

/**
 * La clase de una ruta del CATALOGO: lo que se precarga (instalar), lo que se precarga después y tolerante a fallos
 * (adorno), lo que se guarda al pedirlo (demanda), la página de una sección, que solo entra si la política de la
 * entidad la abre (seccion), y lo que se precarga siempre y se sirve solo de la copia (comprobado).
 */
export const CLASES = Object.freeze(['instalar', 'adorno', 'demanda', 'seccion', 'comprobado'] as const);
export type ClaseDelCatalogo = (typeof CLASES)[number];

/** El catálogo de la copia: cada ruta, una sola vez, con su huella SHA-256 de lo publicado y su clase. */
export type Catalogo = readonly (readonly [ruta: string, sha256: string, clase: ClaseDelCatalogo])[];

/** Los valores que genera la construcción, en el orden de la plantilla. */
export interface ValoresDelServicio {
  readonly VERSION: string;
  readonly FIRMAS: ConHuella;
  readonly PAQUETE: string;
  readonly TAMANOS_DEL_PAQUETE: string;
  readonly CATALOGO: Catalogo;
}

/** Las listas de la copia por su papel, como las calcula la preparación desde lo publicado. */
export interface ListasDelCatalogo {
  readonly ARCHIVOS: readonly string[];
  readonly BAJO_DEMANDA: readonly string[];
  readonly PAGINAS_DE_SECCIONES: ConHuella;
  readonly HUELLAS_DE_ARCHIVOS: ConHuella;
  readonly COMPROBADOS: ConHuella;
}

/** Lo que solo adorna: tipografías, imágenes y los recursos del globo de «Datos globales». */
export const SOLO_ADORNO = /^(tipografias|imagenes|recursos)\//u;

/** Unas listas que no caben en un catálogo de una clase por ruta, o una ruta sin su huella. */
export class CatalogoImposible extends Error {
  override name = 'CatalogoImposible';
}

/** HUELLAS_DE_ARCHIVOS lleva una sola huella por ruta y solo de lo que está en ARCHIVOS o en BAJO_DEMANDA. */
function exigirHuellasDeLaCopia(huellas: ReadonlyMap<string, string>, listas: ListasDelCatalogo): void {
  const deLaCopia = new Set([...listas.ARCHIVOS, ...listas.BAJO_DEMANDA]);
  const sobran = [...huellas.keys()].filter((ruta) => !deLaCopia.has(ruta));
  if (sobran.length || huellas.size !== listas.HUELLAS_DE_ARCHIVOS.length) {
    throw new CatalogoImposible(`HUELLAS_DE_ARCHIVOS sobra o repite: ${sobran.join(', ') || 'una ruta repetida'}`);
  }
}

/**
 * El CATALOGO de unas listas. Cada ruta va una sola vez: lo de ARCHIVOS, en su orden, como instalar o adorno
 * (SOLO_ADORNO), o como seccion si también es una página de una sección; después BAJO_DEMANDA, las páginas de las
 * secciones que no se precargan y COMPROBADOS, en el orden de cada lista. La huella de una página de una sección es la
 * suya (PAGINAS_DE_SECCIONES); la de lo demás de ARCHIVOS y BAJO_DEMANDA, la de HUELLAS_DE_ARCHIVOS.
 *
 * @throws {CatalogoImposible} Si una ruta está en dos listas que se excluyen (ARCHIVOS, BAJO_DEMANDA y COMPROBADOS),
 *   si una lista repite una ruta, si una página de una sección es un adorno, si una página de una sección falta en
 *   ARCHIVOS aunque la política la deje entrar en la copia (listasDelCatalogo no podría devolverla), si una ruta no
 *   tiene huella o si HUELLAS_DE_ARCHIVOS lleva una ruta que no está en ARCHIVOS ni en BAJO_DEMANDA.
 */
export function catalogoDeListas(listas: ListasDelCatalogo): Catalogo {
  const huellas = new Map(listas.HUELLAS_DE_ARCHIVOS);
  const paginas = new Map(listas.PAGINAS_DE_SECCIONES);
  const comprobados = new Map(listas.COMPROBADOS);
  const vistas = new Set<string>();
  const anotar = (ruta: string) => {
    if (vistas.has(ruta)) {
      throw new CatalogoImposible(`«${ruta}» va en más de una lista de la copia`);
    }
    vistas.add(ruta);
  };
  const conHuella = (ruta: string, huella: string | undefined): string => {
    if (huella === undefined) {
      throw new CatalogoImposible(`«${ruta}» no tiene huella`);
    }
    return huella;
  };
  const deArchivos = listas.ARCHIVOS.map((ruta) => {
    anotar(ruta);
    if (paginas.has(ruta)) {
      if (SOLO_ADORNO.test(ruta)) {
        throw new CatalogoImposible(`«${ruta}» no puede ser a la vez un adorno y una página de una sección`);
      }
      return [ruta, conHuella(ruta, paginas.get(ruta)), 'seccion'] as const;
    }
    return [ruta, conHuella(ruta, huellas.get(ruta)), SOLO_ADORNO.test(ruta) ? 'adorno' : 'instalar'] as const;
  });
  const deDemanda = listas.BAJO_DEMANDA.map((ruta) => {
    anotar(ruta);
    return [ruta, conHuella(ruta, huellas.get(ruta)), 'demanda'] as const;
  });
  const enArchivos = new Set(listas.ARCHIVOS);
  exigirHuellasDeLaCopia(huellas, listas);
  const deSecciones = [...paginas]
    .filter(([ruta]) => !enArchivos.has(ruta))
    .map(([ruta, huella]) => {
      if (!rutaFueraDeLaCopia(ruta)) {
        throw new CatalogoImposible(
          `«${ruta}» es una página de una sección que entra en la copia y no está en ARCHIVOS`,
        );
      }
      anotar(ruta);
      return [ruta, huella, 'seccion'] as const;
    });
  const deComprobados = [...comprobados].map(([ruta, huella]) => {
    anotar(ruta);
    return [ruta, huella, 'comprobado'] as const;
  });
  if (comprobados.size !== listas.COMPROBADOS.length || paginas.size !== listas.PAGINAS_DE_SECCIONES.length) {
    throw new CatalogoImposible('COMPROBADOS o PAGINAS_DE_SECCIONES repiten alguna ruta');
  }
  return Object.freeze([...deArchivos, ...deDemanda, ...deSecciones, ...deComprobados]);
}

/**
 * Las listas de un CATALOGO, con la misma regla que catalogo.js en el service worker: una página de una sección se
 * precarga (ARCHIVOS) salvo que la política la deje fuera de la copia. Es la inversa exacta de catalogoDeListas para
 * lo que calcula la preparación, donde una página de una sección solo falta en ARCHIVOS por esa política.
 */
export function listasDelCatalogo(catalogo: Catalogo): ListasDelCatalogo {
  const de = (...clases: ClaseDelCatalogo[]) => catalogo.filter(([, , clase]) => clases.includes(clase));
  const enArchivos = catalogo.filter(
    ([ruta, , clase]) =>
      clase === 'instalar' || clase === 'adorno' || (clase === 'seccion' && !rutaFueraDeLaCopia(ruta)),
  );
  const par = ([ruta, huella]: readonly [string, string, ClaseDelCatalogo]) => [ruta, huella] as const;
  const ordenados = (pares: (readonly [string, string])[]) => {
    const porRuta = new Map(pares);
    return [...porRuta.keys()].sort().map((ruta) => [ruta, porRuta.get(ruta) ?? ''] as const);
  };
  return {
    ARCHIVOS: enArchivos.map(([ruta]) => ruta),
    BAJO_DEMANDA: de('demanda').map(([ruta]) => ruta),
    PAGINAS_DE_SECCIONES: ordenados(de('seccion').map(par)),
    HUELLAS_DE_ARCHIVOS: ordenados([...enArchivos, ...de('demanda')].map(par)),
    COMPROBADOS: de('comprobado').map(par),
  };
}

/** Los valores de la plantilla: con ellos, la VERSION no depende de sí misma ni del paquete de datos. */
export const VALORES_NEUTROS: ValoresDelServicio = Object.freeze({
  VERSION: '',
  FIRMAS: [],
  PAQUETE: '',
  TAMANOS_DEL_PAQUETE: '{}',
  CATALOGO: [],
});

/**
 * Cómo es cada valor: una cadena, pares de cadenas o el catálogo: ternas de ruta, huella SHA-256 y clase (CLASES), sin
 * ninguna ruta repetida.
 */
const FORMAS: Readonly<Record<keyof ValoresDelServicio, 'cadena' | 'tamanos' | 'pares' | 'catalogo'>> = {
  VERSION: 'cadena',
  FIRMAS: 'pares',
  PAQUETE: 'cadena',
  TAMANOS_DEL_PAQUETE: 'tamanos',
  CATALOGO: 'catalogo',
};
const SHA256 = /^[0-9a-f]{64}$/u;
const esCadena = (valor: unknown): valor is string => typeof valor === 'string';
const esPar = (valor: unknown): valor is readonly [string, string] =>
  Array.isArray(valor) && valor.length === 2 && valor.every(esCadena);
/** Cada entrada del CATALOGO: ruta, huella y clase. */
const CAMPOS_DE_LA_ENTRADA = 3;
const esEntrada = (valor: unknown): boolean =>
  Array.isArray(valor) &&
  valor.length === CAMPOS_DE_LA_ENTRADA &&
  valor.every(esCadena) &&
  SHA256.test(valor[1] ?? '') &&
  (CLASES as readonly string[]).includes(valor[2] ?? '');

/** Si lo escrito en TAMANOS_DEL_PAQUETE es un objeto JSON de tamaños en bytes (enteros, sin signo). */
function sonTamanos(texto: string): boolean {
  try {
    const leido: unknown = JSON.parse(texto);
    return (
      typeof leido === 'object' &&
      leido !== null &&
      !Array.isArray(leido) &&
      Object.values(leido).every((tamano) => Number.isSafeInteger(tamano) && tamano >= 0)
    );
  } catch {
    return false;
  }
}

/** Si un valor leído tiene la forma de su valor (FORMAS), elemento a elemento. */
function tieneSuForma(forma: (typeof FORMAS)[keyof ValoresDelServicio], valor: unknown): boolean {
  switch (forma) {
    case 'cadena':
      return esCadena(valor);
    case 'tamanos':
      return esCadena(valor) && sonTamanos(valor);
    case 'pares':
      return Array.isArray(valor) && valor.every(esPar);
    case 'catalogo':
      return (
        Array.isArray(valor) &&
        valor.every(esEntrada) &&
        new Set(valor.map((entrada: string[]) => entrada[0])).size === valor.length
      );
  }
}

/** Un service worker publicado sin la línea de alguno de sus valores, o con ella repetida o ilegible. */
export class ServicioIlegible extends Error {
  override name = 'ServicioIlegible';
}

/**
 * El service worker construido con unos valores.
 *
 * @param valores - Los de la publicación; sin ellos, los neutros (primera pasada).
 * @returns El texto del service worker, en un solo archivo clásico.
 */
export function servicioConValores(valores: ValoresDelServicio = VALORES_NEUTROS): Promise<string> {
  return construirServicio(ENTRADA, { plantilla: PLANTILLA, valores: { ...valores } });
}

/**
 * La línea de un valor en el service worker publicado: la construcción escribe cada uno en una sola línea, como
 * `var NOMBRE = <literal>;` (esbuild elige las comillas de cada cadena).
 *
 * @param nombre - El nombre del valor.
 * @returns La expresión que encuentra esa línea en todo el texto.
 */
export function lineaDelValor(nombre: keyof ValoresDelServicio): RegExp {
  return new RegExp(`^var ${nombre} = (.*);$`, 'gm');
}

/** El valor de un literal de cadena, de número o de lista de literales; cualquier otra expresión no se admite. */
function valorLiteral(nodo: Expression | null): unknown {
  if (nodo?.type === 'Literal' && (typeof nodo.value === 'string' || typeof nodo.value === 'number')) {
    return nodo.value;
  }
  if (nodo?.type === 'ArrayExpression') {
    return nodo.elements.map((elemento) => valorLiteral(elemento?.type === 'SpreadElement' ? null : elemento));
  }
  throw new ServicioIlegible('solo admite literales de cadena, de número y de lista');
}

/** El literal de una línea generada, que tiene que ocuparla entera. */
function literalDeLaLinea(nombre: string, codigo: string): unknown {
  try {
    const nodo = parseExpressionAt(codigo, 0, { ecmaVersion: 'latest' });
    if (nodo.end !== codigo.length) {
      throw new ServicioIlegible('sobra código tras el literal');
    }
    return valorLiteral(nodo);
  } catch (error) {
    throw new ServicioIlegible(`el valor de ${nombre} no es un literal: ${(error as Error).message}`);
  }
}

/**
 * Los valores del service worker publicado, leídos de sus líneas sin ejecutar su código.
 *
 * @param texto - El service worker publicado.
 * @returns Cada valor, en el orden de la plantilla.
 * @throws {ServicioIlegible} Si algún valor no está en una sola línea con un literal de su forma (FORMAS).
 */
export function valoresDelServicio(texto: string): ValoresDelServicio {
  const valores = Object.keys(VALORES_NEUTROS).map((nombre) => {
    const lineas = [...texto.matchAll(lineaDelValor(nombre as keyof ValoresDelServicio))];
    if (lineas.length !== 1) {
      throw new ServicioIlegible(`no declara ${nombre} una sola vez en su línea generada`);
    }
    const valor = literalDeLaLinea(nombre, lineas[0]?.[1] ?? '');
    if (!tieneSuForma(FORMAS[nombre as keyof ValoresDelServicio], valor)) {
      throw new ServicioIlegible(`el valor de ${nombre} no tiene la forma de la plantilla`);
    }
    return [nombre, valor] as const;
  });
  return Object.freeze(Object.fromEntries(valores)) as unknown as ValoresDelServicio;
}
