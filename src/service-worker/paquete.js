import './servir.js';
import { urlDe } from './catalogo.js';
import { noEstaComprobado } from './comprobado.js';
import { reponerLaEntradaDelRecorrido } from './copia.js';
import { bytesDe, sinPararse } from './descarga.js';
import { PAQUETE, TAMANOS_DEL_PAQUETE } from './generado.js';
import {
  anotarElPrimerAnalisis,
  avanceDeLaCopia,
  delPrimerAnalisisGuardado,
  esDelPrimerAnalisis,
  guardarPorOrden,
  PRIMER_ANALISIS_DEL_PAQUETE,
} from './primer-analisis.js';

/** @typedef {import('./copia.js').ConMensaje} ConMensaje */

// ---------- Paquete de datos ----------
// El motor del dispositivo lee el paquete con fetch (src/plataforma/navegador/paquete.ts), con conexión o sin
// ella, solo de esta copia («Lo comprobado»), aparte de la de la web, en «faro-paquete-<versión>»:
// - La web cambia mucho más a menudo que los datos, y el paquete no se vuelve a bajar por un cambio de estilo:
//   borrarCopiasViejas solo borra las copias de la web, cuyo prefijo es otro.
// - Se llena cuando la página lo pide (scripts/paquete-sin-conexion.js), no al instalar: su descarga no puede
//   retrasar ni hacer fallar la copia de la web. La página lo pide en cada visita; con la copia completa, no se baja
//   nada, y si un intento se cortó, el siguiente sigue donde lo dejó (reanudación por archivos): lo guardado y
//   comprobado no se vuelve a bajar, y un archivo que se quedó a medias no se guardó y se baja entero.
// - Mientras espera la copia, la página repite su petición cada poco: cada mensaje es un evento que alarga la vida de
//   este service worker, que el navegador detendría tras un rato sin eventos aunque siguiera bajando, y cortaría con
//   él las descargas. Si ya lo había detenido, la petición lo vuelve a poner en marcha. Las peticiones repetidas se
//   reúnen en el intento en curso, y a cada página se le contesta una vez por intento (responderPaquete).
// - Cada archivo se comprueba contra su huella del manifiesto antes de guardarlo, y el manifiesto, cuya huella es la
//   versión, se guarda el último: una copia con manifiesto está completa.
// - Primero se guarda lo que necesita el primer análisis (ARCHIVOS_DEL_PRIMER_ANALISIS) y después el resto. Con eso
//   guardado y comprobado, se le cuenta a cada página que espera la copia (PRIMER_ANALISIS_DEL_PAQUETE) y, mientras el
//   intento sigue, esos archivos y el manifiesto ya comprobado (de la memoria: no se guarda hasta el final) se sirven al
//   motor; cualquier otro archivo espera a que el intento acabe, como siempre. La página solo pide al motor lo que se
//   responde con ellos hasta tener la copia completa (motor-local/cliente.js). Un archivo que no cuadra o que se corta se
//   repite una vez; si vuelve a fallar, el intento acaba sin manifiesto y lo comprobado se conserva.
// - Un archivo con la misma huella que en otra versión guardada no se vuelve a bajar: se toma de su copia, después de
//   volver a calcular su huella (deOtraCopia). Una versión nueva del paquete cambia pocos archivos, y por la red solo
//   viaja la diferencia, archivo a archivo.
// - La copia de una versión nueva no sustituye a la vieja hasta que está completa: mientras tanto, la vieja sigue
//   entera y sirviendo lo suyo. Y no se borra ninguna mientras otra versión se instala o espera, porque puede haber
//   preparado ya la suya («Actualización en segundo plano»).

