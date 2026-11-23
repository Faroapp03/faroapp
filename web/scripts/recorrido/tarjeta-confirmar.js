// La tarjeta de «¿Te dedicas a esto?»: el grupo que ha reconocido Faro, con su título oficial (y su código, discreto)
// y sus ocupaciones ESCO para elegir. En orden alfabético, con las formas masculina y femenina juntas y sin nada
// elegido de antemano la primera vez; al volver a ella, con la que ya había elegido la persona, que puede seguir igual
// o cambiarla. Con más de MAX_SIN_FILTRO ocupaciones, un filtro por palabra. Siempre con dos salidas: «Ninguna de
// estas, pero es este tipo de trabajo» (se sigue solo con el grupo) y «No, es otra cosa» (Faro vuelve a preguntar).
// Si la IA propuso más grupos, van debajo, en «¿O es alguno de estos?», un botón por grupo. Los títulos se ven en el
// idioma de la página si tienen su traducción de Faro y, si no, en castellano, marcados (datos-traducidos.js). Cada
// ocupación se ve en su forma breve («Bombero/a de brigada acuática») y su nombre accesible es lo que se ve con las dos
// formas enteras detrás (titulo-breve.js); el filtro la encuentra por cualquiera de las dos.

import { crear } from '../dom.js';
import { escribir, escribirAtributo } from '../idioma.js';
import { resolver, traducible } from '../textos.js';
import { nombreAccesible, tituloParaVer } from '../titulo-breve.js';
import { datoOficial } from './datos-traducidos.js';
import { contienePalabra, formatearNumero, ordenarPorTitulo } from './formato.js';
import { anunciar } from './pagina.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { Grupo } from './flujo-ocupacion.js' */
/** @import { OcupacionEsco } from './traduccion-api.js' */

/** Hasta aquí, la lista se lee de un vistazo; con más ocupaciones, aparece el filtro por palabra. */
const MAX_SIN_FILTRO = 15;
/** El `name` de las casillas de las ocupaciones: una sola se puede marcar (ocupacionMarcada la lee). */
const NOMBRE_DE_LA_OPCION = 'ocupacion';
/** Sin tareas de la OIT: con qué estimará Faro las tareas de la persona, o que no podrá estimarlas. */
const SIN_TAREAS = traducible('recorrido.confirmar.sin-tareas');
const CON_SUBGRUPO = traducible('recorrido.confirmar.con-subgrupo');
const SIN_REFERENCIAS = traducible('recorrido.confirmar.sin-referencias');
/** La salida «No, es otra cosa». */
const OTRA_COSA = traducible('recorrido.ocupacion.otra-cosa');

/**
 * Lo que necesita la tarjeta de confirmar (crearConfirmacion).
 * @typedef {Object} DatosDeConfirmar
 * @property {Grupo} grupo
 * @property {Grupo | null} secundario
 * @property {string | null} [elegida]
 * @property {(rotulo: Traducible) => void} alSoloGrupo
 * @property {() => void} alOtraCosa
 */

/**
 * El título oficial del grupo con su código ISCO-08 al lado, en pequeño: la persona no lo necesita para decidir.
 * @param {Grupo} grupo
 */
function crearTituloOficial(grupo) {
  return crear(
    'p',
    { className: 'rc-grupo-oficial' },
    escribir(crear('span'), datoOficial(grupo.titulo)),
    crear('span', { className: 'rc-codigo-isco', textContent: grupo.isco08 }),
  );
}

/**
 * Una ocupación para elegir. Se ve en su forma breve y la casilla se llama con lo que se ve y, entre paréntesis, las
 * dos formas enteras («Bombero/a de brigada acuática (bombero o bombera de brigada acuática)»): el nombre contiene lo
 * que se ve (WCAG 2.5.3) y el lector de pantalla oye las dos formas. El texto que se ve queda fuera del árbol de
 * accesibilidad para no oírlo dos veces. Debajo, en pequeño, su código ESCO. Devuelve la opción
 * entera y su casilla.
 * @param {OcupacionEsco} ocupacion @param {boolean} elegida
 * @returns {{ opcion: HTMLLabelElement, casilla: HTMLInputElement }}
 */
