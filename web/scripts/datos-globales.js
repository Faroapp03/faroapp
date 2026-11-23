// «Datos globales · Cataluña y países» (datos-globales.html), la primera de las tres páginas del dossier: con los datos
// ya comprobados (datos-globales/pagina.js) pinta «Lo esencial» (datos-globales/resumen.js), los capítulos de datos
// (datos-globales/pintar.js, que reúne los de parejas.js y opinion.js), el cuadro (datos-globales/cuadro.js) y el
// índice de preguntas, que se lee de los capítulos pintados (un capítulo sin cifras no sale ni en el índice), con un
// capítulo por página (datos-globales/paginacion.js). El número
// de cada capítulo sale de su orden en datos-globales/capitulos.js (numeroDelCapitulo). La portada, «Cómo comparamos»
// y las fuentes están escritos en la página; de los datos solo toman si todas las cifras son medidas y la fecha de
// consulta. La Unión Europea tiene su página (datos-globales-ue.html) y el globo, la suya (datos-globales-mundo.html).
// Empieza importando sitio.js: no escribe nada antes de tener su diccionario.

import './sitio.js';
import './compatibilidad.js';
import { INDICADORES } from './datos-globales/capitulos.js';
import { capituloDelCuadro } from './datos-globales/cuadro.js';
import { cargarLaPagina, fechaDeConsulta } from './datos-globales/pagina.js';
import { abrirDesplegablesDelFragmento, abrirPaginaDe, paginarCapitulos } from './datos-globales/paginacion.js';
import { capitulosDelDossier } from './datos-globales/pintar.js';
import { clavesDeLoEsencial } from './datos-globales/resumen.js';
import { entradasDelIndice, saltosConFoco } from './datos-globales/seccion.js';
import { porId } from './dom.js';

/**
 * @import { DatosGlobales } from './datos-globales/datos.js'
 */

const preguntas = porId('datos-globales-preguntas');
const indice = porId('datos-globales-indice', HTMLOListElement);
const resumen = porId('datos-globales-resumen');
const claves = porId('datos-globales-claves', HTMLOListElement);
const capitulos = porId('datos-globales-capitulos');
const metodo = porId('datos-globales-metodo');
const todasMedidas = porId('datos-globales-todas-medidas');
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

/** Enseña el dossier con los datos ya comprobados. @param {DatosGlobales} datos */
function ensenar(datos) {
  claves.replaceChildren(...clavesDeLoEsencial(datos));
  const pintados = [...capitulosDelDossier(datos), capituloDelCuadro(datos, fechaDeConsulta(datos.generado))];
  capitulos.replaceChildren(...pintados);
  indice.replaceChildren(...entradasDelIndice(pintados));
  paginacion = paginarCapitulos({ capitulos: pintados, barra, lista, estado: estadoDePagina });
  /** @type {Set<string>} */
  const usados = new Set(Object.values(INDICADORES));
  todasMedidas.hidden = datos.indicadores.some(({ id, naturaleza }) => usados.has(id) && naturaleza !== 'medido');
  for (const seccion of [preguntas, resumen, capitulos, metodo, fuentes]) {
    seccion.hidden = false;
  }
}

abrirDesplegablesDelFragmento(
  ['datos-globales-metodo-desplegable', 'datos-globales-fuentes-desplegable'].map((id) => porId(id)),
);
saltosConFoco(preguntas, abrir);
saltosConFoco(capitulos, abrir);
// Sin await: la página ya está entera y los datos se pintan al llegar; un fallo del programa sale en la consola como
// promesa rechazada, con la región de estado ya escrita (datos-globales/pagina.js).
void cargarLaPagina(ensenar);
