// Iconos del Panel de Control: SVG en línea que reutilizan los símbolos declarados una sola vez en index.html
// («panel-i-…»). La política de seguridad del panel no admite imágenes data:, así que el icono va en el documento.
// Siempre son decorativos: la palabra o el nombre accesible de su control dice lo que significan.

const SVG = 'http://www.w3.org/2000/svg';

/** @param {string} nombre Nombre del símbolo sin el prefijo, por ejemplo «estado-bien» o «chevron». @returns {SVGSVGElement} */
export function icono(nombre) {
  const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, 'svg'));
  svg.setAttribute('class', `panel-icono panel-icono--${nombre}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const uso = document.createElementNS(SVG, 'use');
  uso.setAttribute('href', `#panel-i-${nombre}`);
  svg.append(uso);
  return svg;
}
