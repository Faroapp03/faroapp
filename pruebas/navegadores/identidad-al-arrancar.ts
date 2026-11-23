// La identidad web también para lo que el navegador pide por su cuenta: Chromium y Firefox no aplican la del contexto a
// la descarga del service worker, y el fixture la exige (sin esto la rechaza y el service worker no se registra). La
// usan todos los lanzadores de los ensayos (paquete-comun.mjs, actualizacion-sw.mjs y ensayo.ts).
import { IDENTIDAD_WEB } from '../../src/comun/identidad-web.ts';

/**
 * Las opciones de arranque de `motor` con la identidad web; `otrosDeChromium` son argumentos más de Chromium y
 * `agente`, otro agente de usuario derivado de la identidad (la móvil del ensayo del presupuesto de rendimiento).
 */
export function identidadAlArrancar(
  motor: string,
  otrosDeChromium: readonly string[] = [],
  agente: string = IDENTIDAD_WEB['User-Agent'],
): { args?: string[]; firefoxUserPrefs?: Record<string, string> } {
  if (motor === 'chromium') {
    return { args: [`--user-agent=${agente}`, ...otrosDeChromium] };
  }
  return motor === 'firefox' ? { firefoxUserPrefs: { 'general.useragent.override': agente } } : {};
}
