// Instalación de Faro como aplicación (PWA) y aviso de versión nueva del service worker.
// Sin contexto seguro o service worker se pueden leer las páginas; faltan la copia sin conexión y el recorrido local.
//
// Este módulo es la única fuente de lo que se sabe de la instalación en la página (estadoDeLaInstalacion): si Faro
// está abierto como aplicación, si el navegador acaba de instalarlo o si ofrece ahora su propia ventana de instalación.
// Esa ventana llega con el evento beforeinstallprompt (Chromium), que se guarda desde que se carga el módulo, antes de
// que la página termine de arrancar, para no perderlo. Lo usan el enlace «Instalar Faro» que este módulo pone en el
// menú, que lleva a la página instalar.html, y esa página (scripts/instalar.js), que abre la ventana con instalar().
// El enlace está siempre, también sin service worker o sin contexto seguro (hay Safari que no ofrece service worker),
// salvo en la propia instalar.html y con Faro ya instalado. Solo la vigilancia de versiones, el registro del service
// worker y la actualización periódica dependen de que el navegador los admita.
//
// Versión nueva: el service worker sirve cada página entera desde la copia de su versión (src/service-worker/servir.js), y una
// versión nueva se activa para todas las pestañas de Faro a la vez. Una página se recarga entera o se queda entera como
// está. Estas reglas coordinan activación y recarga para evitar mezclar versiones:
// - Se activa sola solo si ni esta pestaña ni ninguna otra tiene nada que perder (las pestañas se preguntan por un
//   BroadcastChannel). Entonces toda pestaña sin nada que perder se recarga, y el navegador la devuelve al mismo sitio.
// - Una pestaña con algo que perder (un recorrido a medias, algo escrito, una conversación) no se recarga nunca sola:
//   enseña el aviso, que dice que actualizar borra lo que hay en la página y deja terminar antes o guardar el informe.
//   «Actualizar» pide confirmación y, si otra pestaña tiene algo a medias, lo dice en lugar de activar.
// - Lo que una página con algo que perder cargue después (el paso 4, el otro diccionario) no puede llegar de la versión
//   nueva: el recorrido lo trae en cuanto termina de cargar, y lo que falte se niega a cargarlo (scripts/version.js).
// Donde el navegador lo ofrece y lo permite (Faro instalado), pide además que la versión nueva se baje y se compruebe
// en segundo plano (pedirActualizacionPeriodica): al abrir Faro ya está lista y entra con las mismas reglas.
//
// Instalación que no coincide: si la instalación del service worker falla porque uno de sus archivos comprobados no es
// el de esta versión (src/service-worker/no-coincide.js, «Instalación que no coincide») y no queda ningún service worker activo, el
// motor del dispositivo no se puede usar y esperar no lo arregla. Este módulo lo sabe por el aviso del service worker o
// por su constancia y lo cuenta a quien pide algo al motor (recorrido/instalacion-que-no-coincide.js) con una marca en
// <html> y un evento, sin que tengan que cargar este módulo.

import { crearAviso } from './aviso.js';
import { urlDeGuion } from './confianza.js';
import { crear } from './dom.js';
import { escribir } from './idioma.js';
import { hayMensajeDeLaPersona } from './marcas-del-recorrido.js';
import {
  contarElRegistroFallido,
  pedirAlmacenPersistente,
  prepararPaqueteSinConexion,
} from './paquete-sin-conexion.js';
import { texto, traducible } from './textos.js';
import { MS_POR_DIA } from './tiempo.js';

/** @import { AvisoFlotante } from './aviso.js' */

/** La raíz de la web, de la que cuelgan el service worker y su alcance: este archivo está en scripts/. */
const BASE = new URL('../', import.meta.url);
/** Mensaje que entiende el service worker para activar la versión que espera (src/service-worker/secciones.js). */
const ACTIVAR_VERSION_NUEVA = 'ACTIVATE_UPDATE';
/** El nombre del enlace del menú y de la página a la que lleva. */
const INSTALAR = traducible('instalacion.titulo');
/** La página «Instalar Faro», a la que lleva el enlace del menú. */
const PAGINA_INSTALAR = new URL('instalar.html', BASE);
/** Lo que marca la propia instalar.html: en ella el menú no lleva el enlace. */
const MARCA_DE_LA_PAGINA_INSTALAR = '[data-instalar]';
/** El aviso a quienes siguen la instalación (alCambiarLaInstalacion). */
const CAMBIO_DE_INSTALACION = 'cambio';
/** Los estados en que Faro ya está instalado: el enlace del menú ya no hace falta.
 * @type {ReadonlySet<EstadoDeLaInstalacion>}
 */
