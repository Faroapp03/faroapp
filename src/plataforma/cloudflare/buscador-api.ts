import { prepararBuscador } from '../../../motores/ocupaciones/src/index.ts';
import { soltarTextoEnBase64 } from '../../comun/vectores.ts';
import { PAQUETE as datos } from './paquete.ts';

let preparado = false;

/** Prepara los datos del buscador cuando se monta la API y conserva el resultado para las siguientes peticiones. */
export function prepararBuscadorDeLaApi(): void {
  if (!preparado) {
    if (!datos.vectores) {
      throw new Error('El paquete de datos no trae los vectores de las tareas oficiales');
    }
    prepararBuscador(datos);
    soltarTextoEnBase64(datos.vectores);
    preparado = true;
  }
}