const PREFIJO_DEL_PAQUETE = 'faro-paquete-';
const COPIA_DEL_PAQUETE = PREFIJO_DEL_PAQUETE + PAQUETE;
const MANIFIESTO = 'manifiesto.json';
/** Ruta de un archivo del paquete publicado, desde la base de la web, con la versión a la que pertenece. */
const RUTA_DEL_PAQUETE = /^paquete\/([0-9a-f]{16})\/[a-z0-9-]+\.json$/;
/** Mensaje con que la página pide la copia (scripts/paquete-sin-conexion.js) y respuesta con cómo ha quedado. */
const PREPARAR_PAQUETE = 'PREPARAR_PAQUETE';
const ESTADO_DEL_PAQUETE = 'ESTADO_DEL_PAQUETE';
/**
 * Mensaje con que se cuenta a las páginas abiertas cómo va la copia: los archivos del manifiesto y los ya guardados,
 * cada vez que se guarda uno. Cuenta archivos y también bytes según los tamaños generados, o una estimación cuando
 * faltan tamaños. La página lo enseña como una barra (scripts/recorrido/preparacion.js); si no llega ningún avance, la
 * página se queda con el texto.
 */
const PROGRESO_DEL_PAQUETE = 'PROGRESO_DEL_PAQUETE';
/** Archivos que se bajan a la vez: pocos, para no ahogar una conexión móvil. */
const DESCARGAS_A_LA_VEZ = 3;
/**
 * Mientras llegan bytes, cada cuánto se cuenta a las páginas, como mucho, que la copia sigue viva (contarQueSigue): la
 * página deja de esperar si pasa su plazo sin ningún aviso (scripts/paquete-sin-conexion.js, PLAZO_SIN_AVANCE_MS).
 */
const LATIDO_MS = 5000;
/** Cuándo se contó por última vez a las páginas algo de la copia, o empezó el intento (Date.now). */
let ultimoAviso = 0;
/** La base y las cifras de cada byte de una huella escrita en hexadecimal. */
const BASE_HEXADECIMAL = 16;
const CIFRAS_POR_BYTE = 2;
/**
 * La dirección de un archivo del paquete de datos de esta web.
 *
 * @param {string} archivo - Nombre del archivo dentro de la carpeta del paquete.
 * @returns {string}
 */
function urlDelPaquete(archivo) {
  if (!/^[a-z0-9-]+\.json$/.test(archivo)) {
    throw new Error(`${archivo}: no es un nombre de archivo del paquete`);
  }
  return urlDe(`paquete/${PAQUETE}/${archivo}`);
}

/**
 * La huella SHA-256 de unos bytes, en hexadecimal.
 *
 * @param {BufferSource} bytes - Lo que se resume.
 * @returns {Promise<string>} Sesenta y cuatro cifras hexadecimales.
 */
async function sha256(bytes) {
  const resumen = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(resumen, (byte) => byte.toString(BASE_HEXADECIMAL).padStart(CIFRAS_POR_BYTE, '0')).join('');
}

/**
 * Cuenta a las páginas abiertas que la copia sigue recibiendo datos, como mucho cada LATIDO_MS. Es un
 * PROGRESO_DEL_PAQUETE sin cifras: la barra no cambia (scripts/paquete-sin-conexion.js, leerAvanceDeLaCopia), y la
 * página sabe que no tiene que dejar de esperar.
 */
function contarQueSigue() {
  if (Date.now() - ultimoAviso < LATIDO_MS) {
    return;
  }
  avisarALasPaginas({ type: PROGRESO_DEL_PAQUETE, version: PAQUETE });
}

/**
 * Baja un archivo del paquete y devuelve sus bytes si su huella cuadra. Sin la caché HTTP (no-store): lo que se
 * guarda está en la copia, no dos veces en el disco, y una repetición no recibe la misma respuesta estropeada. Si pasa
 * DESCARGA_PARADA_MS sin recibir ningún byte (ni la respuesta ni un trozo), la descarga se corta y falla (sinPararse).
 *
 * @param {string} archivo - Nombre del archivo dentro de la carpeta del paquete.
 * @param {(huella: string) => boolean} cuadra - Si la huella calculada es la esperada.
 * @returns {Promise<ArrayBuffer>}
 */
