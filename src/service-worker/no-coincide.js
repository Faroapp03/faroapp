import './segundo-plano.js';
import { BASE, urlDe } from './catalogo.js';
import { SIN_GUARDAR } from './comprobado.js';
import { guardarCopia, HuellaQueNoCoincide } from './copia.js';
import { VERSION } from './generado.js';

// ---------- Instalación que no coincide ----------
// La copia completa guarda el motor al instalar, y si uno de sus archivos no es el de esta versión
// (HuellaQueNoCoincide), la instalación falla. Volver a intentarlo daría lo mismo, y en una primera visita no queda
// ningún service worker activo al que la página pueda preguntar (la sonda del motor solo la responde uno activo, «Lo
// comprobado»). Por eso, antes de fallar, el service worker se lo cuenta a las páginas abiertas de esta web, también a
// las que aún no controla (con su base: dos webs de Faro pueden compartir origen), y deja constancia del motivo y de
// cuándo en su propia copia de estado (COPIA_DEL_ESTADO). La lee solo la página (scripts/instalacion.js), y solo cuando
// ve descartarse una instalación que ha empezado a seguir. WebKit no conserva lo que escribe una instalación que falla:
// allí el motivo llega solo por el aviso, y una página que se abra después lo sabe por su propia instalación, que
// vuelve a fallar igual. Cada instalación empieza borrando la constancia, y la activación de una versión también: solo
// dice cómo acabó el último intento. No lleva el prefijo de las copias de la web (PREFIJO), que son versiones de ella.

/** La copia de estado de esta web y la dirección con que se guarda en ella la constancia. */
const COPIA_DEL_ESTADO = `faro-estado:${BASE.href}`;
const ESTADO_DE_LA_INSTALACION = urlDe('service-worker/instalacion.json');
/** Mensaje con que se cuenta a las páginas abiertas que la instalación ha fallado por un archivo que no coincide. */
const INSTALACION_QUE_NO_COINCIDE = 'INSTALACION_QUE_NO_COINCIDE';

/**
 * Cuenta a las páginas abiertas de esta web que la instalación falla porque `archivo` no es el de esta versión y deja
 * constancia de ello. No falla: sin páginas, queda la constancia (salvo en WebKit, ver arriba); sin espacio para la
 * constancia, el aviso ya ha salido.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 */
async function dejarConstancia(archivo) {
  console.warn(`Faro: la copia sin conexión no se puede guardar: ${archivo} no es el de esta versión.`);
  await avisarQueNoCoincide(archivo);
  try {
    const estado = await caches.open(COPIA_DEL_ESTADO);
    const constancia = JSON.stringify({ motivo: 'no-coincide', archivo, version: VERSION, cuando: Date.now() });
    await estado.put(
      ESTADO_DE_LA_INSTALACION,
      new Response(constancia, { headers: { 'content-type': 'application/json; charset=utf-8', ...SIN_GUARDAR } }),
    );
  } catch {
    // Sin espacio o sin permiso para guardarla: las páginas abiertas ya lo saben por el aviso.
  }
}

/**
 * Cuenta a las páginas abiertas de esta web, también a las no controladas, que `archivo` no coincide. No falla.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 */
async function avisarQueNoCoincide(archivo) {
  try {
    const ventanas = (await self.clients.matchAll?.({ type: 'window', includeUncontrolled: true })) ?? [];
    for (const ventana of ventanas) {
      ventana.postMessage({ type: INSTALACION_QUE_NO_COINCIDE, archivo, base: BASE.href });
    }
  } catch {
    // Sin páginas a las que contarlo: queda la constancia.
  }
}

/** La instalación: la copia de esta versión (guardarCopia) y, si un archivo no coincide, la constancia del fallo. */
async function instalarVersion() {
  await caches.delete(COPIA_DEL_ESTADO);
  try {
    await guardarCopia();
  } catch (error) {
    if (error instanceof HuellaQueNoCoincide) {
      await dejarConstancia(error.archivo);
    }
    throw error;
  }
}

export { COPIA_DEL_ESTADO, dejarConstancia, instalarVersion };
