/**
 * El estado de los datos que pide el panel y de qué actualización es. Mientras corre una actualización, el almacén de
 * trabajos sigue enseñando la última observación admitida y lo dice; el panel no tiene que deducirlo.
 */
import { type EstadoDatosPanel, type LectorEstadoDatosPanel, leerEstadoDatosPanel } from './estado-datos.js';

export interface LecturaDatosPanel {
  readonly datos: EstadoDatosPanel;
  /** Verdadero cuando después se ha reservado otra actualización que todavía no ha dejado sus datos. */
  readonly deLaActualizacionAnterior: boolean;
}
export type LectorDatosPanel = (senal: AbortSignal) => Promise<LecturaDatosPanel>;
/** Cada composición da una de las dos: la instalación local lee su archivo; el almacén de trabajos, su observación. */
export interface FuentesDatosPanel {
  /** Lectura de la instalación de mantenimiento; no inicia actualizaciones ni acredita despliegues. */
  readonly leerEstadoDatos?: LectorEstadoDatosPanel;
  readonly leerDatosConProcedencia?: LectorDatosPanel;
}
/** El lector que usa la ruta del panel, con la forma de los datos comprobada; undefined si no hay ninguno. */
export function lectorDatosPanel(fuentes: FuentesDatosPanel): LectorDatosPanel | undefined {
  const { leerEstadoDatos, leerDatosConProcedencia } = fuentes;
  if (leerDatosConProcedencia) {
    return async (senal) => {
      const { datos, deLaActualizacionAnterior } = await leerDatosConProcedencia(senal);
      return { datos: leerEstadoDatosPanel(datos), deLaActualizacionAnterior };
    };
  }
  if (leerEstadoDatos) {
    // El archivo local es siempre el de la última lectura de la instalación: no hay otra actualización por delante.
    return async (senal) => ({
      datos: leerEstadoDatosPanel(await leerEstadoDatos(senal)),
      deLaActualizacionAnterior: false,
    });
  }
  return undefined;
}
