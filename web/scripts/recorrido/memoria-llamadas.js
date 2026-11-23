// Las respuestas de la API que ya se han pedido en esta página, para no pedirlas dos veces. Viven solo en la memoria
// de la página (el recorrido no guarda nada en el navegador) y se olvidan al borrar la conversación.
//
// Cada respuesta se guarda por su clave: la ruta de la lectura (/api/grupos), con su idioma. Se guarda la promesa, no
// solo el resultado: una segunda petición igual mientras la primera está en camino recibe la misma respuesta, sin otra
// llamada. Si la llamada falla o se cancela, se olvida, para poder volver a intentarla. Guarda como mucho
// MAX_RESPUESTAS_GUARDADAS: al pasar de ahí se olvida la más antigua, que se volvería a pedir si hiciera falta.

/**
 * Respuestas que se guardan como mucho en una página. Un recorrido pide unas pocas lecturas; el tope acota la memoria
 * en una sesión larga sin que un recorrido normal llegue a olvidar nada.
 */
const MAX_RESPUESTAS_GUARDADAS = 64;

/**
 * Clave → promesa de la respuesta, de la página entera, en el orden en que se guardaron (el de un Map): la escribe
 * unaVez, que la mantiene en MAX_RESPUESTAS_GUARDADAS como mucho, y la vacía olvidarLlamadas. Cada clave guarda la de
 * su llamada, y su tipo lo dice quien la pide (unaVez).
 * @type {Map<string, Promise<unknown>>}
 */
const memoria = new Map();

/**
 * Guarda `promesa` con `clave` y, si con ella se pasa de MAX_RESPUESTAS_GUARDADAS, olvida la más antigua.
 * @param {string} clave @param {Promise<unknown>} promesa @returns {void}
 */
function guardar(clave, promesa) {
  memoria.set(clave, promesa);
  if (memoria.size > MAX_RESPUESTAS_GUARDADAS) {
    const masAntigua = memoria.keys().next();
    if (!masAntigua.done) {
      memoria.delete(masAntigua.value);
    }
  }
}

/**
 * La respuesta guardada con `clave` o, si no la hay, la que dé `pedirla()`, que se guarda para la próxima vez. Quien
 * la pida mientras llega recibe la misma.
 * @template Respuesta
 * @param {string} clave @param {() => Promise<Respuesta>} pedirla @returns {Promise<Respuesta>}
 */
export function unaVez(clave, pedirla) {
  const guardada = memoria.get(clave);
  // Cada clave nombra una sola llamada (su ruta), y solo esa llamada la escribe aquí abajo: lo guardado con ella es una
  // promesa de su mismo tipo de respuesta.
  if (guardada) {
    return /** @type {Promise<Respuesta>} */ (guardada);
  }
  // Solo corre en el manejador de `catch`, siempre después de asignar `promesa`: nunca en la misma vuelta.
  const olvidar = () => {
    if (memoria.get(clave) === promesa) {
      memoria.delete(clave);
    }
  };
  const promesa = pedirla().catch((error) => {
    olvidar();
    throw error;
  });
  guardar(clave, promesa);
  return promesa;
}

/**
 * Olvida todas las respuestas: se usa al borrar la conversación.
 * @returns {void}
 */
export function olvidarLlamadas() {
  memoria.clear();
}
