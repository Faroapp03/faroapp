/** Catálogo y contrato públicos de disponibilidad, compartidos por servidor, página y copia sin conexión. */
// Las extensiones instaladas se leen del registro; las copias publicadas lo sustituyen por una copia de sus datos.
import { EXTENSIONES } from '../plataforma/extensiones.ts';

/** @typedef {'entender-ia'|'que-es-faro'|'como-funciona'|'recorrido'|'guias'|'biblioteca'|'datos-globales'|'doctor'|'cursos'|'encuesta'} IdSeccionPublica */
/** @typedef {Readonly<Record<IdSeccionPublica, boolean>>} PoliticaSecciones */
/** @typedef {{ readonly version: 3, readonly revision: number, readonly secciones: PoliticaSecciones }} DocumentoSecciones */
/** @typedef {{readonly id: IdSeccionPublica, readonly nombre: string, readonly rutas: readonly string[]}} SeccionWeb */
/**
 * Las secciones de la aplicación real; la primera ruta de cada una es su página de entrada.
 * @type {readonly SeccionWeb[]}
 */
const SECCIONES_PROPIAS = [
  { id: 'entender-ia', nombre: 'Qué es IA', rutas: ['/entender-ia.html'] },
  { id: 'que-es-faro', nombre: 'Faro', rutas: ['/que-es-faro.html'] },
  // «Cómo funciona» es una etapa de que-es-faro.html, y «Guías», los segmentos de biblioteca.html: las gobiernan
  // los interruptores de Faro y de Biblioteca, y sus direcciones antiguas son páginas de traslado siempre disponibles.
  // Las dos claves se conservan, sin páginas ni interruptor en el panel, porque el contrato v1 conservado exige sus ocho claves exactas. El contrato v2 añade Cursos;
  // el lector adapta el legado sin modificarlo ni conceder ese permiso. El panel preserva los valores consultados.
  // El contrato v3 añade la Encuesta, que ya era pública: leer un documento anterior la mantiene visible.
  { id: 'como-funciona', nombre: 'Cómo funciona', rutas: [] },
  { id: 'recorrido', nombre: 'Empezar', rutas: ['/recorrido.html', '/informe-ejemplo.html'] },
  { id: 'guias', nombre: 'Guías', rutas: [] },
  { id: 'cursos', nombre: 'Cursos', rutas: ['/cursos.html'] },
  { id: 'biblioteca', nombre: 'Biblioteca', rutas: ['/biblioteca.html'] },
  {
    id: 'datos-globales',
    nombre: 'Datos globales',
    rutas: ['/datos-globales.html', '/datos-globales-ue.html', '/datos-globales-mundo.html'],
  },
  { id: 'doctor', nombre: 'Comprobar', rutas: ['/doctor.html'] },
  // La invitación llega a inicio.html y solo guarda el código en la pestaña: la página de la encuesta es su única ruta.
  { id: 'encuesta', nombre: 'Encuesta', rutas: ['/encuesta.html'] },
];

/**
 * Cada sección con las rutas que le suman las extensiones instaladas, tras su página de entrada.
 * @type {readonly SeccionWeb[]}
 */
export const SECCIONES_WEB = Object.freeze(
  SECCIONES_PROPIAS.map(({ id, nombre, rutas }) => {
    const deExtensiones = EXTENSIONES.flatMap(({ rutasDeSeccion }) => rutasDeSeccion[id] ?? []);
    return Object.freeze({
      id,
      nombre,
      rutas: Object.freeze([...rutas.slice(0, 1), ...deExtensiones, ...rutas.slice(1)]),
    });
  }),
);

/** La versión vigente del contrato de secciones: la primera con la Encuesta. */
const VERSION_SECCIONES = 3;
/**
 * La versión vigente del documento público de secciones (`/secciones-v3.json`): el contrato con la identidad de su
 * autoridad. La emite el servidor y la exige la copia sin conexión para instalarse.
 */
export const VERSION_SECCIONES_PUBLICAS = /** @type {const} */ (4);

/** @returns {never} */
function seccionesInvalidas() {
  throw new Error('Disponibilidad de secciones no válida');
}

/** Copia únicamente propiedades propias de datos; no ejecuta accesores de una entrada desconocida.
 * @param {unknown} entrada
 * @param {readonly string[]} claves
 * @returns {Record<string, unknown>}
 */
function objetoSecciones(entrada, claves) {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    seccionesInvalidas();
  }
  const prototipo = Object.getPrototypeOf(entrada);
  if (
    (prototipo !== Object.prototype && prototipo !== null) ||
    Object.getOwnPropertySymbols(entrada).length ||
    Object.getOwnPropertyNames(entrada).length !== claves.length
  ) {
    seccionesInvalidas();
  }
  /** @type {Record<string, unknown>} */
  const copia = {};
  for (const clave of claves) {
    const descriptor = Object.getOwnPropertyDescriptor(entrada, clave);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
      seccionesInvalidas();
    }
    copia[clave] = descriptor.value;
  }
  return copia;
}

