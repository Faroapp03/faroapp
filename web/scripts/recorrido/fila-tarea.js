// Una tarea en la lista del paso 3: su texto, cuánto tiempo le dedica la persona y la tarea oficial de la OIT que le
// corresponde, con quién la eligió. estado.js decide si el texto modificado conserva el emparejamiento. En el selector
// no se puede elegir una tarea oficial que ya cuenta otra tarea (estado.js, quienCuenta). El selector del tiempo lo
// usan también las tareas oficiales marcadas (lista-oficial.js).

import { crear } from '../dom.js';
import { escribir, escribirAtributo, marcarIdiomaPropio } from '../idioma.js';
import { MAX_TAREA as MAX_LETRAS_TAREA } from '../protocolo-web.js';
import { traducible } from '../textos.js';
import { datoOficial } from './datos-traducidos.js';
import { anularEmparejamiento, emparejamientoCaducado, quienCuenta } from './estado.js';
import { formatearNota, formatearNumero, recortar } from './formato.js';
import { anunciar, hayPeticionEnCurso } from './pagina.js';

/** @import { Parte, Traducible } from '../textos.js' */
/** @import { Tarea, TareaOficialDelGrupo } from './estado.js' */
/** @import { TareaOficial } from './traduccion-api.js' */
/** @import { Tiempo } from '../../../src/dominio/tipos-entrada.ts' */

/**
 * Una tarea cabe en MAX_TAREA caracteres: en su campo de la lista y en la barra de escritura, al añadirla. Es el
 * MAX_TAREA del motor (src/comun/protocolo-web.ts), cotejado en pruebas/web-recorrido-pasos/tarjetas.test.ts.
 */
export { MAX_TAREA as MAX_LETRAS_TAREA } from '../protocolo-web.js';

/** Lo que se enseña, en caracteres, de una tarea que la OIT solo publica en inglés, recortada. */
const LETRAS_TAREA_EN_INGLES = 90;
/** El idioma en que la OIT publica las tareas que Faro no tiene en castellano (WCAG 3.1.2). */
const IDIOMA_DE_LA_OIT = 'en';
/**
 * Los tiempos que se pueden dedicar a una tarea, con su rótulo en los diccionarios (recorrido.tiempo.<tiempo>).
 * @type {readonly Tiempo[]}
 */
const TIEMPOS = Object.freeze(['mucho', 'algo', 'poco']);
/** El rótulo de cada tiempo, con su clave escrita entera para que se pueda comprobar que existe en es y ca. */
const ROTULO_DEL_TIEMPO = Object.freeze({
  mucho: traducible('recorrido.tiempo.mucho'),
  algo: traducible('recorrido.tiempo.algo'),
  poco: traducible('recorrido.tiempo.poco'),
});
/** Lo que dice la fila de una tarea cuando sus grupos no tienen tareas oficiales de la OIT. */
const SIN_TAREAS_DE_LA_OIT = traducible('recorrido.tarea.sin-oit');
/** Lo que dice la fila cuando Faro no tiene tareas de referencia con que estimar una tarea sin tarea oficial. */
const TEXTO_SIN_REFERENCIAS = traducible('recorrido.tarea.sin-referencias');

/**
 * Cómo se escribe el nombre de una tarea en un elemento, para los lectores de pantalla; devuelve el mismo elemento.
 * @typedef {(elemento: HTMLElement) => HTMLElement} Nombrar
 */
/**
 * Las tareas oficiales que se pueden elegir para una tarea, cómo se nombra esta y lo que se hace al elegir una
 * (crearFilaDeTarea).
 * @typedef {Object} Oficiales
 * @property {TareaOficialDelGrupo[]} oficiales
 * @property {boolean} conGrupo
 * @property {Nombrar} nombrar
 * @property {() => void} alElegirOficial
 */
/**
 * Lo que necesita la fila de una tarea (crearFilaDeTarea explica cada campo).
 * @typedef {Object} OpcionesDeLaFila
 * @property {TareaOficialDelGrupo[]} oficiales
 * @property {boolean} [conGrupo]
 * @property {boolean} [sinReferencias]
 * @property {() => void} alQuitar
 * @property {() => void} [alElegirOficial]
 */

