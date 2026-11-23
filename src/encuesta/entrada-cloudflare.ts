/**
 * La entrada de la encuesta en el Worker: el mismo almacén durable que el panel, y un punto por instancia con su
 * ventana de envíos. Se atiende tras la puerta del portal, como la página que la usa (cloudflare/worker-oficial.ts).
 */
import type { EspacioAccesoPublicoDurable } from '../plataforma/acceso-publico/durable.ts';
import { AlmacenEncuestaDurable } from './cliente-durable.ts';
import { crearPuntoDeEncuesta } from './punto-publico.ts';

export { RUTA_DE_LA_ENCUESTA } from './punto-publico.ts';

const recibirEncuesta = crearPuntoDeEncuesta();

export function responderEncuesta(
  peticion: Request,
  espacio: EspacioAccesoPublicoDurable | undefined,
): Promise<Response> {
  return recibirEncuesta(peticion, espacio ? new AlmacenEncuestaDurable(espacio) : undefined);
}