const YA_INSTALADA = new Set(['abierta', 'instalada']);
/** El canal por el que las pestañas de Faro se preguntan si alguna tiene algo que perder. */
const CANAL_DE_VERSIONES = 'faro-versiones';
/** El mensaje con que una pestaña pregunta a las demás si tienen algo que perder. */
const PREGUNTA = 'algo-que-perder?';
/** El mensaje con que una pestaña contesta que tiene algo que perder. */
const RESPUESTA = 'algo-que-perder';
/** Lo que se espera a que contesten las demás pestañas: entre pestañas de un mismo navegador, unos milisegundos. */
const ESPERA_RESPUESTAS_MS = 300;
/** El aviso del service worker y su constancia cuando su instalación no coincide (src/service-worker/no-coincide.js, mismo valor). */
const INSTALACION_QUE_NO_COINCIDE = 'INSTALACION_QUE_NO_COINCIDE';
const COPIA_DEL_ESTADO = `faro-estado:${BASE.href}`;
const ESTADO_DE_LA_INSTALACION = new URL('service-worker/instalacion.json', BASE).href;
/** La marca de <html> y el evento con que se cuenta (recorrido/instalacion-que-no-coincide.js, mismos valores). */
const MARCA_NO_COINCIDE = 'instalacionNoCoincide';
const EVENTO_NO_COINCIDE = 'faro-instalacion-no-coincide';
/** La etiqueta de la sincronización periódica que atiende el service worker (src/service-worker/segundo-plano.js). */
const ACTUALIZACION_PERIODICA = 'faro-actualizar';
/** Como mucho una vez al día: la web y los datos cambian menos, y el navegador la espacia más si Faro se usa poco. */
const INTERVALO_MINIMO_MS = MS_POR_DIA;
/**
 * El primer paso del recorrido todavía no contiene decisiones: desde el siguiente hay recorrido que perder.
 * Las páginas de lectura no tienen data-paso: en ellas no hay nada que perder.
 */
const PASO_SIN_RECORRIDO = '1';
/**
 * El evento `beforeinstallprompt` (navegadores Chromium), que no está en los tipos del DOM: abre el diálogo de
 * instalación del navegador una sola vez y dice qué eligió la persona.
 * @typedef {Event & { prompt(): Promise<void>, userChoice: Promise<{ outcome: string }> }} PeticionDeInstalacion
 */
/**
 * Lo que vigila la versión nueva (vigilarVersiones): el canal entre pestañas, el service worker en espera, si la
 * persona ya confirmó la actualización y el aviso.
 * @typedef {Object} Versiones
 * @property {BroadcastChannel | null} canal
 * @property {ServiceWorker | null} enEspera
 * @property {boolean} confirmada
 * @property {AvisoFlotante} aviso
 */

/**
 * Lo que se sabe de la instalación de Faro en esta página:
 * - «abierta»: Faro está abierto como aplicación instalada.
 * - «instalada»: el navegador acaba de instalarlo desde esta página (appinstalled, o la persona aceptó su ventana).
 * - «disponible»: el navegador ofrece su ventana de instalación (beforeinstallprompt) y aún no se ha usado.
 * - «no-disponible»: no la ofrece ahora. Safari y Firefox no la tienen; un Chromium no la ofrece si Faro ya está
 *   instalado o si no admite instalarlo en esta página.
 * @typedef {'abierta' | 'instalada' | 'disponible' | 'no-disponible'} EstadoDeLaInstalacion
 */
/**
 * Lo que eligió la persona en la ventana del navegador; «no-disponible» si no había ventana que abrir.
 * @typedef {'aceptada' | 'rechazada' | 'no-disponible'} RespuestaDeInstalacion
 */

// ---------- Estado de la instalación ----------

const modoAplicacion = matchMedia('(display-mode: standalone)');
/** Por donde se avisa a quienes siguen la instalación (alCambiarLaInstalacion). */
const avisosDeInstalacion = new EventTarget();
/** La ventana de instalación que ofrece el navegador, mientras no se ha usado: solo se puede abrir una vez.
 * @type {PeticionDeInstalacion | null}
 */