/**
 * El nombre de una tarea oficial en castellano: el corto o, si no lo tiene (falta o está vacío), el texto entero; null
 * si la OIT solo lo publica en inglés. Es el único sitio que elige ese nombre: lo usan las filas, las listas y la
 * tarea que se crea al marcar una oficial (paso-tareas.js).
 * @param {Pick<TareaOficial, 'corto' | 'texto_es'>} tareaOficial @returns {string | null}
 */
export function nombreEnCastellano(tareaOficial) {
  return tareaOficial.corto || tareaOficial.texto_es || null;
}

/**
 * La tarea oficial recortada en el inglés de la OIT, para lo que no admite un elemento aparte.
 * @param {TareaOficial} tareaOficial
 */
function nombreEnIngles(tareaOficial) {
  return recortar(tareaOficial.texto_en, LETRAS_TAREA_EN_INGLES);
}

/**
 * Escribe en `elemento` el nombre de una tarea oficial: el corto o el texto entero (un dato oficial, en el idioma de
 * la página si tiene su traducción de Faro) o, si solo hay inglés, recortado y avisado, con el inglés en un elemento
 * propio marcado con su idioma, para que un lector de pantalla lo lea en inglés (WCAG 3.1.2).
 * @template {HTMLElement} Elemento @param {Elemento} elemento @param {TareaOficial} tareaOficial
 * @returns {Elemento} el mismo elemento
 */
export function escribirNombreOficial(elemento, tareaOficial) {
  const enCastellano = nombreEnCastellano(tareaOficial);
  if (enCastellano) {
    return escribir(elemento, datoOficial(enCastellano));
  }
  elemento.append(crear('span', { lang: IDIOMA_DE_LA_OIT, textContent: nombreEnIngles(tareaOficial) }));
  // El texto del diccionario coloca ese elemento en su sitio ({0}, idioma.js) y añade «(en inglés)» en el de la página.
  return escribir(elemento, traducible('recorrido.tarea.en-ingles'));
}

/**
 * El nombre de una tarea oficial dentro de un texto que no admite elementos (un `<option>`, una frase): en castellano
 * (en el idioma de la página si tiene su traducción) o, si solo existe en inglés, recortado y avisado.
 * @param {TareaOficial} tareaOficial @returns {Parte}
 */
export function nombreEnUnTexto(tareaOficial) {
  const castellano = nombreEnCastellano(tareaOficial);
  if (castellano) {
    return datoOficial(castellano);
  }
  return traducible('recorrido.tarea.en-ingles-en-lista', { texto: nombreEnIngles(tareaOficial) });
}

/**
 * Nombre y nota publicada de una tarea oficial, para las listas; con dos grupos, también el suyo. El rótulo de un
 * `<option>` no admite elementos dentro: si el nombre solo existe en inglés, el idioma va en el propio `<option>`
 * (`marcarRotuloEnIngles`).
 * @param {TareaOficialDelGrupo} tareaOficial @param {boolean} conGrupo @returns {Traducible}
 */
function rotuloEnLaLista(tareaOficial, conGrupo) {
  return traducible(conGrupo ? 'recorrido.tarea.rotulo-grupo' : 'recorrido.tarea.rotulo', {
    nombre: nombreEnUnTexto(tareaOficial),
    nota: formatearNota(tareaOficial.nota),
    grupo: datoOficial(tareaOficial.grupo),
  });
}

/**
 * Un rótulo cuyo nombre solo existe en inglés se lee en inglés: su elemento guarda ese idioma (WCAG 3.1.2).
 * @template {HTMLElement} Elemento @param {Elemento} elemento @param {TareaOficial} tareaOficial
 */
function marcarRotuloEnIngles(elemento, tareaOficial) {
  if (!nombreEnCastellano(tareaOficial)) {
    marcarIdiomaPropio(elemento, IDIOMA_DE_LA_OIT);
  }
  return elemento;
}

/**
 * El rótulo traducible y el nombre de su tarea, en elementos propios para conservarlos al cambiar de idioma.
 * @template {'legend' | 'label'} Etiqueta @param {Etiqueta} etiqueta @param {string} clave @param {Nombrar} nombrar
 */
