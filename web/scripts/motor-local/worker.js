// El motor de Faro en un Worker dedicado. La página le manda cada petición a la
// API como datos (cliente.js) y él la responde con el mismo motor que el servidor
// (src/plataforma/navegador/motor.ts): mismas rutas, mismos errores, mismo informe.
// Un Worker dedicado y no el service worker: el service worker se detiene a los pocos segundos sin actividad, y con él
// se irían los datos del paquete ya cargados; un Worker dedicado vive lo que la página.
// El motor (lo que publica la construcción de la web, con su huella en el CATALOGO del service worker, clase
// comprobado) se carga con import() y el paquete con fetch, y las dos cosas las sirve solo el service worker, desde sus
// copias comprobadas (src/service-worker/comprobado.js). Por eso, antes de nada, el Worker pide la sonda del service
// worker (SONDA), que solo él responde: si no llega, el motor no se carga. Si la web lleva la raíz de las firmas
// (firmas/claves-raiz.js), comprueba además el manifiesto firmado
// (firmas/manifiesto-firmado.js) contra cada archivo del motor antes del import() y contra cada lectura del paquete,
// que además vuelve a comprobar el motor (src/plataforma/navegador/paquete.ts). Sin raíz no se exige firma; la
// huella del service worker, siempre.
// Si algo falta o no cuadra, no se usa nada y la página lo cuenta como un fallo del motor del dispositivo; el motivo va
// a la consola. Sin raíz se comprueban huellas, sin acreditar la identidad de quien publica.
// Un fallo de la carga puede ser de paso (el motor aún no se ha bajado, no hay red) o no: si el service worker ha
// rechazado alguno de sus archivos porque no es el de esta versión, lo cuenta la sonda (`noCoincide`), y la respuesta
// a la página lo dice (`noCoincide: true`) para que no siga esperando. Sin service worker que responda la sonda, el
// fallo es de paso. Que la instalación del service worker haya fallado porque uno de esos archivos no es el de esta
// versión no se mira aquí: sin service worker activo, la página no llega a pedir nada a este Worker
// (motor-local/cliente.js espera antes la copia del paquete), y lo cuenta ella (scripts/instalacion.js y
// recorrido/motor.js).
// La página pregunta en cuanto el service worker ha guardado lo que necesita el primer análisis, y dice en cada
// petición si la copia ya está completa (`completo`). El motor arranca con esas partes; una petición que necesita el
// resto del paquete con la copia aún a medias no se calcula: se contesta `faltaElResto` y la página la repite cuando la
// copia está completa. Con la copia completa, el motor carga el resto después de responder, sin que nadie espere.
// Si el almacenamiento no contesta o falla al abrir la base, leer o guardar la clave de firma (secreto-firma.js,
// AlmacenSinRespuesta y AlmacenConFallo), el motor no arranca con otra clave: la respuesta lo dice (`sinClave: true`) y
// la página no lo cuenta como un fallo de la copia.

import { urlDeGuion } from '../confianza.js';
import { CLAVES_RAIZ } from '../firmas/claves-raiz.js';
import { cuadraConElManifiesto } from '../firmas/manifiesto-firmado.js';
import { comprobarManifiestoNativo } from '../firmas/nativa.js';
import { inicioDelTramo, MEDIDAS, medirTramo } from '../marcas-de-tiempo.js';
import { AlmacenConFallo, AlmacenSinRespuesta, secretoDeFirma } from './secreto-firma.js';

/**
 * El motor, desde la raíz de la web (este archivo está en scripts/motor-local/). Es una dirección fija, no calculada
 * con datos: va en una constante porque el archivo lo produce la construcción de la web y no existe para la
 * comprobación de tipos (sus tipos, en ModuloDelMotor).
 */
const MOTOR = new URL('../../motor/src/plataforma/navegador/motor.js', import.meta.url).href;
/**
 * El trabajador del motor de cursos (src/plataforma/navegador/trabajador-de-cursos.ts), un Worker anidado en este: sus
 * operaciones corren en su propio hilo y la puerta lo termina si una no acaba a tiempo, sin parar el recorrido, que
 * responde este Worker. Se crea desde aquí y no desde la página porque la API que lo usa vive aquí, con los datos.
 */