const bajarComprobado = (archivo, cuadra) =>
  sinPararse(
    archivo,
    async (signal, recibido) => {
      const respuesta = await fetch(urlDelPaquete(archivo), { cache: 'no-store', signal });
      if (!respuesta.ok) {
        throw new Error(`${archivo}: ${respuesta.status}`);
      }
      recibido();
      const bytes = await bytesDe(respuesta, recibido);
      if (!cuadra(await sha256(bytes))) {
        throw new Error(`${archivo}: no coincide con su huella`);
      }
      return bytes;
    },
    contarQueSigue,
  );

/**
 * Baja un archivo del paquete (bajarComprobado) y, si falla, lo intenta una vez más.
 *
 * @param {string} archivo - Nombre del archivo dentro de la carpeta del paquete.
 * @param {(huella: string) => boolean} cuadra - Si la huella calculada es la esperada.
 * @returns {Promise<ArrayBuffer>}
 */
const conUnaRepeticion = (archivo, cuadra) =>
  bajarComprobado(archivo, cuadra).catch(() => bajarComprobado(archivo, cuadra));

/**
 * Los bytes de un archivo del paquete como respuesta JSON, para guardarlos en la copia.
 *
 * @param {ArrayBuffer} bytes - El contenido del archivo.
 * @returns {Response}
 */
const comoRespuesta = (bytes) =>
  new Response(bytes, { headers: { 'content-type': 'application/json; charset=utf-8' } });

/**
 * Lo que pesa cada archivo del manifiesto, en bytes, según TAMANOS_DEL_PAQUETE. Un archivo sin tamaño escrito (un
 * paquete que no es el de esta construcción, o un JSON roto) cuenta por su parte proporcional: lo que pesa de media un
 * archivo con tamaño, o 1 si no hay ninguno, y entonces la copia se cuenta por archivos. `exacto` dice si todos lo
 * tienen: solo entonces la página habla de megas.
 *
 * @param {readonly string[]} archivos - Los archivos que nombra el manifiesto.
 * @returns {{ peso: (archivo: string) => number, total: number, exacto: boolean }}
 */
function pesosDelPaquete(archivos) {
  /** @type {Record<string, unknown>} */
  let escritos = {};
  try {
    escritos = JSON.parse(TAMANOS_DEL_PAQUETE) ?? {};
  } catch {
    // Sin tamaños legibles: cada archivo cuenta por su parte (abajo).
  }
  /** @param {string} archivo */
  const escrito = (archivo) => {
    const tamano = Object.hasOwn(escritos, archivo) ? escritos[archivo] : undefined;
    return typeof tamano === 'number' && Number.isInteger(tamano) && tamano > 0 ? tamano : null;
  };
  const conocidos = archivos.map(escrito).filter((tamano) => tamano !== null);
  const media = conocidos.length ? conocidos.reduce((suma, tamano) => suma + tamano, 0) / conocidos.length : 1;
  /** @param {string} archivo */
  const peso = (archivo) => escrito(archivo) ?? media;
  return {
    peso,
    total: archivos.reduce((suma, archivo) => suma + peso(archivo), 0),
    exacto: conocidos.length === archivos.length,
  };
}

/**
 * Cuenta a las páginas abiertas cuánto de la copia hay ya guardado (PROGRESO_DEL_PAQUETE): archivos y bytes, frente
 * al total, y aparte, en `primerAnalisis`, lo mismo de lo que necesita el primer análisis: son dos estados distintos, y
 * la página no confunde uno con otro. No espera ni falla: es un aviso, y la copia sigue igual si no llega.
 *
 * @param {{ archivos: number, guardados: number, bytes: number, total: number, exacto: boolean,
 *   primerAnalisis: { archivos: number, guardados: number, bytes: number, total: number } }} avance
 */
function contarProgreso({ archivos, guardados, bytes, total, exacto, primerAnalisis }) {
  avisarALasPaginas({
    type: PROGRESO_DEL_PAQUETE,
    version: PAQUETE,
    archivos,
    guardados,
    bytes: Math.round(bytes),
    bytesTotales: Math.round(total),
    exacto,
    primerAnalisis: {
      archivos: primerAnalisis.archivos,
      guardados: primerAnalisis.guardados,
      bytes: Math.round(primerAnalisis.bytes),
      bytesTotales: Math.round(primerAnalisis.total),
    },
  });
}

