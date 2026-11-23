import './secciones.js';
import {
  COMPLEMENTARIOS,
  COPIA,
  ENTRADA_DEL_RECORRIDO,
  HUELLAS_DE_LA_COPIA,
  HUELLAS_DE_PAGINAS,
  IMPRESCINDIBLES,
  PREFIJO,
  urlDe,
} from './catalogo.js';
import { bytesDe, sinPararse } from './descarga.js';
import {
  anotarElRecorrido,
  anotarModoAlInstalar,
  estadoDelRecorrido,
  modoDeLaInstalacion,
  PLAZO_DE_LA_CONSULTA_MS,
} from './modo.js';
import { COPIA_DEL_ESTADO } from './no-coincide.js';
import { cuadraLaEntradaGuardada, sha256 } from './paquete.js';
import { disponibilidadSecciones, HTTP_SECCIONES, seccionDeLaClave } from './secciones.js';

/**
 * Un fallo capturado: normalmente un Error, con su mensaje.
 * @typedef {{ message?: string } | null | undefined} ConMensaje
 */

/**
 * Los guiones que se publican con la huella de su contenido en el nombre, con la misma regla que el servidor, que los
 * sirve inmutables (src/plataforma/cabeceras-web.ts, CARPETAS_PUBLICAS_CON_HUELLA y NOMBRE_CON_HUELLA; lo coteja
 * pruebas/web-service-worker/nombre-con-huella.test.ts): en js/ (las páginas públicas) y en motor/trozos/, las
 * entradas de página (pagina-<nombre>-<16 cifras hexadecimales>.js, o paginas-<nombre>-… cuando varias páginas
 * comparten la misma entrada) y los trozos de esbuild (<nombre>-<8 letras de su huella>.js). Un nombre así no se
 * publica nunca con otros bytes.
 */
const CARPETAS_CON_HUELLA = ['js/', 'motor/trozos/'];
const NOMBRE_CON_HUELLA = /^[a-z0-9-]+-(?:[0-9a-f]{16}|[A-Z2-7]{8})\.js$/;
/** @param {string} archivo - Ruta del archivo desde la base de la web. */
function conHuellaEnElNombre(archivo) {
  const carpeta = CARPETAS_CON_HUELLA.find((publica) => archivo.startsWith(publica));
  return carpeta !== undefined && NOMBRE_CON_HUELLA.test(archivo.slice(carpeta.length));
}

/**
 * El modo de caché HTTP con que se pide un archivo para la copia. Lo que lleva la huella en el nombre
 * (conHuellaEnElNombre) se pide con «default»: si el navegador ya lo tiene porque la página acaba de pedirlo, no se
 * vuelve a descargar; si lo que da así no cuadra con su huella, se pide una vez más con «reload» (respuestaParaLaCopia).
 * Lo demás salta la caché HTTP («reload»), también lo comprobado sin huella en el nombre: la copia nueva se hace con lo
 * que hay ahora en el servidor. Los bytes se comprueban siempre contra su huella (deEstaVersion); las cabeceras que
 * llegan no se cotejan con nada: se guardan las del servidor (salvo las del transporte, cabecerasDeLaCopia). Por eso
 * lo que no lleva la huella en el nombre no se toma de la caché HTTP, que podría guardar las de otra versión (el Worker
 * del motor toma la CSP de su propia respuesta); lo que la lleva, el servidor lo entrega siempre con las mismas.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @returns {RequestCache}
 */
const modoDeLaCopia = (archivo) => (conHuellaEnElNombre(archivo) ? 'default' : 'reload');

/**
 * La petición con que se baja un archivo para la copia.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @param {RequestCache} [modo] - El modo de caché HTTP (modoDeLaCopia, si no se indica).
 * @returns {Request}
 */
const peticionDeCopia = (archivo, modo = modoDeLaCopia(archivo)) => new Request(urlDe(archivo), { cache: modo });

