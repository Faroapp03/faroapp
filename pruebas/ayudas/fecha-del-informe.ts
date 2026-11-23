import { fileURLToPath } from 'node:url';
import { fechaDeLosDatos } from '../../src/dominio/fecha-de-los-datos.ts';
import { cargarDatos } from '../../src/plataforma/node/datos.ts';

/**
 * La fecha de un informe de prueba calculado con el paquete real: la de su copia de cursos más reciente. Una fecha
 * anterior en dos o más días la rechaza el informe como reloj atrasado; con esta, el informe sale siempre, también al
 * renovar los datos.
 */
const fecha = fechaDeLosDatos(cargarDatos(fileURLToPath(new URL('../../datos/', import.meta.url))));
if (fecha === null) {
  throw new Error('El paquete real no trae ninguna copia de cursos con fecha');
}
export const FECHA_DEL_INFORME: string = fecha;
