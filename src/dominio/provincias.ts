// ¿En qué provincias se contrata tu ocupación? Los contratos firmados en 12 meses en cada provincia, según el
// Observatori del Treball (que publica comarcas; plataforma_datos/mercado/fuentes/observatori/lector.py las suma por provincia con la
// tabla del Idescat). Se dice «de cada 100 contratos de tu ocupación firmados en Cataluña, 84 en la provincia de
// Barcelona». Los «de cada 100» se redondean por restos mayores, para que las cuatro provincias sumen siempre 100 en la
// misma fila. Describe dónde se contrata al grupo, nunca dónde le iría mejor a la persona: no ordena opciones para
// nadie.

import type { Idioma } from '../comun/idioma.ts';
import { compararPorCodigo } from '../comun/orden.js';
import type { Lengua } from './lengua.ts';
import type { GrupoContratacion } from './tipos-informe.ts';
import type { DatosObservatori, Provincia, ProvinciasDeLaOcupacion } from './tipos-provincias.ts';

/** El total que se reparte: «de cada 100 contratos». */
const DE_CADA = 100;

/**
 * El rótulo de los 12 meses de los indicadores del Observatori (contratos firmados, personas demandantes y contratos por
 * provincia), en un idioma. Todos salen de la misma ventana de 12 meses de la fuente, la de los contratos firmados; la
 * otra medida del contrato indefinido, la del censo, tiene su propio periodo y no se usa aquí.
 *
 * @param observatori - Paquete del Observatori del Treball.
 * @param idioma - Idioma del rótulo.
 * @returns El periodo, como «de julio de 2025 a junio de 2026».
 */
export function periodoDelObservatori(observatori: DatosObservatori, idioma: Idioma): string {
  return observatori.contrato_indefinido.contratos_firmados.periodo[idioma];
}

/**
 * Reparte DE_CADA entre las partes en proporción a su peso, en enteros que suman DE_CADA (método de los restos
 * mayores): cada parte recibe la parte entera de su cuota y las unidades que faltan van a los restos más grandes; a
 * igual resto, a la parte que va antes en la lista. La aritmética es entera, así que dos restos iguales son iguales
 * exactamente y el desempate por posición siempre actúa.
 *
 * @param pesos - Enteros no negativos (contratos) que no suman 0.
 * @returns Un entero por peso, en el mismo orden, que suman DE_CADA.
 */
function deCada100PorRestosMayores(pesos: readonly number[]): number[] {
  const total = pesos.reduce((suma, peso) => suma + peso, 0);
  const partes = pesos.map((peso, posicion) => {
    const resto = (DE_CADA * peso) % total;
    return { posicion, resto, entero: (DE_CADA * peso - resto) / total };
  });
  const faltan = DE_CADA - partes.reduce((suma, { entero }) => suma + entero, 0);
  const porResto = [...partes];
  porResto.sort((a, b) => b.resto - a.resto || a.posicion - b.posicion);
  for (const parte of porResto.slice(0, faltan)) {
    parte.entero += 1;
  }
  return partes.map(({ entero }) => entero);
}

/**
 * Las provincias de la ocupación, o null si no se enseñan: sin el paquete, si la ocupación se reparte entre varios
 * grupos (nunca se elige uno por la persona) o si tiene menos de `min_base` contratos en Cataluña.
 *
 * @param observatori - Paquete del Observatori del Treball, si el despliegue lo tiene.
 * @param contratacion - Grupos de contratación CNO-11 de la ocupación.
 * @param lengua - Lengua del informe, para el rótulo del periodo.
 * @returns Las provincias de más a menos contratos, con sus «de cada 100» que suman 100, o null.
 */
export function provinciasDeLaOcupacion(
  observatori: DatosObservatori | undefined,
  contratacion: readonly GrupoContratacion[],
  lengua: Lengua,
): ProvinciasDeLaOcupacion | null {
  if (!observatori || contratacion.length !== 1) {
    return null;
  }
  // La longitud comprobada garantiza el único grupo de contratación.
  const { cno11, grupo } = contratacion[0] as GrupoContratacion;
  const porProvincia = observatori.provincias.cno4[cno11];
  if (!porProvincia) {
    return null;
  }
  const total = Object.values(porProvincia).reduce((suma, contratos) => suma + contratos, 0);
  if (total < observatori.min_base) {
    return null;
  }
  // La cadena construye las cuatro provincias y valida su suma; Object.entries pierde ese tipo de claves.
  const ordenadas = (Object.entries(porProvincia) as [Provincia, number][]).sort(
    ([provinciaA, contratosA], [provinciaB, contratosB]) =>
      contratosB - contratosA || compararPorCodigo(provinciaA, provinciaB),
  );
  const deCada100 = deCada100PorRestosMayores(ordenadas.map(([, contratos]) => contratos));
  const provincias = ordenadas.map(([provincia, contratos], posicion) => ({
    provincia,
    contratos,
    // El reparto recibe una entrada por provincia y devuelve una cuota en cada posición.
    deCada100: deCada100[posicion] as number,
  }));
  const periodo = periodoDelObservatori(observatori, lengua.idioma);
  return { cno11, grupo, periodo, total, provincias };
}
