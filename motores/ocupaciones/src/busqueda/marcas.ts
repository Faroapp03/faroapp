// Plataformas y grandes empleadores con que la gente describe su trabajo («trabajo en Mercadona», «rider de Glovo»,
// «Uber»). La lista (marcas.json) liga cada empresa a su actividad pública (clase CNAE-2009) y a 1-3 ocupaciones ESCO
// típicas de esa actividad. Es una pista de sector y una probabilidad previa suave, nunca una respuesta: Amazon puede
// ser almacén o reparto. La lista se escribió a partir de los mayores empleadores y plataformas de Cataluña y España,
// sin mirar el banco de evaluación. La clase CNAE de cada una se asigna por su actividad pública declarada, sin
// cotejarla con el Registro Mercantil.
// Las formas que también son palabras corrientes o nombres de pila («Dia», «Consum», «Zara», «Correos») solo cuentan
// detrás de una preposición («trabajo en Zara», «caixera del Consum»).

import { normalizar } from '../../../../src/comun/texto.ts';
import type { PistaDeSector, Sector } from './contexto.ts';
import lista from './marcas.json' with { type: 'json' };

/** Una actividad de la lista: su sector, su clase CNAE-2009 y sus ocupaciones ESCO típicas. */
interface Actividad {
  sector: Sector;
  cnae: string;
  actividad: string;
  ocupaciones: readonly string[];
}

/** Una empresa nombrada en el texto, con su actividad. */
export interface MarcaEncontrada {
  nombre: string;
  /** La forma con que aparece, normalizada («mercadona»). */
  forma: string;
  actividad: Actividad;
}

/** Preposiciones tras las que una forma ambigua sí nombra la empresa. */
const PREPOSICIONES = new Set(['en', 'a', 'al', 'de', 'del', 'd', 'per', 'para', 'pa', 'amb', 'con', 'pel']);

/** Cada forma de la lista, en palabras normalizadas, con su empresa y si necesita preposición delante. */
const FORMAS = lista.marcas.flatMap((marca) =>
  marca.formas.map((forma) => ({
    palabras: normalizar(forma).split(' '),
    nombre: marca.nombre,
    actividad: (lista.actividades as Record<string, Actividad>)[marca.actividad] as Actividad,
    conPreposicion: 'conPreposicion' in marca && marca.conPreposicion === true,
  })),
);

/**
 * Las empresas de la lista que nombra el texto, cada una una vez.
 *
 * @param texto - El texto de la búsqueda.
 * @returns Las empresas, en el orden de la lista.
 */
export function marcasDelTexto(texto: string): MarcaEncontrada[] {
  const palabras = normalizar(texto).split(' ');
  const encontradas = new Map<string, MarcaEncontrada>();
  for (const forma of FORMAS) {
    for (let i = 0; i + forma.palabras.length <= palabras.length; i++) {
      const coincide = forma.palabras.every((palabra, j) => palabras[i + j] === palabra);
      const valida = !forma.conPreposicion || PREPOSICIONES.has(palabras[i - 1] ?? '');
      if (coincide && valida && !encontradas.has(forma.nombre)) {
        encontradas.set(forma.nombre, {
          nombre: forma.nombre,
          forma: forma.palabras.join(' '),
          actividad: forma.actividad,
        });
      }
    }
  }
  return [...encontradas.values()];
}

/**
 * La pista de sector de una empresa: su sector, la forma con que aparece, los grupos CIUO-08 de sus ocupaciones
 * típicas, su nombre y su clase CNAE.
 *
 * @param marca - La empresa encontrada.
 * @param isco08De - El grupo CIUO-08 de una ocupación ESCO.
 * @returns La pista.
 */
export function pistaDeLaMarca(marca: MarcaEncontrada, isco08De: (esco: string) => string | undefined): PistaDeSector {
  const grupos = [...new Set(marca.actividad.ocupaciones.map(isco08De).filter((g): g is string => !!g))];
  return {
    sector: marca.actividad.sector,
    palabra: marca.forma,
    grupos,
    marca: marca.nombre,
    cnae: marca.actividad.cnae,
  };
}