const TRABAJADOR_DE_CURSOS = new URL('../../motor/src/plataforma/navegador/trabajador-de-cursos.js', import.meta.url);
/** La raíz de la web, de la que cuelgan el manifiesto firmado, el motor y el paquete. */
const RAIZ = new URL('../../', import.meta.url);
/** El manifiesto firmado y su sobre, cuando la publicación incorpora firmas. */
const MANIFIESTO = new URL('firmas/manifiesto.json', RAIZ);
const FIRMA = new URL('firmas/manifiesto.firma.json', RAIZ);
/** La sonda que responde el service worker, y no el servidor: ver la cabecera. */
const SONDA = new URL('motor/copia-comprobada.json', RAIZ);
/**
 * Las fases de la carga que este Worker cuenta a la página (cliente.js), sin identificador de petición, a medida que
 * pasan: «comprobado» (la sonda y las firmas), «motor» (el motor compilado importado), «datos» (el paquete leído y el
 * motor creado) y, de los archivos extra del paquete (src/plataforma/archivos-del-paquete.ts), cuándo se han acabado de
 * leer: «vectores» y «clasificador». Solo se cuenta lo que ha pasado; la página no inventa las que no llegan.
 * @typedef {'comprobado' | 'motor' | 'datos' | 'vectores' | 'clasificador'} FaseDeLaCarga
 * @type {ReadonlyMap<string, FaseDeLaCarga>}
 */
const FASE_DE_CADA_ARCHIVO = new Map([
  ['vectores-movil.json', 'vectores'],
  ['clasificador-movil.json', 'clasificador'],
]);

/**
 * Lo que este Worker usa del motor compilado, con los tipos de su fuente (src/plataforma/navegador/motor.ts).
 * No se importan de ella: arrastrarían todo el motor a la comprobación general de la web, que no es la suya.
 * @typedef {{ responder: (peticion: { url: string, method: string, headers: [string, string][],
 *   body: string | null }) => Promise<Response>, necesitaElResto: (url: string) => boolean,
 *   completar: () => Promise<void> }} MotorLocal
 * @typedef {{ crearMotorLocal: (base: URL, opciones: { secretoFirma?: CryptoKey,
 *   trabajadorDeCursos?: () => Worker }) => Promise<MotorLocal> }} ModuloDelMotor
 */
/**
 * @typedef {{ id: number, paquete: string, completo: boolean, url: string, method: string,
 *   headers: [string, string][], body: string | null }} PeticionAlMotor
 */

/** El motor en marcha; motorDe lo crea y lo olvida si su carga falla. @type {Promise<MotorLocal> | null} */
let motor = null;
/** La carpeta del paquete con que se cargó `motor`; la cambia motorDe. */
let paqueteCargado = '';
/**
 * Los archivos del último manifiesto comprobado; null mientras no hay ninguno. Los cambia protegerLecturasDelPaquete.
 * @type {ReadonlyMap<string, string> | null}
 */
let vigentes = null;

/** Las lecturas del paquete ya pasan por el envoltorio de envolverLecturasDelPaquete. */
let envueltas = false;
/**
 * Las lecturas del paquete del intento de carga en curso: el archivo, el estado con que respondió el service worker
 * (0 si no respondió) y lo que tardó en responder. Si la carga falla, van a la consola con el fallo (motorDe).
 * @type {{ archivo: string, estado: number, ms: number }[]}
 */
let lecturas = [];
/** El estado de una lectura que ha ido bien, y cuántas de las más lentas se cuentan si la carga falla. */
const RESPUESTA_BIEN = 200;
const LECTURAS_LENTAS = 3;
/** Los intentos de carga del motor desde que se creó este Worker. */
let intentos = 0;

/** La carga ha fallado porque alguno de los archivos del motor no es el de esta versión: volver a cargarlo no sirve. */
class MotorQueNoCoincide extends Error {
  /** @override */
  name = 'MotorQueNoCoincide';
}

/** Cuenta a la página una fase de la carga (FaseDeLaCarga). @param {FaseDeLaCarga} fase */
function contarFase(fase) {
  globalThis.postMessage({ fase });
}