let peticionInstalar = null;
/** Si el navegador ha instalado Faro desde esta página. */
let instaladaDesdeAqui = false;

/** Si Faro está abierto como aplicación instalada; `navigator.standalone` es la forma de saberlo en Safari para iPhone
 * y iPad. @returns {boolean}
 */
function abiertaComoAplicacion() {
  return modoAplicacion.matches || ('standalone' in navigator && navigator.standalone === true);
}

/** Lo que se sabe ahora de la instalación (EstadoDeLaInstalacion). @returns {EstadoDeLaInstalacion} */
export function estadoDeLaInstalacion() {
  if (abiertaComoAplicacion()) {
    return 'abierta';
  }
  if (instaladaDesdeAqui) {
    return 'instalada';
  }
  return peticionInstalar ? 'disponible' : 'no-disponible';
}

/**
 * `funcion(estado)` se llama cada vez que cambia lo que se sabe de la instalación, con el estado nuevo.
 * @param {(estado: EstadoDeLaInstalacion) => void} funcion @returns {void}
 */
export function alCambiarLaInstalacion(funcion) {
  avisosDeInstalacion.addEventListener(CAMBIO_DE_INSTALACION, () => funcion(estadoDeLaInstalacion()));
}

function avisarDeLaInstalacion() {
  avisosDeInstalacion.dispatchEvent(new Event(CAMBIO_DE_INSTALACION));
}

/**
 * Abre la ventana de instalación del navegador, si la ofrece, y dice qué eligió la persona. La ventana solo se puede
 * abrir una vez: después, hasta que el navegador ofrezca otra, el estado es «no-disponible». Se llama con el gesto de
 * la persona (el botón de instalar.html), y por eso aquí se pide también el almacenamiento persistente, y no en cada
 * visita: algunos navegadores solo lo conceden (o solo preguntan) tras un gesto, y quien instala Faro quiere conservar
 * la copia. La instalación no depende de esa respuesta; pedirAlmacenPersistente absorbe las denegaciones.
 * @returns {Promise<RespuestaDeInstalacion>}
 */
export async function instalar() {
  void pedirAlmacenPersistente();
  if (!peticionInstalar) {
    return 'no-disponible';
  }
  const peticion = peticionInstalar;
  peticionInstalar = null;
  try {
    await peticion.prompt();
    const aceptada = (await peticion.userChoice).outcome === 'accepted';
    instaladaDesdeAqui ||= aceptada;
    return aceptada ? 'aceptada' : 'rechazada';
  } catch (error) {
    // El navegador rechaza abrir una ventana que ya no vale (InvalidStateError) o sin el gesto (NotAllowedError): no
    // hay ventana, como si no la ofreciera. Otro fallo es del programa.
    if (error instanceof DOMException) {
      return 'no-disponible';
    }
    throw error;
  } finally {
    avisarDeLaInstalacion();
  }
}

// Desde que se carga el módulo: el navegador avisa una sola vez de que ofrece su ventana, y puede hacerlo antes de que
// la página termine de arrancar (sitio.js espera antes a su diccionario).
window.addEventListener('beforeinstallprompt', (evento) => {
  // Sin la mini barra de Chromium en el móvil: la ventana se abre desde instalar.html, cuando la persona lo pide.
  evento.preventDefault();
  // @ts-expect-error El evento beforeinstallprompt es una PeticionDeInstalacion (ver su tipo, arriba).
  peticionInstalar = evento;
  avisarDeLaInstalacion();
});
window.addEventListener('appinstalled', () => {
  peticionInstalar = null;
  instaladaDesdeAqui = true;
  avisarDeLaInstalacion();
});
modoAplicacion.addEventListener('change', avisarDeLaInstalacion);

// ---------- Enlace «Instalar Faro» del menú ----------

/**
 * El enlace «Instalar Faro» al final del menú, a instalar.html. No va en la propia instalar.html, y no se ve con Faro
 * ya instalado. No depende del service worker ni del contexto seguro.
 */
function prepararEnlaceDelMenu() {
  const menu = document.getElementById('menu');
  if (!menu || document.querySelector(MARCA_DE_LA_PAGINA_INSTALAR)) {
    return;
  }
  const enlace = escribir(crear('a', { href: PAGINA_INSTALAR.href, className: 'instalacion-enlace' }), INSTALAR);
  /** @param {EstadoDeLaInstalacion} estado */
  const mostrarSegun = (estado) => {
    enlace.hidden = YA_INSTALADA.has(estado);
  };
  mostrarSegun(estadoDeLaInstalacion());
  alCambiarLaInstalacion(mostrarSegun);
  menu.append(enlace);
}

