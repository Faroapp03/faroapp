// Una página larga leída por etapas, sin salir de ella: arriba, una barra con los pasos; abajo de cada etapa, la
// tarjeta del paso siguiente y el enlace al anterior. Cada etapa tiene su dirección (#<id>), así que atrás y adelante
// del navegador cambian de etapa, una dirección con fragmento abre la suya y un enlace a algo que está en una etapa
// oculta (una referencia, un ejemplo) abre esa etapa y lleva hasta ello. Sin JavaScript, o si el marcado no cumple el
// contrato, no cambia nada: la página se lee entera, como un documento, y la barra y los controles siguen ocultos.
//
// Contrato de marcado (un solo contenedor por página):
//   <div class="etapas" data-etapas>
//     <nav class="etapas-barra" data-etapas-barra aria-label="…" hidden>
//       <p class="etapas-rotulo" aria-hidden="true" data-etapas-rotulo></p>
//       <ol><li><a href="#paso-1"><span class="etapas-numero">1</span> <span class="etapas-nombre">…</span></a></li>…
//       <p class="etapas-estado" aria-hidden="true" data-etapas-estado></p>
//     </nav>
//     <div class="etapa" id="paso-1" data-etapa>
//       … contenido; su primer encabezado (h2–h6) es el título de la etapa …
//       <nav class="etapas-controles" data-etapas-controles aria-label="…" hidden>
//         <a class="etapas-siguiente" href="#paso-2">
//           <span class="etapas-siguiente-rotulo">…</span> <span class="etapas-siguiente-nombre">…</span> <svg>→</svg></a>
//         <a class="etapas-anterior" href="#paso-1"><svg>←</svg> <span>…</span></a>
//       </nav>
//     </div>
//     …
//   </div>
// - Las etapas (dos o más) son hijas directas del contenedor y tienen id; la barra tiene un enlace por etapa, a su id y
//   en el mismo orden. Los controles son enlaces corrientes que escribe la página, con sus textos y su numeración
//   (la tarjeta «Siguiente» de la última puede salir de la página); la primera etapa no tiene «anterior».
// - El módulo muestra barra y controles, pone .etapas--activas en el contenedor y .etapa--actual en la etapa visible
//   (estilos/etapas.css oculta las demás solo en pantalla), aria-current="step" en su enlace y data-vista en los de las
//   etapas ya vistas, con un aviso para lectores de pantalla (comun.etapas.vista); la hoja no pinta ninguna marca en
//   ellos y el número sigue en el documento. Si la barra tiene [data-etapas-estado], escribe en él
//   «Paso 3 de 5 · <nombre>» (comun.etapas.paso), con el nombre de .etapas-nombre: su clave si la tiene; si tiene
//   [data-etapas-rotulo], escribe «Recorrido · Paso 3 de 5» (comun.etapas.rotulo). Los textos van con data-texto.
//   Una página que no es un recorrido (la guía «Qué es la IA») puede dar sus propias claves para esas dos líneas, con
//   los mismos marcadores, en data-etapas-clave-paso y data-etapas-clave-rotulo del contenedor.
// - Un paso con data-etapas-con-nombre en su <li> enseña su nombre también en el móvil, donde los demás enseñan su
//   número (estilos/etapas.css): una parte que no es del recorrido numerado, como un glosario o un desafío.
// - La barra se comporta como unas pestañas: pulsar un paso cambia solo el contenido. Cancela el salto del enlace,
//   añade #<id> a la historia con pushState (sin hashchange: atrás y adelante siguen funcionando), no mueve la vista y
//   deja el foco en el enlace pulsado; el cambio se anuncia en una región aria-live discreta con la línea
//   «Paso 3 de 5 · <nombre>». Pulsar el paso que ya se ve no hace nada. Un clic con modificador o con otro botón se
//   deja al navegador.
// - Los controles del pie (a #<id> de una etapa) llevan a quien lee, que está al final del texto, al principio del
//   recorrido: añaden también #<id> a la historia, llevan la vista al principio del contenedor, sin animación, y el
//   foco al título de la etapa nueva (la hoja le quita el contorno: es un foco del guion en un elemento que no se
//   pulsa). Un control a otra página no se toca.
// - Atrás y adelante (popstate) muestran la etapa del fragmento sin mover la vista. Un fragmento escrito a mano, un
//   enlace a algo dentro de una etapa oculta (#ref-2) o abrir con fragmento activan esa etapa y llevan hasta ello o al
//   principio de su etapa, como un enlace corriente.
// - Sin fragmento (o con uno que no es de ninguna etapa) se ve la etapa inicial: la primera o, si el contenedor lleva
//   data-etapas-inicial="<id>", esa etapa. Lo pone la página antes de cargar este módulo cuando la etapa que conviene
//   ver primero depende de quien la abre (instalar.html, según el navegador: scripts/instalar.js). Un id que no es de
//   ninguna etapa no cumple el contrato.
//
// Variante «segmentos» (<div class="etapas" data-etapas="segmentos">): los apartados de una página que no se lee en
// orden (la Biblioteca), con la misma barra, la misma dirección por apartado y la misma conducta de la barra, del
// fragmento y de la historia. No es un recorrido: no lleva controles al pie (si los tiene, el marcado no cumple el
// contrato), el apartado que se ve lleva aria-current="true" y no "step", no se marcan ni se anuncian los ya vistos y
// la línea de estado y el anuncio dicen «Apartado 2 de 5 · <nombre>» (comun.etapas.segmento). El rótulo «Recorrido ·
// Paso…» no se escribe, y la barra puede ir sin números: la hoja enseña los nombres también en el móvil. El contenedor
// puede llevar entre la barra y los apartados otras piezas que no son etapas (los filtros de la Biblioteca).