/**
 * Manda un aviso de la copia a las páginas abiertas. No espera ni falla: la copia sigue igual si no llega.
 *
 * @param {Record<string, unknown>} mensaje - El aviso.
 */
function avisarALasPaginas(mensaje) {
  ultimoAviso = Date.now();
  Promise.resolve(self.clients.matchAll?.({ type: 'window' }))
    .then((ventanas) => {
      for (const ventana of ventanas ?? []) {
        ventana.postMessage(mensaje);
      }
    })
    .catch(() => {
      // Sin páginas a las que contarlo: la copia no depende de este aviso.
    });
}

/** Las copias del paquete de otras versiones que hay en el dispositivo, con su versión: unas pocas como mucho. */
async function otrasCopiasDelPaquete() {
  const nombres = await caches.keys();
  const otras = nombres.filter((nombre) => nombre.startsWith(PREFIJO_DEL_PAQUETE) && nombre !== COPIA_DEL_PAQUETE);
  return Promise.all(
    otras.map(async (nombre) => ({
      version: nombre.slice(PREFIJO_DEL_PAQUETE.length),
      copia: await caches.open(nombre),
    })),
  );
}

/**
 * Los bytes de `archivo` que ya guarda la copia de otra versión, si cuadran con `huella`; si no, null. Se vuelve a
 * calcular la huella de lo guardado, como en desdeLoComprobado: la copia del navegador la puede tocar cualquier script
 * de la web, y lo que entra en esta copia tiene que ser lo que dice su manifiesto, venga de la red o del dispositivo.
 *
 * @param {readonly { version: string, copia: Cache }[]} otras - Las copias del paquete de otras versiones.
 * @param {string} archivo - Nombre del archivo dentro de la carpeta del paquete.
 * @param {string} huella - La huella SHA-256 esperada, en hexadecimal.
 * @returns {Promise<ArrayBuffer | null>}
 */
async function deOtraCopia(otras, archivo, huella) {
  for (const { version, copia } of otras) {
    const guardada = await copia.match(urlDe(`paquete/${version}/${archivo}`));
    if (!guardada) {
      continue;
    }
    let bytes;
    try {
      bytes = await guardada.arrayBuffer();
    } catch {
      console.warn('Faro: una entrada guardada no se puede leer; se intenta otra copia o la red.');
      continue;
    }
    if ((await sha256(bytes)) === huella) {
      return bytes;
    }
  }
  return null;
}

/**
 * Guarda los archivos que faltan, unos pocos a la vez: de la copia de otra versión si ya está allí con su huella, y si
 * no, de la red. Un fallo no para los demás. Devuelve los fallos.
 *
 * @param {Cache} copia - La copia del paquete de esta versión.
 * @param {readonly (readonly [archivo: string, huella: string])[]} pendientes - Archivo y huella esperada.
 * @param {readonly { version: string, copia: Cache }[]} otras - Las copias del paquete de otras versiones.
 * @param {(archivo: string) => void} [alGuardar] - Se llama cada vez que un archivo queda guardado.
 * @returns {Promise<string[]>} Los mensajes de los fallos.
 */
async function guardarPendientes(copia, pendientes, otras, alGuardar = () => {}) {
  const cola = [...pendientes];
  /** @type {string[]} */
  const fallos = [];
  const descargar = async () => {
    for (let siguiente = cola.shift(); siguiente; siguiente = cola.shift()) {
      const [archivo, huella] = siguiente;
      try {
        const bytes =
          (await deOtraCopia(otras, archivo, huella)) ??
          (await conUnaRepeticion(archivo, (calculada) => calculada === huella));
        await copia.put(urlDelPaquete(archivo), comoRespuesta(bytes));
        alGuardar(archivo);
      } catch (error) {
        fallos.push(/** @type {ConMensaje} */ (error)?.message ?? String(error));
      }
    }
  };
  await Promise.all(Array.from({ length: DESCARGAS_A_LA_VEZ }, descargar));
  return fallos;
}

