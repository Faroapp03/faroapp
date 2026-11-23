// «Datos globales · Unión Europea» (datos-globales-ue.html), la segunda de las tres páginas del dossier: la Unión
// Europea, los 27 países juntos, en su propia página, porque su cifra incluye a España, Alemania, Francia e Italia y no
// se compara con ellos. Con los datos ya comprobados (datos-globales/pagina.js) pinta «Lo esencial»
// (datos-globales/union-europea.js), sus capítulos 01 a 10 (datos-globales/union-europea-capitulos.js) y el índice de
// preguntas, que se lee de los capítulos pintados, con un capítulo por página (datos-globales/paginacion.js). La portada y las fuentes están escritas en la página. Empieza
// importando sitio.js: no escribe nada antes de tener su diccionario.

import './sitio.js';
import './compatibilidad.js';
import { cargarLaPagina } from './datos-globales/pagina.js';
import { abrirDesplegablesDelFragmento, abrirPaginaDe, paginarCapitulos } from './datos-globales/paginacion.js';
import { entradasDelIndice, saltosConFoco } from './datos-globales/seccion.js';
import { clavesDeLaUe } from './datos-globales/union-europea.js';
import { capitulosDeLaUe } from './datos-globales/union-europea-capitulos.js';
import { porId } from './dom.js';

const preguntas = porId('datos-globales-preguntas');
const indice = porId('datos-globales-indice', HTMLOListElement);
const resumen = porId('datos-globales-resumen');
const claves = porId('datos-globales-claves', HTMLOListElement);
const capitulos = porId('datos-globales-capitulos');
const fuentes = porId('datos-globales-fuentes');
const barra = porId('datos-globales-paginas');
const lista = porId('datos-globales-paginas-lista');
const estadoDePagina = porId('datos-globales-pagina-estado');
/** @type {import('./datos-globales/paginacion.js').Paginacion | null} */
let paginacion = null;
const abrir = (/** @type {HTMLElement} */ destino) => {
  if (paginacion) {
    abrirPaginaDe(paginacion, destino);
  }
};

abrirDesplegablesDelFragmento(['datos-globales-fuentes-desplegable'].map((id) => porId(id)));
saltosConFoco(preguntas, abrir);
saltosConFoco(capitulos, abrir);
// Sin await: la página ya está entera y los datos se pintan al llegar (datos-globales/pagina.js).
void cargarLaPagina((datos) => {
  const pintados = capitulosDeLaUe(datos);
  claves.replaceChildren(...clavesDeLaUe(datos));
  capitulos.replaceChildren(...pintados);
  indice.replaceChildren(...entradasDelIndice(pintados));
  paginacion = paginarCapitulos({ capitulos: pintados, barra, lista, estado: estadoDePagina });
  for (const seccion of [preguntas, resumen, capitulos, fuentes]) {
    seccion.hidden = !pintados.length && seccion !== fuentes;
  }
  fuentes.hidden = false;
});