// ---------- Actualización en segundo plano ----------

/**
 * Si el navegador ha concedido a Faro la sincronización periódica. Chromium solo la concede a la aplicación instalada;
 * un navegador que no conoce el nombre del permiso rechaza la consulta (TypeError), y eso es un no.
 * @returns {Promise<boolean>}
 */
async function permisoDeActualizacionPeriodica() {
  if (!navigator.permissions) {
    return false;
  }
  try {
    // @ts-expect-error El nombre es el de la especificación (WICG, Periodic Background Sync) y no está en PermissionName.
    const permiso = await navigator.permissions.query({ name: 'periodic-background-sync' });
    return permiso.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * Pide la sincronización periódica a un registro con el service worker activo. `periodicSync` no está en los tipos del
 * DOM: se comprueba su forma antes de usarla.
 * @param {ServiceWorkerRegistration} registro @returns {Promise<void>}
 */
async function registrarActualizacionPeriodica(registro) {
  const sincronizacion = 'periodicSync' in registro ? registro.periodicSync : null;
  if (typeof sincronizacion !== 'object' || sincronizacion === null || !('register' in sincronizacion)) {
    return;
  }
  if (typeof sincronizacion.register !== 'function') {
    return;
  }
  try {
    await sincronizacion.register(ACTUALIZACION_PERIODICA, { minInterval: INTERVALO_MINIMO_MS });
  } catch (error) {
    // El permiso se puede retirar entre la consulta y la petición: entonces es un no, como sin permiso.
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return;
    }
    console.warn('Faro no ha podido pedir la actualización en segundo plano; se actualizará al abrirlo.', error);
  }
}

/**
 * Pide al navegador que despierte de vez en cuando al service worker para bajar y comprobar la versión siguiente antes
 * de que la persona abra Faro (src/service-worker/segundo-plano.js, «Actualización en segundo plano»). Solo se pide cuando puede salir
 * bien: el navegador la ofrece (Chromium), Faro está abierto como aplicación instalada, el permiso está concedido y hay
 * un service worker activo (sin él, Chromium la rechaza con InvalidStateError). Si no, no se pide nada y Faro se
 * actualiza al abrirlo, como siempre: es lo esperado, no un error. No falla.
 * @param {ServiceWorkerRegistration} registro @returns {Promise<void>}
 */
async function pedirActualizacionPeriodica(registro) {
  if (!('periodicSync' in registro) || !abiertaComoAplicacion()) {
    return;
  }
  if (!(await permisoDeActualizacionPeriodica())) {
    return;
  }
  // `ready` da el registro de esta página en cuanto tiene un service worker activo, y no rechaza nunca.
  await registrarActualizacionPeriodica(await navigator.serviceWorker.ready);
}

// ---------- Versión nueva ----------

/**
 * Qué se perdería al recargar la página para pasar a la versión nueva: un recorrido a medias (desde el paso 2), algo
 * escrito sin enviar o una conversación empezada. Nada de eso se guarda en ninguna parte, así que solo la persona puede
 * decidir cuándo recargar; sin nada de eso, la versión nueva entra sola.
 * @returns {boolean}
 */
function hayAlgoQuePerder() {
  const paso = document.body.dataset.paso;
  if (paso === undefined) {
    return false;
  }
  if (paso !== PASO_SIN_RECORRIDO) {
    return true;
  }
  const mensaje = document.getElementById('mensaje');
  const escrito = mensaje instanceof HTMLTextAreaElement ? mensaje.value.trim() : '';
  return Boolean(escrito) || hayMensajeDeLaPersona();
}

/**
 * Abre el canal entre pestañas y contesta a las demás cuando esta tiene algo que perder. Sin BroadcastChannel, null.
 * @returns {BroadcastChannel | null}
 */
function abrirCanal() {
  if (!('BroadcastChannel' in window)) {
    return null;
  }
  const canal = new BroadcastChannel(CANAL_DE_VERSIONES);
  canal.addEventListener('message', ({ data }) => {
    if (data === PREGUNTA && hayAlgoQuePerder()) {
      canal.postMessage(RESPUESTA);
    }
  });
  return canal;
}

/**
 * Pregunta a las demás pestañas de Faro si alguna tiene algo que perder y espera sus respuestas un momento. Una
 * pestaña dormida que no contesta no lo impide: su recorrido ya está entero en memoria (scripts/recorrido.js).
 * @param {BroadcastChannel | null} canal @returns {Promise<boolean>}
 */
function otraPestanaTieneAlgoQuePerder(canal) {
  if (!canal) {
    return Promise.resolve(false);
  }
  return new Promise((resolver) => {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let reloj;
    /** @param {boolean} respuesta */
    const terminar = (respuesta) => {
      canal.removeEventListener('message', alContestar);
      clearTimeout(reloj);
      resolver(respuesta);
    };
    /** @param {MessageEvent} mensaje */
    const alContestar = ({ data }) => {
      if (data === RESPUESTA) {
        terminar(true);
      }
    };
    canal.addEventListener('message', alContestar);
    reloj = setTimeout(() => terminar(false), ESPERA_RESPUESTAS_MS);
    canal.postMessage(PREGUNTA);
  });
}

/**
 * Recarga la página para pasar a la versión nueva. Si la persona ya lo ha confirmado, el recorrido no vuelve a
 * preguntar al salir (data-actualizando en <html>, que lee scripts/recorrido.js).
 */
function recargar() {
  document.documentElement.dataset.actualizando = '';
  location.reload();
}

/**
 * El aviso de versión nueva, para una página con algo que perder: dice que actualizar la recarga y borra lo que hay en
 * ella, y deja terminar antes. `alActualizar` es lo que hace su botón.
 * @param {() => void} alActualizar @returns {AvisoFlotante}
 */
function crearAvisoVersion(alActualizar) {
  const aviso = crearAviso({
    nombre: traducible('instalacion.version-nombre'),
    botones: [
      { texto: traducible('instalacion.actualizar'), alPulsar: alActualizar },
      {
        texto: traducible('instalacion.mas-tarde'),
        nombre: traducible('instalacion.mas-tarde-nombre'),
        secundario: true,
        alPulsar: () => aviso.ocultar(),
      },
    ],
  });
  return aviso;
}

/** @param {Versiones} versiones */
function avisarDeVersion(versiones) {
  return versiones.aviso.mostrar(traducible('instalacion.version-nueva'), traducible('instalacion.version-anuncio'));
}

/**
 * Pide al service worker en espera que se active: cuando tome el control, las páginas se recargan (seguirAlControl).
 * @param {Versiones} versiones
 */
function pedirActivacion(versiones) {
  return versiones.enEspera?.postMessage({ type: ACTIVAR_VERSION_NUEVA });
}

/**
 * «Actualizar»: confirma que se borra lo de esta página. Si la versión ya está activa (la activó otra pestaña), basta
 * con recargar; si otra pestaña tiene algo a medias, lo dice y no activa nada.
 * @param {Versiones} versiones
 */
async function actualizar(versiones) {
  if (!confirm(texto('instalacion.confirmar'))) {
    return;
  }
  if (versiones.enEspera?.state !== 'installed') {
    recargar();
    return;
  }
  if (await otraPestanaTieneAlgoQuePerder(versiones.canal)) {
    versiones.aviso.mostrar(traducible('instalacion.otra-pestana'));
    return;
  }
  versiones.confirmada = true;
  pedirActivacion(versiones);
}

/**
 * Cuando otro service worker toma el control: si es el primero, nada; si la persona lo confirmó aquí, o si la página no
 * tiene nada que perder, se recarga; si lo tiene (lo activó otra pestaña, o la persona empezó a escribir mientras se
 * activaba), avisa y sigue entera como está.
 * @param {Versiones} versiones
 */
function seguirAlControl(versiones) {
  let controlada = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlada) {
      controlada = true;
      return;
    }
    if (versiones.confirmada || !hayAlgoQuePerder()) {
      recargar();
    } else {
      avisarDeVersion(versiones);
    }
  });
}

