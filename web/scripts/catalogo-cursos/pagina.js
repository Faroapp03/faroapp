/** Carga diferida de una entrega admitida; el fallo no se presenta como ausencia de cursos. */
import '../sitio.js';
import { escribir } from '../idioma.js';
import { traducible } from '../textos.js';
import { cargarListado } from './carga-pagina.js';
import { iniciarVista } from './vista.js';

const progreso = document.querySelector('[data-progreso]');
const estado = document.querySelector('[data-cuenta]');
try {
  const catalogo = await cargarListado();
  const raiz = document.querySelector('main.cursos');
  if (!(raiz instanceof HTMLElement)) {
    throw new Error('Falta la página de Cursos');
  }
  iniciarVista(raiz, catalogo);
} catch (error) {
  if (estado instanceof HTMLElement) {
    escribir(estado, traducible('catalogo.error'));
  }
  console.warn('La entrega de Cursos no está disponible o no es válida', error);
} finally {
  if (progreso instanceof HTMLElement) {
    progreso.hidden = true;
  }
}
