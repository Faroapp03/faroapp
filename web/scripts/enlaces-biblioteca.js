// Acciones públicas de Biblioteca desde hechos admitidos por su generador; no consulta fuentes remotas.
// La fecha de la última confirmación se enseña siempre: su edad solo avisa a quien mantiene los datos.
// Un enlace que falló en la última revisión sigue abierto, con un aviso: el fallo es del enlace, no del documento.
import { fechaNumerica, partesUtc } from './fechas.js';
import { alCambiarIdioma, escribir } from './idioma.js';
import { idiomaActual, traducible } from './textos.js';

/** @import { Idioma } from './textos.js' */

/** La URL y su confirmación son independientes para cada idioma.
 * @param {HTMLElement} enlace @param {Idioma} idioma
 */
function decision(enlace, idioma) {
  const url = enlace.getAttribute(`data-enlace-${idioma}`) ?? enlace.getAttribute('data-enlace-es');
  const abrir = url !== null && enlace.getAttribute(`data-abrir-${idioma}`) === 'true';
  const captura = Date.parse(enlace.getAttribute(`data-comprobado-${idioma}`) ?? '');
  const comprobado = abrir && Number.isFinite(captura);
  const incidencia = abrir && enlace.hasAttribute(`data-incidencia-${idioma}`);
  return { url, abrir, captura, comprobado, incidencia };
}

/** @param {HTMLElement} enlace @param {HTMLElement} aviso
 * @param {ReturnType<typeof decision>} dato
 */
function mostrarDecision(enlace, aviso, dato) {
  if (dato.abrir && dato.url) {
    enlace.setAttribute('href', dato.url);
    enlace.removeAttribute('aria-disabled');
  } else {
    enlace.removeAttribute('href');
    enlace.setAttribute('aria-disabled', 'true');
  }
  aviso.hidden = dato.abrir && !dato.comprobado && !dato.incidencia;
  if (!dato.abrir) {
    escribir(aviso, traducible('biblioteca.enlace-no-disponible'));
    return;
  }
  const fecha = dato.comprobado ? fechaNumerica(partesUtc(dato.captura)) : null;
  if (dato.incidencia) {
    escribir(
      aviso,
      fecha === null
        ? traducible('biblioteca.enlace-incidencia')
        : traducible('biblioteca.comprobado-con-incidencia', { fecha }),
    );
  } else if (fecha !== null) {
    escribir(aviso, traducible('biblioteca.comprobado', { fecha }));
  }
}

/** Conserva la ficha y distingue destino no seguro, desconocido, confirmado con su fecha e incidencia del enlace.
 * @param {ParentNode} raiz @param {Idioma} idioma
 */
function actualizarEnlacesBiblioteca(raiz, idioma) {
  for (const ficha of raiz.querySelectorAll('[data-lectura]')) {
    const enlace = ficha.querySelector('a[data-enlace-es]');
    const aviso = ficha.querySelector('[data-comprobacion-enlace]');
    if (!(enlace instanceof HTMLElement) || !(aviso instanceof HTMLElement)) {
      continue;
    }
    mostrarDecision(enlace, aviso, decision(enlace, idioma));
  }
}

/** Se actualiza al cambiar de idioma; no renueva fechas ni depende del reloj. */
export function iniciarEnlacesBiblioteca() {
  const actualizar = () => actualizarEnlacesBiblioteca(document, idiomaActual());
  actualizar();
  alCambiarIdioma(actualizar);
}
