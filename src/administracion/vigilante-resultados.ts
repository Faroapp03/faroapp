/** Resultado interno de la autoridad, separado del DTO que se entrega al panel. */
import type { SesionPanelActiva, SesionPanelInactiva } from './sesion.ts';
import type { EvaluacionVigilante, OrigenDatosVigilante } from './vigilante.ts';

export interface FilaVigilanteInterna {
  readonly id: number;
  readonly clave: string;
  readonly estado: 'incidencia' | 'conforme';
  readonly motivo: string;
  readonly observadoEn: number;
  readonly evaluadoEn: number;
  readonly origen: 'recibo' | 'lectura-local' | 'no-registrado';
}
export type ComprobacionVigilanteSesion =
  | SesionPanelInactiva
  | Readonly<{
      estado: 'activa';
      sesion: SesionPanelActiva;
      vigilante: Readonly<{
        origenDatos: OrigenDatosVigilante;
        evaluacion: EvaluacionVigilante;
        incidencias: readonly FilaVigilanteInterna[];
        revision: number | null;
      }>;
    }>;
export type HistorialVigilanteSesion =
  | SesionPanelInactiva
  | Readonly<{
      estado: 'activa';
      sesion: SesionPanelActiva;
      historial: Readonly<{ revision: number; decisiones: readonly FilaVigilanteInterna[]; siguiente: number | null }>;
    }>;
