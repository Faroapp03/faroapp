// La espera del recorrido a los archivos extra del paquete (la tabla de vectores y el clasificador de fragmentos),
// aparte del motor para poder probarla en Node con promesas y plazos inyectados. El motor del navegador
// (plataforma/navegador/motor.ts) los pide al arrancar; un paso del recorrido espera a que terminen de cargar, bien o
// mal, como mucho ESPERA_MAXIMA_DE_LOS_EXTRAS_MS. Una vez terminadas las cargas, no espera nada más.

import { MS_POR_SEGUNDO } from '../../comun/tiempo.ts';

/**
 * Lo que un paso del recorrido espera a los extras: veinte segundos. Con ellos ya guardados en el dispositivo
 * (el service worker no deja arrancar el motor sin lo que necesita el primer análisis, extras incluidos), leer y cargar los dos archivos cuesta unos 70 ms en un
 * Mac y, por cinco, menos de medio segundo en un móvil lento. El plazo solo se agota si algo se ha quedado colgado; la
 * pantalla avisa de que «Faro se está preparando…» mientras tanto (web/scripts/recorrido/paso-ocupacion.js).
 */
const SEGUNDOS_DE_ESPERA = 20;
export const ESPERA_MAXIMA_DE_LOS_EXTRAS_MS = SEGUNDOS_DE_ESPERA * MS_POR_SEGUNDO;

/** Un plazo que se puede cancelar. El real usa setTimeout; las pruebas inyectan el suyo. */
export type Plazo = (ms: number) => { readonly vencido: Promise<void>; readonly cancelar: () => void };

/** El plazo real, con setTimeout. */
const plazoReal: Plazo = (ms) => {
  let id: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<void>((resolver) => {
    id = setTimeout(resolver, ms);
  });
  return { vencido, cancelar: () => clearTimeout(id) };
};

/**
 * Prepara la espera a unas cargas. Cada llamada espera a que terminen todas (bien o mal) como mucho `ms`; cuando ya han
 * terminado, responde enseguida y sin crear ningún plazo.
 *
 * @param cargas - Las cargas en curso; un rechazo cuenta como terminada.
 * @param ms - Lo que espera cada llamada como mucho.
 * @param plazo - El plazo; por defecto, el real.
 * @returns Una función que dice si las cargas han terminado a tiempo.
 */
export function crearEsperaDeLosExtras(
  cargas: readonly Promise<unknown>[],
  ms: number,
  plazo: Plazo = plazoReal,
): () => Promise<boolean> {
  let terminadas = false;
  const todas = Promise.allSettled(cargas).then(() => {
    terminadas = true;
    return true;
  });
  return async () => {
    if (terminadas) {
      return true;
    }
    const { vencido, cancelar } = plazo(ms);
    try {
      return await Promise.race([todas, vencido.then(() => false)]);
    } finally {
      cancelar();
    }
  };
}
