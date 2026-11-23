import type { CubrirVencimiento } from '../../src/plataforma/acceso-publico/mantenimiento-durable.ts';

/** Para pruebas que no miran la retención de los contadores: escribe sin programar ninguna alarma. */
export const escribirSinAlarma: CubrirVencimiento = async (_fecha, escribir) => escribir();
/** Alarma persistente en memoria para el binding local; no simula que Cloudflare la haya ejecutado. */
export function alarmaDurableDePrueba() {
  let fecha: number | null = null;
  return {
    getAlarm: async (): Promise<number | null> => fecha,
    setAlarm: async (siguiente: number): Promise<void> => {
      fecha = siguiente;
    },
    deleteAlarm: async (): Promise<void> => {
      fecha = null;
    },
  };
}