function etiquetaConTarea(etiqueta, clave, nombrar) {
  return crear(
    etiqueta,
    {},
    escribir(crear('span'), traducible(clave)),
    document.createTextNode(' '),
    nombrar(crear('span', { className: 'solo-lectores' })),
  );
}

/**
 * «¿Cuánto tiempo le dedicas?», con el nombre de la tarea para los lectores de pantalla (WCAG 1.3.1).
 * @param {Tarea} tarea @param {Nombrar} [nombrar] @returns {HTMLFieldSetElement}
 */
export function crearSelectorTiempo(tarea, nombrar = (elemento) => escribir(elemento, tarea.texto)) {
  const opciones = TIEMPOS.map((valor) => {
    const opcion = crear('input', {
      type: 'radio',
      name: `tiempo-${tarea.id}`,
      value: valor,
      checked: tarea.tiempo === valor,
    });
    opcion.addEventListener('change', () => {
      tarea.tiempo = valor;
      // La fila deja de señalar que falta el tiempo (revision.js); fuera de una fila no hay nada que quitar.
      const fila = opcion.closest('li');
      if (fila) {
        delete fila.dataset.falta;
      }
    });
    return crear('label', {}, opcion, escribir(crear('span'), ROTULO_DEL_TIEMPO[valor]));
  });
  return crear(
    'fieldset',
    { className: 'rc-tiempo' },
    etiquetaConTarea('legend', 'recorrido.tiempo.pregunta', nombrar),
    ...opciones,
  );
}

/** De dónde sale la tarea oficial elegida. @param {Tarea} tarea */
function origenDeLaTareaOficial(tarea) {
  if (!tarea.oficial) {
    return traducible('recorrido.tarea.origen.sin');
  }
  if (tarea.oficial === tarea.propuesta) {
    return traducible('recorrido.tarea.origen.propuesta');
  }
  return traducible('recorrido.tarea.origen.elegida');
}

/**
 * Una opción del selector. La tarea oficial que ya cuenta otra tarea se ve, pero no se puede elegir.
 * @param {Tarea} tarea @param {TareaOficialDelGrupo} tareaOficial @param {boolean} conGrupo
 */
function crearOpcionOficial(tarea, tareaOficial, conGrupo) {
  const opcion = crear('option', {
    value: tareaOficial.id,
    selected: tareaOficial.id === tarea.oficial,
    disabled: Boolean(quienCuenta(tareaOficial.id, tarea)),
  });
  return escribir(marcarRotuloEnIngles(opcion, tareaOficial), rotuloEnLaLista(tareaOficial, conGrupo));
}

/**
 * El selector de la tarea oficial: «Ninguna» y las de sus grupos.
 * @param {Tarea} tarea @param {Oficiales} listas
 */
function crearListaDeOficiales(tarea, { oficiales, conGrupo }) {
  return crear(
    'select',
    { id: `oficial-${tarea.id}` },
    escribir(crear('option', { value: '', selected: !tarea.oficial }), traducible('recorrido.tarea.ninguna')),
    ...oficiales.map((tareaOficial) => crearOpcionOficial(tarea, tareaOficial, conGrupo)),
  );
}

/**
 * La tarea oficial que corresponde a una tarea, con quién la eligió; se anula si la persona cambia el texto.
 * @param {Tarea} tarea @param {number} orden @param {HTMLInputElement} campoTexto @param {Oficiales} listas
 */
function crearSelectorOficial(tarea, orden, campoTexto, listas) {
  const selector = crearListaDeOficiales(tarea, listas);
  const origen = escribir(crear('p', { className: 'rc-emparejada' }), origenDeLaTareaOficial(tarea));
  // Elegir una tarea oficial la empareja con el texto que hay escrito en ese momento. La lista se vuelve a pintar
  // (`alElegirOficial`): la tarea oficial elegida ya no se puede marcar ni elegir en otra tarea.
  selector.addEventListener('change', () => {
    tarea.oficial = selector.value || null;
    tarea.emparejadaPara = tarea.oficial ? tarea.texto : null;
    escribir(origen, origenDeLaTareaOficial(tarea));
    listas.alElegirOficial();
  });
  campoTexto.addEventListener('change', () => {
    if (!emparejamientoCaducado(tarea)) {
      return;
    }
    anularEmparejamiento(tarea);
    selector.value = '';
    escribir(origen, traducible('recorrido.tarea.cambiada'));
    anunciar(traducible('recorrido.tarea.cambiada-anuncio', { numero: formatearNumero(orden) }));
  });
  const etiqueta = etiquetaConTarea('label', 'recorrido.tarea.oficial-etiqueta', listas.nombrar);
  etiqueta.className = 'rc-campo';
  etiqueta.htmlFor = `oficial-${tarea.id}`;
  return [etiqueta, selector, origen];
}

