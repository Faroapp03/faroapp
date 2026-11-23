// El registro de la Biblioteca (guías y lecturas): tipos, niveles y validación antes de generar la página o sus textos.
// Los idiomas y las guardas primitivas proceden del motor; los datos se conservan sin transformar.

import { readFileSync } from 'node:fs';
import { IDIOMAS, type Idioma } from '../../../src/comun/idioma.ts';
import { esObjeto, esTexto } from '../../../src/comun/json.ts';

const REGISTRO = new URL('../../../datos/lecturas.json', import.meta.url);
/**
 * Los niveles de lectura, de lo sencillo a lo avanzado: el orden en que se enseñan. Sus nombres a la vista son
 * «Inicial», «Intermedio» y «Avanzado» (textos «lecturas.niveles.*»); los ids no cambian.
 */
export const NIVELES = ['empezar', 'profundizar', 'investigacion'] as const;
/**
 * Los tipos de lectura, cada uno con el segmento de la Biblioteca (la pestaña) en que va, en el orden de las pestañas:
 * Guías, Informes y Notas. El segmento de cada lectura sale de su tipo; su nombre, del texto «biblioteca.tipos.<tipo>».
 */
export const TIPOS = [
  { tipo: 'guia', segmento: 'guias' },
  { tipo: 'informe', segmento: 'informes' },
  { tipo: 'nota', segmento: 'notas' },
] as const;

/** Un texto del registro en cada idioma admitido. */
export type PorIdioma = Record<Idioma, string>;

/**
 * Una lectura del registro: su tipo (guia, informe o nota), que decide su segmento; si acaso, su tema y su subtipo (un
 * manual, una infografía…), que la página no enseña; su nivel, su fuente, su fecha, su licencia, qué abre y sus textos.
 * Un enlace que no es https:// (una página o una ficha PDF de Faro) o que falta (una guía propia en preparación) es
 * contenido propio de Faro. Los campos `seccion` y `segmento` no se leen.
 */
export interface Lectura {
  id: string;
  tema?: string;
  tipo: (typeof TIPOS)[number]['tipo'];
  subtipo?: PorIdioma;
  nivel: (typeof NIVELES)[number];
  fuente: string;
  idiomas: string[];
  minutos: number;
  enlace: string | null;
  enlace_ca?: string;
  fecha: { iso: string | null } & PorIdioma;
  consultado: string;
  licencia: string;
  formato?: PorIdioma;
  es: { titulo: string; resumen: string; interes: string };
  ca: { titulo: string; resumen: string; interes: string };
}

/** El registro de lecturas (datos/lecturas.json): los textos de la página, los temas y las lecturas. */
export interface Registro {
  textos: Record<string, PorIdioma>;
  temas: Record<string, PorIdioma>;
  lecturas: Lectura[];
}

/** El registro de lecturas no tiene la forma que leen las páginas: el mensaje nombra lo que falla. */
export class RegistroInvalido extends Error {
  override readonly name = 'RegistroInvalido';
}

/** Si `valor` da un texto en cada idioma admitido. */
function esPorIdioma(valor: unknown): valor is PorIdioma {
  return esObjeto(valor) && IDIOMAS.every((idioma) => esTexto(valor[idioma]));
}
/** Si `valor` es una tabla cuyas entradas dan un texto en cada idioma admitido. */
function esTablaPorIdioma(valor: unknown): valor is Record<string, PorIdioma> {
  return esObjeto(valor) && Object.values(valor).every(esPorIdioma);
}
/**
 * Si `valor` tiene la forma de una lectura: lo que leen las páginas, con un nivel y un tipo de los admitidos; lo
 * opcional, ausente o bien.
 */
function esLectura(valor: unknown): valor is Lectura {
  if (!esObjeto(valor)) {
    return false;
  }
  const { es, ca, fecha } = valor;
  const textosDe = (lengua: unknown) =>
    esObjeto(lengua) && esTexto(lengua.titulo) && esTexto(lengua.resumen) && esTexto(lengua.interes);
  const opcional = (campo: unknown, tipo: (otro: unknown) => boolean) => campo === undefined || tipo(campo);
  return (
    esTexto(valor.id) &&
    NIVELES.some((nivel) => nivel === valor.nivel) &&
    TIPOS.some(({ tipo }) => tipo === valor.tipo) &&
    [valor.fuente, valor.consultado, valor.licencia].every(esTexto) &&
    Array.isArray(valor.idiomas) &&
    valor.idiomas.every(esTexto) &&
    typeof valor.minutos === 'number' &&
    Number.isInteger(valor.minutos) &&
    valor.minutos > 0 &&
    (valor.enlace === null || esTexto(valor.enlace)) &&
    esObjeto(fecha) &&
    (fecha.iso === null || esTexto(fecha.iso)) &&
    esPorIdioma(fecha) &&
    textosDe(es) &&
    textosDe(ca) &&
    [valor.tema, valor.enlace_ca].every((campo) => opcional(campo, esTexto)) &&
    [valor.formato, valor.subtipo].every((campo) => opcional(campo, esPorIdioma))
  );
}

/**
 * El registro de lecturas, validado antes de tiparse: un campo que falta o de otro tipo es un error que nombra la
 * lectura, no un TypeError a mitad de escribir las páginas.
 * @param valor - El contenido de datos/lecturas.json, ya analizado.
 * @returns El mismo valor, tipado como registro.
 * @throws {RegistroInvalido} Si falta una parte del registro o una lectura no tiene la forma esperada.
 */
export function comoRegistro(valor: unknown): Registro {
  const rechazo = (que: string): RegistroInvalido => new RegistroInvalido(`datos/lecturas.json: ${que}`);
  if (!esObjeto(valor)) {
    throw rechazo('no es un objeto');
  }
  const { textos, temas, lecturas } = valor;
  if (!esTablaPorIdioma(textos)) {
    throw rechazo('«textos» debe dar cada clave en es y ca');
  }
  if (!esTablaPorIdioma(temas)) {
    throw rechazo('«temas» debe dar cada clave en es y ca');
  }
  if (!Array.isArray(lecturas)) {
    throw rechazo('«lecturas» debe ser una lista');
  }
  const mal = lecturas.find((lectura) => !esLectura(lectura));
  if (mal !== undefined) {
    throw rechazo(`la lectura ${JSON.stringify(esObjeto(mal) ? mal.id : mal)} no tiene la forma esperada`);
  }
  // La Biblioteca solo publica lo que se puede leer en castellano o en catalán.
  const ajena = (lecturas as Lectura[]).find(
    ({ idiomas }) => !idiomas.some((codigo) => codigo === 'es' || codigo === 'ca'),
  );
  if (ajena !== undefined) {
    throw rechazo(`la lectura ${JSON.stringify(ajena.id)} no se puede leer en castellano ni en catalán`);
  }
  return { textos, temas, lecturas };
}

/**
 * El registro de lecturas de datos/lecturas.json, validado.
 * @returns El registro tipado.
 * @throws {RegistroInvalido} Si el archivo no tiene la forma esperada.
 */
export function leerRegistro(): Registro {
  return comoRegistro(JSON.parse(readFileSync(REGISTRO, 'utf8')));
}
