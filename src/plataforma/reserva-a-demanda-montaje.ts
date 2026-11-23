/**
 * La ruta de la reserva a demanda solo existe con una autoridad que sabe reservar a demanda y con la actualización
 * configurada: de ella sale la confianza que el panel y la programada fijan también en sus reservas.
 */
import type { ConfiguracionAdministrativa } from '../administracion/configuracion.ts';
import type { ConfiguracionActualizacionGitHub } from '../administracion/configuracion-actualizacion.ts';
import { crearReceptorReservaADemanda } from '../administracion/reserva-a-demanda.ts';
import type { AlmacenTrabajosActualizacion } from '../administracion/trabajos.ts';
import type { AlmacenTrabajosDemanda } from './acceso-publico/trabajos-durable.ts';

export interface DemandaDelMontaje {
  readonly almacen: AlmacenTrabajosDemanda;
  /** El texto de `FARO_ACTUALIZACION_DEMANDA` tal como llega; sin él, la vía está cerrada. */
  readonly configuracion: string | undefined;
}
interface OpcionesReserva {
  readonly configuracion: ConfiguracionAdministrativa;
  readonly trabajos?: Pick<AlmacenTrabajosActualizacion, 'prepararTrabajos'>;
  readonly actualizacion?: {
    readonly configuracion: () => ConfiguracionActualizacionGitHub;
    readonly pedir?: typeof fetch;
  };
  readonly demanda?: DemandaDelMontaje;
}
type Receptor = (peticion: Request) => Promise<Response>;

/** Como las demás operaciones de la actualización, se prepara con la primera petición y un fallo se reintenta. */
export function reservaDelMontaje(opciones: OpcionesReserva): { readonly recibirReserva?: Receptor } {
  const { configuracion, trabajos, actualizacion, demanda } = opciones;
  if (!demanda || !actualizacion) {
    return {};
  }
  let actual: Promise<Receptor> | undefined;
  const montar = async () => {
    if (!trabajos) {
      throw new Error('La reserva a demanda requiere un almacén durable de trabajos');
    }
    const { confianza } = actualizacion.configuracion();
    const recibir = crearReceptorReservaADemanda({
      origen: configuracion.origen,
      permitirHttpLocal: configuracion.permitirHttpLocal,
      confianza,
      configuracionDemanda: demanda.configuracion,
      almacen: demanda.almacen,
      ...(actualizacion.pedir ? { pedir: actualizacion.pedir } : {}),
    });
    await trabajos.prepararTrabajos();
    return recibir;
  };
  const obtener = () => {
    if (!actual) {
      const candidata = montar();
      actual = candidata;
      void candidata.catch(() => {
        if (actual === candidata) {
          actual = undefined;
        }
      });
    }
    return actual;
  };
  return { recibirReserva: async (peticion) => (await obtener())(peticion) };
}