/**
 * La misma respuesta, que cuenta `fase` cuando su cuerpo se ha acabado de leer, sin guardarlo aparte.
 * @param {Response} respuesta @param {FaseDeLaCarga} fase @returns {Response}
 */
function conAvisoAlAcabar(respuesta, fase) {
  if (!respuesta.body) {
    return respuesta;
  }
  const cuerpo = respuesta.body.pipeThrough(new TransformStream({ flush: () => contarFase(fase) }));
  return new Response(cuerpo, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: respuesta.headers,
  });
}

/** Los bytes de un archivo de la web; un fallo de red es un fallo. @param {URL | string} url */
async function bytesDe(url) {
  const respuesta = await fetch(url, { cache: 'no-store' });
  if (!respuesta.ok) {
    throw new Error(`${url}: ${respuesta.status}`);
  }
  return new Uint8Array(await respuesta.arrayBuffer());
}

/** La ruta de una dirección desde la raíz de la web, o null si está fuera. @param {string} url */
function rutaEnLaWeb(url) {
  const direccion = new URL(url, RAIZ);
  return direccion.origin === RAIZ.origin && direccion.pathname.startsWith(RAIZ.pathname)
    ? direccion.pathname.slice(RAIZ.pathname.length)
    : null;
}

/**
 * Envuelve el fetch de este Worker, que es de Faro y solo ejecuta el motor, una sola vez: es la única forma de ver lo
 * que lee el motor compilado sin cambiarlo. Con un manifiesto comprobado (protegerLecturasDelPaquete), toda lectura del
 * paquete se compara con él antes de entregarse, con el último. Y cuando se acaba de leer un archivo extra del paquete,
 * se cuenta su fase (FASE_DE_CADA_ARCHIVO). Sin manifiesto, la respuesta se entrega como llega.
 */
function envolverLecturasDelPaquete() {
  if (envueltas) {
    return;
  }
  envueltas = true;
  const leer = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (entrada, opciones) => {
    const ruta = rutaEnLaWeb(entrada instanceof Request ? entrada.url : String(entrada));
    if (!ruta?.startsWith('paquete/')) {
      return leer(entrada, opciones);
    }
    const inicio = performance.now();
    const archivo = ruta.split('/').at(-1) ?? ruta;
    try {
      const respuesta = await leer(entrada, opciones);
      lecturas.push({ archivo, estado: respuesta.status, ms: Math.round(performance.now() - inicio) });
      return respuesta.ok ? lecturaDelPaquete(ruta, respuesta) : respuesta;
    } catch (error) {
      lecturas.push({ archivo, estado: 0, ms: Math.round(performance.now() - inicio) });
      throw error;
    }
  };
}

/**
 * Una lectura del paquete tal como la recibe el motor: comparada con el último manifiesto comprobado, si lo hay, y
 * con su fase contada al acabar de leerse, si es un archivo extra (envolverLecturasDelPaquete).
 * @param {string} ruta @param {Response} respuesta @returns {Promise<Response>}
 */
async function lecturaDelPaquete(ruta, respuesta) {
  const fase = FASE_DE_CADA_ARCHIVO.get(ruta.split('/').at(-1) ?? '');
  if (vigentes === null) {
    return fase ? conAvisoAlAcabar(respuesta, fase) : respuesta;
  }
  const inicio = inicioDelTramo();
  const bytes = new Uint8Array(await respuesta.arrayBuffer());
  cuadraConElManifiesto(vigentes, ruta, bytes);
  medirTramo(MEDIDAS.comprobarLectura, inicio, { archivo: ruta.split('/').at(-1) ?? ruta });
  if (fase) {
    contarFase(fase);
  }
  return new Response(bytes, { status: respuesta.status, headers: respuesta.headers });
}

/**
 * Desde ahora, toda lectura del paquete que haga el motor se compara con el manifiesto antes de entregarse, siempre
 * con el último manifiesto comprobado (envolverLecturasDelPaquete). @param {ReadonlyMap<string, string>} archivos
 */
function protegerLecturasDelPaquete(archivos) {
  vigentes = archivos;
  envolverLecturasDelPaquete();
}

/**
 * Comprueba la firma de lo que va a usar el motor con el paquete de `paquete`: el manifiesto firmado, y con él cada
 * archivo del motor compilado. Las firmas las comprueba la criptografía nativa del navegador si la trae, y noble si
 * no (firmas/nativa.js). Sin raíz en la web no hay nada contra qué comprobar y basta la huella del service worker.
 * Lanza si algo no cuadra. @param {string} paquete
 */
