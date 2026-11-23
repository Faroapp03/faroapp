// Plantilla de los valores que genera la construcción del service worker
// (herramientas/web/servicio/servicio-publicado.ts): aquí van en su forma neutra y no se editan a mano;
// npm run web:preparar escribe los reales en web/service-worker.js.
export const VERSION = '';

/**
 * El manifiesto de lo que descarga el dispositivo y, si la web lleva raíz de firmas, su firma
 * (docs/construccion-web.md), con su huella SHA-256. En el repositorio va vacía: se publican al desplegar. Mientras no
 * haya raíz de confianza no hay firma de despliegue (docs/construccion-web.md, «Límites»); una firma nunca se inventa
 * ni se reutiliza de otra publicación. La publicación debe incorporar el manifiesto y su firma solo después de
 * comprobar su firma con el código del dispositivo. Con ella, el manifiesto y su firma se guardan en la copia de esta
 * versión, junto al motor que describen, y se sirven solo de ella, como lo comprobado: el motor funciona sin conexión,
 * «Faro verificable» compara con el manifiesto de esta versión y nunca se combina el manifiesto de una versión con el
 * motor de otra. Cambiarla cambia el nombre de la copia (COPIA): volver a firmar sin cambiar la web también instala
 * una copia nueva, con la firma nueva.
 *
 * @type {readonly (readonly [archivo: string, huella: string])[]}
 */
export const FIRMAS = [];
/**
 * La versión del paquete de datos que usa esta web: las primeras cifras de la huella SHA-256 de su manifiesto, la
 * carpeta en que se publica (paquete/<PAQUETE>/). La escribe y la comprueba npm run web:preparar, como
 * VERSION.
 */
export const PAQUETE = '';
/**
 * Lo que pesa cada archivo del paquete de PAQUETE, en bytes, como JSON: { "esco.json": 5652419, … }. Sirve para contar
 * cuánto lleva la copia en megas (PROGRESO_DEL_PAQUETE). La escribe y la comprueba npm run web:preparar
 * (herramientas/web/copia-sin-conexion.ts) desde los archivos de datos/, en la misma pasada que PAQUETE.
 */
export const TAMANOS_DEL_PAQUETE = '{}';
/**
 * El catálogo de la copia sin conexión: cada ruta, una sola vez, con la huella SHA-256 de lo publicado y su clase
 * (instalar, adorno, demanda, seccion o comprobado). Lo escribe y lo comprueba npm run web:preparar
 * (herramientas/web/copia-sin-conexion.ts); catalogo.js deriva de él todo lo demás.
 *
 * @type {readonly (readonly [ruta: string, huella: string, clase: 'instalar' | 'adorno' | 'demanda' | 'seccion' | 'comprobado'])[]}
 */
export const CATALOGO = [];
