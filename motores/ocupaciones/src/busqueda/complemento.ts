// Dónde empieza el complemento de un oficio o de un nombre del catálogo: lo que sigue a «de», «del» o «d'» después de
// la primera palabra del núcleo que no es genérica. En «limpiador de oficinas» el núcleo es «limpiador» y el
// complemento, «oficinas»; en «maestro de educación primaria», «educación primaria»; «técnico de sonido» no tiene
// complemento, porque su núcleo («técnico») es genérico y «sonido» es lo que dice el oficio; «maestro cervecero»
// tampoco: «cervecero» no es un complemento de «maestro», es otro oficio. La consulta (consulta.ts) rebaja el peso
// del complemento buscado y la puntuación (puntuacion.ts) el de las palabras del complemento de cada nombre, así que
// el sentido principal de un título («maestro de…») gana a los compuestos («maestro cervecero»), que necesitan su
// segunda palabra en la búsqueda para subir.

import { esGenerica } from './genericas.ts';
import { formaComun, palabrasDe } from './palabras.ts';
import { normalizar } from '../../../../src/comun/texto.ts';

/** Lo que abre el complemento: «de», «del» y el resto del apóstrofo de «d'». */
const ABREN_COMPLEMENTO = new Set(['de', 'del', 'd']);

/**
 * La posición, entre las palabras que cuentan del texto (palabrasDe), en que empieza su complemento.
 *
 * @param texto - Un oficio o un nombre del catálogo.
 * @returns La posición de la primera palabra del complemento; el número de palabras si no tiene.
 */
export function inicioDelComplemento(texto: string): number {
  let nucleo = false;
  let contadas = 0;
  for (const palabra of normalizar(texto).split(' ')) {
    if (nucleo && ABREN_COMPLEMENTO.has(palabra)) {
      return contadas;
    }
    if (palabrasDe(palabra).length) {
      contadas += 1;
      nucleo ||= !esGenerica(formaComun(palabra));
    }
  }
  return contadas;
}