/**
 * Atiende a un service worker en espera: con algo que perder aquí, el aviso; si no, lo activa en el acto, salvo que
 * otra pestaña tenga algo que perder (entonces espera: esa pestaña ya enseña su aviso). Sin un service worker que
 * controle la página (la primera instalación) no hay versión anterior y no hace nada.
 * @param {Versiones} versiones @param {ServiceWorker | null} trabajador
 */
async function atenderEnEspera(versiones, trabajador) {
  if (!trabajador || !navigator.serviceWorker.controller) {
    return;
  }
  versiones.enEspera = trabajador;
  if (hayAlgoQuePerder()) {
    avisarDeVersion(versiones);
    return;
  }
  if (!(await otraPestanaTieneAlgoQuePerder(versiones.canal))) {
    pedirActivacion(versiones);
  }
}

/** Prepara la vigilancia de versiones y devuelve la función que atiende a un service worker en espera.
 * @returns {(trabajador: ServiceWorker | null) => Promise<void>}
 */
function vigilarVersiones() {
  /** @type {Versiones} */
  const versiones = {
    canal: abrirCanal(),
    enEspera: null,
    confirmada: false,
    // El gesto ocurre después de crear `versiones`; la actualización comunica su resultado en el propio aviso.
    aviso: crearAvisoVersion(() => {
      void actualizar(versiones);
    }),
  };
  seguirAlControl(versiones);
  return (trabajador) => atenderEnEspera(versiones, trabajador);
}

