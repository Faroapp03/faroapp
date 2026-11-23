// Los bancos y sus casos: cada frase con sus ocupaciones y grupos válidos. Los bancos se miden en el orden de su
// manifiesto (bancos.json, junto a ellos) y las frases en el de su archivo, porque la salida se compara posición a
// posición. El nombre de cada banco en los resultados lo da el manifiesto, no este código.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Opciones } from './opciones.ts';
import type { DatosDelPaquete } from './tipos.ts';

/** Un banco que se mide: su nombre en los resultados y su archivo. */
export interface Banco {
  readonly nombre: string;
  readonly archivo: string;
  /**
   * La clave con que se sortea el ruido de sus personas («clave/id#grupo»). Es explícita para que el sorteo no dependa
   * del nombre del banco ni de su archivo. El nombre, en cambio, va en el campo `banco` de cada resultado.
   */
  readonly claveDeRuido: string;
}

/** Una frase tal como viene en el banco. */
interface FraseDelBanco {
  readonly id: string;
  readonly lote?: number;
  readonly idioma?: string;
  readonly tipo?: string;
  readonly estilo?: string;
  readonly rasgos?: readonly string[];
  readonly texto: string;
  readonly esperadas?: readonly string[];
  readonly grupo?: string;
}

/** Un caso medido. El orden de los campos es el de la salida. */
export interface Caso {
  readonly banco: string;
  readonly id: string;
  readonly lote: number | null;
  readonly idioma: string;
  readonly tipo: string | null;
  readonly rasgos: readonly string[];
  readonly texto: string;
  readonly validas: { readonly esco: readonly string[]; readonly grupos: readonly string[] };
  readonly principal: string | undefined;
  readonly ambigua: boolean;
}

/** Desde cuántos grupos válidos una frase es ambigua. */
const GRUPOS_DE_UNA_AMBIGUA = 2;
const GRUPO_CIUO = /^\d{4}$/;

/** El manifiesto de una carpeta de bancos: cada banco con su nombre en los resultados y su archivo, en orden. */
interface Manifiesto {
  readonly bancos: readonly { readonly nombre: string; readonly archivo: string; readonly clave_de_ruido?: string }[];
}

/**
 * Los bancos de una carpeta, en el orden de su manifiesto.
 *
 * @param carpeta - La carpeta con bancos.json; los archivos se leen relativos a ella.
 * @returns Los bancos.
 */
export function bancosDe(carpeta: string): Banco[] {
  const manifiesto = JSON.parse(readFileSync(resolve(carpeta, 'bancos.json'), 'utf8')) as Manifiesto;
  return manifiesto.bancos.map((b) => {
    if (!b.clave_de_ruido) {
      throw new Error(`bancos.json: el banco «${b.nombre}» no tiene clave_de_ruido`);
    }
    return { nombre: b.nombre, archivo: resolve(carpeta, b.archivo), claveDeRuido: b.clave_de_ruido };
  });
}

/** Un banco de referencia: su nombre en los resultados, la huella de su archivo y su clave de ruido. */
interface BancoDeReferencia {
  readonly nombre: string;
  readonly sha256: string;
  readonly claveDeRuido: string;
}

/**
 * Los tres bancos de referencia, en su orden: su nombre, su huella y su clave de ruido. Con ellos, la medición es
 * comparable con la referencia de banco/README.md.
 */
export const BANCOS_DE_REFERENCIA: readonly BancoDeReferencia[] = [
  {
    nombre: 'banco-100',
    sha256: '18e505a24b5856e32508c1f37edadaa64cef65012fb3023f02f4a11e54c84889',
    claveDeRuido: 'banco-100',
  },
  {
    nombre: 'propios-12',
    sha256: '1dc714dc655ad48c37d6aea4db06df06c0ed611816256fc0e1be77f747ce2be6',
    claveDeRuido: 'propios-12',
  },
  {
    nombre: 'cobertura-2000',
    sha256: 'a2efb3d9f403d737d684d92dae0deb84b24731ada71ccfb237f7f19145690631',
    claveDeRuido: 'cobertura-2000',
  },
];

/** El grupo CIUO-08 de una ocupación ESCO. */
export const grupoDe = (datos: DatosDelPaquete, esco: string | undefined): string | undefined =>
  esco === undefined ? undefined : datos.esco.ocupaciones[esco]?.isco08;
const esGrupo = (g: unknown): g is string => typeof g === 'string' && GRUPO_CIUO.test(g);

function casoDe(datos: DatosDelPaquete, banco: string, f: FraseDelBanco): Caso {
  const esco = f.esperadas ?? [];
  const delBanco = esGrupo(f.grupo) ? f.grupo : null;
  const grupos = [...new Set([...esco.map((e) => grupoDe(datos, e)), delBanco].filter((g): g is string => Boolean(g)))];
  return {
    banco,
    id: f.id,
    lote: f.lote ?? null,
    idioma: f.idioma === 'ca' ? 'ca' : 'es',
    // Algunos bancos llaman «estilo» a lo que estos llaman «tipo».
    tipo: f.tipo ?? f.estilo ?? null,
    rasgos: f.rasgos ?? [],
    texto: f.texto,
    validas: { esco, grupos },
    // El grupo principal del banco (frases-2000 lo trae; si no, el de la primera esperada).
    principal: delBanco ?? grupoDe(datos, esco[0]),
    // Ambiguo: el texto admite varios grupos según el banco, o el banco lo marca como genérico ambiguo.
    ambigua: grupos.length >= GRUPOS_DE_UNA_AMBIGUA || (f.tipo ?? f.estilo) === 'generica_ambigua',
  };
}

/** Los bancos que se miden: los del manifiesto o, con --banco nombre=archivo, ese solo (con el nombre como clave). */
export function bancosMedidos(opciones: Opciones): Banco[] {
  if (!opciones.banco) {
    return bancosDe(opciones.bancos);
  }
  const banco = String(opciones.banco);
  const nombre = banco.slice(0, banco.indexOf('='));
  return [{ nombre, archivo: banco.slice(banco.indexOf('=') + 1), claveDeRuido: nombre }];
}

/**
 * Los casos que se miden, en orden: todos los de los bancos, o los de --casos, hasta --limite.
 *
 * @param datos - Los datos del paquete.
 * @param bancos - Los bancos medidos.
 * @param opciones - Las opciones de la medición.
 * @returns Los casos.
 */
export function leerCasos(datos: DatosDelPaquete, bancos: readonly Banco[], opciones: Opciones): Caso[] {
  const elegidos = new Set<string>(opciones.casos ? JSON.parse(readFileSync(String(opciones.casos), 'utf8')) : []);
  return bancos
    .flatMap(({ nombre, archivo }) => {
      const crudo = JSON.parse(readFileSync(archivo, 'utf8')) as { frases?: FraseDelBanco[]; casos?: FraseDelBanco[] };
      return (crudo.frases ?? crudo.casos ?? []).map((f) => casoDe(datos, nombre, f));
    })
    .filter((c) => !opciones.casos || elegidos.has(`${c.banco}/${c.id}`))
    .slice(0, opciones.limite || undefined);
}