/**
 * Si `respuesta` es del acceso temporal al recorrido inactivo (src/plataforma/cloudflare/acceso-recorrido.ts,
 * MARCA_DEL_ACCESO): su formulario («acceso») o la página que entrega con la sesión temporal («temporal»).
 *
 * @param {Response} respuesta - Lo que ha contestado el servidor.
 * @returns {boolean}
 */
const marcadaPorElAcceso = (respuesta) => respuesta.headers.has('x-faro-recorrido');

/**
 * Lo que demuestra una respuesta de la red a la entrada del recorrido real: si llega con el acceso temporal
 * (marcadaPorElAcceso), el recorrido real está protegido: se anota (anotarElRecorrido) y su página sale de la copia,
 * para que sin red no se abra (responderEntradaDelRecorrido). Devuelve si estaba marcada.
 *
 * @param {Response} respuesta - Lo que ha contestado el servidor a la entrada del recorrido real.
 * @returns {Promise<boolean>}
 */
async function siEstaProtegido(respuesta) {
  if (!marcadaPorElAcceso(respuesta)) {
    return false;
  }
  await anotarElRecorrido('protegido');
  if (await (await caches.open(COPIA)).delete(urlDe(ENTRADA_DEL_RECORRIDO))) {
    anotarEscrituraEnLaCopia();
  }
  return true;
}

/**
 * Por qué una respuesta no sirve como copia de `direccion`, o '' si sirve: un estado fuera de 2xx, una que llega
 * tras una redirección (un portal de wifi, una sesión caducada), una página HTML en lugar de otro tipo de archivo (un
 * portal que contesta 200 con su página) o lo que entrega el acceso temporal al recorrido (marcadaPorElAcceso): sin red
 * se abriría lo protegido. Guardada, se serviría como si fuera de esta versión. La misma regla al instalar
 * (respuestaParaLaCopia), al reparar y al guardar lo que trae la red después (responder, guardarLaEntradaDelRecorrido).
 *
 * @param {string} direccion - Dirección absoluta del archivo que se quiere guardar.
 * @param {Response} respuesta - Lo que ha contestado el servidor.
 * @returns {string} El motivo, o la cadena vacía si sirve.
 */
function noSirveComoCopia(direccion, respuesta) {
  const tipo = respuesta.headers.get('content-type') ?? '';
  const paginaPorOtroArchivo = !new URL(direccion).pathname.endsWith('.html') && tipo.startsWith('text/html');
  const marcada = marcadaPorElAcceso(respuesta);
  if (respuesta.ok && !respuesta.redirected && !paginaPorOtroArchivo && !marcada) {
    return '';
  }
  const como = `${respuesta.redirected ? ' tras una redirección' : ''}${marcada ? ' del acceso al recorrido' : ''}`;
  return `${respuesta.status}${como} ${tipo}`;
}

/**
 * Lo que ha llegado no son los bytes de esta versión: un archivo alterado o de otra versión. No es un fallo de paso
 * (como la falta de red): volver a pedirlo daría lo mismo.
 */
class HuellaQueNoCoincide extends Error {
  /** @param {string} archivo - Ruta del archivo desde la base de la web. */
  constructor(archivo) {
    super(`${archivo}: no coincide con su huella`);
    this.name = 'HuellaQueNoCoincide';
    /** El archivo que no coincide. */
    this.archivo = archivo;
  }
}

/**
 * La respuesta del servidor para la copia de un archivo, ya comprobada contra su huella (deEstaVersion), o un error si
 * no sirve como copia (noSirveComoCopia) o no es de esta versión. Lo pedido con la caché HTTP («default»,
 * modoDeLaCopia) que no cuadra con su huella se pide una vez más sin ella.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes (la reparación avisa así de que sigue viva).
 * @returns {Promise<Response>} La respuesta, con los bytes de esta versión.
 */
async function respuestaParaLaCopia(archivo, alRecibir) {
  const modo = modoDeLaCopia(archivo);
  try {
    return await respuestaComprobada(archivo, modo, alRecibir);
  } catch (error) {
    if (!(error instanceof HuellaQueNoCoincide) || modo === 'reload') {
      throw error;
    }
    return respuestaComprobada(archivo, 'reload', alRecibir);
  }
}