function crearOpcion(ocupacion, elegida) {
  const casilla = crear('input', { type: 'radio', name: NOMBRE_DE_LA_OPCION, value: ocupacion.esco, checked: elegida });
  escribirAtributo(casilla, 'aria-label', datoOficial(ocupacion.titulo, nombreAccesible));
  const visto = escribir(crear('strong'), datoOficial(ocupacion.titulo, tituloParaVer));
  visto.setAttribute('aria-hidden', 'true');
  const codigo = crear('small', { className: 'rc-codigo', textContent: `ESCO ${ocupacion.esco}` });
  return { opcion: crear('label', { className: 'rc-opcion' }, casilla, visto, codigo), casilla };
}

/**
 * Lo que encuentra el filtro de una ocupación: su título entero, con las dos formas, y el que se ve, en el idioma de
 * la página. Así se encuentra por «bombera», por «bombero de brigada» y por «bombero/a».
 * @param {{ opcion: HTMLElement, titulo: string }} entrada
 */
function textoDelFiltro({ opcion, titulo }) {
  return `${resolver(datoOficial(titulo))} ${opcion.textContent}`;
}

/**
 * Deja ver solo las ocupaciones que contienen la palabra; si no queda ninguna, lo dice y ofrece la salida.
 * @param {string} palabra @param {{ opcion: HTMLElement, titulo: string }[]} entradas
 * @param {HTMLElement} sinResultados
 */
function filtrar(palabra, entradas, sinResultados) {
  for (const entrada of entradas) {
    entrada.opcion.hidden = !contienePalabra(textoDelFiltro(entrada), palabra);
  }
  const visibles = entradas.filter((entrada) => !entrada.opcion.hidden).length;
  sinResultados.hidden = visibles > 0;
  escribir(sinResultados, traducible('recorrido.confirmar.sin-resultados', { palabra: palabra.trim() }));
  anunciar(
    visibles === 1
      ? traducible('recorrido.confirmar.queda-una')
      : traducible('recorrido.confirmar.quedan', { numero: formatearNumero(visibles) }),
  );
}

/**
 * El filtro por palabra, con su etiqueta y la línea que dice que no queda ninguna.
 * @param {{ opcion: HTMLElement, titulo: string }[]} entradas
 */
function crearFiltro(entradas) {
  const campo = crear('input', { type: 'search', id: 'filtro-ocupaciones', autocomplete: 'off' });
  const sinResultados = crear('p', { className: 'rc-vacio' });
  sinResultados.hidden = true;
  campo.addEventListener('input', () => filtrar(campo.value, entradas, sinResultados));
  // Enter en el filtro no envía la tarjeta: solo filtra.
  campo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
    }
  });
  const etiqueta = escribir(
    crear('label', { className: 'rc-campo', htmlFor: 'filtro-ocupaciones' }),
    traducible('recorrido.confirmar.filtro'),
  );
  return { filtro: crear('div', { className: 'rc-filtro' }, etiqueta, campo), campo, sinResultados };
}

/**
 * Las ocupaciones del grupo para elegir, con el filtro si son muchas, y `elegida` (su código ESCO) ya marcada si se da.
 * Devuelve los nodos y el primer control: el filtro si lo hay; si no, la ocupación marcada o, sin ninguna marcada, la
 * primera casilla (null solo si no hay ocupaciones que elegir).
 * @param {OcupacionEsco[]} ocupaciones @param {string | null} elegida
 * @returns {{ nodos: HTMLElement[], foco: HTMLElement | null }}
 */
