import { CATALOGO, FIRMAS, VERSION } from './generado.js';
import { rutaFueraDeLaCopia } from './politica.js';
import './portal.js';

const BASE = new URL('./', self.location.href);

/** Una ruta del catálogo solo puede guardar recursos públicos de esta misma raíz. @param {string} archivo */
function admitidoEnLaCopia(archivo) {
  const url = new URL(archivo, BASE);
  return (
    url.origin === BASE.origin &&
    url.pathname.startsWith(BASE.pathname) &&
    !rutaFueraDeLaCopia(url.pathname.slice(BASE.pathname.length))
  );
}

/**
 * Las entradas del CATALOGO de unas clases, en su orden. El constructor aplica la misma política; esta frontera también
 * rechaza un catálogo defectuoso al ejecutarse.
 *
 * @param {readonly string[]} clases
 */
const publicasDe = (clases) =>
  CATALOGO.filter(([archivo, , clase]) => clases.includes(clase) && admitidoEnLaCopia(archivo));
/**
 * Lo que se precarga sin huella propia de lo comprobado: lo que hay que instalar, los adornos y las páginas de las
 * secciones que la política admite en la copia.
 */
const PRECARGA_PUBLICA = publicasDe(['instalar', 'adorno', 'seccion']);
const ARCHIVOS_PUBLICOS = PRECARGA_PUBLICA.map(([archivo]) => archivo);
/** Lo que se guarda la primera vez que se pide, si cuadra con su huella (guardarSiEsDeEstaVersion). */
const DEMANDA_PUBLICA = publicasDe(['demanda']).map(([archivo]) => archivo);
/** @type {(readonly [string, string])[]} */
const COMPROBADOS_PUBLICOS = publicasDe(['comprobado']).map(([archivo, huella]) => [archivo, huella]);
const FIRMAS_PUBLICAS = FIRMAS.filter(([archivo]) => admitidoEnLaCopia(archivo));

/**
 * La página del recorrido real. Detrás de un portal, el servidor puede contestar en su lugar con el acceso a la variante
 * protegida: no cuadra con su huella y la instalación sigue sin ella (COMPLEMENTARIOS). Sin red solo la abre una
 * instalación pública (responderEntradaDelRecorrido).
 */
const ENTRADA_DEL_RECORRIDO = 'recorrido.html';
/**
 * Lo que no puede faltar para que la web funcione: las páginas, los estilos, los scripts y los diccionarios. Se guardan
 * todos o ninguno (una copia a medias serviría una página sin su estilo).
 */
const IMPRESCINDIBLES = [
  ...PRECARGA_PUBLICA.filter(([archivo, , clase]) => clase !== 'adorno' && archivo !== ENTRADA_DEL_RECORRIDO).map(
    ([archivo]) => archivo,
  ),
  ...COMPROBADOS_PUBLICOS.map(([archivo]) => archivo),
  ...FIRMAS_PUBLICAS.map(([archivo]) => archivo),
];
/**
 * Los adornos (tipografías, imágenes y los recursos del globo de «Datos globales») se guardan después, uno a uno y
 * tolerante a fallos: sin ellos la web se lee (sin sus recursos, el globo lo dice y deja la lista de países), y lo que
 * falte se pide a la red cuando se use.
 */
const COMPLEMENTARIOS = PRECARGA_PUBLICA.filter(
  ([archivo, , clase]) => clase === 'adorno' || archivo === ENTRADA_DEL_RECORRIDO,
).map(([archivo]) => archivo);

/**
 * El nombre de cada copia lleva su web y su versión: se borran solo las copias viejas de esta web. Con FIRMAS, también
 * la huella de su última entrada (la firma o, sin ella, el manifiesto): una firma nueva (volver a firmar sin cambiar la
 * web) es una copia nueva.
 */
const PREFIJO = `faro:${BASE.href}:`;
/** Las primeras cifras hexadecimales de la huella de la última firma que entran en el nombre de la copia. */
const CIFRAS_DE_LA_FIRMA = 16;
const ULTIMA_FIRMA = FIRMAS_PUBLICAS.at(-1);
const COPIA = `${PREFIJO}${VERSION}${ULTIMA_FIRMA ? `+${ULTIMA_FIRMA[1].slice(0, CIFRAS_DE_LA_FIRMA)}` : ''}`;
/**
 * La dirección absoluta de un archivo de la web.
 *
 * @param {string} archivo - Ruta del archivo desde la base de la web.
 * @returns {string}
 */
const urlDe = (archivo) => new URL(archivo, BASE).href;
/** Lo que se guarda y se sirve primero de la copia. Lo comprobado no está: tiene sus propias reglas. */
const GUARDABLES = new Set([...ARCHIVOS_PUBLICOS, ...DEMANDA_PUBLICA].map(urlDe));
/** La huella de cada archivo comprobado (COMPROBADOS y FIRMAS), por su dirección. */
const HUELLAS = new Map(
  [...COMPROBADOS_PUBLICOS, ...FIRMAS_PUBLICAS].map(([archivo, huella]) => [urlDe(archivo), huella]),
);
/** Cada fotografía a tamaño completo y su versión de 800 px (la de «foto.webp» es «foto-800.webp»). */
const REDUCIDAS = new Map(
  DEMANDA_PUBLICA.filter((archivo) => archivo.endsWith('.webp')).map((foto) => [
    urlDe(foto),
    urlDe(foto.replace(/\.webp$/, '-800.webp')),
  ]),
);
const SIN_CONEXION = urlDe('sin-conexion.html');
/** HTML opcional: solo se incorpora si sus bytes pertenecen a esta misma versión. */
const HUELLAS_DE_PAGINAS = new Map(
  CATALOGO.filter(([, , clase]) => clase === 'seccion').map(([archivo, huella]) => [urlDe(archivo), huella]),
);
/**
 * La huella de esta versión de cada archivo que puede entrar en su copia, por su dirección: lo que se precarga y lo que
 * se guarda al pedirlo, las páginas de las secciones y lo comprobado. Nada entra en la copia sin cuadrar con la suya
 * (deEstaVersion), ni al instalar, ni al reparar, ni al guardarlo cuando se usa.
 */
const HUELLAS_DE_ARCHIVOS_PUBLICOS = new Map(
  publicasDe(['instalar', 'adorno', 'seccion', 'demanda']).map(([archivo, huella]) => [urlDe(archivo), huella]),
);
const HUELLAS_DE_LA_COPIA = new Map([...HUELLAS_DE_ARCHIVOS_PUBLICOS, ...HUELLAS_DE_PAGINAS, ...HUELLAS]);

export {
  BASE,
  COMPLEMENTARIOS,
  COPIA,
  ENTRADA_DEL_RECORRIDO,
  GUARDABLES,
  HUELLAS,
  HUELLAS_DE_LA_COPIA,
  HUELLAS_DE_PAGINAS,
  IMPRESCINDIBLES,
  PREFIJO,
  REDUCIDAS,
  SIN_CONEXION,
  urlDe,
};