/** Las instalaciones nuevas publican Cursos; las políticas guardadas conservan sus permisos.
 * @returns {PoliticaSecciones}
 */
export function politicaSeccionesInicial() {
  return {
    'entender-ia': true,
    'que-es-faro': true,
    'como-funciona': true,
    recorrido: true,
    guias: true,
    cursos: true,
    biblioteca: true,
    'datos-globales': true,
    doctor: true,
    encuesta: true,
  };
}

/** Exige todos los identificadores conocidos, sin completar una política parcial.
 * @param {unknown} entrada
 * @returns {PoliticaSecciones}
 */
export function leerPoliticaSecciones(entrada) {
  const objeto = objetoSecciones(
    entrada,
    SECCIONES_WEB.map(({ id }) => id),
  );
  /** @type {Record<IdSeccionPublica, boolean>} */
  const politica = { ...politicaSeccionesInicial() };
  for (const { id } of SECCIONES_WEB) {
    const valor = objeto[id];
    if (typeof valor !== 'boolean') {
      seccionesInvalidas();
    }
    politica[id] = valor;
  }
  return Object.freeze(politica);
}

/** @param {unknown} entrada @returns {DocumentoSecciones} */
export function leerDocumentoSecciones(entrada) {
  const objeto = objetoSecciones(entrada, ['version', 'revision', 'secciones']);
  if (
    (objeto.version !== 1 && objeto.version !== 2 && objeto.version !== VERSION_SECCIONES) ||
    typeof objeto.revision !== 'number' ||
    !Number.isSafeInteger(objeto.revision) ||
    objeto.revision < 0
  ) {
    seccionesInvalidas();
  }
  return Object.freeze({
    version: VERSION_SECCIONES,
    revision: objeto.revision,
    secciones: leerPoliticaSecciones(seccionesDeLaVersion(objeto.version, objeto.secciones)),
  });
}

/** La política de un documento con las claves exactas de su versión, llevada a las de la vigente.
 * @param {1 | 2 | 3} version
 * @param {unknown} secciones
 * @returns {unknown}
 */
function seccionesDeLaVersion(version, secciones) {
  if (version === VERSION_SECCIONES) {
    return secciones;
  }
  const nuevas = version === 1 ? ['cursos', 'encuesta'] : ['encuesta'];
  const anterior = objetoSecciones(
    secciones,
    SECCIONES_WEB.filter(({ id }) => !nuevas.includes(id)).map(({ id }) => id),
  );
  // El contrato v1 tiene ocho permisos y leerlo nunca concede Cursos. La Encuesta ya se publicaba con los contratos
  // v1 y v2: se conserva visible, como estaba, hasta que el panel la oculte.
  return version === 1 ? { ...anterior, cursos: false, encuesta: true } : { ...anterior, encuesta: true };
}

/**
 * La página de una sección que nombra `camino`, también con un alias que un servidor de archivos podría normalizar
 * (otras mayúsculas, sin «.html», «\\», segmentos vacíos, «.» o «..», o letras codificadas): la misma regla en el
 * servidor y en el service worker (que la lleva dentro de web/service-worker.js). Nunca reescribe la petición ni
 * crea una ruta válida. Recibe un pathname absoluto, sin consulta ni fragmento.
 * @param {string} camino
 * @returns {string | undefined} La ruta de la página («/biblioteca.html»), o undefined si no nombra ninguna.
 */
export function paginaDeLaRuta(camino) {
  let ruta;
  try {
    ruta = decodeURIComponent(camino);
  } catch (error) {
    if (error instanceof URIError) {
      return undefined;
    }
    throw error;
  }
  if (!ruta.startsWith('/')) {
    return undefined;
  }
  /** @type {string[]} */
  const partes = [];
  for (const parte of ruta.replace(/\\/g, '/').split('/')) {
    if (parte === '..') {
      partes.pop();
    } else if (parte && parte !== '.') {
      partes.push(parte);
    }
  }
  const normalizada = `/${partes.join('/')}`.toLowerCase();
  return SECCIONES_WEB.flatMap(({ rutas }) => rutas).find(
    (pagina) => normalizada === pagina || normalizada === pagina.slice(0, -'.html'.length),
  );
}

/** Reserva alias que un servidor de archivos podría normalizar (paginaDeLaRuta): la sección de la página que nombran.
 * Recibe un pathname absoluto, sin consulta ni fragmento. Los recursos compartidos y páginas esenciales no son secciones.
 * @param {string} camino
 * @returns {IdSeccionPublica | undefined}
 */
export function seccionDeLaRuta(camino) {
  const pagina = paginaDeLaRuta(camino);
  return pagina === undefined ? undefined : SECCIONES_WEB.find(({ rutas }) => rutas.includes(pagina))?.id;
}
