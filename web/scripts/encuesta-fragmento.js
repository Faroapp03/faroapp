// Primera dependencia de encuesta.js: recoge el código de la invitación del fragmento de la dirección (#codigo=…) y lo
// retira de la dirección de la pestaña al cargar (history.replaceState), así que no queda en la entrada de la pestaña
// ni a la vista si se copia la dirección. No borra el historial del navegador, que guarda la dirección con la que se
// abrió la página, ni impide que la lean los guiones que se ejecutan antes que este módulo. Son dos, propios:
// tema-inicial.js no lee la dirección, e idioma-inicial.js solo la lee entera cuando el enlace trae un idioma
// (?idioma=…), para retirarlo conservando lo demás, y ni la guarda ni la envía (pruebas/encuesta/pagina.test.ts lo
// comprueba ejecutándolo). Este guion no se adelanta a ellos porque, como guion clásico, tendría que pasar el código a
// encuesta.js en una variable global, que cualquier guion de la página podría leer.
// El fragmento no viaja al servidor ni sale como procedencia: el código solo sale de aquí en el cuerpo del envío.

/** La marca del fragmento que lleva el código, como la escribe el panel en cada enlace de profesional. */
const MARCA = '#codigo=';

/** @returns {string | null} El código del fragmento, o null si la dirección no lo trae. */
function recoger() {
  if (!location.hash.startsWith(MARCA)) {
    return null;
  }
  const valor = location.hash.slice(MARCA.length);
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  try {
    return decodeURIComponent(valor);
  } catch {
    return null;
  }
}

let codigo = recoger();

/**
 * Entrega el código a un único consumidor; la copia del módulo se descarta.
 * @returns {string | null}
 */
export function tomarCodigo() {
  const valor = codigo;
  codigo = null;
  return valor;
}
