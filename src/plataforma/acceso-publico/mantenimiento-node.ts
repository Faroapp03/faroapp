/** Limpieza física Node: un solo temporizador sin retener el proceso, retirado al cerrar el almacén. */

import type { AlmacenAccesos } from '../../administracion/accesos.ts';
import { registrarFalloMantenimiento } from '../../api/errores.ts';

const MAX_ESPERA_NODE_MS = 2_147_483_647;
const REINTENTO_MS = 3_600_000;
const MAX_INSTANTE_DATE = 8_640_000_000_000_000;
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: las operaciones y el cierre comparten un único temporizador y revisión de planificación, sin estado global.
export function crearMantenimientoAccesosNode(
  almacen: AlmacenAccesos,
  proximo: () => Promise<number | null>,
  ahora: () => number = Date.now,
): {
  readonly accesos: AlmacenAccesos;
  reanudar(): void;
  cerrar(): void;
} {
  let temporizador: ReturnType<typeof setTimeout> | undefined,
    cerrado = false,
    revision = 0;
  function exigirAbierto(): void {
    if (cerrado) {
      throw new Error('El registro operativo está cerrado');
    }
  }
  function ponerTemporizador(espera: number): void {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      temporizador = undefined;
      void mantener();
    }, espera);
    temporizador.unref();
  }
  function asegurarReintento(): void {
    if (!cerrado && temporizador === undefined) {
      ponerTemporizador(REINTENTO_MS);
    }
  }
  async function programar(): Promise<void> {
    const turno = ++revision,
      fecha = await proximo();
    if (cerrado || turno !== revision) {
      return;
    }
    const hoy = ahora();
    if (
      !Number.isSafeInteger(hoy) ||
      hoy < 0 ||
      hoy > MAX_INSTANTE_DATE ||
      (fecha !== null && (!Number.isSafeInteger(fecha) || fecha < 0 || fecha > MAX_INSTANTE_DATE))
    ) {
      throw new Error('Reloj de mantenimiento no válido');
    }
    clearTimeout(temporizador);
    temporizador = undefined;
    if (fecha !== null) {
      ponerTemporizador(Math.min(MAX_ESPERA_NODE_MS, Math.max(0, fecha - hoy)));
    }
  }
  async function mantener(): Promise<void> {
    if (cerrado) {
      return;
    }
    try {
      await almacen.depurarAccesos();
      await programar();
    } catch (error) {
      registrarFalloMantenimiento('registro-conectividad', error);
      asegurarReintento();
    }
  }
  return {
    reanudar: () => {
      exigirAbierto();
      void programar().catch((error: unknown) => {
        registrarFalloMantenimiento('registro-conectividad', error);
        asegurarReintento();
      });
    },
    accesos: {
      prepararAccesos: async () => {
        exigirAbierto();
        await almacen.prepararAccesos();
        await programar();
      },
      registrarAcceso: async (uso) => {
        exigirAbierto();
        asegurarReintento();
        await almacen.registrarAcceso(uso);
        await programar();
      },
      depurarAccesos: async () => {
        exigirAbierto();
        asegurarReintento();
        await almacen.depurarAccesos();
        await programar();
      },
      leerAccesosDeSesion: async (acceso, pagina) => {
        exigirAbierto();
        const resultado = await almacen.leerAccesosDeSesion(acceso, pagina);
        if (resultado.estado === 'activa') {
          await programar();
        }
        return resultado;
      },
    },
    cerrar: () => {
      cerrado = true;
      revision++;
      clearTimeout(temporizador);
      temporizador = undefined;
    },
  };
}