/**
 * Una petición de la copia de un archivo con el modo de caché `modo` (respuestaParaLaCopia). Si pasa el plazo sin
 * recibir nada, ni la respuesta ni un trozo de su cuerpo, se corta y falla (sinPararse): una petición que no avanza no
 * deja colgada la instalación ni la reparación. Las cabeceras ya cuentan como avance, y `alRecibir` también se llama
 * al llegar: la reparación avisa entonces a la página, sin más avisos que con los trozos, porque los espacia LATIDO_MS.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @param {RequestCache} modo - El modo de caché HTTP.
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes.
 * @returns {Promise<Response>}
 */
function respuestaComprobada(archivo, modo, alRecibir) {
  return sinPararse(
    archivo,
    async (signal, recibido) => {
      const respuesta = await fetch(peticionDeCopia(archivo, modo), { signal });
      recibido();
      const entrada = archivo === ENTRADA_DEL_RECORRIDO;
      if (entrada) {
        await siEstaProtegido(respuesta);
      }
      const motivo = noSirveComoCopia(urlDe(archivo), respuesta);
      if (motivo) {
        throw new Error(`${archivo}: ${motivo}`);
      }
      const comprobada = await deEstaVersion(archivo, respuesta, recibido);
      if (entrada) {
        await anotarElRecorrido('activo');
      }
      return comprobada;
    },
    alRecibir,
  );
}

/**
 * `respuesta` tal como entra en la copia: con sus bytes, solo si cuadran con la huella de `archivo` en esta versión
 * (HUELLAS_DE_LA_COPIA). Si no cuadran, lo que llega es de otra versión o está alterado (HuellaQueNoCoincide): la
 * instalación o la reparación fallan enteras y la copia anterior sigue. Un archivo sin huella no entra: no se puede
 * saber si es de esta versión (la preparación de la web da huella a todo lo que puede entrar en la copia).
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @param {Response} respuesta - Lo que ha contestado el servidor, que sirve como copia (noSirveComoCopia).
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes (bytesDe).
 * @returns {Promise<Response>}
 */
async function deEstaVersion(archivo, respuesta, alRecibir) {
  const huella = HUELLAS_DE_LA_COPIA.get(urlDe(archivo));
  if (huella === undefined) {
    throw new Error(`${archivo}: no tiene huella de esta versión`);
  }
  if (
    HUELLAS_DE_PAGINAS.has(urlDe(archivo)) &&
    respuesta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/html'
  ) {
    throw new Error(`${archivo}: no es una página HTML`);
  }
  const bytes = await bytesDe(respuesta, alRecibir);
  if ((await sha256(bytes)) !== huella) {
    throw new HuellaQueNoCoincide(archivo);
  }
  return new Response(bytes, { status: respuesta.status, headers: cabecerasDeLaCopia(respuesta) });
}

/** Las cabeceras que describen cómo viajó el cuerpo, no el archivo: la copia guarda el cuerpo ya descodificado. */
const CABECERAS_DEL_TRANSPORTE = ['content-encoding', 'content-length'];

/**
 * Las cabeceras con que entra en la copia `respuesta`, ya leída: las suyas, sin las del transporte. Si el alojamiento la
 * comprimió (Brotli o gzip), el navegador entrega el cuerpo descodificado, y una entrada que dijera «br» con la longitud
 * de lo comprimido no describiría lo que guarda.
 *
 * @param {Response} respuesta - Lo que ha contestado el servidor.
 * @returns {Headers}
 */
function cabecerasDeLaCopia(respuesta) {
  const cabeceras = new Headers(respuesta.headers);
  for (const nombre of CABECERAS_DEL_TRANSPORTE) {
    cabeceras.delete(nombre);
  }
  return cabeceras;
}

