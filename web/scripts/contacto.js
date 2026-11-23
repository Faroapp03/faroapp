// Contacto de publicación: el único origen es la configuración común; no consulta al servidor ni al almacenamiento.
import { CONTACTO_PUBLICO, leerContactoPublico } from './contacto-publico.js';

/** Construye solo al usarlo el correo elegido por la persona.
 * @param {string} correo @param {{asunto?:string,cuerpo?:string}} [mensaje] */
export function enlaceDeCorreo(correo, { asunto, cuerpo } = {}) {
  const contacto = leerContactoPublico({ responsable: '', correo });
  if (!contacto.correo) {
    return null;
  }
  const parametros = [];
  if (asunto) {
    parametros.push(`subject=${encodeURIComponent(asunto)}`);
  }
  if (cuerpo) {
    parametros.push(`body=${encodeURIComponent(cuerpo)}`);
  }
  const consulta = parametros.length ? `?${parametros.join('&')}` : '';
  return `mailto:${encodeURIComponent(contacto.correo)}${consulta}`;
}

/** @param {ParentNode} raiz @param {string} selector */
function elementos(raiz, selector) {
  return [...raiz.querySelectorAll(selector)].map((elemento) => {
    if (!(elemento instanceof HTMLElement)) {
      throw new TypeError('El contacto requiere un elemento HTML');
    }
    return elemento;
  });
}

/** No muestra identidades ni enlaces vacíos; los datos de configuración entran siempre como texto.
 * @param {ParentNode} [raiz] @param {{responsable:string,correo:string}} [entrada] */
export function prepararContacto(raiz = document, entrada = CONTACTO_PUBLICO) {
  const contacto = leerContactoPublico(entrada);
  for (const elemento of elementos(raiz, '[data-contacto-responsable]')) {
    elemento.textContent = contacto.responsable;
    elemento.hidden = !contacto.responsable;
  }
  for (const elemento of elementos(raiz, '[data-contacto-correo]')) {
    elemento.replaceChildren();
    elemento.hidden = !contacto.correo;
    const direccion = enlaceDeCorreo(contacto.correo);
    if (direccion) {
      const enlace = elemento.ownerDocument.createElement('a');
      enlace.textContent = contacto.correo;
      enlace.href = direccion;
      elemento.append(enlace);
    }
  }
  for (const elemento of elementos(raiz, '[data-contacto-solo]')) {
    const campo = elemento.getAttribute('data-contacto-solo');
    if (campo !== 'responsable' && campo !== 'correo') {
      throw new TypeError('Campo de contacto no reconocido');
    }
    elemento.hidden = campo === 'responsable' ? !contacto.responsable : !contacto.correo;
  }
  for (const elemento of elementos(raiz, '[data-contacto-sin-correo]')) {
    elemento.hidden = Boolean(contacto.correo);
  }
}
