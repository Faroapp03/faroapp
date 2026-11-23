// «Borrar todo» en «Tus datos» retira las preferencias de Faro, las copias locales y la clave de firma del motor.
// El recorrido vive en la página; los almacenes de otras aplicaciones y la configuración operativa del servicio no
// se tocan. Las demás pestañas reciben el aviso compartido. Si otra pestaña bloquea la retirada de la clave,
// se conserva el límite de espera de motor-local/secreto-firma.js. La confirmación usa el diccionario de sitio.js.

import './sitio.js';
import { avisarBorrado } from './aviso-de-borrado.js';
import { borrarSecretoDeFirma } from './motor-local/secreto-firma.js';
import { COPIA_SECCIONES } from './secciones.js';
import { texto } from './textos.js';

/** Todas las claves que guarda Faro empiezan así («faro-tema», «faro-idioma»); las de otras webs no se tocan. */
const PREFIJO = 'faro-';
/** La raíz de la web, de la que cuelgan el service worker y su copia: este archivo está en scripts/. */
const BASE = new URL('../', import.meta.url);
/** El mismo prefijo que pone el service worker (src/service-worker/catalogo.js, PREFIJO) al nombre de cada copia: solo se borran las copias de esta web. */
const PREFIJO_COPIAS = `faro:${BASE.href}:`;
/** El prefijo de la copia del paquete de datos (src/service-worker/paquete.js, «Paquete de datos»), que no cambia con la web. */
const PREFIJO_PAQUETE = 'faro-paquete-';
/** La copia de estado de esta web (src/service-worker/no-coincide.js, «Instalación que no coincide»): cómo acabó su instalación. */
const COPIA_DEL_ESTADO = `faro-estado:${BASE.href}`;
/** Adónde vuelve la página después de borrar. */
const INICIO = 'inicio.html';
/**
 * Borra de `almacen` las claves de Faro que son de la persona (no las de la entidad).
 * @param {Storage} almacen
 * @returns {void}
 */
function borrarClaves(almacen) {
  const deFaro = Object.keys(almacen).filter((clave) => clave.startsWith(PREFIJO));
  for (const clave of deFaro) {
    almacen.removeItem(clave);
  }
}

/**
 * Borra las claves de Faro de localStorage y de sessionStorage, cada uno por su lado: si uno no se puede leer o borrar
 * (almacenamiento bloqueado: SecurityError), el otro se intenta igual, y el fallo queda en la consola.
 * @returns {void}
 */
function borrarAlmacenamiento() {
  try {
    borrarClaves(localStorage);
  } catch (error) {
    console.warn('Faro no ha podido borrar sus claves de localStorage.', error);
  }
  try {
    borrarClaves(sessionStorage);
  } catch (error) {
    console.warn('Faro no ha podido borrar sus claves de sessionStorage.', error);
  }
}

/**
 * Espera cada intento antes de comunicar un fallo: volver al inicio con borrados pendientes podría interrumpirlos.
 * @param {Promise<unknown>[]} operaciones
 * @returns {Promise<void>}
 */
async function esperarBorrados(operaciones) {
  const resultados = await Promise.allSettled(operaciones);
  for (const resultado of resultados) {
    if (resultado.status === 'rejected') {
      throw resultado.reason;
    }
  }
}

/**
 * Borra las copias sin conexión de la web y del paquete, y retira su service worker, que ya no tendría qué servir.
 * @returns {Promise<void>}
 */
async function borrarCopiaSinConexion() {
  if ('caches' in window) {
    const nombres = await caches.keys();
    // La última política de la entidad se conserva: olvidar una retirada podría reabrirla sin conexión. También el
    // modo observado (faro-modo:<web>, src/service-worker/modo.js), que no lleva el prefijo de las copias: no guarda
    // nada de la persona ni ningún contenido, solo lo último que el servidor ha demostrado de la instalación (pública o
    // privada) y de su recorrido real (activo o protegido); la instalación siguiente parte de él hasta que el servidor
    // demuestre otra cosa, y una instalación que se sabe privada o un recorrido que se sabe protegido no se abren sin
    // conexión entretanto.
    const deFaro = nombres.filter(
      (nombre) =>
        nombre === COPIA_DEL_ESTADO ||
        (nombre !== COPIA_SECCIONES && (nombre.startsWith(PREFIJO_COPIAS) || nombre.startsWith(PREFIJO_PAQUETE))),
    );
    await esperarBorrados(deFaro.map((nombre) => caches.delete(nombre)));
  }
  const registro = await navigator.serviceWorker?.getRegistration(BASE.href);
  if (registro?.scope === BASE.href) {
    await registro.unregister();
  }
}

/**
 * Apunta en la consola el fallo de un intento de borrado, si lo hubo.
 * @param {PromiseSettledResult<unknown>} resultado Cómo terminó el intento.
 * @param {string} aviso Lo que no se ha podido borrar, para la consola.
 * @returns {void}
 */
function avisarSiFallo(resultado, aviso) {
  if (resultado.status === 'rejected') {
    console.warn(aviso, resultado.reason);
  }
}

/**
 * «Borrar todo»: si la persona lo confirma, intenta borrar lo de Faro en este navegador, avisa a las demás pestañas y
 * vuelve al inicio si se ha confirmado el borrado de la clave. Si falla o queda bloqueado, permite volver a intentarlo.
 * Se espera a cada intento antes de informar; los fallos quedan también en la consola.
 * @returns {Promise<void>}
 */
async function borrarTodo() {
  if (!confirm(texto('informacion-y-creditos.borrar.confirmar'))) {
    return;
  }
  borrarAlmacenamiento();
  const [copia, secreto] = await Promise.allSettled([borrarCopiaSinConexion(), borrarSecretoDeFirma()]);
  avisarSiFallo(copia, 'Faro no ha podido borrar su copia sin conexión.');
  avisarSiFallo(secreto, 'Faro no ha podido borrar el secreto de firma del motor del dispositivo.');
  avisarBorrado();
  if (secreto.status === 'rejected') {
    alert(texto('informacion-y-creditos.borrar.error'));
    return;
  }
  location.href = INICIO;
}

document.getElementById('borrar-todo')?.addEventListener('click', borrarTodo);