/**
 * Peticiones a la vez al hacer la copia: las conexiones que un navegador abre por servidor en HTTP/1.1 (seis). Así
 * ninguna espera en la cola del navegador sin conexión libre, que es lo que exige el plazo por falta de avance
 * (sinPararse, descarga.js): cuenta desde que se llama a fetch, y una petición en cola no recibe nada. Pedirlo todo a
 * la vez (cientos) satura un móvil sin ganar tiempo.
 */
const PETICIONES_A_LA_VEZ = 6;
/** Lo que distingue la copia provisional de una instalación de la copia de su versión. */
const SUFIJO_PROVISIONAL = ':provisional';

/**
 * Hace `tarea` con cada elemento, como mucho `aLaVez` a la vez y en el orden de la lista. Al primer fallo no empieza
 * ninguna más; espera las tareas ya iniciadas antes de rechazar con ese primer fallo.
 *
 * @param {readonly string[]} elementos - Lo que hay que hacer.
 * @param {number} aLaVez - Cuántas tareas como mucho en curso.
 * @param {(elemento: string) => Promise<void>} tarea - Lo que se hace con cada uno.
 * @returns {Promise<void>} Se cumple cuando han terminado todas.
 */
async function enTandas(elementos, aLaVez, tarea) {
  const cola = [...elementos];
  /** @type {{ error: unknown } | undefined} */
  let primerFallo;
  const trabajar = async () => {
    for (let siguiente = cola.shift(); siguiente !== undefined; siguiente = cola.shift()) {
      try {
        await tarea(siguiente);
      } catch (error) {
        cola.length = 0;
        primerFallo ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: aLaVez }, trabajar));
  if (primerFallo) {
    throw primerFallo.error;
  }
}

/**
 * Cuántas veces ha escrito o borrado este service worker en la copia de esta versión desde que se puso en marcha. Lo
 * que se concluye de leerla (copiaEnteraYDeEstaVersion, reparar.js) solo vale mientras esta cuenta no cambia; al
 * detenerse el service worker se pierde, con todo lo que dependía de ella.
 */
const escriturasEnLaCopia = { cuenta: 0 };
/** Anota que la copia de esta versión ha cambiado (escriturasEnLaCopia). */
function anotarEscrituraEnLaCopia() {
  escriturasEnLaCopia.cuenta += 1;
}

/**
 * Guarda un archivo, si su respuesta sirve como copia (respuestaParaLaCopia).
 *
 * @param {Cache} copia - La copia de esta versión.
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @returns {Promise<void>}
 */
async function guardarUno(copia, archivo) {
  await copia.put(urlDe(archivo), await respuestaParaLaCopia(archivo));
  anotarEscrituraEnLaCopia();
}

/**
 * Hace la copia en dos pasadas, porque no todo pesa lo mismo si falla:
 * 1. Lo imprescindible (páginas, estilos, scripts y diccionarios), de una vez y todo o nada: si falla, la instalación
 *    falla, esta copia se descarta y el navegador vuelve a intentarla en la siguiente visita. Media copia de esto no
 *    serviría: una página sin su estilo.
 * 2. Lo complementario (tipografías e imágenes), unas pocas a la vez y aguantando los fallos: con una wifi
 *    inestable es lo que más se cae, y sin ello la web se lee igual. Lo que falte se pide a la red la primera vez que
 *    se use, y se guarda.
 * En las dos, cada archivo entra solo si cuadra con su huella de esta versión (respuestaParaLaCopia): uno
 * imprescindible que no cuadra hace fallar la instalación (con su constancia); uno complementario se queda fuera, como
 * si no hubiera llegado.
 * Si la copia de esta VERSION ya existía, ninguna de las dos pasadas reescribe lo que ya tiene: solo le añaden lo que
 * le falte. Lo imprescindible se descarga entero igualmente, para seguir siendo todo o nada; lo complementario que ya
 * está no se pide.
 * Un archivo que pasa el plazo sin recibir datos (respuestaComprobada) cuenta como uno que no ha llegado: lo
 * imprescindible hace fallar la instalación, que borra su copia provisional y deja intacta la de esta VERSION que ya
 * existiera; lo complementario se queda fuera. Ninguna petición que no avance deja la instalación sin terminar.
 * Lo que no se pudo guardar se cuenta en la consola del service worker: no es un problema que haya que contarle a la
 * persona, pero sí uno que quien mantiene Faro tiene que poder ver.
 */
