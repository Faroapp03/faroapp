import './paquete.js';
import { BASE, COPIA, HUELLAS, urlDe } from './catalogo.js';
import { VERSION } from './generado.js';
import { sha256 } from './paquete.js';
import { borrarLaProvisionalSinUso } from './reparar.js';

// ---------- Lo comprobado ----------
// Lo que ejecuta y lee el motor del dispositivo (motor-local/worker.js) sale solo de las copias comprobadas, como en
// una precaché con revisiones:
// - Cada archivo de COMPROBADOS (el motor, el propio Worker y los demás scripts de motor-local/, la comprobación de
//   las firmas, sus bibliotecas y las copias compartidas) y de FIRMAS (el manifiesto firmado) se guarda al instalar
//   solo si cuadra con su huella (respuestaParaLaCopia), y la instalación es todo o nada: una versión que no se baja
//   entera y comprobada no sustituye a la anterior («Instalación que no coincide»).
// - Toda petición a sus archivos con huella o a sus carpetas (CARPETAS_COMPROBADAS) se responde de la copia de esta
//   versión, después de volver a calcular la huella de lo guardado: la copia del navegador la puede tocar cualquier
//   script de la web, y lo que se sirve tiene que ser lo comprobado, byte a byte. import() y fetch, del Worker o de la
//   página, reciben los mismos bytes. Las páginas los cargan además con su huella SRI (el mapa de módulos); el Worker,
//   que no tiene mapa, solo con esta.
// - Toda petición a paquete/ se responde de la copia completa del paquete (desdeLaCopiaDelPaquete).
// - Nada de esto se sirve desde la red ni desde la caché HTTP: lo que falta o no cuadra es un error, y el Worker no
//   ejecuta nada.
// - SONDA_DEL_MOTOR no existe en el servidor: la responde este service worker, y así el Worker sabe que sus peticiones
//   pasan por aquí antes de cargar el motor. Sin service worker (primera visita, un navegador que no lo admite o que
//   no lo pone delante de los Workers dedicados), la sonda falla y el motor del dispositivo no se usa.
// Las páginas, sus estilos y sus otros scripts también se vuelven a comprobar al servirlos de la copia, pero lo que no
// cuadra se descarta y se pide a la red, porque pueden venir de ella (guardadaQueCuadra, servir.js).

/** Las carpetas que se sirven solo de lo comprobado, desde la base de la web. */
const CARPETAS_COMPROBADAS = ['motor/', 'firmas/', 'scripts/motor-local/', 'scripts/firmas/', 'terceros/noble/'].map(
  (carpeta) => new URL(carpeta, BASE).pathname,
);
const RUTA_DE_LOS_PAQUETES = new URL('paquete/', BASE).pathname;
const SONDA_DEL_MOTOR = urlDe('motor/copia-comprobada.json');
const SIN_GUARDAR = { 'cache-control': 'no-store' };
/**
 * Lo comprobado que este service worker se ha negado a servir porque sus bytes no son los de esta versión
 * (noEsDeEstaVersion), mientras está en marcha. La sonda lo cuenta (`noCoincide`) para que el Worker del motor, que no
 * ve el estado de un import() que falla, sepa que el fallo no es de paso. Se olvida al servir el archivo bien.
 * @type {Set<string>}
 */
const NO_COINCIDEN = new Set();
/** 500: la copia guardada en el dispositivo ha cambiado (noEsDeEstaVersion). */
const LA_COPIA_HA_CAMBIADO = 500;
/** El cuerpo de la respuesta con que se rechaza un archivo comprobado que no es de esta versión, o que falta. */
const NO_ES_DE_ESTA_VERSION = 'El archivo del motor del dispositivo no es el de esta versión.';
const LE_FALTA_A_LA_COPIA = 'El archivo del motor del dispositivo falta en la copia guardada.';

/**
 * El error de lo que no está en la copia comprobada: se cuenta en la consola, y el motor del dispositivo no se usa.
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {string} [motivo] - Por qué no se sirve.
 * @returns {Response} Un 503 sin copia en caché.
 */
function noEstaComprobado(clave, motivo = 'no está en la copia comprobada') {
  console.warn(`Faro: el motor del dispositivo no está listo: ${clave} ${motivo}.`);
  return new Response('El motor del dispositivo no está listo.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...SIN_GUARDAR },
  });
}

/**
 * El error de un archivo comprobado cuya copia guardada ya no es la de esta versión (no cuadra con su huella): a
 * diferencia de noEstaComprobado, no es de paso, y quien lo pide no debe esperar a que se arregle solo. Lleva su cuerpo
 * (NO_ES_DE_ESTA_VERSION) y la sonda lo cuenta (NO_COINCIDEN). Es un 500 porque el fallo es de este lado: la copia
 * guardada en el dispositivo ha cambiado (RFC 9110, apartado 15.6.1); no un 503, que se resolvería esperando. Lo que
 * llega de la red sin cuadrar no se sirve nunca: hace fallar la instalación («Instalación que no coincide»).
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {string} [cuerpo] - El cuerpo de la respuesta: no es de esta versión (NO_ES_DE_ESTA_VERSION) o falta.
 * @returns {Response}
 */
function noEsDeEstaVersion(clave, cuerpo = NO_ES_DE_ESTA_VERSION) {
  NO_COINCIDEN.add(clave);
  console.warn(`Faro: el motor del dispositivo no se puede usar: ${clave}: ${cuerpo}`);
  return new Response(cuerpo, {
    status: LA_COPIA_HA_CAMBIADO,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...SIN_GUARDAR },
  });
}

/**
 * Un archivo comprobado: de la copia de esta versión y solo si su huella sigue siendo la de COMPROBADOS o FIRMAS.
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @returns {Promise<Response>}
 */
async function desdeLoComprobado(clave) {
  if (clave === SONDA_DEL_MOTOR) {
    if (NO_COINCIDEN.size === 0) {
      void borrarLaProvisionalSinUso();
    }
    return new Response(JSON.stringify({ version: VERSION, noCoincide: NO_COINCIDEN.size > 0 }), {
      headers: { 'content-type': 'application/json; charset=utf-8', ...SIN_GUARDAR },
    });
  }
  const huella = HUELLAS.get(clave);
  const guardada = huella && (await caches.match(clave, { cacheName: COPIA }));
  if (!guardada) {
    // Con la copia completa, todo lo comprobado se guarda al instalar: si falta, la copia guardada se ha estropeado
    // (el navegador borró parte, o una versión anterior de Faro la dejó a medias) y no es de paso: hay que repararla.
    return huella ? noEsDeEstaVersion(clave, LE_FALTA_A_LA_COPIA) : noEstaComprobado(clave);
  }
  // Se comprueba una rama del mismo cuerpo y se sirve la otra (clone): los mismos bytes, en la respuesta guardada, con
  // su dirección y sus cabeceras.
  const servida = guardada.clone();
  if ((await sha256(await guardada.arrayBuffer())) !== huella) {
    return noEsDeEstaVersion(clave);
  }
  NO_COINCIDEN.delete(clave);
  return servida;
}

export { CARPETAS_COMPROBADAS, desdeLoComprobado, NO_COINCIDEN, noEstaComprobado, RUTA_DE_LOS_PAQUETES, SIN_GUARDAR };