async function comprobarLoQueSeUsa(paquete) {
  if (!CLAVES_RAIZ.length) {
    return;
  }
  const version = new URL(paquete).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const [bytes, firma] = await Promise.all([bytesDe(MANIFIESTO), bytesDe(FIRMA)]);
  /** @type {unknown} */
  const firmaLeida = JSON.parse(new TextDecoder().decode(firma));
  const archivos = await comprobarManifiestoNativo(bytes, firmaLeida, { paquete: version });
  const delMotor = [...archivos.keys()].filter((ruta) => ruta.startsWith('motor/'));
  await Promise.all(
    delMotor.map(async (ruta) => cuadraConElManifiesto(archivos, ruta, await bytesDe(new URL(ruta, RAIZ)))),
  );
  protegerLecturasDelPaquete(archivos);
}

/**
 * Comprueba que las peticiones de este Worker pasan por el service worker, que solo las sirve de sus copias
 * comprobadas: la sonda no existe en el servidor. Lanza si no es así.
 */
async function comprobarCopiaComprobada() {
  /** @param {unknown} [causa] */
  const noEstaListo = (causa) =>
    new Error('El motor del dispositivo no está listo: no hay service worker que sirva la copia comprobada', {
      cause: causa,
    });
  try {
    const respuesta = await fetch(SONDA, { cache: 'no-store' });
    /** @type {unknown} */
    const sonda = respuesta.ok ? await respuesta.json() : null;
    if (typeof sonda === 'object' && sonda !== null && 'version' in sonda && typeof sonda.version === 'string') {
      return;
    }
  } catch (error) {
    throw noEstaListo(error);
  }
  throw noEstaListo();
}

/**
 * Si el service worker se ha negado a servir algún archivo comprobado porque no es el de esta versión: lo cuenta la
 * sonda. Un import() que falla no dice con qué estado; la sonda, sí. Si no contesta, no se sabe y no se da por hecho.
 * @returns {Promise<boolean>}
 */
async function algoNoCoincide() {
  try {
    const respuesta = await fetch(SONDA, { cache: 'no-store' });
    /** @type {unknown} */
    const sonda = respuesta.ok ? await respuesta.json() : null;
    return typeof sonda === 'object' && sonda !== null && 'noCoincide' in sonda && sonda.noCoincide === true;
  } catch {
    return false;
  }
}

/**
 * Carga el motor con el paquete de `paquete` y el secreto de firma del dispositivo.
 * @param {string} paquete @returns {Promise<MotorLocal>}
 */
async function cargar(paquete) {
  const inicio = inicioDelTramo();
  await comprobarCopiaComprobada();
  medirTramo(MEDIDAS.sonda, inicio);
  try {
    return await cargarComprobado(paquete);
  } catch (error) {
    throw (await algoNoCoincide())
      ? new MotorQueNoCoincide('El motor del dispositivo no es el de esta versión', { cause: error })
      : error;
  }
}

/**
 * La carga, una vez se sabe que hay service worker que sirva la copia comprobada (cargar). Si falla, cargar pregunta
 * a la sonda si ha sido porque algún archivo no es el de esta versión.
 * @param {string} paquete @returns {Promise<MotorLocal>}
 */
async function cargarComprobado(paquete) {
  const inicioDeLasFirmas = inicioDelTramo();
  await comprobarLoQueSeUsa(paquete);
  medirTramo(MEDIDAS.firmas, inicioDeLasFirmas);
  envolverLecturasDelPaquete();
  contarFase('comprobado');
  const inicioDelImport = inicioDelTramo();
  /** @type {[ModuloDelMotor, CryptoKey | undefined]} */
  const [{ crearMotorLocal }, secretoFirma] = await Promise.all([import(MOTOR), secretoDeFirma()]);
  medirTramo(MEDIDAS.importarMotor, inicioDelImport);
  const trabajadorDeCursos = () => new Worker(urlDeGuion(TRABAJADOR_DE_CURSOS), { type: 'module' });
  contarFase('motor');
  const inicioDelMotor = inicioDelTramo();
  const creado = await crearMotorLocal(new URL(paquete), {
    trabajadorDeCursos,
    ...(secretoFirma === undefined ? {} : { secretoFirma }),
  });
  medirTramo(MEDIDAS.crearMotor, inicioDelMotor);
  contarFase('datos');
  return creado;
}