async function guardarCopia() {
  const imprescindibles = await imprescindiblesDeEstaVersion();
  // Todo o nada, como addAll, pero con las mismas exigencias que cada archivo suelto y unas pocas peticiones a la vez:
  // cada respuesta se guarda en una copia provisional al llegar (sin retener cientos de cuerpos en memoria), y solo si
  // todas sirven pasan a la copia de la versión. Si falla la descarga, no se toca la definitiva; si falla la copia
  // a la definitiva (por ejemplo, sin cuota), la instalación falla sin activar la versión.
  const provisional = `${COPIA}${SUFIJO_PROVISIONAL}`;
  await caches.delete(provisional);
  const enCurso = await caches.open(provisional);
  // Una copia con este nombre ya existe si se vuelve a instalar la misma VERSION. Pasa cuando cambia solo el paquete de
  // datos: sus líneas (PAQUETE y TAMANOS_DEL_PAQUETE) cambian los bytes de este archivo, y el navegador lo instala,
  // pero la VERSION no las cubre (herramientas/web/version-copia.ts), porque el paquete tiene su propia copia
  // («Paquete de datos») y se actualiza sin cambiar la de la web. También, si un intento anterior no llegó a activarse.
  // Entonces lo que tiene es de esta misma VERSION, y puede estar sirviendo a la versión activa.
  let definitivaNueva = true;
  try {
    await enTandas(imprescindibles, PETICIONES_A_LA_VEZ, async (archivo) => {
      const respuesta = await respuestaParaLaCopia(archivo);
      if (archivo === 'inicio.html') {
        // El modo de la instalación, con la evidencia de inicio.html recién llegada (modo.js).
        await anotarModoAlInstalar(respuesta);
      }
      await enCurso.put(urlDe(archivo), respuesta);
    });
    definitivaNueva = !(await caches.has(COPIA));
    const definitiva = await caches.open(COPIA);
    await enTandas(imprescindibles, PETICIONES_A_LA_VEZ, async (archivo) => {
      // En una copia que ya existía, lo que tiene es de esta misma VERSION (el mismo contenido): no se reescribe,
      // para no tocar lo que está sirviendo la versión activa; solo se añade lo que le falte.
      if (!definitivaNueva && (await definitiva.match(urlDe(archivo)))) {
        return;
      }
      // Recién guardada en la copia provisional por la tanda anterior.
      await definitiva.put(urlDe(archivo), /** @type {Response} */ (await enCurso.match(urlDe(archivo))));
      anotarEscrituraEnLaCopia();
    }).catch(async (error) => {
      // La copia que ha creado este intento se borra entera y el siguiente empieza de cero. La que ya existía no se
      // borra: puede ser la de la versión activa, y este intento solo le ha añadido entradas que faltaban; si quedó
      // incompleta, el siguiente intento la completa.
      if (definitivaNueva) {
        await caches.delete(COPIA);
        anotarEscrituraEnLaCopia();
      }
      throw error;
    });
  } finally {
    await caches.delete(provisional);
  }
  const copia = await caches.open(COPIA);
  /** @type {unknown[]} */
  const faltan = [];
  await enTandas(COMPLEMENTARIOS, PETICIONES_A_LA_VEZ, async (archivo) => {
    try {
      // Como en la pasada anterior: en una copia que ya existía no se reescribe lo que tiene, solo se añade lo que falte.
      if (!definitivaNueva && (await copia.match(urlDe(archivo)))) {
        return;
      }
      await guardarUno(copia, archivo);
    } catch (error) {
      faltan.push(error);
    }
  });
  if (faltan.length) {
    console.warn(
      `Faro: la copia sin conexión se ha guardado sin ${faltan.length} de ${COMPLEMENTARIOS.length} archivos complementarios (tipografías, imágenes o la página del recorrido).`,
      faltan.map((error) => /** @type {ConMensaje} */ (error)?.message ?? error),
    );
  }
}

