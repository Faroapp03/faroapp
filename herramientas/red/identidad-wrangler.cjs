// Solo el proceso privado de Wrangler fijado. No modifica node_modules ni el agente TLS.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { identidad } = require('../../config/identidad-web.json');
const compatibilidad = require('./compatibilidad-wrangler.json');
const CAMPOS = new Set(Object.keys(identidad).map((nombre) => nombre.toLowerCase()));

/** Rechaza otra implementación antes de cargar el CLI o instalar interceptores.
 * @param {string} raiz
 */
function comprobarWrangler(raiz) {
  const paquete = JSON.parse(readFileSync(resolve(raiz, 'package.json'), 'utf8'));
  if (paquete.version !== compatibilidad.version) {
    throw new Error('Wrangler incompatible con el perfil de red');
  }
  for (const [ruta, huella] of Object.entries(compatibilidad.archivos)) {
    const actual = createHash('sha256')
      .update(readFileSync(resolve(raiz, ruta)))
      .digest('hex');
    if (actual !== huella) {
      throw new Error('Transporte de Wrangler no comprobado');
    }
  }
}
/** Formas de cabeceras del paquete fijado de Wrangler: registro de `fetch` o vector plano de `dispatch`.
 * No se reparan otros formatos ni se normalizan cabeceras ajenas.
 * @param {unknown} entrada
 * @returns {Record<string,string>|string[]}
 */
function cabeceras(entrada) {
  if (
    entrada &&
    Object.getPrototypeOf(entrada) === Object.prototype &&
    Object.values(entrada).every((v) => typeof v === 'string')
  ) {
    return {
      ...Object.fromEntries(Object.entries(entrada).filter(([nombre]) => !CAMPOS.has(nombre.toLowerCase()))),
      ...identidad,
    };
  }
  if (!Array.isArray(entrada) || entrada.length % 2 !== 0 || !entrada.every((v) => typeof v === 'string')) {
    throw new Error('Cabeceras del despachador incompatibles');
  }
  const salida = [];
  for (let i = 0; i < entrada.length; i += 2) {
    if (!CAMPOS.has(entrada[i].toLowerCase())) {
      salida.push(entrada[i], entrada[i + 1]);
    }
  }
  return [...salida, ...Object.entries(identidad).flat()];
}
/** Intercepta solo las dos publicaciones del despachador verificadas en el paquete construido de Wrangler.
 * Las opciones, el manejador, el destino y el agente original se conservan.
 * @returns {void}
 */
function instalarDispatcher() {
  const original = Object.defineProperty;
  const claves = new Set([Symbol.for('undici.globalDispatcher.1'), Symbol.for('undici.globalDispatcher.2')]);
  const adaptados = new WeakMap();
  Object.defineProperty = function definir(objeto, clave, descriptor) {
    if (objeto !== globalThis || !claves.has(clave)) {
      return original(objeto, clave, descriptor);
    }
    const agente = descriptor.value;
    if (!agente || typeof agente.dispatch !== 'function') {
      throw new Error('Despachador de Wrangler incompatible');
    }
    let adaptado = adaptados.get(agente);
    if (!adaptado) {
      adaptado = new Proxy(agente, {
        get(destino, propiedad) {
          if (propiedad === 'dispatch') {
            return function dispatch(opciones, handler) {
              return Reflect.apply(destino.dispatch, destino, [
                { ...opciones, headers: cabeceras(opciones.headers) },
                handler,
              ]);
            };
          }
          const valor = Reflect.get(destino, propiedad, destino);
          return typeof valor === 'function' ? valor.bind(destino) : valor;
        },
      });
      adaptados.set(agente, adaptado);
    }
    return original(objeto, clave, { ...descriptor, value: adaptado });
  };
}
comprobarWrangler(resolve(__dirname, '../../node_modules/wrangler'));
require('./identidad-http.cjs');
instalarDispatcher();
module.exports = { comprobarWrangler, cabeceras };