/**
 * El registro del service worker de Faro, o null si este navegador no deja tener uno. Una ventana privada o una
 * política lo rechazan con SecurityError, y un bloqueo puede sustituir `register` por una función que no da ningún
 * registro (la norma, Service Workers, «register()», siempre da un ServiceWorkerRegistration). Sin él, la web funciona
 * con conexión y sin copia para usar sin ella: es una decisión del navegador, no un fallo, y se dice sin alarma. Otro
 * rechazo (el guion no llega o no se puede ejecutar) sí es un fallo, y se avisa. En los dos casos se cuenta que el
 * registro ha fallado (contarElRegistroFallido): quien espera al service worker mira si hay otro registro.
 * @returns {Promise<ServiceWorkerRegistration | null>}
 */
async function pedirRegistro() {
  /** @type {unknown} */
  let registro = null;
  try {
    registro = await navigator.serviceWorker.register(urlDeGuion(new URL('service-worker.js', BASE)), {
      scope: BASE.pathname,
      updateViaCache: 'none',
    });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'SecurityError')) {
      console.warn('No se pudo preparar Faro para usar sin conexión.', error);
      contarElRegistroFallido();
      return null;
    }
  }
  if (registro instanceof ServiceWorkerRegistration) {
    return registro;
  }
  console.info('Este navegador no deja guardar Faro para usarlo sin conexión: funciona con conexión.');
  contarElRegistroFallido();
  return null;
}

// ---------- Instalación que no coincide ----------

/** Cuenta al recorrido, una sola vez, que la instalación no coincide: la marca de <html> y su evento. */
function contarQueNoCoincide() {
  const raiz = document.documentElement;
  if (raiz.dataset[MARCA_NO_COINCIDE] !== undefined) {
    return;
  }
  raiz.dataset[MARCA_NO_COINCIDE] = '';
  window.dispatchEvent(new Event(EVENTO_NO_COINCIDE));
}

/**
 * Si el service worker ha dejado constancia de que una instalación empezada desde `desde` (Date.now) no coincide: una
 * constancia anterior es de otro intento y no vale. La lee sin crear la copia de estado; si no se puede leer, no se da
 * por hecho. @param {number} desde @returns {Promise<boolean>}
 */
async function constanciaDeQueNoCoincide(desde) {
  try {
    const guardada = await caches.match(ESTADO_DE_LA_INSTALACION, { cacheName: COPIA_DEL_ESTADO });
    /** @type {unknown} */
    const estado = guardada ? await guardada.json() : null;
    return (
      typeof estado === 'object' &&
      estado !== null &&
      'motivo' in estado &&
      estado.motivo === 'no-coincide' &&
      'cuando' in estado &&
      typeof estado.cuando === 'number' &&
      estado.cuando >= desde
    );
  } catch {
    return false;
  }
}

/**
 * Con una instalación que no coincide y ningún service worker activo, se cuenta al recorrido. Con uno activo no: la
 * versión anterior sigue entera y sirve su motor, que la sonda comprueba (src/service-worker/comprobado.js, «Lo comprobado»).
 * @param {ServiceWorkerRegistration} registro
 * @param {boolean | number} sabido - true si ya lo ha dicho el aviso del service worker; si no, desde cuándo (Date.now)
 *   se sigue la instalación descartada, para leer solo una constancia de ese intento.
 */