/**
 * Borra las otras copias del paquete solo con la de esta completa. Si otra versión se instala o espera, conserva
 * todas: esa versión puede haber preparado su copia en segundo plano (PRECARGAR_PAQUETE).
 */
async function borrarPaquetesViejos() {
  const nombres = await caches.keys();
  // Se vuelve a mirar después de la espera; la guardia de responderPaquete no cubre ese intervalo.
  if (self.registration.installing || self.registration.waiting) {
    return;
  }
  const viejas = nombres.filter((nombre) => nombre.startsWith(PREFIJO_DEL_PAQUETE) && nombre !== COPIA_DEL_PAQUETE);
  await Promise.all(viejas.map((nombre) => caches.delete(nombre)));
}

/**
 * Lee las entradas de un manifiesto del paquete: debe nombrar datos locales y sus huellas, nunca estar vacío ni
 * incluirse a sí mismo. La huella del propio manifiesto se comprueba antes de llamar, también al leerlo de la copia.
 *
 * @param {ArrayBuffer} bytes - El manifiesto ya comprobado contra la versión del paquete.
 * @returns {[archivo: string, huella: string][]}
 */
function entradasDelManifiesto(bytes) {
  const manifiesto = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  if (!manifiesto || typeof manifiesto !== 'object' || Array.isArray(manifiesto)) {
    throw new Error('El manifiesto del paquete no es un objeto');
  }
  const entradas = Object.entries(manifiesto);
  if (!entradas.length) {
    throw new Error('El manifiesto del paquete está vacío');
  }
  return entradas.map(([archivo, entrada]) => {
    urlDelPaquete(archivo);
    if (
      archivo === MANIFIESTO ||
      !entrada ||
      typeof entrada !== 'object' ||
      Array.isArray(entrada) ||
      typeof entrada.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entrada.sha256)
    ) {
      throw new Error(`${archivo}: no es una entrada del manifiesto del paquete`);
    }
    return [archivo, entrada.sha256];
  });
}

/**
 * Una entrada guardada solo se reutiliza si se puede leer y coincide con el manifiesto comprobado. Un cuerpo
 * ilegible se trata como una entrada que falta, para poder repararlo sin quedar atrapados en la lectura de la copia.
 *
 * @param {Response} respuesta - La entrada guardada.
 * @param {string} huella - Su huella en el manifiesto.
 * @returns {Promise<boolean>}
 */
async function cuadraLaEntradaGuardada(respuesta, huella) {
  try {
    return (await sha256(await respuesta.arrayBuffer())) === huella;
  } catch {
    return false;
  }
}

/**
 * Si a una copia con manifiesto (completa) le falta algún archivo de los que nombra: el navegador puede haber perdido
 * una entrada, y entonces el motor fallaría en cada lectura sin que nada volviera a bajarla. Solo mira si están, sin
 * leerlos; con `revisar` (después de que el motor no haya podido leer la copia: paquete-sin-conexion.js), además
 * vuelve a calcular la huella de cada archivo y quita los que no cuadran. Si no se puede leer el manifiesto o
 * comprobar sus entradas, la copia no se confirma como completa y se intenta reparar sin borrar los datos guardados.
 *
 * @param {Cache} copia - La copia del paquete de esta versión.
 * @param {Response} guardado - Su manifiesto.
 * @param {boolean} [revisar] - Si se comprueba también la huella de cada archivo.
 * @returns {Promise<boolean>}
 */
async function leFaltaAlgo(copia, guardado, revisar = false) {
  try {
    const bytes = await guardado.arrayBuffer();
    if (!(await sha256(bytes)).startsWith(PAQUETE)) {
      return true;
    }
    const revisados = await Promise.all(
      entradasDelManifiesto(bytes).map(async ([archivo, huella]) => {
        const respuesta = await copia.match(urlDelPaquete(archivo));
        if (respuesta && revisar && !(await cuadraLaEntradaGuardada(respuesta, huella))) {
          // Un archivo que ya no cuadra con su huella se quita, y se vuelve a bajar como uno que falta.
          await copia.delete(urlDelPaquete(archivo));
          return false;
        }
        return Boolean(respuesta);
      }),
    );
    return revisados.some((esta) => !esta);
  } catch {
    return true;
  }
}

