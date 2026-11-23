// «Borrar todo» en una pestaña lo avisa a las demás de esta web por un BroadcastChannel: cada una ejecuta al recibir el
// aviso su acción de olvido, en vez de seguir mostrando lo que la persona acaba de borrar. Este módulo tiene el canal,
// el aviso de quien borra (borrar-datos.js) y la escucha; el recorrido lo recibe en recorrido.js.

/** El nombre del canal: el mismo para quien avisa y para quien escucha. */
export const CANAL_DE_BORRADO = 'faro-borrar';
/** Lo que se envía por el canal: quien escucha no lo lee, le basta con recibir algo. */
const MENSAJE_DE_BORRADO = 'borrar-todo';

/**
 * Avisa a las demás pestañas de que se han borrado los datos de Faro. Sin BroadcastChannel (navegadores antiguos), no
 * avisa a nadie.
 * @returns {void}
 */
export function avisarBorrado() {
  if (typeof BroadcastChannel !== 'function') {
    return;
  }
  const canal = new BroadcastChannel(CANAL_DE_BORRADO);
  canal.postMessage(MENSAJE_DE_BORRADO);
  canal.close();
}

/**
 * Llama a `alBorrar` cada vez que otra pestaña avisa de que ha borrado los datos de Faro. Un navegador sin
 * BroadcastChannel no avisa ni escucha: cada pestaña sigue con lo suyo hasta recargarse.
 * @param {() => void} alBorrar @returns {() => void} cómo dejar de escuchar
 */
export function escucharBorrado(alBorrar) {
  if (typeof BroadcastChannel !== 'function') {
    return () => {};
  }
  const canal = new BroadcastChannel(CANAL_DE_BORRADO);
  canal.addEventListener('message', () => alBorrar());
  return () => canal.close();
}