async function siNoCoincide(registro, sabido) {
  if (!registro.active && (sabido === true || (await constanciaDeQueNoCoincide(Number(sabido))))) {
    console.warn(
      'Faro no ha podido guardar su copia para usar sin conexión: uno de sus archivos no es el de esta versión.',
    );
    contarQueNoCoincide();
  }
}

/**
 * Sigue la instalación de `trabajador`: con `alInstalarse` cuando queda instalado y, si se descarta sin llegar a
 * instalarse, mira si ha sido porque un archivo no coincide (siNoCoincide).
 * @param {ServiceWorkerRegistration} registro @param {ServiceWorker} trabajador @param {() => void} alInstalarse
 */
function seguirLaInstalacion(registro, trabajador, alInstalarse) {
  let instalado = false;
  const desde = Date.now();
  trabajador.addEventListener('statechange', () => {
    if (trabajador.state === 'installed') {
      instalado = true;
      alInstalarse();
    }
    // Descartado sin llegar a instalarse: la copia no se pudo guardar (se cayó la red a mitad, un portal de wifi, o
    // un archivo que no es el de esta versión). La web sigue funcionando con red, y el navegador vuelve a intentar la
    // copia en la siguiente visita.
    if (trabajador.state === 'redundant' && !instalado) {
      console.warn('Faro no ha podido guardar su copia para usar sin conexión. Volverá a intentarlo.');
      void siNoCoincide(registro, desde);
    }
  });
}

/**
 * Registra el service worker y le pasa a `avisar` cada versión que queda en espera. `avisar` no falla
 * (atenderEnEspera), así que no se espera: el registro no depende de lo que decida. Sin registro (pedirRegistro), no
 * hay versiones que vigilar ni copia que preparar.
 * @param {(trabajador: ServiceWorker | null) => Promise<void>} avisar
 */
async function registrarServiceWorker(avisar) {
  const registro = await pedirRegistro();
  if (!registro) {
    return;
  }
  void avisar(registro.waiting);
  // Sin await: pedirActualizacionPeriodica no falla, y sin ella todo sigue igual.
  void pedirActualizacionPeriodica(registro);
  // Con el service worker activo, la copia de los datos del motor para usarlo sin conexión. Sin await: la copia la
  // prepara el service worker, la página la sigue mientras esté abierta y la petición no falla (serviceWorker.ready
  // no rechaza nunca).
  void prepararPaqueteSinConexion();
  // El aviso del service worker que no ha podido instalarse llega también a esta página aunque aún no la controle (el
  // registro se hace con la página ya cargada, cuando el navegador ya le entrega los mensajes), y solo vale el de esta
  // web: dos webs de Faro pueden compartir origen. Además se mira la constancia cuando la versión se descarta
  // (seguirLaInstalacion), salvo en WebKit, que no conserva lo que escribe una instalación que falla: allí solo cuenta
  // el aviso, y una página que se abra después lo sabe por su propia instalación, que vuelve a fallar igual.
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (
      typeof data === 'object' &&
      data !== null &&
      data.type === INSTALACION_QUE_NO_COINCIDE &&
      data.base === BASE.href
    ) {
      void siNoCoincide(registro, true);
    }
  });
  /** Cada versión se sigue una sola vez, la vea primero el registro o updatefound. @type {WeakSet<ServiceWorker>} */
  const seguidos = new WeakSet();
  const seguir = () => {
    const trabajador = registro.installing;
    if (trabajador && !seguidos.has(trabajador)) {
      seguidos.add(trabajador);
      seguirLaInstalacion(registro, trabajador, () => void avisar(trabajador));
    }
  };
  seguir();
  registro.addEventListener('updatefound', seguir);
}

/** El enlace «Instalar Faro» del menú siempre; aviso de versión nueva y registro del service worker, cuando el
 * navegador los admite (contexto seguro y service worker).
 * @returns {void}
 */
export function iniciarInstalacion() {
  prepararEnlaceDelMenu();
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    return;
  }
  const avisar = vigilarVersiones();
  // El registro espera a que la página termine de cargar, para no competir con ella por la red. Sin await: no falla
  // (pedirRegistro lo dice en la consola y la web sigue sin copia).
  /** @returns {void} */
  const registrar = () => void registrarServiceWorker(avisar);
  if (document.readyState === 'complete') {
    registrar();
  } else {
    window.addEventListener('load', registrar, { once: true });
  }
}
