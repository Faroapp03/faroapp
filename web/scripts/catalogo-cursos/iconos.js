/** Iconos decorativos de materia, construidos con trazos locales de SVG. */
/** @import { TemaCurso } from '../../recursos/catalogo-cursos/lector.js' */
/** @type {Record<TemaCurso, string>} */
const TRAZOS = {
  'no-indicado': 'M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h5',
  ia: 'M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4-4.4-1.6 4.4-1.6zM18 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  digital:
    'M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5zM9 20h6M12 16v4',
  ofimatica: 'M7 3.5h7l4 4V20.5H7zM14 3.5V7.5h4M9.5 12h6M9.5 15h6M9.5 18h4',
  datos: 'm8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 6l-3 12',
  seguridad: 'M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6zM9 12l2 2 4-4',
  empresa:
    'M5 7.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V9A1.5 1.5 0 0 1 5 7.5zM9 7.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3.5 12.5h17',
  oficio: 'M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5L16 12l-2.5-.5L13 9z',
  diseno: 'm4 17 11-11 3 3L7 20H4zM13 8l3 3M14 5l2-2 5 5-2 2',
  web: 'M3 4h18v16H3zM3 8h18M6 6h.01M9 6h.01M7 12l-2 2 2 2M17 12l2 2-2 2M13 11l-2 6',
  comunicacion: 'M4 4h16v12H10l-6 4zM8 8h8M8 12h5',
  empleo: 'M4 7h16v13H4zM8 7V4h8v3M4 12h16M10 12v3h4v-3',
  ciudadania: 'M3 5h18v14H3zM7 9h3v4H7zM13 9h5M13 12h5M7 16h11',
  educacion: 'M3 5c4-2 6-2 9 0 3-2 5-2 9 0v15c-4-2-6-2-9 0-3-2-5-2-9 0zM12 5v15',
  sistemas: 'M8 3h8v5H8zM3 16h7v5H3zM14 16h7v5h-7zM12 8v4M6 16v-4h12v4',
};
/** @param {TemaCurso} tema */
export function iconoTema(tema) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lecturas-icono');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', TRAZOS[tema]);
  svg.append(path);
  return svg;
}
