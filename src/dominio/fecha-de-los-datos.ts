import { diaUtc, esDiaReal, MS_POR_DIA } from '../comun/tiempo.ts';
import { InvarianteRoto } from './errores.ts';
import type { Datos } from './tipos-paquete.ts';

/**
 * El día de cada copia de cursos del paquete, con el nombre de su fuente: las que el informe compara con su fecha para
 * decidir qué cursos han terminado. Una fuente ausente del paquete no aparece.
 */
function copiasDeCursos(datos: Datos): [string, unknown][] {
  return [
    ['formacion.fecha_cursos', datos.formacion?.fecha_cursos],
    ['consorci.fecha_copia', datos.consorci?.fecha_copia],
    ['fundae.consulta', datos.fundae?.consulta],
    ['citilab.copia', datos.citilab?.copia],
  ].filter(([, dia]) => dia !== undefined) as [string, unknown][];
}

/**
 * El día (AAAA-MM-DD) de la copia más reciente de los cursos del paquete: la fecha con la que el informe decide qué
 * cursos han terminado se compara siempre con las copias del SOC, del Consorci, de FUNDAE y de Citilab, y ninguna
 * existía antes de su día de copia. Es un día de calendario en España.
 *
 * @param datos - El paquete de datos.
 * @returns El día de la copia más reciente, o null si el paquete no trae ninguna fuente de cursos.
 * @throws {InvarianteRoto} Si la copia de una fuente presente no es un día real: el paquete no es válido y no se
 * compara una fecha con él a ciegas.
 */
export function fechaDeLosDatos(datos: Datos): string | null {
  const dias = copiasDeCursos(datos).map(([fuente, dia]) => {
    if (!esDiaReal(dia)) {
      throw new InvarianteRoto(`La copia de cursos ${fuente} del paquete no es un día real`);
    }
    return dia;
  });
  return dias.length === 0 ? null : dias.reduce((mayor, dia) => (dia > mayor ? dia : mayor));
}

/**
 * El primer día (AAAA-MM-DD) que puede marcar un reloj bien puesto: el anterior al de los datos. La fecha de los datos
 * es un día de España y el día civil de cualquier lugar del mundo puede ir, como mucho, un día por detrás del de España
 * en ese mismo instante; un día por detrás es posible con el reloj bien y dos o más no. Una fecha anterior a esta es,
 * con certeza, un reloj mal puesto; una posterior no se puede acreditar como errónea con los datos.
 *
 * @param datos - El paquete de datos.
 * @returns El día anterior al de la copia más reciente, o null si el paquete no trae cursos con fecha.
 * @throws {InvarianteRoto} Si la copia de una fuente presente no es un día real.
 */
export function primerDiaPosibleDelDispositivo(datos: Datos): string | null {
  const dia = fechaDeLosDatos(datos);
  return dia === null ? null : diaUtc(Date.parse(`${dia}T00:00:00Z`) - MS_POR_DIA);
}
