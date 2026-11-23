import { alCambiarIdioma, iniciarIdioma } from '../scripts/idioma.js';
import { avisarDeIdiomaNoCargado, iniciarSelectorIdioma } from '../scripts/selector-idioma.js';
import { iniciarTema } from '../scripts/tema.js';

// idioma.js apunta el manifiesto por su nombre; esta página está un nivel por debajo de las páginas públicas.
function apuntarManifiesto() {
  const enlace = document.querySelector('link[rel="manifest"]');
  const nombre = enlace?.getAttribute('href');
  if (enlace && nombre && !nombre.startsWith('/')) {
    enlace.setAttribute('href', new URL(`../${nombre}`, import.meta.url).href);
  }
}
const elegido = document.documentElement.dataset.idioma;
const cargado = await iniciarIdioma();
apuntarManifiesto();
alCambiarIdioma(apuntarManifiesto);
iniciarSelectorIdioma();
iniciarTema();
if (!cargado && elegido) {
  avisarDeIdiomaNoCargado(elegido);
}
