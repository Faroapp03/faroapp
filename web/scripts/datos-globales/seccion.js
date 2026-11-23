// Las piezas de página de «Datos globales» (datos-globales.html y datos-globales-ue.html), comunes a sus capítulos:
// - el capítulo: a la izquierda, su número y su tema; a la derecha, la pregunta en pequeño, el titular que la responde,
//   la entradilla, las figuras, la lectura de tres frases, la ficha técnica plegada y «Volver a las preguntas»;
// - la figura delimitada: título (qué se mide), subtítulo (unidad, población y año), el gráfico, su alternativa en
//   texto para lectores de pantalla y el pie (fuente y nota);
// - la tarjeta de «Lo esencial» y el índice de preguntas, cuyos enlaces llevan el foco al titular, sin animación.
// Los textos van con su clave (idiomas/), así que un cambio de idioma los reescribe solos; los gráficos se redibujan
// (dibujo.js). Las ejerce, montando las páginas enteras, pruebas/web-datos-globales-capitulos/.

import { crear } from '../dom.js';
import { escribirAtributo } from '../idioma.js';
import { traducible } from '../textos.js';
import { conTexto, marcaDeNaturaleza } from './ficha.js';

/**
 * @import { DatosGlobales } from './datos.js'
 * @import { Parte } from '../textos.js'
 * @typedef {{ id: string, numero: string, tema: Parte, pregunta: Parte, titular: Parte }} Cabecera
 * @typedef {{ titulo: Parte | null, nodo: HTMLElement }} Panel
 * @typedef {{ titulo: Parte, sub: Parte[], control: HTMLElement | null, marca: HTMLElement | null, paneles: Panel[],
 *   alternativa: Parte[], fuente: Parte, notas: Parte[] }} Figura `marca`, la de las encuestas de opinión;
 *   `alternativa`, lo que dice el gráfico en texto, para lectores de pantalla
 * @typedef {[titulo: Parte, texto: Parte]} Frase una frase de la lectura: su titular en palabras y su texto
 * @typedef {Cabecera & { entradilla: Parte[], figuras: HTMLElement[], lectura: Frase[],
 *   ficha: HTMLDetailsElement }} Capitulo
 */

/** El id del título del índice de preguntas: a él vuelve cada capítulo. */
export const TITULO_DEL_INDICE = 'dg-indice-titulo';

/**
 * Un párrafo con varias partes seguidas, separadas por un espacio: cada una se traduce por su cuenta.
 * @param {string} clase @param {Parte[]} partes @returns {HTMLParagraphElement}
 */
export function parrafo(clase, partes) {
  return crear(
    'p',
    { className: clase },
    ...partes.flatMap((parte, i) => [...(i ? [' '] : []), conTexto('span', {}, parte)]),
  );
}

/** «↑ Volver a las preguntas», al final de cada capítulo. @returns {HTMLParagraphElement} */
function volver() {
  const enlace = conTexto('a', {}, traducible('datos-globales.volver'));
  enlace.setAttribute('href', `#${TITULO_DEL_INDICE}`);
  enlace.dataset.dgSalto = '';
  return crear('p', { className: 'dg-volver' }, enlace);
}

/**
 * Una sección de capítulo: a la izquierda, su número y su tema; a la derecha, la pregunta, el titular que la responde
 * (se puede enfocar: a él lleva el índice), el contenido y «Volver a las preguntas».
 * @param {Cabecera} cabecera @param {Node[]} contenido @returns {HTMLElement}
 */
export function seccion({ id, numero, tema, pregunta, titular }, contenido) {
  const seccionDelCapitulo = crear('section', { className: 'dg-capitulo', id: `dg-${id}` });
  seccionDelCapitulo.setAttribute('aria-labelledby', `dg-${id}-titulo`);
  const rail = crear(
    'div',
    { className: 'dg-capitulo-rail' },
    crear('p', { className: 'dg-capitulo-numero', textContent: numero }),
    conTexto('p', { className: 'dg-capitulo-tema' }, tema),
  );
  const titulo = conTexto('h2', { id: `dg-${id}-titulo` }, titular);
  titulo.setAttribute('tabindex', '-1');
  const texto = crear(
    'div',
    { className: 'dg-capitulo-texto' },
    conTexto('p', { className: 'dg-pregunta' }, pregunta),
    titulo,
    ...contenido,
    volver(),
  );
  seccionDelCapitulo.append(rail, texto);
  return seccionDelCapitulo;
}

/**
 * La lectura de las cifras: dos o tres frases en una banda fina, cada una con su titular en palabras.
 * @param {Frase[]} frases @returns {HTMLUListElement}
 */
