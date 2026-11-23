// La versión de Faro con que se abrió esta página: la del service worker que la controlaba al cargarla. Si después toma
// el control otro (se ha activado una versión nueva, desde esta pestaña o desde otra), lo que la página pida a partir
// de entonces llegaría de la copia de la versión nueva. Mezclar archivos de dos versiones no da error: da una pantalla
// descolocada o un script que falla. Por eso lo que se carga tarde (el paso 4 del recorrido, el diccionario del otro
// idioma) lo mira antes de pedirse (scripts/recorrido.js y scripts/idioma.js).

/** El service worker que controla la página ahora; null si no hay ninguno o el navegador no lo soporta. */
function controlActual() {
  return globalThis.navigator?.serviceWorker?.controller ?? null;
}

/** El service worker que controlaba la página al abrirla; null si no había ninguno (primera visita, recarga forzada que omite el service worker, o sin soporte). */
const controlAlAbrir = controlActual();

/**
 * Desde que se abrió la página se ha activado otra versión de Faro. Sin service worker al abrirla no hay versión que
 * comparar: el primero que toma el control guarda la copia de lo mismo que se acaba de cargar. Si la página pierde el
 * control (se desregistró el service worker), también devuelve `true`: ya no es la versión con que se abrió.
 * @returns {boolean}
 */
export function versionCambiada() {
  if (controlAlAbrir === null) {
    return false;
  }
  return controlActual() !== controlAlAbrir;
}