/** El campo con el texto de la tarea, que la persona puede editar. @param {Tarea} tarea */
function crearCampoDeTarea(tarea) {
  const campo = crear('input', {
    type: 'text',
    id: `tarea-${tarea.id}`,
    value: tarea.texto,
    maxLength: MAX_LETRAS_TAREA,
    autocomplete: 'off',
  });
  campo.addEventListener('input', () => {
    tarea.texto = campo.value;
  });
  return campo;
}

/**
 * «Quitar», con el número de la tarea en su nombre; mientras Faro responde, no quita nada.
 * @param {number} orden @param {() => void} alQuitar
 */
function crearBotonQuitar(orden, alQuitar) {
  const quitar = escribir(
    crear('button', { type: 'button', className: 'rc-quitar' }),
    traducible('recorrido.tarea.quitar'),
  );
  escribirAtributo(
    quitar,
    'aria-label',
    traducible('recorrido.tarea.quitar-nombre', { numero: formatearNumero(orden) }),
  );
  quitar.addEventListener('click', () => {
    if (!hayPeticionEnCurso()) {
      alQuitar();
    }
  });
  return quitar;
}

/**
 * El nombre accesible sigue al texto del campo, también mientras se edita sin salir de él.
 * @param {Tarea} tarea @param {HTMLInputElement} campoTexto @returns {Nombrar}
 */
function nombreEditable(tarea, campoTexto) {
  return (elemento) => {
    const actualizar = () => escribir(elemento, tarea.texto);
    campoTexto.addEventListener('input', actualizar);
    return actualizar();
  };
}

/**
 * La fila de la tarea número `orden`. `oficiales` son las tareas oficiales de sus grupos (con `conGrupo`, cada una dice
 * de qué grupo es); `alQuitar`, lo que hace su botón «Quitar»; `alElegirOficial`, lo que se hace tras elegir su tarea
 * oficial. Sin tareas oficiales, la fila dice cómo tendrá nota: `sinReferencias` si Faro no tiene con qué estimarla.
 * @param {Tarea} tarea @param {number} orden @param {OpcionesDeLaFila} opciones
 * @returns {HTMLLIElement}
 */
export function crearFilaDeTarea(tarea, orden, opciones) {
  const { oficiales, conGrupo = false, sinReferencias = false, alQuitar, alElegirOficial = () => {} } = opciones;
  const campoTexto = crearCampoDeTarea(tarea);
  const nombrar = nombreEditable(tarea, campoTexto);
  const cabecera = crear(
    'div',
    { className: 'rc-tarea-cabecera' },
    escribir(
      crear('label', { htmlFor: `tarea-${tarea.id}` }),
      traducible('recorrido.tarea.numero', { numero: formatearNumero(orden) }),
    ),
    crearBotonQuitar(orden, alQuitar),
  );
  const fila = crear('li', { className: 'rc-tarea' }, cabecera, campoTexto, crearSelectorTiempo(tarea, nombrar));
  fila.dataset.tarea = String(tarea.id);
  if (oficiales.length) {
    fila.append(...crearSelectorOficial(tarea, orden, campoTexto, { oficiales, conGrupo, nombrar, alElegirOficial }));
  } else {
    const sinOficiales = sinReferencias ? TEXTO_SIN_REFERENCIAS : SIN_TAREAS_DE_LA_OIT;
    fila.append(escribir(crear('p', { className: 'rc-emparejada' }), sinOficiales));
  }
  return fila;
}
