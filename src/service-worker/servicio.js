// Service worker de Faro: guarda una copia de la web para usarla sin conexión. Nunca guarda la API.
//
// La copia versionada mantiene juntos los recursos precargados. Secciones y rutas privadas consultan la red;
// los recursos fuera de la copia siguen sus propias reglas. Una instalación solo se activa si termina; si falla al
// pasar los recursos, la copia definitiva que ha creado se borra y el siguiente intento empieza de cero; una copia
// que ya existía solo se completa con lo que le falte, nunca se reescribe.
// La actualización conserva la versión anterior hasta activar la nueva (ver scripts/instalacion.js); el paquete
// de datos y los recursos comprobados se verifican con sus propias huellas.
// El CATALOGO (generado.js) lleva cada ruta de la copia una sola vez, con su huella SHA-256 y su clase; catalogo.js
// deriva de él todo lo demás. Se descarga al instalar lo de las clases instalar, adorno y seccion: la publicación
// pública admitida, salvo la entrada, las piezas de su grafo clásico, las rutas excluidas por
// src/plataforma/politica-cache-web.ts y lo que sigue:
// - Lo que ejecuta el Worker del motor del dispositivo es de la clase comprobado: el motor, el propio Worker, la
//   comprobación de las firmas y sus bibliotecas. Se descarga entero al instalar: la copia sin conexión es completa.
// - Lo que se genera al desplegar: el manifiesto y su firma, en FIRMAS, y el paquete de datos, que tiene su propia
//   copia.
// - La clase demanda: lo que no se descarga al instalar, sino la primera vez que se pide, y entonces se guarda. Son
//   las fotografías a tamaño completo, que solo piden las pantallas grandes (srcset; sin conexión y sin copia se sirve
//   en su lugar la de 800 px, que sí se descarga). Una ruta no puede ser a la vez comprobado y demanda.
// - Los adornos (tipografías, imágenes y recursos del globo) se guardan después de lo imprescindible, uno a uno y
//   tolerantes a fallos; las páginas de una sección (seccion) solo entran si la política de la entidad la abre.
// VERSION es la huella de todo lo que cambia lo que hace la copia en el dispositivo: en qué lista va cada ruta
// (ARCHIVOS, COMPROBADOS, BAJO_DEMANDA y las páginas de las secciones, PAGINAS_DE_SECCIONES, que la preparación saca
// del CATALOGO), los bytes de cada archivo
// (las páginas con versión, con su marcador vacío), el código de este service worker tal como se publica (construido
// desde src/service-worker/ en un solo archivo, sin comentarios y con sus valores generados en su forma neutra) y las
// cabeceras con que se sirven (la copia guarda cada respuesta con las suyas: un cambio de la CSP también tiene que
// renovarla).
// Cambia sola cuando cambia cualquiera de ellos, también un cambio solo de código del service worker, que crea una
// copia nueva; no la cambian los comentarios, el formato ni el paquete de datos (ver guardarCopia). La calcula y la
// comprueba la construcción de la web (herramientas/web/version-copia.ts, docs/construccion-web.md).
// El paquete de datos del motor va en una copia aparte, que no cambia con la versión de la web: ver «Paquete de datos».
// Lo que ejecuta y lee el motor del dispositivo (COMPROBADOS, FIRMAS y el paquete) sigue una regla más
// estricta, la de una precaché con revisiones: se guarda solo si cuadra con su huella, y toda petición a sus carpetas
// se atiende solo desde la copia comprobada, nunca desde la red ni desde la caché HTTP. Ver «Lo comprobado» y
// docs/construccion-web.md.
// Con acceso privado mediante Cloudflare Access: una página que lleva la marca ?acceso=renovar (scripts/acceso.js) se
// pide a la red, para que Access pueda redirigir a la pantalla del código cuando su sesión ha caducado (renovarAcceso).
// Donde el navegador lo ofrece, la versión siguiente se baja y se comprueba en segundo plano, con las mismas reglas que
// al abrir la web: ver «Actualización en segundo plano».

/**
 * La sincronización periódica, que las bibliotecas de TypeScript no declaran.
 * @typedef {ExtendableEvent & { tag: string }} EventoDeSincronizacion
 */

