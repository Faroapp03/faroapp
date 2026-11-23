// Qué es JavaScript en los ensayos de descargas (descargas-js.mjs) y del presupuesto de rendimiento
// (presupuesto-cifras.mjs y presupuesto-medida.mjs): la única fuente de los dos criterios. Son dos a propósito, porque
// miran desde dos sitios distintos y no se suman:
// - el del servidor cuenta lo que llega al servidor (fixture.ts, el Worker oficial o el servidor del ensayo) por el
//   destino que declara el navegador (`sec-fetch-dest`) o por la ruta; es la cifra del límite y del presupuesto;
// - el del contexto clasifica, en Chromium, lo que ve el propio contexto de Playwright, que no da el destino sino el
//   tipo de recurso e incluye lo que el service worker entrega desde su copia sin llegar al servidor; es solo un
//   contraste.

/** Los destinos (`sec-fetch-dest`) de un script: el de la página y los de sus Workers y su service worker. */
const DESTINOS_JS = new Set(['script', 'worker', 'sharedworker', 'serviceworker']);

/**
 * JavaScript pedido al servidor: destino de script o de Worker (también compartido o service worker), o ruta .js o
 * .mjs. El documento del presupuesto guarda su texto (`criterioJavaScript`).
 *
 * @param {{ ruta: string, destino?: string | null | undefined }} peticion - Una petición del registro de un servidor.
 * @returns {boolean} Si cuenta como JavaScript.
 */
const esJavaScriptDelServidor = ({ ruta, destino }) => DESTINOS_JS.has(destino ?? '') || /\.m?js$/u.test(ruta);

/**
 * JavaScript visto por el contexto de Chromium: tipo de recurso `script` (`resourceType()` de Playwright) o ruta .js o
 * .mjs.
 *
 * @param {{ ruta: string, tipo: string }} vista - Una petición que ha visto el contexto.
 * @returns {boolean} Si cuenta como JavaScript en el contraste.
 */
const esJavaScriptDelContexto = ({ ruta, tipo }) => tipo === 'script' || /\.m?js$/u.test(ruta);

export { esJavaScriptDelContexto, esJavaScriptDelServidor };