import { crear, PaginaIncompleta } from './dom.js';
import { escribir } from './idioma.js';
import { traducible } from './textos.js';

/** @import { Parte } from './textos.js' */

/** El contenedor ya funciona por etapas: solo entonces la hoja oculta las que no se ven. */
const CLASE_ACTIVAS = 'etapas--activas';
/** La etapa que se ve. */
const CLASE_ACTUAL = 'etapa--actual';
/** Los encabezados entre los que se busca el título de cada etapa: el primero, en el orden del documento. */
const ENCABEZADOS = 'h2, h3, h4, h5, h6';
/** Menos de dos etapas no son un recorrido. */
const MINIMO_DE_ETAPAS = 2;
/** La línea con el paso que se ve: «Paso {numero} de {total} · {nombre}». */
const CLAVE_PASO = 'comun.etapas.paso';
/** El rótulo de la barra, sin el nombre: «Recorrido · Paso {numero} de {total}». */
const CLAVE_ROTULO = 'comun.etapas.rotulo';
/** El aviso, solo para lectores de pantalla, de que un paso ya se ha visto. */
const CLAVE_VISTA = 'comun.etapas.vista';
/** La línea con el apartado que se ve, en la variante «segmentos»: «Apartado {numero} de {total} · {nombre}». */
const CLAVE_SEGMENTO = 'comun.etapas.segmento';
/** El valor de data-etapas de la variante «segmentos»; sin valor, es un recorrido. */
const SEGMENTOS = 'segmentos';

/**
 * Una etapa con su enlace de la barra, su título y el aviso de «ya vista» de ese enlace (los segmentos no lo llevan).
 * @typedef {Object} Etapa
 * @property {HTMLElement} etapa
 * @property {HTMLElement} enlace
 * @property {HTMLElement} titulo
 * @property {HTMLElement | null} aviso
 */

/**
 * Si el contenedor es de la variante «segmentos»; sin valor en data-etapas, es un recorrido.
 * @param {HTMLElement} contenedor @returns {boolean}
 * @throws {PaginaIncompleta} Si data-etapas tiene otro valor.
 */
