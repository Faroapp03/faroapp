/** Recursos abiertos de Faro para una hoja sin cursos. Son los mismos para todas las personas: se eligen por tema,
 * no por quién las lee, y no prometen nada. */
import { crear } from '../../dom.js';

const RECURSOS = [
  { clave: 'formacion.mientras.guia', destino: 'entender-ia.html' },
  { clave: 'formacion.mientras.desafio', destino: 'entender-ia.html#desafio' },
  { clave: 'formacion.mientras.biblioteca', destino: 'biblioteca.html' },
];
/** @typedef {<E extends HTMLElement>(elemento: E, clave: string) => E} EscribirClave */
/** @param {EscribirClave} escribirClave @param {{ conAcreditacion: boolean, clase: string }} opciones */
export function bloqueMientrasTanto(escribirClave, { conAcreditacion, clase }) {
  const lista = crear(
    'ul',
    {},
    ...RECURSOS.map(({ clave, destino }) =>
      crear('li', {}, escribirClave(crear('a', { href: destino, className: 'pe-enlace' }), clave)),
    ),
  );
  const seccion = crear(
    'section',
    { className: clase },
    escribirClave(crear('h3'), 'formacion.mientras.titulo'),
    escribirClave(crear('p'), 'formacion.mientras.intro'),
    lista,
  );
  if (conAcreditacion) {
    seccion.append(escribirClave(crear('p'), 'formacion.mientras.acreditacion'));
  }
  seccion.append(escribirClave(crear('p', { className: 'pe-nota' }), 'formacion.mientras.volver'));
  return seccion;
}
