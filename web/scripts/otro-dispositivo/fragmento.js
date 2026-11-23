// «Pasar a otro dispositivo», al llegar: el código del resultado (recorrido.html#pasar=<código>) sale de la barra y
// del historial en cuanto se evalúa este módulo. recorrido.html lo carga como su primer módulo, antes que sitio.js,
// que espera al diccionario antes de dejar seguir a nadie: así el código no está en la dirección ni al terminar de
// leerse el documento (DOMContentLoaded), aunque el resto de la página no llegue a arrancar. Solo depende de formato.js
// y lo que este importa, que no esperan a nada. El código queda en memoria para el paso 4 (recibir.js).

import { codigoDelFragmento } from './formato.js';

/**
 * Lee el código del fragmento y lo quita de la barra y del historial (history.replaceState: la entrada del historial
 * se reescribe, no se añade otra). Devuelve el código o null si no lo había.
 * @returns {string | null}
 */
export function tomarCodigoDelFragmento() {
  const tomar =
    typeof window === 'undefined' ? undefined : Reflect.get(window, Symbol.for('faro.fragmento.transitorio'));
  const fragmento = typeof tomar === 'function' ? tomar() : location.hash;
  const codigo = codigoDelFragmento(fragmento ?? '');
  if (codigo === null) {
    return null;
  }
  if (typeof tomar !== 'function') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }
  return codigo;
}

/** El código con que se abrió la página, ya fuera de la dirección; null si no traía ninguno. */
export const codigoRecibido = tomarCodigoDelFragmento();