import './reparar.js';
import { BASE, COPIA, GUARDABLES, HUELLAS } from './catalogo.js';
import { CARPETAS_COMPROBADAS, desdeLoComprobado, noEstaComprobado, RUTA_DE_LOS_PAQUETES } from './comprobado.js';
import { activarVersion } from './copia.js';
import { instalarVersion } from './no-coincide.js';
import {
  desdeLaCopiaDelPaquete,
  PREPARAR_PAQUETE,
  prepararPaquete,
  RUTA_DEL_PAQUETE,
  responderPaquete,
} from './paquete.js';
import { claveDeCopia, esDeLaWeb, esNavegacionRecorrido, rutaEsEntradaRecorrido } from './politica.js';
import { REPARAR_COPIA, repararCopiaEnSuTurno } from './reparar.js';
import { ACTIVAR_VERSION_NUEVA, seccionPublicaDePeticion } from './secciones.js';
import { ACTUALIZACION_PERIODICA, actualizarEnSegundoPlano, PRECARGAR_PAQUETE } from './segundo-plano.js';
import { responderDesdeLaCopia, responderEntradaDelRecorrido, responderSeccion } from './servir.js';

// ---------- Puesta en marcha ----------

self.addEventListener('install', (evento) => {
  evento.waitUntil(instalarVersion());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(activarVersion());
});

// La versión nueva solo se activa cuando la pide una página (scripts/instalacion.js): sola si ninguna pestaña tiene
// nada que perder, o cuando la persona pulsa «Actualizar» y lo confirma. Nunca cambia una página por sorpresa.
self.addEventListener('message', (evento) => {
  if (evento.data?.type === ACTIVAR_VERSION_NUEVA) {
    evento.waitUntil(self.skipWaiting());
  }
  if (evento.data?.type === PREPARAR_PAQUETE) {
    evento.waitUntil(responderPaquete(evento.source, evento.data?.revisar === true));
  }
  if (evento.data?.type === PRECARGAR_PAQUETE) {
    evento.waitUntil(prepararPaquete());
  }
  if (evento.data?.type === REPARAR_COPIA) {
    evento.waitUntil(repararCopiaEnSuTurno(evento.source, evento.data.id));
  }
});

// Solo en los navegadores que la ofrecen; en los demás este oyente no se llama nunca.
self.addEventListener('periodicsync', (evento) => {
  const sincronizacion = /** @type {EventoDeSincronizacion} */ (evento);
  if (sincronizacion.tag === ACTUALIZACION_PERIODICA) {
    sincronizacion.waitUntil(actualizarEnSegundoPlano());
  }
});

/** @param {URL} url @param {string | undefined} seccion */
const esEntradaSinNavegar = (url, seccion) =>
  seccion === 'recorrido' && rutaEsEntradaRecorrido(url.pathname.slice(BASE.pathname.length));

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  const url = new URL(peticion.url);
  if (esNavegacionRecorrido(peticion, url, BASE)) {
    evento.respondWith(responderEntradaDelRecorrido(evento, url));
    return;
  }
  const seccion = seccionPublicaDePeticion(peticion, url);
  if (esEntradaSinNavegar(url, seccion)) {
    return;
  }
  if (!seccion && !esDeLaWeb(peticion, url, BASE)) {
    return;
  }
  const clave = claveDeCopia(url, BASE);
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      Reflect.get(globalThis, 'navegarSegunPortal')(evento, {
        clave,
        seccion,
        url,
        copia: caches.open(COPIA),
        seccionada: responderSeccion,
        publica: responderDesdeLaCopia,
      }),
    );
    return;
  }
  if (seccion) {
    evento.respondWith(responderSeccion(clave, seccion));
    return;
  }
  // Lo comprobado y el paquete, solo de sus copias comprobadas («Lo comprobado»): nunca de la red.
  if (HUELLAS.has(clave) || CARPETAS_COMPROBADAS.some((carpeta) => url.pathname.startsWith(carpeta))) {
    evento.respondWith(desdeLoComprobado(clave));
    return;
  }
  if (url.pathname.startsWith(RUTA_DE_LOS_PAQUETES)) {
    const version = RUTA_DEL_PAQUETE.exec(url.pathname.slice(BASE.pathname.length))?.[1];
    evento.respondWith(version === undefined ? noEstaComprobado(clave) : desdeLaCopiaDelPaquete(clave, version));
    return;
  }
  // Fuera de las páginas, solo se atiende lo que está en la copia.
  if (!GUARDABLES.has(clave)) {
    return;
  }
  evento.respondWith(responderDesdeLaCopia(evento, clave, false));
});
