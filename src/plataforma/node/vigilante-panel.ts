/** La lectura ocurre fuera de SQLite; sesión y registro se vuelven a comprobar juntos. */

import type { ConfiguracionProgramada } from '../../administracion/configuracion-programada.ts';
import type { ConfiguracionVigilante } from '../../administracion/configuracion-vigilante.ts';
import { FalloLecturaVigilante } from '../../administracion/errores-vigilante.ts';
import type { LectorEstadoDatosPanel } from '../../administracion/estado-datos.js';
import type { CapacidadVigilantePanel } from '../../administracion/http-vigilante.ts';
import { proyectarComprobacion, proyectarHistorial } from '../../administracion/vigilante-proyeccion.ts';
import type { AlmacenSesionVigilanteSqlite } from '../acceso-publico/sesion-vigilante-sqlite.ts';
import { leerYComprobarVigilante } from './lectura-vigilante.ts';

export function crearVigilantePanelNode(
  almacen: AlmacenSesionVigilanteSqlite,
  configuracion: ConfiguracionVigilante,
  programada: ConfiguracionProgramada | undefined | (() => ConfiguracionProgramada | undefined),
  leer: LectorEstadoDatosPanel,
): CapacidadVigilantePanel {
  return {
    comprobar: (acceso, senal) => {
      senal.throwIfAborted();
      const programacion = typeof programada === 'function' ? programada() : programada;
      return leerYComprobarVigilante({
        configuracion,
        reloj: Date.now,
        senal,
        lector: leer,
        preparar: async () => {
          const estado = await almacen.exigirVigilanteDeSesion(acceso, configuracion);
          return estado.estado === 'activa' ? undefined : estado;
        },
        confirmar: async (datos) =>
          proyectarComprobacion(
            await almacen.comprobarVigilanteDeSesion(acceso, configuracion, programacion, {
              origen: 'lectura-local',
              datos,
            }),
          ),
        fallo: async (error) => {
          const resultado = await almacen.comprobarVigilanteDeSesion(acceso, configuracion, programacion, {
            origen: 'lectura-local',
            fallo: true,
          });
          if (resultado.estado !== 'activa') {
            return resultado;
          }
          throw new FalloLecturaVigilante('No se pudo observar el estado local', { cause: error });
        },
      });
    },
    historial: async (acceso, opciones) =>
      proyectarHistorial(await almacen.historialVigilanteDeSesion(acceso, configuracion, opciones)),
  };
}