function esDeSegmentos(contenedor) {
  const variante = contenedor.dataset.etapas ?? '';
  if (variante !== '' && variante !== SEGMENTOS) {
    throw new PaginaIncompleta(`Las etapas no tienen la variante «${variante}»`);
  }
  return variante === SEGMENTOS;
}

/**
 * Lee y comprueba el marcado de las etapas sin cambiar nada: si algo no cumple el contrato, la página se queda entera.
 * @param {HTMLElement} contenedor El elemento [data-etapas].
 * @param {boolean} segmentos Si es de la variante «segmentos», que no lleva controles al pie.
 * @returns {{ barra: HTMLElement, etapas: Omit<Etapa, 'aviso'>[] }}
 * @throws {PaginaIncompleta} Si falta la barra, hay menos de dos etapas, la barra no enlaza cada etapa en su orden o
 *   unos segmentos llevan controles al pie.
 */
function leerEtapas(contenedor, segmentos) {
  if (segmentos && contenedor.querySelector('[data-etapas-controles]')) {
    throw new PaginaIncompleta('Los segmentos no llevan controles al pie');
  }
  const barra = contenedor.querySelector('[data-etapas-barra]');
  if (!(barra instanceof HTMLElement)) {
    throw new PaginaIncompleta('Las etapas no tienen su barra [data-etapas-barra]');
  }
  const etapas = [...contenedor.children].filter(
    (hijo) => hijo instanceof HTMLElement && hijo.hasAttribute('data-etapa'),
  );
  const enlaces = [...barra.querySelectorAll('a')];
  if (etapas.length < MINIMO_DE_ETAPAS || enlaces.length !== etapas.length) {
    throw new PaginaIncompleta(`Hay ${etapas.length} etapas y ${enlaces.length} enlaces en su barra`);
  }
  return {
    barra,
    etapas: etapas.map((etapa, posicion) => {
      const enlace = enlaces[posicion];
      const titulo = etapa.querySelector(ENCABEZADOS);
      if (!(etapa instanceof HTMLElement) || !etapa.id || !(enlace instanceof HTMLElement)) {
        throw new PaginaIncompleta(`La etapa ${posicion + 1} no tiene id o enlace`);
      }
      if (enlace.getAttribute('href') !== `#${etapa.id}`) {
        throw new PaginaIncompleta(`El enlace ${posicion + 1} de la barra no lleva a #${etapa.id}`);
      }
      if (!(titulo instanceof HTMLElement)) {
        throw new PaginaIncompleta(`La etapa #${etapa.id} no tiene título`);
      }
      return { etapa, enlace, titulo };
    }),
  };
}

/**
 * El texto de un fragmento con sus secuencias %XX descifradas, como lo busca el navegador después del literal. Una
 * secuencia mal formada no descifra a nada: se queda el literal.
 * @param {string} fragmento @returns {string}
 */
function descifrado(fragmento) {
  try {
    return decodeURIComponent(fragmento);
  } catch (error) {
    if (error instanceof URIError) {
      return fragmento;
    }
    throw error;
  }
}

/**
 * El elemento al que apunta un fragmento de la dirección («#ref-2»), o null si está vacío o no hay ninguno con ese id.
 * @param {string} fragmento @returns {HTMLElement | null}
 */