function lectura(frases) {
  const lista = crear(
    'ul',
    { className: 'dg-lectura' },
    ...frases.map(([titulo, texto]) => crear('li', {}, conTexto('strong', {}, titulo), conTexto('span', {}, texto))),
  );
  escribirAtributo(lista, 'aria-label', traducible('datos-globales.lectura.nombre'));
  return lista;
}

/**
 * Un capítulo con datos: la entradilla, sus figuras, la lectura y la ficha técnica (solo el método).
 * @param {Capitulo} capitulo @returns {HTMLElement}
 */
export function capitulo({ entradilla, figuras, lectura: frases, ficha, ...cabecera }) {
  return seccion(cabecera, [
    parrafo('dg-entradilla', entradilla),
    ...figuras,
    ...(frases.length ? [lectura(frases)] : []),
    ficha,
  ]);
}

/**
 * El cuerpo de una figura: un panel o, si son varios, uno al lado de otro con su título (con la misma escala: lo dice
 * su subtítulo). @param {Panel[]} paneles @returns {HTMLElement}
 */
function cuerpoDeLaFigura(paneles) {
  const [unico] = paneles;
  if (paneles.length === 1 && unico && unico.titulo === null) {
    return unico.nodo;
  }
  return crear(
    'div',
    { className: 'dg-paneles' },
    ...paneles.map(({ titulo, nodo }) =>
      crear(
        'div',
        { className: 'dg-panel' },
        ...(titulo === null ? [] : [conTexto('p', { className: 'dg-panel-titulo' }, titulo)]),
        nodo,
      ),
    ),
  );
}

/**
 * Una figura delimitada: título y subtítulo (y, si lo hay, su control o su marca), el gráfico, su alternativa en texto
 * y el pie, con la fuente y las notas.
 * @param {Figura} figura @returns {HTMLElement}
 */
export function figura({ titulo, sub, control, marca, paneles, alternativa, fuente, notas }) {
  const cabeza = crear(
    'div',
    { className: 'dg-figura-cabeza' },
    crear('div', {}, conTexto('p', { className: 'dg-figura-titulo' }, titulo), parrafo('dg-figura-sub', sub)),
    ...(marca ? [marca] : []),
    ...(control ? [control] : []),
  );
  const pie = crear(
    'figcaption',
    { className: 'dg-figura-pie' },
    conTexto('p', {}, traducible('datos-globales.fuente', { fuente })),
    ...notas.map((nota) => conTexto('p', {}, nota)),
  );
  return crear(
    'figure',
    { className: 'dg-figura' },
    cabeza,
    cuerpoDeLaFigura(paneles),
    parrafo('solo-lectores', alternativa),
    pie,
  );
}

/**
 * La tabla gráfica año a año, en su propia figura delimitada: título, subtítulo y la tabla.
 * @param {{ titulo: Parte, sub: Parte, tabla: HTMLElement, notas: Parte[] }} figuraDeTabla @returns {HTMLElement}
 */
export function figuraDeTabla({ titulo, sub, tabla, notas }) {
  return crear(
    'figure',
    { className: 'dg-figura dg-figura--tabla' },
    crear(
      'div',
      { className: 'dg-figura-cabeza' },
      crear(
        'div',
        {},
        conTexto('p', { className: 'dg-figura-titulo' }, titulo),
        conTexto('p', { className: 'dg-figura-sub' }, sub),
      ),
    ),
    tabla,
    ...(notas.length
      ? [crear('figcaption', { className: 'dg-figura-pie' }, ...notas.map((nota) => conTexto('p', {}, nota)))]
      : []),
  );
}

/**
 * Un interruptor de dos o más botones con estado (aria-pressed), de 44 px de alto: elige qué enseña un gráfico.
 * @param {{ nombre: Parte, opciones: { clave: string, texto: Parte }[], elegida: string,
 *   alElegir: (clave: string) => void }} interruptor @returns {HTMLElement}
 */
export function interruptor({ nombre, opciones, elegida, alElegir }) {
  const botones = opciones.map(({ clave, texto }) => {
    const boton = conTexto('button', { type: 'button' }, texto);
    boton.dataset.opcion = clave;
    boton.setAttribute('aria-pressed', String(clave === elegida));
    return boton;
  });
  const grupo = crear('div', { className: 'dg-interruptor' }, ...botones);
  grupo.setAttribute('role', 'group');
  escribirAtributo(grupo, 'aria-label', nombre);
  grupo.addEventListener('click', (evento) => {
    const boton = botones.find(
      (candidato) => candidato === evento.target || candidato.contains(/** @type {Node} */ (evento.target)),
    );
    if (!boton?.dataset.opcion) {
      return;
    }
    for (const otro of botones) {
      otro.setAttribute('aria-pressed', String(otro === boton));
    }
    alElegir(boton.dataset.opcion);
  });
  return grupo;
}