function crearEleccion(ocupaciones, elegida) {
  const enOrden = ordenarPorTitulo(ocupaciones, (ocupacion) => resolver(datoOficial(ocupacion.titulo)));
  const entradas = enOrden.map((ocupacion) => ({
    ...crearOpcion(ocupacion, ocupacion.esco === elegida),
    titulo: ocupacion.titulo,
  }));
  const opciones = crear('div', { className: 'rc-opciones' }, ...entradas.map(({ opcion }) => opcion));
  const grupo = crear(
    'fieldset',
    { className: 'rc-grupo' },
    escribir(crear('legend', { className: 'solo-lectores' }), traducible('recorrido.confirmar.leyenda')),
    opciones,
  );
  const primera = (entradas.find(({ casilla }) => casilla.checked) ?? entradas[0])?.casilla ?? null;
  if (ocupaciones.length <= MAX_SIN_FILTRO) {
    return { nodos: [grupo], foco: primera };
  }
  const { filtro, campo, sinResultados } = crearFiltro(entradas);
  return { nodos: [filtro, grupo, sinResultados], foco: campo };
}

/**
 * Un botón con su rótulo (un traducible).
 * @param {Parte} rotulo @param {() => void} alPulsar
 */
function crearBoton(rotulo, alPulsar) {
  const boton = escribir(crear('button', { type: 'button', className: 'rc-boton-anadir' }), rotulo);
  boton.addEventListener('click', alPulsar);
  return boton;
}

/**
 * Sin tareas de la OIT, con qué estimará Faro las tareas de la persona: las del subgrupo, las más parecidas o ninguna.
 * @param {Grupo} grupo
 */
function notaSinTareas(grupo) {
  if (grupo.sinReferencias) {
    return SIN_REFERENCIAS;
  }
  return grupo.referenciasSubgrupo ? CON_SUBGRUPO : SIN_TAREAS;
}

/**
 * Lo que acompaña al título: el grupo secundario que también se tendrá en cuenta y si la OIT no publica tareas.
 * @param {Grupo} grupo @param {Grupo | null} secundario
 */
function crearNotas(grupo, secundario) {
  const notas = [];
  if (secundario) {
    const tambien = traducible('recorrido.confirmar.tambien', { titulo: datoOficial(secundario.titulo) });
    notas.push(escribir(crear('p', { className: 'rc-nota' }), tambien));
  }
  if (grupo.sinTareasOit) {
    notas.push(escribir(crear('p', { className: 'rc-nota' }), notaSinTareas(grupo)));
  }
  return notas;
}

/**
 * La ocupación marcada en la tarjeta, o null.
 * @param {HTMLElement} formulario @returns {string | null}
 */
export function ocupacionMarcada(formulario) {
  const marcada = formulario.querySelector(`input[name="${NOMBRE_DE_LA_OPCION}"]:checked`);
  return marcada instanceof HTMLInputElement ? marcada.value : null;
}

/**
 * El contenido de la tarjeta para confirmar `grupo` ({ isco08, titulo, ocupaciones y sus marcas }), con `secundario` si
 * lo hay. `elegida` es la ocupación
 * ESCO que ya había elegido la persona, si vuelve a la tarjeta: sale marcada. `alSoloGrupo(rotulo)` y `alOtraCosa` son
 * las dos salidas (la primera recibe el rótulo de su botón, que es lo que dice la persona). Devuelve { nodos, foco } y
 * cómo es la acción principal: `conOcupaciones` dice si hay que elegir y enviar («Continuar»).
 * @param {DatosDeConfirmar} datos @returns {{ nodos: HTMLElement[], foco: HTMLElement, conOcupaciones: boolean }}
 */
export function crearConfirmacion({ grupo, secundario, elegida = null, alSoloGrupo, alOtraCosa }) {
  const ocupaciones = grupo.ocupaciones ?? [];
  const soloGrupo = traducible(
    ocupaciones.length ? 'recorrido.confirmar.ninguna-pero-tipo' : 'recorrido.confirmar.si-es-este',
  );
  const botonSoloGrupo = crearBoton(soloGrupo, () => alSoloGrupo(soloGrupo));
  const eleccion = ocupaciones.length ? crearEleccion(ocupaciones, elegida) : { nodos: [], foco: botonSoloGrupo };
  const nodos = [
    crearTituloOficial(grupo),
    ...crearNotas(grupo, secundario),
    ...eleccion.nodos,
    botonSoloGrupo,
    crearBoton(OTRA_COSA, alOtraCosa),
  ];
  return { nodos, foco: eleccion.foco ?? botonSoloGrupo, conOcupaciones: ocupaciones.length > 0 };
}
