/**
 * El cliente del Worker para la reserva a demanda: la misma operación que el objeto durable expone en su ruta privada,
 * sobre el mismo enlace protegido que las demás operaciones del almacén.
 */
import { pedirDemandaDurable } from './trabajos-demanda-sqlite.ts';
import type { AlmacenTrabajosDemanda, PeticionDemanda, ResultadoDemanda } from './trabajos-durable.ts';
import { AlmacenVigilanteDurable } from './vigilante-cliente-durable.ts';

export class AlmacenDemandaDurable extends AlmacenVigilanteDurable implements AlmacenTrabajosDemanda {
  operarDemanda(peticion: PeticionDemanda): Promise<ResultadoDemanda> {
    return pedirDemandaDurable((ruta, cuerpo, leer) => this.enviar(ruta, cuerpo, leer), peticion);
  }
}