/**
 * Una cifra clave de «Lo esencial»: el tema y el año, la cifra con su unidad, su significado en una frase, la
 * comparación (un título y su gráfico mínimo) y el pie, con la fuente o la definición que haga falta.
 * @param {{ tema: Parte, cifra: string, unidad: Parte, significado: Parte, comparacion: Parte, grafico: HTMLElement,
 *   pie: Parte, ue: boolean }} tarjeta `ue`, si la cifra es de la UE (va en su color)
 * @returns {HTMLLIElement}
 */
export function tarjetaEsencial({ tema, cifra, unidad, significado, comparacion, grafico, pie, ue }) {
  return crear(
    'li',
    { className: `dg-esencial-tarjeta${ue ? ' dg-esencial-tarjeta--ue' : ''}` },
    conTexto('p', { className: 'dg-esencial-tema' }, tema),
    crear('p', { className: 'dg-esencial-cifra' }, cifra, conTexto('small', {}, unidad)),
    conTexto('p', { className: 'dg-esencial-significado' }, significado),
    conTexto('p', { className: 'dg-esencial-comparacion' }, comparacion),
    grafico,
    conTexto('p', { className: 'dg-esencial-pie' }, pie),
  );
}

/**
 * El índice de preguntas, sin cifras: una entrada por capítulo pintado, con su número y su pregunta, que enlaza con su
 * titular. Las preguntas se leen de los propios capítulos, así que el índice nunca enlaza con uno que no está.
 * @param {HTMLElement[]} capitulos @returns {HTMLLIElement[]}
 */
export function entradasDelIndice(capitulos) {
  return capitulos.flatMap((capituloPintado) => {
    const pregunta = capituloPintado.querySelector('.dg-pregunta');
    const numero = capituloPintado.querySelector('.dg-capitulo-numero')?.textContent ?? '';
    const titulo = capituloPintado.querySelector('h2');
    const clave = pregunta instanceof HTMLElement ? pregunta.dataset.texto : undefined;
    if (!clave || !titulo) {
      return [];
    }
    const enlace = crear(
      'a',
      {},
      crear('span', { className: 'dg-indice-numero', textContent: numero }),
      conTexto('span', { className: 'dg-indice-pregunta' }, traducible(clave)),
    );
    enlace.setAttribute('href', `#${titulo.id}`);
    enlace.dataset.dgSalto = '';
    return [crear('li', {}, enlace)];
  });
}

/**
 * Los saltos internos (índice y «Volver a las preguntas»), sin animación: `abrir` deja a la vista el destino (la página
 * de su capítulo), el foco va a su titular y la página se coloca con su pregunta a la vista. Escucha en `raiz`.
 * @param {HTMLElement} raiz @param {(destino: HTMLElement) => void} [abrir]
 * @returns {void}
 */
export function saltosConFoco(raiz, abrir = () => {}) {
  raiz.addEventListener('click', (evento) => {
    const objetivo = evento.target;
    const enlace = objetivo instanceof Element ? objetivo.closest('a[data-dg-salto]') : null;
    const destino = enlace ? document.getElementById(enlace.getAttribute('href')?.slice(1) ?? '') : null;
    if (!enlace || !destino) {
      return;
    }
    evento.preventDefault();
    abrir(destino);
    (destino.closest('section') ?? destino).scrollIntoView({ block: 'start', behavior: 'instant' });
    destino.focus({ preventScroll: true });
    history.replaceState(null, '', enlace.getAttribute('href'));
  });
}

/**
 * El recuadro de lo que no tiene cifra oficial, con su porqué.
 * @param {Parte} motivo Por qué no hay cifra.
 * @returns {HTMLElement} El párrafo del recuadro.
 */
export function recuadroSinCifra(motivo) {
  return conTexto('p', { className: 'dg-falta' }, motivo);
}

/**
 * La marca del tipo de un indicador para la ficha: la naturaleza que declaran los datos. Un indicador que no está en
 * los datos no se marca «medido» (la afirmación más fuerte): la ficha dice que no hay cifra oficial publicada.
 * @param {DatosGlobales} datos Los datos del dossier.
 * @param {string} id El id del indicador.
 * @returns {HTMLSpanElement} La marca de su naturaleza, o el texto de «sin cifra» si no está en los datos.
 */
export function marcaDeIndicador(datos, id) {
  const indicador = datos.indicadores.find((candidato) => candidato.id === id);
  if (!indicador) {
    return conTexto('span', {}, traducible('datos-globales.sin-cifra'));
  }
  return marcaDeNaturaleza(indicador.naturaleza);
}
