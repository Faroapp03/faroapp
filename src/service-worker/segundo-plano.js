import './comprobado.js';
import { prepararPaquete } from './paquete.js';

/**
 * El navegador de un Worker con la Network Information API (ahorraDatos).
 * @typedef {{ connection?: { saveData?: boolean, type?: string } }} NavegadorConRed
 */

// ---------- Actualización en segundo plano ----------
// Donde el navegador ofrece la sincronización periódica en segundo plano (Periodic Background Sync: hoy, los de
// Chromium con Faro instalado), la página la pide (scripts/instalacion.js) y el navegador despierta a este service
// worker cuando él decide: Faro pide como mucho una vez al día, y el navegador lo espacia más si Faro se usa poco.
// Entonces:
// 1. Busca una versión nueva de la web (registration.update()). Si la hay, el navegador la instala como al abrir la
//    web, con las mismas reglas (guardarCopia): todo o nada, y cada archivo solo si cuadra con su huella. Si algo no
//    cuadra, la instalación falla y sigue esta versión, entera.
// 2. Con una versión nueva instalada y en espera, le pide que prepare ya la copia de sus datos (PRECARGAR_PAQUETE),
//    comprobada archivo a archivo contra su manifiesto, sin borrar la de esta versión, que sigue sirviendo hasta que la
//    nueva se active. Sin versión nueva, completa la copia de los datos de esta, si un intento anterior se cortó.
// La versión nueva no se activa aquí: se activa como siempre, cuando una página la pide (scripts/instalacion.js: sola
// si nadie tiene nada que perder), y como ya está bajada y comprobada, entra al abrir Faro sin esperar a la red.
// Con datos móviles o con el ahorro de datos activado no se baja nada: es una descarga que la persona no ha pedido, y
// lo que no se baja en segundo plano se baja al abrir Faro, como siempre. Si el dispositivo se está cargando no lo
// puede saber un service worker (la API de la batería solo existe en las páginas), así que no se mira.
// Sin el evento (Safari, Firefox o Faro sin instalar), nada de esto ocurre: Faro se actualiza al abrirlo.

/** La etiqueta de la sincronización periódica que pide scripts/instalacion.js. */
const ACTUALIZACION_PERIODICA = 'faro-actualizar';
/** Mensaje con que esta versión pide a la siguiente, en espera, que prepare la copia de sus datos. */
const PRECARGAR_PAQUETE = 'PRECARGAR_PAQUETE';
/** Los estados en que una versión ya no se está instalando: en espera (o más allá) o descartada. */
const INSTALACION_TERMINADA = new Set(['installed', 'activating', 'activated', 'redundant']);

/**
 * La conexión es de datos móviles o la persona ha pedido ahorrar datos. Lo dice la Network Information API, que solo
 * tienen los navegadores de Chromium, los mismos que despiertan al service worker; `type` solo lo dan en Android y
 * ChromeOS.
 */
function ahorraDatos() {
  const conexion = /** @type {NavegadorConRed} */ (self.navigator)?.connection;
  return conexion?.saveData === true || conexion?.type === 'cellular';
}

/**
 * Espera a que `trabajador` deje de instalarse. No necesita plazo propio: el navegador limita lo que dura la
 * instalación, y una que no acaba bien termina descartada (redundant).
 *
 * @param {ServiceWorker} trabajador - La versión que se está instalando.
 * @returns {Promise<void>}
 */
function finDeLaInstalacion(trabajador) {
  return new Promise(
    /** @param {() => void} resolver */ (resolver) => {
      const mirar = () => {
        if (!INSTALACION_TERMINADA.has(trabajador.state)) {
          return;
        }
        trabajador.removeEventListener('statechange', mirar);
        resolver();
      };
      trabajador.addEventListener('statechange', mirar);
      mirar();
    },
  );
}

/** Busca la versión siguiente y prepara sus datos o, si no la hay, completa los de esta (ver arriba). */
async function actualizarEnSegundoPlano() {
  if (ahorraDatos()) {
    return;
  }
  try {
    await self.registration.update();
  } catch (error) {
    // Sin red o con el servidor caído: se vuelve a intentar en la próxima sincronización o al abrir Faro.
    console.warn('Faro: no se ha podido buscar una versión nueva en segundo plano.', error);
    return;
  }
  const instalando = self.registration.installing;
  if (instalando) {
    await finDeLaInstalacion(instalando);
  }
  const enEspera = self.registration.waiting;
  if (enEspera) {
    enEspera.postMessage({ type: PRECARGAR_PAQUETE });
  } else {
    await prepararPaquete();
  }
}

export { ACTUALIZACION_PERIODICA, actualizarEnSegundoPlano, PRECARGAR_PAQUETE };
