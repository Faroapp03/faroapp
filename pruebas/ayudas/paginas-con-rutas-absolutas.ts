/**
 * La página de una dirección que no existe (web/no-existe.html) se sirve en cualquier dirección, también anidada, así
 * que sus enlaces y recursos parten de la raíz del sitio («/inicio.html»); los de las demás páginas, de la propia
 * página («inicio.html»). Las pruebas que comparan la cabecera, el menú o el pie comunes la leen con sus rutas
 * relativas a la raíz, como las demás.
 */

/** Las páginas cuyas rutas parten de la raíz del sitio. */
export const PAGINAS_CON_RUTAS_ABSOLUTAS: ReadonlySet<string> = new Set(['no-existe.html']);

/**
 * El HTML de una página con sus rutas como las de las demás: en una página de PAGINAS_CON_RUTAS_ABSOLUTAS, cada
 * `href="/…"` y `src="/…"` pierde la barra inicial; las demás páginas quedan igual.
 *
 * @param pagina - El nombre de la página dentro de web/.
 * @param html - Su HTML.
 * @returns El HTML con las rutas relativas a la raíz.
 */
export function conRutasRelativas(pagina: string, html: string): string {
  return PAGINAS_CON_RUTAS_ABSOLUTAS.has(pagina) ? html.replaceAll(/\b(href|src)="\/(?!\/)/g, '$1="') : html;
}
