/** Declara capacidades configuradas, sin afirmar que sus autoridades estén preparadas. */
import type { ServerResponse } from 'node:http';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import type { AdministracionMontada } from '../administracion.ts';

export function servirCapacidadesPanel(
  administracion: AdministracionMontada | undefined,
  respuesta: ServerResponse,
): boolean {
  if (!administracion) {
    return false;
  }
  const capacidades = administracion.capacidadesPanel ?? {
    controles: false,
    actualizacion: false,
    vigilante: false,
    recorrido: false,
  };
  respuesta.writeHead(ESTADO_HTTP.correcto, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  respuesta.end(JSON.stringify({ version: 1, ...capacidades }));
  return true;
}
