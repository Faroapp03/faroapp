// Uso declarado de la IA generativa en el trabajo en el grupo de la persona, según la encuesta TIC-H del INE: el
// porcentaje de personas ocupadas de su grupo ISCO-08 de 2 cifras que dijo haberla usado en los tres meses anteriores
// (cálculo de Faro con los microdatos, con su intervalo) y, de quienes no la usaron en Cataluña en ocupaciones de su
// clase (manuales o no), cuántos dijeron que no sabían cómo (tabla del Idescat). Es lo que dicen las personas del
// grupo, no lo que pasa en el puesto de nadie, y nunca se presenta como un riesgo. Va en un bloque propio del informe,
// lejos de la nota, y no entra en ella.
//
// La cifra se busca por este orden: la del bloque del grupo, si está en uno; la del gran grupo, si se da entero;
// la del grupo; y, si no llega a las respuestas mínimas, la de su gran grupo. Así la cifra siempre describe a la
// gente que nombra.

import { lista } from '../comun/formato.ts';
import type { Lengua } from './lengua.ts';
import type { AlcanceDelUso, DatosTich, UsoDeclaradoDeLaIa, UsoEnLaEncuesta } from './tipos-contexto.ts';
import type { Datos } from './tipos-paquete.ts';

/** Una cifra de la encuesta, con su código y de quién es. */
interface CifraDeLaEncuesta {
  codigo: string;
  alcance: AlcanceDelUso;
  encuesta: UsoEnLaEncuesta;
}

/** La cifra de un grupo de la encuesta, si tiene las respuestas mínimas del paquete. */
function conRespuestasSuficientes(tich: DatosTich, encuesta: UsoEnLaEncuesta | undefined): UsoEnLaEncuesta | null {
  return encuesta && encuesta.muestra >= tich.min_muestra ? encuesta : null;
}

/** De quienes no la usaron en Cataluña en ocupaciones de la clase del grupo (manuales o no), cuántos no sabían cómo. */
function noSabianComo(tich: DatosTich, isco2: string): UsoDeclaradoDeLaIa['noSabianComo'] {
  const clase = tich.clase_por_isco2[isco2];
  const { anio, no_sabia_como_utilizarlas: porClase } = tich.motivos_no_uso;
  const pct = clase ? porClase[clase] : undefined;
  return clase && pct !== undefined ? { clase, pct, anio } : null;
}

/**
 * La cifra que corresponde a un grupo ISCO-08 de 2 cifras: la de su bloque, su gran grupo entero o la suya; si la
 * elegida no llega a las respuestas mínimas, la de su gran grupo.
 */
function cifraDelGrupo(tich: DatosTich, isco2: string): CifraDeLaEncuesta | null {
  const granGrupo = isco2.slice(0, 1);
  const bloque = tich.bloque_por_isco2[isco2];
  const enConjunto = bloque ?? (tich.grandes_grupos_enteros.includes(granGrupo) ? granGrupo : null);
  if (enConjunto !== null) {
    const encuesta = conRespuestasSuficientes(
      tich,
      bloque ? tich.espana_bloques[bloque] : tich.espana_isco1[granGrupo],
    );
    if (encuesta) {
      return { codigo: enConjunto, alcance: 'conjunto', encuesta };
    }
  } else {
    const delGrupo = conRespuestasSuficientes(tich, tich.espana_isco2[isco2]);
    if (delGrupo) {
      return { codigo: isco2, alcance: 'grupo', encuesta: delGrupo };
    }
  }
  const delGranGrupo = conRespuestasSuficientes(tich, tich.espana_isco1[granGrupo]);
  return delGranGrupo ? { codigo: granGrupo, alcance: 'gran-grupo', encuesta: delGranGrupo } : null;
}

/** El título oficial de una cifra; el de un bloque, con los de sus grupos («… y técnicos de …»). */
function tituloDe(tich: DatosTich, codigo: string, lengua: Pick<Lengua, 'tituloIsco' | 'idioma'>): string {
  const grupos = Object.keys(tich.bloque_por_isco2).filter((isco2) => tich.bloque_por_isco2[isco2] === codigo);
  if (grupos.length === 0) {
    return lengua.tituloIsco(codigo);
  }
  const titulos = grupos.map((isco2, i) => {
    const titulo = lengua.tituloIsco(isco2);
    return i === 0 ? titulo : titulo.charAt(0).toLowerCase() + titulo.slice(1);
  });
  return lista(titulos, lengua.idioma);
}

/**
 * El uso declarado de la IA para el grupo ISCO-08 de 2 cifras de un código de 4, con de quién es la cifra (el grupo, su
 * gran grupo o un conjunto). Null si el paquete no trae la encuesta o la cifra no llega a las respuestas mínimas.
 *
 * @param datos - El paquete de datos.
 * @param isco08 - El código ISCO-08 de 4 cifras.
 * @param lengua - La lengua del informe.
 * @returns El uso declarado, o null.
 */
export function usoDeclaradoDeLaIa(
  datos: Pick<Datos, 'tich'>,
  isco08: string,
  lengua: Pick<Lengua, 'tituloIsco' | 'idioma'>,
): UsoDeclaradoDeLaIa | null {
  const tich = datos.tich;
  if (!tich) {
    return null;
  }
  const isco2 = isco08.slice(0, 2);
  const cifra = cifraDelGrupo(tich, isco2);
  if (!cifra) {
    return null;
  }
  const { codigo, alcance, encuesta } = cifra;
  return {
    anio: tich.anio,
    codigo,
    grupo: tituloDe(tich, codigo, lengua),
    alcance,
    pct: encuesta.pct,
    intervalo: [encuesta.ic95[0], encuesta.ic95[1]],
    noSabianComo: noSabianComo(tich, isco2),
  };
}