/**
 * Lo imprescindible de esta versión (IMPRESCINDIBLES), sin las páginas de las secciones que la política de la entidad
 * tiene apagadas. Lanza si la política no se puede comprobar.
 * @returns {Promise<string[]>}
 */
async function imprescindiblesDeEstaVersion() {
  const politica = HUELLAS_DE_PAGINAS.size ? await disponibilidadSecciones() : null;
  if (politica && (politica.fallo || !politica.documento)) {
    throw new Error('No se puede comprobar la disponibilidad de las secciones');
  }
  return IMPRESCINDIBLES.filter((archivo) => {
    const seccion = seccionDeLaClave(urlDe(archivo));
    return !HUELLAS_DE_PAGINAS.has(urlDe(archivo)) || !seccion || politica?.documento?.secciones[seccion] === true;
  });
}

/**
 * Si la copia de esta versión tiene la página del recorrido real (ENTRADA_DEL_RECORRIDO) con sus bytes de esta versión
 * o no la necesita. En cada visita (responderPaquete) y en la reparación, con red, vuelve a consultar su entrada
 * (consultarLaEntrada): si contesta el acceso temporal, el recorrido real está protegido (siEstaProtegido): sale de la
 * copia, sin red no se abre y la copia no lo promete; si llega su página y la copia no la tiene, o lo último anotado es
 * «protegido», la guarda y anota «activo». Sin red, con el plazo vencido o con otra respuesta (un 5xx), no cambia nada
 * de lo anotado. Al instalar es complementaria (COMPLEMENTARIOS: detrás de un portal puede llegar el acceso en su
 * lugar), pero sin ella el recorrido no se abre sin conexión, y la copia no se da por completa (responderPaquete, la
 * reparación). No hace falta si esta versión no la guarda, si la instalación no es pública (modoDeLaInstalacion) o si
 * la entidad tiene cerrada su sección: sin red se ve que está retirada, no la copia. Sin poder comprobar la política,
 * falta. No falla.
 *
 * @param {() => void} [alRecibir] - Se llama cada vez que llegan bytes (la reparación avisa así de que sigue viva).
 * @returns {Promise<boolean>} Si la copia la tiene o no la necesita.
 */
async function reponerLaEntradaDelRecorrido(alRecibir) {
  const clave = urlDe(ENTRADA_DEL_RECORRIDO);
  const huella = HUELLAS_DE_LA_COPIA.get(clave);
  if (!COMPLEMENTARIOS.includes(ENTRADA_DEL_RECORRIDO) || huella === undefined) {
    return true;
  }
  /** @type {Response | undefined} */
  let respuesta;
  try {
    const copia = await caches.open(COPIA);
    // Sin red, solo una instalación pública abre el recorrido desde la copia (responderEntradaDelRecorrido): en una
    // privada no hace falta, y detrás de un portal la red contesta con el acceso en su lugar.
    if ((await modoDeLaInstalacion(copia)) !== 'publica') {
      return true;
    }
    respuesta = await consultarLaEntrada(clave);
    if (await nadaQueGuardar(copia, huella, respuesta)) {
      return true;
    }
    const necesaria = await laNecesitaSuSeccion(clave);
    if (necesaria !== true || !respuesta) {
      return necesaria === false;
    }
    const motivo = noSirveComoCopia(clave, respuesta);
    if (motivo) {
      throw new Error(`${ENTRADA_DEL_RECORRIDO}: ${motivo}`);
    }
    await copia.put(clave, await deEstaVersion(ENTRADA_DEL_RECORRIDO, respuesta, alRecibir));
    anotarEscrituraEnLaCopia();
    await anotarElRecorrido('activo');
    return true;
  } catch (error) {
    console.warn('Faro: la copia sin conexión sigue sin la página del recorrido.', error);
    return false;
  } finally {
    if (respuesta && !respuesta.bodyUsed) {
      await respuesta.body?.cancel().catch(() => undefined);
    }
  }
}