/**
 * Guarda lo que le falta a la copia, primero lo del primer análisis (guardarPorOrden), contando el avance a las páginas
 * (avanceDeLaCopia); con lo del primer análisis guardado, lo anota (anotarElPrimerAnalisis) y llama a
 * `alGuardarElPrimerAnalisis`. Devuelve los fallos.
 *
 * @param {Cache} copia
 * @param {{ bytes: ArrayBuffer, entradas: readonly (readonly [archivo: string, huella: string])[] }} manifiesto - Sus
 *   bytes, ya comprobados, y sus entradas.
 * @param {readonly (readonly [archivo: string, huella: string])[]} pendientes - Las que faltan.
 * @param {() => void} alGuardarElPrimerAnalisis
 * @returns {Promise<string[]>}
 */
async function guardarLoQueFalta(copia, manifiesto, pendientes, alGuardarElPrimerAnalisis) {
  const nombres = manifiesto.entradas.map(([archivo]) => archivo);
  const alGuardar = avanceDeLaCopia(
    nombres,
    new Set(pendientes.map(([archivo]) => archivo)),
    pesosDelPaquete(nombres),
    contarProgreso,
  );
  const otras = await otrasCopiasDelPaquete();
  /** @param {readonly (readonly [archivo: string, huella: string])[]} tanda */
  const guardar = (tanda) => guardarPendientes(copia, tanda, otras, alGuardar);
  return guardarPorOrden(pendientes, guardar, () => {
    anotarElPrimerAnalisis({
      deLaCopia: (clave) => copia.match(clave),
      manifiesto: urlDelPaquete(MANIFIESTO),
      respuesta: () => comoRespuesta(manifiesto.bytes.slice(0)),
      archivos: new Set(nombres.filter(esDelPrimerAnalisis).map(urlDelPaquete)),
    });
    alGuardarElPrimerAnalisis();
  });
}

/**
 * Completa la copia del paquete de esta versión; true si queda completa. No borra ninguna otra. Si la copia tiene
 * manifiesto pero le falta algún archivo (leFaltaAlgo), se le quita el manifiesto y se completa como una a medias.
 * Guarda primero lo que necesita el primer análisis (guardarPorOrden) y, con todo eso guardado, lo anota
 * (anotarElPrimerAnalisis) y llama a `alGuardarElPrimerAnalisis`.
 *
 * @param {boolean} [revisar] - Si se revisan las huellas de una copia completa (leFaltaAlgo).
 * @param {() => void} [alGuardarElPrimerAnalisis] - Se llama cuando está guardado lo del primer análisis.
 * @returns {Promise<boolean>}
 */
async function llenarCopiaDelPaquete(revisar = false, alGuardarElPrimerAnalisis = () => {}) {
  anotarElPrimerAnalisis(null);
  const copia = await caches.open(COPIA_DEL_PAQUETE);
  const guardado = await copia.match(urlDelPaquete(MANIFIESTO));
  if (guardado && !(await leFaltaAlgo(copia, guardado, revisar))) {
    return true;
  }
  if (guardado) {
    console.warn('Faro: no se ha podido confirmar que la copia de los datos esté completa; se vuelve a comprobar.');
    await copia.delete(urlDelPaquete(MANIFIESTO));
  }
  // El latido (contarQueSigue) cuenta desde que empieza el intento: la página acaba de pedirlo.
  ultimoAviso = Date.now();
  const bytesManifiesto = await conUnaRepeticion(MANIFIESTO, (huella) => huella.startsWith(PAQUETE));
  const entradas = entradasDelManifiesto(bytesManifiesto);
  /** @type {[archivo: string, huella: string][]} */
  const pendientes = [];
  for (const [archivo, huella] of entradas) {
    const guardado = await copia.match(urlDelPaquete(archivo));
    if (guardado && (await cuadraLaEntradaGuardada(guardado, huella))) {
      continue;
    }
    if (guardado) {
      await copia.delete(urlDelPaquete(archivo));
    }
    pendientes.push([archivo, huella]);
  }
  const manifiesto = { bytes: bytesManifiesto, entradas };
  const fallos = await guardarLoQueFalta(copia, manifiesto, pendientes, alGuardarElPrimerAnalisis);
  if (fallos.length) {
    console.warn(
      `Faro: la copia de los datos para usar sin conexión no está completa; faltan ${fallos.length}.`,
      fallos,
    );
    return false;
  }
  await copia.put(urlDelPaquete(MANIFIESTO), comoRespuesta(bytesManifiesto));
  return true;
}

