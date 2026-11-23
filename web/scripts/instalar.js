// La página «Instalar Faro» (instalar.html): dos pestañas, una para Brave, Chrome y Edge y otra para Safari y Firefox
// (scripts/etapas.js, variante «segmentos»). Al abrirla se ve la del navegador de quien la abre, según lo que el
// navegador ofrece y no según su nombre en el user agent: la familia Chromium expone navigator.userAgentData (Brave
// también, aunque no conozca beforeinstallprompt) o el evento beforeinstallprompt; Safari y Firefox, ninguno de los
// dos. Un fragmento en la dirección (#chromium, #safari-firefox) manda sobre esa elección. Para que etapas.js abra la
// pestaña elegida, la página la apunta en data-etapas-inicial antes de cargarlo.
//
// En un navegador Chromium, la pestaña de Brave, Chrome y Edge lleva siempre el botón «Descargar e instalar Faro»,
// salvo con Faro ya instalado («Faro ya está instalado» si se usa como aplicación, «Faro está instalado» cuando el
// navegador lo acaba de instalar). Si el navegador ofrece su ventana de instalación (scripts/instalacion.js, la única
// fuente del estado), el botón la abre; si no (Brave no la ofrece desde la página, ni ningún Chromium con Faro ya
// instalado), el botón despliega en el sitio los pasos de ese navegador, con el foco en ellos. Cuál es (Brave, Chrome o
// Edge) se sabe por navigator.brave, la interfaz propia de Brave, o por las marcas de userAgentData, y solo sirve para
// enseñar sus pasos; si no se sabe, se enseñan los de los tres. En Safari o Firefox esa pestaña no lleva botón: enseña
// los pasos directamente. Sin JavaScript se leen las dos pestañas seguidas, con los pasos y sin el botón. Empieza
// importando sitio.js: espera a que termine el intento de cargar su diccionario antes de escribir textos.

import './sitio.js';
import { porId } from './dom.js';
import { alCambiarLaInstalacion, estadoDeLaInstalacion, instalar } from './instalacion.js';

/** @import { EstadoDeLaInstalacion } from './instalacion.js' */

/** La pestaña de los navegadores Chromium (Brave, Chrome, Edge). */
const PESTANA_CHROMIUM = 'chromium';
/** La pestaña de los navegadores que se instalan a mano o no se instalan. */
const PESTANA_SAFARI_FIREFOX = 'safari-firefox';
/** Las marcas de userAgentData de cada navegador con pasos propios (data-navegador de instalar.html). */
const MARCAS = /** @type {const} */ ([
  ['Brave', 'brave'],
  ['Microsoft Edge', 'edge'],
  ['Google Chrome', 'chrome'],
]);

const pestanas = porId('instalar-navegadores');
const zonaDelEstado = porId('instalar-estado');
const accion = porId('instalar-accion');
const nota = porId('instalar-nota');
const boton = porId('instalar-boton', HTMLButtonElement);
const pasos = porId('instalar-pasos');
const abierta = porId('instalar-abierta');
const instalada = porId('instalar-instalada');

/**
 * Las marcas que declara el navegador en navigator.userAgentData (Client Hints: solo Chromium), o null si no lo tiene.
 * No está en los tipos del DOM: se comprueba su forma.
 * @returns {string[] | null}
 */
function marcasDelNavegador() {
  const datos = Reflect.get(navigator, 'userAgentData');
  if (typeof datos !== 'object' || datos === null) {
    return null;
  }
  const marcas = Reflect.get(datos, 'brands');
  return Array.isArray(marcas) ? marcas.map((marca) => String(Reflect.get(Object(marca), 'brand'))) : [];
}

/** Si el navegador es de la familia Chromium, por lo que ofrece: userAgentData o beforeinstallprompt. */
function esChromium() {
  return marcasDelNavegador() !== null || 'onbeforeinstallprompt' in window || estadoDeLaInstalacion() === 'disponible';
}

/**
 * Cuál de los navegadores con pasos propios es: Brave por su interfaz navigator.brave; los demás, por su marca.
 * @returns {string | null} El valor de su data-navegador, o null si no se sabe.
 */
function navegadorConPasos() {
  if ('brave' in navigator) {
    return 'brave';
  }
  const marcas = marcasDelNavegador() ?? [];
  return MARCAS.find(([marca]) => marcas.includes(marca))?.[1] ?? null;
}

const conBoton = esChromium();
/** Si la persona ha pulsado el botón sin ventana del navegador: desde entonces se ven los pasos. */
let pasosPedidos = !conBoton;

/** Deja en la lista solo los pasos del navegador que es, si se sabe. */
function elegirPasos() {
  const suyo = navegadorConPasos();
  for (const paso of pasos.querySelectorAll('[data-navegador]')) {
    if (paso instanceof HTMLElement) {
      paso.hidden = suyo !== null && paso.dataset.navegador !== suyo;
    }
  }
}

/**
 * Enseña lo que corresponde al estado. Si el foco estaba en algo que se oculta (el botón, tras instalar), pasa al
 * mensaje que se ve: el texto nuevo se lee en el acto y el foco no se pierde.
 * @param {EstadoDeLaInstalacion} estado
 */
function mostrarEstado(estado) {
  const sinInstalar = estado === 'disponible' || estado === 'no-disponible';
  const tenia = boton.contains(document.activeElement);
  accion.hidden = !(conBoton && sinInstalar);
  nota.hidden = estado !== 'disponible';
  pasos.hidden = !(estado === 'no-disponible' && pasosPedidos);
  abierta.hidden = estado !== 'abierta';
  instalada.hidden = estado !== 'instalada';
  if (tenia && accion.hidden) {
    (abierta.hidden ? instalada : abierta).focus();
  }
}

/** Los pasos del navegador, en el sitio y con el foco: el botón no ha podido abrir su ventana. */
function mostrarPasos() {
  pasosPedidos = true;
  mostrarEstado(estadoDeLaInstalacion());
  pasos.focus();
}

boton.addEventListener('click', async () => {
  if (estadoDeLaInstalacion() !== 'disponible') {
    mostrarPasos();
    return;
  }
  // instalar() avisa del estado nuevo, que pinta alCambiarLaInstalacion; solo rechaza por un fallo del programa. Si el
  // navegador ya no abre la ventana, quedan sus pasos.
  if ((await instalar()) === 'no-disponible') {
    mostrarPasos();
  }
});
elegirPasos();
mostrarEstado(estadoDeLaInstalacion());
alCambiarLaInstalacion(mostrarEstado);
// Después de pintar el estado de partida: lo que cambie a partir de ahora (los pasos, «instalado») se anuncia.
zonaDelEstado.setAttribute('aria-live', 'polite');
pestanas.dataset.etapasInicial = conBoton ? PESTANA_CHROMIUM : PESTANA_SAFARI_FIREFOX;
await import('./etapas.js');
