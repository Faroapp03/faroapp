// Buscador de la barra del Panel de Control: lleva a un apartado por su nombre. Las sugerencias son los nombres de la
// navegación en el idioma que se ve, y el navegador las filtra mientras se escribe. ⌘K o Ctrl+K pone el cursor en el
// campo desde cualquier parte del panel; Intro lleva al apartado y Escape vacía el campo.
import { texto } from '../scripts/textos.js';

/** @typedef {{nombre:string, enlace:string}} Apartado */

/** El texto del HTML trae saltos y sangrías: un solo espacio entre palabras. @param {string} valor */
const normalizarEspacios = (valor) => valor.replace(/\s+/gu, ' ').trim();
/** Sin acentos ni mayúsculas, para que «revision» encuentre «Revisión editorial». @param {string} valor */
const normal = (valor) => normalizarEspacios(valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase());

/** Los apartados de la navegación, con el nombre que se ve y su enlace. @param {Element} nav @returns {Apartado[]} */
export function apartadosDe(nav) {
  return Array.from(nav.querySelectorAll('a[data-ir]')).map((enlace) => ({
    nombre: normalizarEspacios(enlace.textContent ?? ''),
    enlace: enlace.getAttribute('href') ?? '',
  }));
}

/**
 * El apartado de lo escrito: primero el de nombre idéntico, después el que empieza así y por último el que lo contiene.
 * @param {readonly Apartado[]} apartados @param {string} consulta @returns {Apartado|null}
 */
export function buscarApartado(apartados, consulta) {
  const buscado = normal(consulta);
  if (!buscado) {
    return null;
  }
  const nombres = apartados.map((a) => normal(a.nombre));
  const criterios = [
    (/** @type {string} */ n) => n === buscado,
    (/** @type {string} */ n) => n.startsWith(buscado),
    (/** @type {string} */ n) => n.includes(buscado),
  ];
  for (const cumple of criterios) {
    const indice = nombres.findIndex(cumple);
    if (indice >= 0) {
      return apartados[indice] ?? null;
    }
  }
  return null;
}

/** @param {Document} doc @param {Window} ventana */
export function iniciarBuscador(doc, ventana) {
  const campo = /** @type {HTMLInputElement|null} */ (doc.querySelector('#panel-buscar'));
  const sugerencias = doc.querySelector('#panel-buscar-apartados');
  const nav = doc.querySelector('#navegacion-panel');
  const armazon = /** @type {HTMLElement|null} */ (doc.querySelector('[data-armazon]'));
  if (!campo || !sugerencias || !nav || !armazon) {
    return null;
  }
  /** Las sugerencias se rehacen al entrar en el campo: así siguen el idioma elegido. */
  function sugerir() {
    sugerencias?.replaceChildren(
      ...apartadosDe(/** @type {Element} */ (nav)).map(({ nombre }) => {
        const opcion = doc.createElement('option');
        opcion.value = nombre;
        return opcion;
      }),
    );
  }
  /** Lleva al apartado; si ninguno se llama así, lo dice junto al campo y no se mueve. */
  function ir() {
    const campoActual = /** @type {HTMLInputElement} */ (campo);
    const apartado = buscarApartado(apartadosDe(/** @type {Element} */ (nav)), campoActual.value);
    if (!apartado) {
      campoActual.setCustomValidity(texto('panel.buscar.sin-resultado'));
      campoActual.reportValidity();
      return;
    }
    campoActual.value = '';
    ventana.location.hash = apartado.enlace;
  }
  campo.addEventListener('focus', sugerir);
  campo.addEventListener('input', (evento) => {
    campo.setCustomValidity('');
    // Elegir una sugerencia de la lista ya es una decisión: lleva al apartado sin pedir Intro.
    if (/** @type {InputEvent} */ (evento).inputType === 'insertReplacementText') {
      ir();
    }
  });
  campo.addEventListener('keydown', (evento) => {
    const tecla = /** @type {KeyboardEvent} */ (evento).key;
    if (tecla === 'Enter') {
      evento.preventDefault();
      ir();
    } else if (tecla === 'Escape') {
      campo.value = '';
      campo.setCustomValidity('');
    }
  });
  doc.addEventListener('keydown', (evento) => {
    const pulsacion = /** @type {KeyboardEvent} */ (evento);
    if ((pulsacion.metaKey || pulsacion.ctrlKey) && pulsacion.key.toLowerCase() === 'k' && !armazon.hidden) {
      pulsacion.preventDefault();
      campo.focus();
    }
  });
  return { ir, sugerir };
}