/**
 * El intento en curso: dos pestañas que piden la copia a la vez comparten la misma descarga. Entre service workers (el
 * activo y el que espera, de dos versiones de la web con el mismo paquete), el cerrojo del origen con el nombre de la
 * copia (navigator.locks): el segundo espera a que el primero termine y encuentra la copia completa, sin volver a bajar
 * nada ni escribir a la vez en las mismas entradas.
 */
let llenando = /** @type {Promise<boolean> | null} */ (null);
let revisionPendiente = false;
let revisionEnCurso = false;

/**
 * De cada intento (la promesa de prepararPaquete), cuándo tiene guardado lo del primer análisis: true en cuanto lo
 * tiene (o la copia ya estaba completa) y false si acaba sin tenerlo.
 */
const primerAnalisisDelIntento = /** @type {WeakMap<Promise<boolean>, Promise<boolean>>} */ (new WeakMap());

/** @param {boolean} [revisar] - Si se revisan las huellas de una copia completa (leFaltaAlgo). */
function prepararPaquete(revisar = false) {
  revisionPendiente ||= revisar && !revisionEnCurso;
  if (llenando) {
    return llenando;
  }
  /** @type {(guardado: boolean) => void} */
  let contarElPrimerAnalisis = () => {};
  const primerAnalisis = new Promise((resolver) => {
    contarElPrimerAnalisis = resolver;
  });
  const intento = (async () => {
    let completo = false;
    try {
      do {
        const revisarAhora = revisionPendiente;
        revisionPendiente = false;
        revisionEnCurso = revisarAhora;
        completo = await navigator.locks
          .request(COPIA_DEL_PAQUETE, () => llenarCopiaDelPaquete(revisarAhora, () => contarElPrimerAnalisis(true)))
          .catch((error) => {
            console.warn('Faro: no se ha podido guardar la copia de los datos para usar sin conexión.', error);
            return false;
          });
      } while (revisionPendiente);
      return completo;
    } finally {
      revisionEnCurso = false;
      anotarElPrimerAnalisis(null);
      llenando = null;
      // Una copia que ya estaba completa también tiene lo del primer análisis; un intento que no lo ha guardado, no.
      contarElPrimerAnalisis(completo);
    }
  })();
  primerAnalisisDelIntento.set(intento, primerAnalisis);
  llenando = intento;
  return intento;
}

/** Las páginas, por su id, a las que cada intento (la promesa de prepararPaquete) ya tiene que contestar. */
const paginasDelIntento = /** @type {WeakMap<Promise<boolean>, Set<string>>} */ (new WeakMap());

/**
 * Prepara la copia, borra las de otras versiones si ya no hacen falta (borrarPaquetesViejos) y cuenta a la página que
 * la pidió cómo ha quedado. Lo pide siempre una página a la versión activa (scripts/paquete-sin-conexion.js). Si esa
 * página ya espera la respuesta de este intento (repite su petición mientras espera), su evento dura lo que el intento,
 * sin otra respuesta. A cada petición se le cuenta además, en cuanto lo está, que lo del primer análisis ya está
 * guardado (PRIMER_ANALISIS_DEL_PAQUETE).
 *
 * @param {ExtendableMessageEvent['source']} cliente - Quien lo pidió, o null si no se sabe.
 * @param {boolean} [revisar] - Si se revisan las huellas de una copia completa (la página lo pide tras un fallo).
 * @returns {Promise<void>}
 */