/**
 * El motor, cargado una sola vez por versión del paquete. Si la carga falla (el paquete aún no está entero sin
 * conexión), se olvida: la petición siguiente lo vuelve a intentar. Solo se olvida esa carga: si mientras tanto ya
 * se carga otra versión, el fallo de la anterior no la descarta.
 * @param {string} paquete @returns {Promise<MotorLocal>}
 */
function motorDe(paquete) {
  if (!motor || paquete !== paqueteCargado) {
    paqueteCargado = paquete;
    intentos += 1;
    lecturas = [];
    const inicio = performance.now();
    /** @type {Promise<MotorLocal>} */
    const esta = cargar(paquete).catch((error) => {
      if (motor === esta) {
        motor = null;
      }
      const fallidas = lecturas.filter(({ estado }) => estado !== RESPUESTA_BIEN);
      const lentas = [...lecturas].sort((a, b) => b.ms - a.ms).slice(0, LECTURAS_LENTAS);
      console.warn(
        `Faro: el intento ${intentos} de cargar el motor ha fallado a los ${Math.round(performance.now() - inicio)} ms.`,
        { lecturas: lecturas.length, fallidas, lentas },
      );
      throw error;
    });
    motor = esta;
  }
  return motor;
}

/**
 * Lo que se contesta a la página cuando la petición `id` no se ha podido responder por `error`.
 * @param {number} id @param {unknown} error
 */
function falloParaLaPagina(id, error) {
  if (error instanceof MotorQueNoCoincide) {
    return { id, fallo: true, noCoincide: true };
  }
  const sinClave = error instanceof AlmacenSinRespuesta || error instanceof AlmacenConFallo;
  return sinClave ? { id, fallo: true, sinClave: true } : { id, fallo: true };
}

/**
 * Responde una petición de la página con su identificador: la respuesta del motor, o el fallo que no le dejó darla.
 * @param {PeticionAlMotor} peticion
 */
async function responder({ id, paquete, completo, url, method, headers, body }) {
  try {
    const creado = await motorDe(paquete);
    if (!completo && creado.necesitaElResto(url)) {
      globalThis.postMessage({ id, faltaElResto: true });
      return;
    }
    const { responder: api } = creado;
    const inicioDelCalculo = inicioDelTramo();
    const respuesta = await api({ url, method, headers, body });
    // El motor ya ha leído la dirección: aquí es válida.
    const ruta = new URL(url).pathname;
    medirTramo(MEDIDAS.calculo, inicioDelCalculo, { ruta });
    const inicioDeLaEntrega = inicioDelTramo();
    const texto = await respuesta.text();
    globalThis.postMessage({ id, status: respuesta.status, headers: [...respuesta.headers], body: texto });
    medirTramo(MEDIDAS.entrega, inicioDeLaEntrega, { ruta });
    if (completo) {
      completarEnSegundoPlano(creado);
    }
  } catch (error) {
    console.warn('Faro: el motor del dispositivo no ha podido responder.', error);
    globalThis.postMessage(falloParaLaPagina(id, error));
  }
}

/**
 * Carga el resto del paquete con la copia completa, después de responder: la próxima petición que lo necesite no lo
 * espera. Si falla, lo dice la consola y esa petición lo vuelve a intentar (y falla como un fallo del motor si sigue
 * sin poder).
 * @param {MotorLocal} creado
 */
function completarEnSegundoPlano(creado) {
  creado.completar().catch((error) => {
    console.warn('Faro: el resto del paquete no se ha podido cargar; se intentará otra vez cuando haga falta.', error);
  });
}

// La promesa de responder no rechaza nunca (cada fallo se contesta a la página como `fallo`, cliente.js): el navegador
// no la espera, y se devuelve para que las pruebas puedan esperar la respuesta.
globalThis.addEventListener('message', (/** @type {MessageEvent<PeticionAlMotor>} */ evento) => responder(evento.data));
