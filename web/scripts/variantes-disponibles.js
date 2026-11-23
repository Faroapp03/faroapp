/** @typedef {{ readonly ruta: string, readonly estado: Readonly<Record<'es' | 'ca', string>>, readonly opcion: Readonly<Record<'es' | 'ca', string>> }} VarianteInstalada */
/**
 * Las variantes de recorrido instaladas además del real, generadas desde el registro de extensiones
 * (src/plataforma/extensiones.ts) y los textos de cada extensión (<carpeta>/idiomas/<idioma>/recorrido.js): no se
 * editan a mano. Cada una lleva la ruta de su entrada, relativa a la web, y en cada idioma el estado que muestra el
 * menú y el nombre de su opción en el panel. Sin extensiones, el objeto está vacío.
 * @type {Readonly<Record<string, VarianteInstalada>>}
 */
export const VARIANTES_INSTALADAS = Object.freeze({});