async function responderPaquete(cliente, revisar = false) {
  const intento = prepararPaquete(revisar);
  const esperan = paginasDelIntento.get(intento) ?? new Set();
  paginasDelIntento.set(intento, esperan);
  const id = cliente && 'id' in cliente ? cliente.id : null;
  // A cada petición, también a las que repite la página mientras espera: quien empieza a esperar cuando lo del primer
  // análisis ya está guardado lo sabe enseguida, aunque su página ya esperase este intento.
  primerAnalisisDelIntento.get(intento)?.then((guardado) => {
    if (guardado) {
      cliente?.postMessage({ type: PRIMER_ANALISIS_DEL_PAQUETE, version: PAQUETE });
    }
  });
  if (id !== null && esperan.has(id)) {
    await intento;
    return;
  }
  if (id !== null) {
    esperan.add(id);
  }
  // La copia sin conexión tampoco está completa sin la página del recorrido; si falta, se vuelve a pedir, y la página
  // lo sabe por faltaElRecorrido: el paquete puede estar completo para el motor sin que la copia lo esté. En cada
  // visita, a la vez que el paquete, se vuelve a consultar su entrada: si el recorrido real ha pasado a protegido, sale
  // de la copia y sin red ya no se abre (reponerLaEntradaDelRecorrido).
  const recorrido = reponerLaEntradaDelRecorrido();
  const completo = await intento;
  if (completo && !self.registration.waiting) {
    await borrarPaquetesViejos();
  }
  const conElRecorrido = await recorrido;
  cliente?.postMessage({
    type: ESTADO_DEL_PAQUETE,
    version: PAQUETE,
    completo,
    ...(conElRecorrido ? {} : { faltaElRecorrido: true }),
  });
}

/**
 * Un archivo del paquete, solo de la copia completa de su versión (cada archivo se comprobó al guardarlo, y el
 * manifiesto, el último, dice que está entera): nunca de la red. Una copia a medias no sirve nada; mientras tanto, la
 * página sigue con la versión anterior o espera a que esta acabe (scripts/paquete-sin-conexion.js).
 * Si la copia de esta versión se está guardando, la petición espera a ese intento (llenando) y se responde con lo que
 * deje: una página que este service worker acaba de pasar a controlar (clients.claim) puede pedir el paquete en ese
 * rato, y lo que se está guardando no está ausente. Lo del primer análisis, en cuanto ese intento lo tiene guardado, no
 * espera (delPrimerAnalisisGuardado). Sin un intento en curso no se empieza ninguno: lo pide la página.
 *
 * @param {string} clave - Dirección sin consulta ni fragmento (claveDeCopia).
 * @param {string} version - La versión del paquete que pide la dirección.
 * @returns {Promise<Response>}
 */
async function desdeLaCopiaDelPaquete(clave, version) {
  if (version === PAQUETE && llenando) {
    const delPrimerAnalisis = await delPrimerAnalisisGuardado(clave);
    if (delPrimerAnalisis) {
      return delPrimerAnalisis;
    }
    await llenando;
  }
  const nombre = PREFIJO_DEL_PAQUETE + version;
  if (!(await caches.has(nombre))) {
    return noEstaComprobado(clave);
  }
  const copia = await caches.open(nombre);
  const completa = await copia.match(urlDe(`paquete/${version}/${MANIFIESTO}`));
  return (completa && (await copia.match(clave))) || noEstaComprobado(clave);
}

export {
  cuadraLaEntradaGuardada,
  desdeLaCopiaDelPaquete,
  LATIDO_MS,
  PREPARAR_PAQUETE,
  prepararPaquete,
  RUTA_DEL_PAQUETE,
  responderPaquete,
  sha256,
};
