// Comprobación de solo lectura previa a cada batería de navegadores: en una máquina virtual macOS, cada proceso de
// navegador deja abierta una conexión de AppleVideoToolboxParavirtualizationUserClient que no se libera hasta reiniciar
// la máquina. Al llegar a unas 1020 conexiones, WebKit deja de pintar (esperas de 15 s y capturas vacías) sin dar
// ningún error claro. Aquí se cuenta con `ioreg` y, si el controlador está casi lleno, se para antes de empezar.
// Solo mira en macOS y solo si el controlador existe; en Linux (GitHub) y en un Mac sin él no hace nada.

import { spawnSync } from 'node:child_process';
import { FalloDeComprobacion } from './fallo-de-comprobacion.ts';

/** La clase del controlador que consulta `ioreg`. */
export const CLASE_DEL_CONTROLADOR = 'AppleVideoToolboxParavirtualizationUserClient';
/** Dónde está `ioreg` en macOS; una ruta fija, no la que haya en el PATH. */
export const RUTA_DE_IOREG = '/usr/sbin/ioreg';
/** Las conexiones que admite el controlador antes de que WebKit deje de pintar (se observaron fallos hacia las 1020). */
export const CONEXIONES_APROXIMADAS_DEL_CONTROLADOR = 1024;
/**
 * Por encima de cuántas conexiones se para. Una batería de navegadores abre cientos de procesos y cada uno deja una
 * conexión: con menos de unas 124 de margen (1024 menos 900) puede agotar el controlador a mitad de la batería, y el
 * fallo aparecería como esperas y capturas vacías, lejos de su causa. Parar antes de empezar lo evita.
 */
export const UMBRAL_DE_CONEXIONES = 900;
/** Tiempo máximo de `ioreg`, que normalmente tarda unas centésimas de segundo. */
const PLAZO_DE_IOREG_MS = 15_000;
/** Con ~1020 conexiones la salida ocupa unos cientos de kilobytes; el tope, de 64 MiB, deja holgura sin ser ilimitado. */
const SALIDA_MAXIMA_BYTES = 67_108_864;
/** Una línea de `ioreg -r -c` por cada conexión: el mismo criterio que `grep -c 'o <clase>'`. */
const LINEA_DE_CONEXION = new RegExp(`o ${CLASE_DEL_CONTROLADOR}\\b`);

/** Lo que se puede variar en las pruebas; por defecto, la máquina real. */
export interface OpcionesDelControlador {
  /** Sistema operativo; solo `darwin` consulta. */
  readonly plataforma?: NodeJS.Platform;
  /** El ejecutable de `ioreg`. */
  readonly ioreg?: string;
  /** Destino de un aviso si `ioreg` existe pero no se puede leer; no para la batería. */
  readonly avisar?: (texto: string) => void;
}

/**
 * Cuántas conexiones abiertas tiene el controlador de vídeo de la máquina virtual.
 *
 * @param opciones - Plataforma, ejecutable y destino de avisos.
 * @returns El número de conexiones; 0 si no es macOS, si no hay `ioreg` o si el controlador no existe; undefined si
 *   `ioreg` existe pero no ha podido leerse (se avisa).
 */
export function conexionesDelControlador(opciones: OpcionesDelControlador = {}): number | undefined {
  const { plataforma = process.platform, ioreg = RUTA_DE_IOREG, avisar = console.error } = opciones;
  if (plataforma !== 'darwin') {
    return 0;
  }
  const resultado = spawnSync(ioreg, ['-r', '-c', CLASE_DEL_CONTROLADOR, '-w0'], {
    encoding: 'utf8',
    timeout: PLAZO_DE_IOREG_MS,
    maxBuffer: SALIDA_MAXIMA_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (resultado.error && 'code' in resultado.error && resultado.error.code === 'ENOENT') {
    return 0;
  }
  if (resultado.error || resultado.status !== 0) {
    const causa = resultado.error?.message ?? `terminó con ${resultado.status ?? resultado.signal}`;
    avisar(`No se ha podido leer el controlador de vídeo con ioreg (${causa}); no se comprueba su ocupación.`);
    return undefined;
  }
  return resultado.stdout.split('\n').filter((linea) => LINEA_DE_CONEXION.test(linea)).length;
}

/**
 * Para antes de una batería de navegadores si el controlador de vídeo de la máquina virtual está casi lleno. Solo
 * lee; no cierra nada ni reinicia nada. No dice nada si está por debajo del umbral.
 *
 * @param opciones - Plataforma, ejecutable y destino de avisos.
 * @throws {FalloDeComprobacion} Si las conexiones superan UMBRAL_DE_CONEXIONES.
 */
export function comprobarControladorDeVideo(opciones: OpcionesDelControlador = {}): void {
  const conexiones = conexionesDelControlador(opciones);
  if (conexiones !== undefined && conexiones > UMBRAL_DE_CONEXIONES) {
    throw new FalloDeComprobacion(
      `El controlador de vídeo de la máquina virtual está casi lleno (${conexiones} de ~${CONEXIONES_APROXIMADAS_DEL_CONTROLADOR} conexiones): reinicia la máquina virtual antes de las pruebas de navegador`,
    );
  }
}
