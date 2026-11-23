// Las claves públicas de la raíz de las firmas del manifiesto: van en
// el código de la web, así que solo cambian con una versión nueva de Faro. La raíz firma una vez al año la clave
// diaria, y la clave diaria firma cada manifiesto; el dispositivo no usa nada que no llegue hasta aquí.
// Mientras la lista esté vacía, ni la construcción firma ni el dispositivo exige firma (motor-local/worker.js): el
// motor y el paquete se usan comprobados solo contra sus huellas sin firmar (las del service worker y la del manifiesto
// del paquete). En cuanto lleva claves, el Worker no usa nada que no llegue firmado hasta ellas. Se rellena con las
// públicas de la raíz real, creada sin conexión. Se conserva la forma escrita de la declaración para los generadores
// (`export const CLAVES_RAIZ = [ … ];`): por eso la lista se declara así y se congela
// en la sentencia siguiente, con cada clave, y no dentro de la declaración.

/** @type {{ algoritmo: string, id: string, publica: string }[]} */
export const CLAVES_RAIZ = [];
// Las anclas de confianza no se pueden cambiar en ejecución: ni la lista ni cada clave.
Object.freeze(CLAVES_RAIZ);
for (const clave of CLAVES_RAIZ) {
  Object.freeze(clave);
}

/**
 * Los ids de claves diarias retiradas antes de que caduque su certificado (una clave perdida o robada): la web deja de
 * aceptarlas desde la versión que las añade aquí; la que siga abierta con una versión anterior las acepta hasta que se
 * actualice. Para retirarla, incluir aquí su id y publicar la nueva versión.
 * @type {readonly string[]}
 */
export const CLAVES_DIARIAS_RETIRADAS = Object.freeze([]);
