// Cómo se lee la VERSION del texto del service worker publicado: la única definición para el doctor, los ensayos de
// navegador y las pruebas. La construcción la escribe en su propia línea, `var VERSION = "<16 cifras hex>";`
// (herramientas/web/servicio/servicio-publicado.ts, lineaDelValor), y una construcción anterior la escribía como
// `const VERSION = '<16 cifras hex>';`: se admiten las dos, con cualquiera de las dos comillas y nada más en la línea.
// La barrera de versión (barrera-version.js) es un guion clásico y no puede importar este módulo: lleva la misma
// expresión, y pruebas/web-publicacion/version-del-servicio.test.ts exige que sea idéntica a esta.

/** La línea que declara la VERSION: una declaración de nivel superior con un literal de 16 cifras hexadecimales. */
export const LINEA_DE_LA_VERSION = /^(?:var|let|const) VERSION = (?:"([a-f0-9]{16})"|'([a-f0-9]{16})');$/gmu;

/**
 * La VERSION que declara el texto de un service worker, o null si no la declara exactamente una vez en su línea.
 * @param {string} texto @returns {string | null}
 */
export function versionDelServicio(texto) {
  const lineas = [...texto.matchAll(LINEA_DE_LA_VERSION)];
  const [linea] = lineas;
  return lineas.length === 1 && linea ? (linea[1] ?? linea[2] ?? null) : null;
}