function elementoDelFragmento(fragmento) {
  const literal = fragmento.replace(/^#/, '');
  if (!literal) {
    return null;
  }
  const elemento = document.getElementById(literal) ?? document.getElementById(descifrado(literal));
  return elemento instanceof HTMLElement ? elemento : null;
}

/**
 * Las etapas de la página en marcha: cuáles se han visto en esta visita y cuál se ve, por su posición.
 * @typedef {Object} Recorrido
 * @property {HTMLElement} contenedor
 * @property {boolean} segmentos Si es de la variante «segmentos»: apartados sin orden, sin pasos vistos ni controles.
 * @property {Etapa[]} etapas
 * @property {HTMLElement | null} estado La línea «Paso 3 de 5 · …», si la barra la tiene.
 * @property {HTMLElement | null} rotulo El rótulo «Recorrido · Paso 3 de 5», si la barra lo tiene y es un recorrido.
 * @property {HTMLElement} anuncio La región aria-live donde se anuncia el paso al cambiar con la barra o la historia.
 * @property {string} clavePaso La clave de «Paso 3 de 5 · nombre»: la de data-etapas-clave-paso o la común.
 * @property {string} claveRotulo La clave de «Recorrido · Paso 3 de 5»: la de data-etapas-clave-rotulo o la común.
 * @property {Set<number>} vistas
 * @property {number} actual
 * @property {number} inicial La etapa que se ve sin fragmento: la de data-etapas-inicial o la primera.
 * @property {string} atendido El último fragmento ya atendido: popstate y hashchange llegan juntos, y el segundo no repite.
 * @property {number | null} vistaAlVolver Dónde estaba la vista en popstate, hasta que el hashchange que le sigue pase.
 */
/**
 * Dónde lleva un fragmento: la posición de una etapa y el elemento de destino, que es la propia etapa, algo dentro de
 * ella o nada.
 * @typedef {{ posicion: number, destino: HTMLElement | null }} Lugar
 */

/**
 * El lugar de un fragmento. Vacío o sin elemento con ese id, la etapa inicial; un destino fuera de las etapas (el
 * contenido principal, del enlace de salto), null: la etapa no cambia.
 * @param {Recorrido} recorrido @param {string} fragmento @returns {Lugar | null}
 */
function lugarDe({ etapas, inicial }, fragmento) {
  const destino = elementoDelFragmento(fragmento);
  if (!destino) {
    return { posicion: inicial, destino: null };
  }
  const posicion = etapas.findIndex(({ etapa }) => etapa.contains(destino));
  return posicion === -1 ? null : { posicion, destino };
}

/**
 * Si el lugar es algo dentro de su etapa, y no la etapa entera ni nada.
 * @param {Recorrido} recorrido @param {Lugar} lugar @returns {boolean}
 */
function esInterior({ etapas }, { posicion, destino }) {
  return destino !== null && destino !== etapas[posicion]?.etapa;
}

/**
 * El nombre de un paso de la barra: la clave de su .etapas-nombre, para que cambie con el idioma, o su texto.
 * @param {HTMLElement} enlace @returns {Parte}
 */
function nombreDelPaso(enlace) {
  const nombre = enlace.querySelector('.etapas-nombre');
  if (!(nombre instanceof HTMLElement)) {
    return '';
  }
  return nombre.dataset.texto ? traducible(nombre.dataset.texto) : (nombre.textContent ?? '');
}

/**
 * Lo que dice el paso que se ve, para la línea de estado y para el anuncio: «Paso 3 de 5 · nombre» (o la clave propia
 * de la página); en los segmentos, «Apartado 3 de 5 · nombre».
 * @param {Recorrido} recorrido @param {number} posicion @returns {Parte}
 */
function textoDelPaso({ etapas, segmentos, clavePaso }, posicion) {
  const enlace = etapas[posicion]?.enlace;
  const valores = { numero: posicion + 1, total: etapas.length, nombre: enlace ? nombreDelPaso(enlace) : '' };
  return traducible(segmentos ? CLAVE_SEGMENTO : clavePaso, valores);
}

/**
 * Marca el enlace de un paso como ya visto, o no, y enseña u oculta su aviso para lectores de pantalla.
 * @param {HTMLElement} enlace @param {HTMLElement} aviso @param {boolean} yaVista
 */
function marcarVista(enlace, aviso, yaVista) {
  if (yaVista) {
    enlace.setAttribute('data-vista', '');
  } else {
    enlace.removeAttribute('data-vista');
  }
  aviso.hidden = !yaVista;
}

/**
 * Deja a la vista la etapa de esa posición y marca la barra: el paso actual y los ya vistos (en los segmentos, solo el
 * apartado actual).
 * @param {Recorrido} recorrido @param {number} posicion
 */
function mostrar(recorrido, posicion) {
  recorrido.actual = posicion;
  recorrido.vistas.add(posicion);
  for (const [otra, { etapa, enlace, aviso }] of recorrido.etapas.entries()) {
    const esLaActual = otra === posicion;
    etapa.classList.toggle(CLASE_ACTUAL, esLaActual);
    if (esLaActual) {
      enlace.setAttribute('aria-current', recorrido.segmentos ? 'true' : 'step');
    } else {
      enlace.removeAttribute('aria-current');
    }
    if (aviso) {
      marcarVista(enlace, aviso, recorrido.vistas.has(otra) && !esLaActual);
    }
  }
  if (recorrido.rotulo) {
    const valores = { numero: posicion + 1, total: recorrido.etapas.length };
    escribir(recorrido.rotulo, traducible(recorrido.claveRotulo, valores));
  }
  if (recorrido.estado) {
    escribir(recorrido.estado, textoDelPaso(recorrido, posicion));
  }
}

/**
 * Muestra la etapa sin mover la vista ni el foco y avisa a los lectores de pantalla del paso nuevo.
 * @param {Recorrido} recorrido @param {number} posicion
 */
function mostrarEnSitio(recorrido, posicion) {
  mostrar(recorrido, posicion);
  escribir(recorrido.anuncio, textoDelPaso(recorrido, posicion));
}

/**
 * Muestra la etapa desde su principio: la vista, al inicio del contenedor; el foco, en su título.
 * @param {Recorrido} recorrido @param {number} posicion
 */
function irAlPrincipio(recorrido, posicion) {
  mostrar(recorrido, posicion);
  recorrido.contenedor.scrollIntoView({ block: 'start' });
  recorrido.etapas[posicion]?.titulo.focus({ preventScroll: true });
}

/**
 * Añade la etapa a la historia: sin ella el navegador saltaría al ancla, y pushState no avisa con hashchange ni repite
 * una entrada que ya está en la dirección.
 * @param {Recorrido} recorrido @param {number} posicion
 */
function apuntarEnLaHistoria(recorrido, posicion) {
  const fragmento = `#${recorrido.etapas[posicion]?.etapa.id}`;
  if (location.hash !== fragmento) {
    history.pushState(null, '', fragmento);
  }
  recorrido.atendido = fragmento;
}

/**
 * Un enlace que el navegador debe tratar él mismo: otro botón, o con una tecla que abre en otra pestaña o ventana.
 * @param {MouseEvent} evento @returns {boolean}
 */
function esClicAparte(evento) {
  return evento.button > 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey;
}

/**
 * Atrás, adelante, un enlace de la página o un fragmento escrito a mano. Un destino dentro de una etapa oculta no ha
 * podido recibir la vista: se le lleva al mostrarla. Uno dentro de la etapa que ya se ve lo ha llevado el navegador.
 * Si popstate acaba de atender este fragmento, no se repite; solo se devuelve la vista adonde estaba: la etapa recién
 * mostrada es ya el destino del fragmento y el navegador, entre popstate y hashchange, ha saltado a ella.
 * @param {Recorrido} recorrido
 */
function alCambiarElFragmento(recorrido) {
  if (location.hash === recorrido.atendido) {
    if (recorrido.vistaAlVolver !== null) {
      window.scrollTo({ top: recorrido.vistaAlVolver, behavior: 'instant' });
      recorrido.vistaAlVolver = null;
    }
    return;
  }
  recorrido.vistaAlVolver = null;
  recorrido.atendido = location.hash;
  const lugar = lugarDe(recorrido, location.hash);
  if (!lugar) {
    return;
  }
  if (!esInterior(recorrido, lugar)) {
    irAlPrincipio(recorrido, lugar.posicion);
  } else if (lugar.posicion !== recorrido.actual) {
    mostrar(recorrido, lugar.posicion);
    lugar.destino?.scrollIntoView({ block: 'start' });
  }
}

/**
 * Atrás y adelante: la etapa del fragmento, sin mover la vista (el navegador restaura la suya). Un destino dentro de
 * otra etapa, oculta hasta ahora, sí se alcanza.
 * @param {Recorrido} recorrido
 */
function alVolverEnLaHistoria(recorrido) {
  recorrido.vistaAlVolver = null;
  recorrido.atendido = location.hash;
  const lugar = lugarDe(recorrido, location.hash);
  if (!lugar || lugar.posicion === recorrido.actual) {
    return;
  }
  const vista = window.scrollY;
  mostrarEnSitio(recorrido, lugar.posicion);
  if (esInterior(recorrido, lugar)) {
    lugar.destino?.scrollIntoView({ block: 'start' });
  } else {
    recorrido.vistaAlVolver = vista;
  }
}

/**
 * Pulsar un paso de la barra: como unas pestañas, cambia el contenido y deja la vista y el foco donde están.
 * @param {Recorrido} recorrido @param {number} posicion @param {MouseEvent} evento
 */
function alPulsarUnPaso(recorrido, posicion, evento) {
  if (evento.defaultPrevented || esClicAparte(evento)) {
    return;
  }
  evento.preventDefault();
  if (posicion === recorrido.actual) {
    return;
  }
  apuntarEnLaHistoria(recorrido, posicion);
  mostrarEnSitio(recorrido, posicion);
  recorrido.etapas[posicion]?.enlace.focus({ preventScroll: true });
}

/**
 * Pulsar «Siguiente» o «Anterior», al final del texto: la etapa nueva, desde su principio.
 * @param {Recorrido} recorrido @param {number} posicion @param {MouseEvent} evento
 */
function alPulsarUnControl(recorrido, posicion, evento) {
  if (evento.defaultPrevented || esClicAparte(evento)) {
    return;
  }
  evento.preventDefault();
  apuntarEnLaHistoria(recorrido, posicion);
  irAlPrincipio(recorrido, posicion);
}

/**
 * Prepara cada etapa leída: su aviso de «ya vista», oculto, en su enlace (los segmentos no lo llevan), y su título,
 * enfocable desde el guion.
 * @param {Omit<Etapa, 'aviso'>[]} leidas @param {boolean} segmentos @returns {Etapa[]}
 */
function prepararEtapas(leidas, segmentos) {
  return leidas.map((leida) => {
    let aviso = null;
    if (!segmentos) {
      aviso = escribir(crear('span', { className: 'solo-lectores', hidden: true }), traducible(CLAVE_VISTA));
      leida.enlace.append(aviso);
    }
    if (!leida.titulo.hasAttribute('tabindex')) {
      leida.titulo.setAttribute('tabindex', '-1');
    }
    return { ...leida, aviso };
  });
}

/**
 * La posición de la etapa que se ve sin fragmento: la del id de data-etapas-inicial, si el contenedor lo lleva; si no,
 * la primera.
 * @param {HTMLElement} contenedor @param {Omit<Etapa, 'aviso'>[]} etapas @returns {number}
 * @throws {PaginaIncompleta} Si data-etapas-inicial no es el id de ninguna etapa.
 */
function posicionInicial(contenedor, etapas) {
  const id = contenedor.dataset.etapasInicial;
  if (id === undefined) {
    return 0;
  }
  const posicion = etapas.findIndex(({ etapa }) => etapa.id === id);
  if (posicion === -1) {
    throw new PaginaIncompleta(`data-etapas-inicial lleva a «${id}», que no es ninguna etapa`);
  }
  return posicion;
}

/**
 * Las claves de la línea de estado y del rótulo: las propias de la página (data-etapas-clave-paso y
 * data-etapas-clave-rotulo) o las comunes.
 * @param {HTMLElement} contenedor @returns {{ clavePaso: string, claveRotulo: string }}
 */
function clavesDeLaPagina({ dataset }) {
  return { clavePaso: dataset.etapasClavePaso || CLAVE_PASO, claveRotulo: dataset.etapasClaveRotulo || CLAVE_ROTULO };
}

/**
 * Sigue la barra, los controles del pie y los cambios de fragmento. Los controles que no llevan a una etapa de la página
 * (la tarjeta final) siguen su enlace.
 * @param {Recorrido} recorrido
 */
function escuchar(recorrido) {
  window.addEventListener('popstate', () => alVolverEnLaHistoria(recorrido));
  window.addEventListener('hashchange', () => alCambiarElFragmento(recorrido));
  for (const [posicion, { enlace }] of recorrido.etapas.entries()) {
    enlace.addEventListener('click', (evento) => alPulsarUnPaso(recorrido, posicion, evento));
  }
  for (const controles of recorrido.contenedor.querySelectorAll('[data-etapas-controles]')) {
    for (const enlace of controles.querySelectorAll('a')) {
      const posicion = recorrido.etapas.findIndex(({ etapa }) => enlace.getAttribute('href') === `#${etapa.id}`);
      if (posicion !== -1) {
        enlace.addEventListener('click', (evento) => alPulsarUnControl(recorrido, posicion, evento));
      }
    }
  }
}

/**
 * Pone en marcha las etapas de la página, si las tiene: las comprueba, muestra la del fragmento de la dirección (o la
 * inicial), deja ver la barra y los controles y sigue los cambios de fragmento. Al abrir con fragmento, el navegador
 * llevó la vista con todas las etapas a la vista; ocultas las demás, se vuelve a llevar: a lo que señala o al
 * principio de su etapa. Sin destino, la página empieza por arriba. Al abrir no se mueve el foco.
 * @throws {PaginaIncompleta} Si hay más de un contenedor o su marcado no cumple el contrato; la página no cambia.
 */
function iniciarEtapas() {
  const contenedores = [...document.querySelectorAll('[data-etapas]')];
  if (!contenedores.length) {
    return;
  }
  const [contenedor] = contenedores;
  if (contenedores.length > 1 || !(contenedor instanceof HTMLElement)) {
    throw new PaginaIncompleta('Una página admite un solo contenedor de etapas');
  }
  const segmentos = esDeSegmentos(contenedor);
  const { barra, etapas } = leerEtapas(contenedor, segmentos);
  const estado = barra.querySelector('[data-etapas-estado]');
  const rotulo = barra.querySelector('[data-etapas-rotulo]');
  /** @type {Recorrido} */
  const recorrido = {
    contenedor,
    segmentos,
    etapas: prepararEtapas(etapas, segmentos),
    estado: estado instanceof HTMLElement ? estado : null,
    rotulo: !segmentos && rotulo instanceof HTMLElement ? rotulo : null,
    anuncio: crear('p', { className: 'solo-lectores' }),
    ...clavesDeLaPagina(contenedor),
    vistas: new Set(),
    actual: 0,
    inicial: posicionInicial(contenedor, etapas),
    atendido: location.hash,
    vistaAlVolver: null,
  };
  recorrido.anuncio.setAttribute('aria-live', 'polite');
  recorrido.anuncio.setAttribute('aria-atomic', 'true');
  barra.append(recorrido.anuncio);
  const inicial = lugarDe(recorrido, location.hash) ?? { posicion: recorrido.inicial, destino: null };
  mostrar(recorrido, inicial.posicion);
  contenedor.classList.add(CLASE_ACTIVAS);
  barra.hidden = false;
  for (const controles of contenedor.querySelectorAll('[data-etapas-controles]')) {
    if (controles instanceof HTMLElement) {
      controles.hidden = false;
    }
  }
  escuchar(recorrido);
  if (esInterior(recorrido, inicial)) {
    inicial.destino?.scrollIntoView({ block: 'start' });
  } else if (inicial.destino) {
    contenedor.scrollIntoView({ block: 'start' });
  }
}

iniciarEtapas();
