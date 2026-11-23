// Generado desde src/comun/texto-buscable.js; no editar esta copia.
/**
 * Forma de consulta para títulos y nombres visibles: ignora mayúsculas, tildes latinas
 * y la variante tipográfica del apóstrofo. Conserva otros signos y alfabetos.
 * No transforma identificadores, URLs, texto mostrado ni entradas de seguridad.
 * @param {string} texto
 * @returns {string}
 */
export function textoBuscable(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/’/gu, "'");
}