/**
 * Si la consulta de la entrada (consultarLaEntrada) no deja nada que guardar: ha llegado el acceso temporal
 * (siEstaProtegido); lo último anotado es «protegido» y no llega su página; o no es «protegido» y la copia ya tiene la
 * página con su huella.
 *
 * @param {Cache} copia @param {string} huella @param {Response | undefined} respuesta
 * @returns {Promise<boolean>}
 */
async function nadaQueGuardar(copia, huella, respuesta) {
  if (respuesta && (await siEstaProtegido(respuesta))) {
    return true;
  }
  if ((await estadoDelRecorrido()) === 'protegido') {
    return respuesta?.status !== HTTP_SECCIONES.correcto;
  }
  const guardada = await copia.match(urlDe(ENTRADA_DEL_RECORRIDO));
  return guardada !== undefined && (await cuadraLaEntradaGuardada(guardada, huella));
}

/**
 * Si la política de la entidad tiene abierta la sección de `clave` (o no es de ninguna); undefined si no se puede
 * comprobar.
 *
 * @param {string} clave
 * @returns {Promise<boolean | undefined>}
 */
async function laNecesitaSuSeccion(clave) {
  const politica = await disponibilidadSecciones();
  if (politica.fallo || !politica.documento) {
    return undefined;
  }
  const seccion = seccionDeLaClave(clave);
  return !seccion || politica.documento.secciones[seccion] === true;
}

/**
 * La entrada del recorrido real por red, como la sonda de inicio.html: sin seguir redirecciones, sin la caché HTTP,
 * con la sesión (la temporal del acceso también cuenta) y con plazo (PLAZO_DE_LA_CONSULTA_MS). Quien la usa solo lee
 * el cuerpo si hay que guardarla. Sin red o con el plazo vencido, undefined.
 *
 * @param {string} clave - Dirección de la entrada (ENTRADA_DEL_RECORRIDO).
 * @returns {Promise<Response | undefined>}
 */
async function consultarLaEntrada(clave) {
  try {
    return await fetch(clave, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(PLAZO_DE_LA_CONSULTA_MS),
    });
  } catch {
    return undefined;
  }
}

/**
 * Borra las otras copias de la web y la constancia de una instalación fallida («Instalación que no coincide»), salvo si
 * otra versión se instala o espera (su copia y su constancia son de ella); el paquete tiene otro prefijo.
 */
async function borrarCopiasViejas() {
  const nombres = await caches.keys();
  // El registro puede haber cambiado durante keys(): la instalación nueva ya puede estar escribiendo su copia.
  if (self.registration.installing || self.registration.waiting) {
    return;
  }
  const viejas = nombres.filter(
    (nombre) => nombre === COPIA_DEL_ESTADO || (nombre.startsWith(PREFIJO) && nombre !== COPIA),
  );
  await Promise.all(viejas.map((nombre) => caches.delete(nombre)));
}

/**
 * Al activarse esta versión: borra las copias de las otras (borrarCopiasViejas) y toma el control de las pestañas ya
 * abiertas (clients.claim), para que sirvan de su copia sin esperar a recargar.
 */
async function activarVersion() {
  await borrarCopiasViejas();
  await self.clients.claim();
}

export {
  activarVersion,
  anotarEscrituraEnLaCopia,
  deEstaVersion,
  enTandas,
  escriturasEnLaCopia,
  guardarCopia,
  HuellaQueNoCoincide,
  imprescindiblesDeEstaVersion,
  marcadaPorElAcceso,
  modoDeLaCopia,
  noSirveComoCopia,
  PETICIONES_A_LA_VEZ,
  reponerLaEntradaDelRecorrido,
  respuestaParaLaCopia,
  siEstaProtegido,
};
