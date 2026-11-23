// Cabeceras de seguridad de la web, iguales en Cloudflare y en el servidor local, y las direcciones propias que
// nombran: la portada a la que los dos redirigen la raíz del sitio, el catálogo de las API, las reglas de preprocesado
// de la navegación y el punto que recibe los avisos técnicos del navegador. Viven con las cabeceras que las citan;
// los módulos que las sirven las importan de aquí. Este archivo no depende de la API.
// La política admite recursos del propio sitio, imágenes data: y el mapa de módulos en línea por su huella.
// La activación de credenciales excluye caché, precarga e informes del navegador para proteger sus secretos. Lo que
// lleva la huella de su contenido en el nombre se guarda un año sin volver a preguntar (conHuellaEnElNombre).

import { SEGUNDOS_POR_DIA } from '../comun/tiempo.ts';
import { HUELLA_DEL_MAPA_DE_MODULOS } from './mapa-de-modulos.ts';
import { CACHE_DEL_PAQUETE } from './paquete-publicado.ts';

/** Días de una semana. */
const DIAS_DE_UNA_SEMANA = 7;
/** Días de un año. */
const DIAS_DE_UN_ANO = 365;
/** Segundos que el navegador recuerda que la web solo se sirve por https: un año. */
const VIGENCIA_DEL_HSTS_S = DIAS_DE_UN_ANO * SEGUNDOS_POR_DIA;

/**
 * Lo que ninguna página puede pedir al navegador: cámara, micrófono, ubicación, pantalla, sensores, dispositivos
 * conectados ni pagos. Faro no usa nada de eso; si un guion lo intentara, el navegador lo niega sin preguntar a la
 * persona. El dictado del teclado y la lectura en voz alta del sistema no pasan por aquí. Cada navegador aplica los
 * nombres que conoce: Chromium, todos los de la lista; WebKit y Firefox, solo una parte (hid, serial, usb, bluetooth,
 * idle-detection, local-fonts, screen-wake-lock o xr-spatial-tracking pueden no conocerlos) y pueden dejar un aviso en
 * la consola por cada uno que ignoran. Ninguno impide cargar la página. browsing-topics no está: en Brave era un error
 * en la consola de cada página.
 */
const PERMISOS_DENEGADOS = [
  'accelerometer',
  'bluetooth',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
] as const;

/** La página a la que redirige la raíz del sitio. */
export const PORTADA = '/inicio.html';

/**
 * El catálogo de las API del sitio (RFC 9727), que sirve plataforma/catalogo-de-apis.ts. Las páginas lo enlazan con
 * rel="api-catalog" (RFC 8288) para que un programa encuentre la API sin conocerla de antemano.
 */
export const RUTA_CATALOGO_DE_APIS = '/.well-known/api-catalog';
/** El enlace al catálogo: en cada página y en el propio catálogo, que lo exige en GET y en HEAD (RFC 9727, 2). */
export const ENLACE_AL_CATALOGO = `<${RUTA_CATALOGO_DE_APIS}>; rel="api-catalog"`;

/**
 * Las reglas de preprocesado de la navegación (Speculation Rules, HTML, 7.6): un archivo de la web que nombra la
 * cabecera Speculation-Rules. Por cabecera y no con un guion en línea, la CSP no cambia: su carga no pasa por ella
 * (HTML, 7.6.5.2). El navegador solo las aplica si llegan con su tipo propio, que la extensión .json no dice.
 */
export const RUTA_REGLAS_DE_ESPECULACION = '/reglas-de-especulacion.json';
/** El tipo que exige el navegador para leer las reglas (HTML, 7.6.3). */
export const TIPO_REGLAS_DE_ESPECULACION = 'application/speculationrules+json';

/**
 * Dónde avisa el navegador de lo que bloquea la CSP (Reporting API) y de lo que no consigue cargar de Faro (Network
 * Error Logging): un punto del propio sitio (plataforma/punto-de-avisos.ts), con un mismo nombre en las cuatro
 * cabeceras que lo citan. avisos-del-navegador.ts reduce los informes a campos técnicos y descarta sus rutas y textos.
 */
export const RUTA_DE_AVISOS = '/avisos-del-navegador';
/** El nombre del punto de avisos en Reporting-Endpoints, en la directiva report-to de la CSP, en Report-To y en NEL. */
export const PUNTO_DE_AVISOS = 'avisos';
/**
 * Segundos que el navegador recuerda a dónde avisar de un fallo de red: una semana, el tiempo entre dos sesiones de
 * quien vuelve a Faro, sin dejar la política guardada meses en su navegador.
 */
export const VIGENCIA_DE_LOS_AVISOS_S: number = DIAS_DE_UNA_SEMANA * SEGUNDOS_POR_DIA;

/**
 * Las políticas de Trusted Types de la web (web/scripts/confianza.js): las únicas que pueden convertir texto en HTML o
 * en la dirección de un guion. Una con otro nombre no se puede crear.
 */
export const POLITICAS_DE_CONFIANZA = ['faro-guiones', 'faro-informe'] as const;

/**
 * Política de seguridad de contenidos (CSP): recursos propios e imágenes data:, con el mapa de módulos en línea
 * admitido por su huella (herramientas/web/integridad.ts). Niega objetos incrustados, etiquetas base y que Faro se
 * cargue dentro de un marco. Con Trusted Types exige las políticas de POLITICAS_DE_CONFIANZA para HTML y guiones.
 * report-to pide avisos de bloqueo al punto propio, que conserva solo los campos técnicos definidos
 * en avisos-del-navegador.ts.
 *
 * @param huellaDelMapa - Las huellas SHA-256 de los mapas de módulos en línea, separadas por espacios.
 * @returns La política de contenidos.
 */
export function politicaDeContenidos(huellaDelMapa: string): string {
  return [
    "default-src 'self'",
    ['script-src', "'self'", huellaDelMapa].filter((parte) => parte !== '').join(' '),
    "frame-src 'none'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "require-trusted-types-for 'script'",
    `trusted-types ${POLITICAS_DE_CONFIANZA.join(' ')}`,
    `report-to ${PUNTO_DE_AVISOS}`,
  ].join('; ');
}

/** La CSP con la huella vigente del mapa de módulos de las páginas. */
export const POLITICA_DE_CONTENIDOS = politicaDeContenidos(HUELLA_DEL_MAPA_DE_MODULOS);

/**
 * Cross-Origin-Embedder-Policy: la página solo carga de otro origen lo que ese origen declara que se puede incrustar
 * (CORP o CORS). Con COOP same-origin, la página queda aislada de otros orígenes (`crossOriginIsolated`): el navegador
 * la protege de los ataques de canal lateral tipo Spectre y le daría SharedArrayBuffer, que hoy no usa ninguna pieza
 * de la web. require-corp mantiene el aislamiento de los recursos propios también en Safari.
 */
const AISLAMIENTO_DE_ORIGEN = 'require-corp';

/**
 * Reporting-Endpoints (Reporting API, W3C, 3.2): el punto al que el navegador manda los avisos del documento, hoy los
 * de la CSP. Un diccionario de campos estructurados (RFC 9651) con una dirección relativa, que el navegador resuelve
 * contra la de la respuesta.
 */
const PUNTOS_DE_AVISO = `${PUNTO_DE_AVISOS}="${RUTA_DE_AVISOS}"`;

/**
 * Network Error Logging (W3C, 4.1): el navegador avisa cuando no consigue cargar algo de Faro (DNS, conexión, TLS,
 * respuestas fallidas) y nunca de lo que carga bien (success_fraction 0), que contaría las visitas. Solo Chromium lo
 * tiene; Firefox y Safari ignoran la cabecera y no cambia nada.
 */
const REGISTRO_DE_ERRORES_DE_RED = JSON.stringify({
  report_to: PUNTO_DE_AVISOS,
  max_age: VIGENCIA_DE_LOS_AVISOS_S,
  success_fraction: 0,
  failure_fraction: 1,
});

/**
 * Report-To: el grupo de puntos de la primera versión de la Reporting API, el único que lee NEL (su report_to nombra un
 * grupo de esta cabecera, no de Reporting-Endpoints). Va solo para eso, con el mismo punto. Chromium admite la
 * dirección relativa a la raíz y la resuelve contra el origen de la respuesta.
 */
const GRUPO_DE_AVISOS = JSON.stringify({
  group: PUNTO_DE_AVISOS,
  max_age: VIGENCIA_DE_LOS_AVISOS_S,
  endpoints: [{ url: RUTA_DE_AVISOS }],
});

/**
 * Cabeceras para una CSP dada; el constructor puede pasar la del mapa de módulos que está preparando.
 *
 * @param politica - La política de contenidos.
 * @returns Las cabeceras de seguridad de toda respuesta de la web.
 */
export function cabecerasAislamiento(): Readonly<Record<string, string>> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': PERMISOS_DENEGADOS.map((permiso) => `${permiso}=()`).join(', '),
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-embedder-policy': AISLAMIENTO_DE_ORIGEN,
    'origin-agent-cluster': '?1',
  };
}

/** La CSP y los informes dependen de la página; el aislamiento es común. */
export function cabecerasWeb(politica: string): Readonly<Record<string, string>> {
  return {
    ...cabecerasAislamiento(),
    'content-security-policy': politica,
    'reporting-endpoints': PUNTOS_DE_AVISO,
    'report-to': GRUPO_DE_AVISOS,
    nel: REGISTRO_DE_ERRORES_DE_RED,
  };
}

/**
 * Cabeceras de seguridad de toda página y archivo de la web: la CSP, sin adivinar tipos, sin enmarcar, sin rastreo de
 * origen, sin cámara ni micrófono, con la ventana aislada de otras webs, sin que otra web pueda incrustar sus archivos
 * y sin incrustar nada de otra web que no lo permita (aislamiento de origen, AISLAMIENTO_DE_ORIGEN), y a dónde avisar
 * de lo que se bloquea o no carga. Van en toda respuesta porque la CSP, que cita el punto de avisos, también rige los
 * Workers que arranca la web.
 */
export const CABECERAS_WEB = cabecerasWeb(POLITICA_DE_CONTENIDOS);

/**
 * Integrity-Policy: el navegador avisa de todo guion de la página que llegue sin su huella (SRI). Va solo en las
 * páginas: los Workers del motor importan el motor compilado, que no tiene mapa de módulos.
 */
export const POLITICA_DE_INTEGRIDAD = 'blocked-destinations=(script)';

/**
 * La cabecera de integridad de una ruta: solo las páginas .html llevan la regla, y en modo informe. Las huellas se
 * comprueban igual (la de cada etiqueta y las del mapa de módulos), pero no se bloquea un guion por llegar sin huella:
 * - WebKit (Safari) aplica la regla a los módulos importados y no lee las huellas del mapa de módulos, así que con la
 *   regla aplicada no carga ningún módulo que no sea el de la etiqueta: ni el idioma ni «Borrar todo»;
 * - la limpieza del motor compilado (recorrido/minimizar.js) no tiene mapa de módulos.
 * La CSP sigue restringiendo los guiones a los orígenes admitidos y al mapa en línea por su huella, aunque la política
 * de integridad solo informe.
 *
 * @param ruta - La ruta de la página.
 * @returns La cabecera de integridad que le toca, o ninguna.
 */
function cabeceraDeIntegridad(ruta: string): Readonly<Record<string, string>> {
  if (!ruta.endsWith('.html')) {
    return {};
  }
  return { 'integrity-policy-report-only': POLITICA_DE_INTEGRIDAD };
}

/**
 * Las cabeceras que solo lee un documento, en las páginas .html: la de integridad, las reglas de preprocesado de la
 * navegación (una lista de cadenas de campos estructurados, HTML 7.6.3) y el enlace al catálogo de las API.
 *
 * @param ruta - La ruta de la página.
 * @returns Sus cabeceras de documento.
 */
export function cabecerasDePagina(ruta: string): Readonly<Record<string, string>> {
  if (!ruta.endsWith('.html')) {
    return {};
  }
  return {
    ...cabeceraDeIntegridad(ruta),
    'speculation-rules': `"${RUTA_REGLAS_DE_ESPECULACION}"`,
    link: ENLACE_AL_CATALOGO,
  };
}

/**
 * Las carpetas públicas donde la construcción deja guiones con la huella de su contenido en el nombre: la zona de las
 * páginas públicas del paquete (herramientas/web/empaquetado/zonas.ts) y los trozos del motor (motor/trozos/). No
 * entran las zonas de las extensiones (<carpeta>/js/ y <carpeta>-js/), que sirven tras su autoridad de recorrido o
 * de su panel, ni la del panel privado: una caché compartida no debe guardar lo que pide una autoridad.
 */
export const CARPETAS_PUBLICAS_CON_HUELLA: readonly string[] = Object.freeze(['js/', 'motor/trozos/']);

/**
 * El nombre con huella que emite la construcción (empaquetado/construccion.ts): las entradas de página,
 * `pagina-<nombre>-<16 cifras hexadecimales>.js` (o `paginas-<nombre>-…` cuando varias páginas comparten la misma
 * entrada), y los trozos de esbuild, `<nombre>-<8 letras de su huella>.js`. Los
 * guiones estables de la zona (`scripts-recorrido-paso-informe.js`) no la llevan y no entran.
 */
const NOMBRE_CON_HUELLA = /^[a-z0-9-]+-(?:[0-9a-f]{16}|[A-Z2-7]{8})\.js$/;

/** Un guion con la huella de su contenido en el nombre, en una carpeta pública: otro contenido, otro nombre. */
function conHuellaEnElNombre(ruta: string): boolean {
  const carpeta = CARPETAS_PUBLICAS_CON_HUELLA.find((publica) => ruta.startsWith(`/${publica}`));
  return carpeta !== undefined && NOMBRE_CON_HUELLA.test(ruta.slice(carpeta.length + 1));
}

/** Las cabeceras de una web cuyas páginas llevan unos mapas de módulos concretos, calculadas una vez. */
export interface CabecerasDeLaWeb {
  /** Las de toda respuesta, con la CSP de esos mapas. */
  readonly web: Readonly<Record<string, string>>;
  /** Las de cada ruta de esa web (cabecerasParaRuta). */
  readonly paraRuta: (ruta: string) => Readonly<Record<string, string>>;
}

/**
 * Las cabeceras de la web cuyas páginas llevan los mapas de estas huellas: la publicada (las de mapa-de-modulos.ts, que
 * la construcción del Worker sustituye por las de la web construida) o la que sirva el servidor local.
 *
 * @param huellaDelMapa - Las huellas CSP de los mapas de módulos de sus páginas.
 * @returns Las cabeceras de toda respuesta y las de cada ruta.
 */
export function cabecerasDeLaWeb(huellaDelMapa: string): CabecerasDeLaWeb {
  const politica = politicaDeContenidos(huellaDelMapa);
  const web = huellaDelMapa === HUELLA_DEL_MAPA_DE_MODULOS ? CABECERAS_WEB : cabecerasWeb(politica);
  // Lo que lleva cada página .html y lo que lleva un guion con la huella de su contenido en el nombre (inmutable).
  const deLaPagina: Readonly<Record<string, string>> = { ...web, ...cabecerasDePagina('.html') };
  const conHuella: Readonly<Record<string, string>> = { ...web, 'cache-control': CACHE_DEL_PAQUETE };
  return { web, paraRuta: (ruta) => cabecerasDeRuta(ruta, { politica, web, deLaPagina, conHuella }) };
}

/**
 * Las cabeceras de una ruta de la web. Las páginas de credenciales no se precargan ni se guardan en caché; lo que lleva
 * la huella de su contenido en el nombre se guarda sin volver a preguntar; el resto deja la caché al alojamiento.
 */
function cabecerasDeRuta(
  ruta: string,
  de: {
    readonly politica: string;
    readonly web: Readonly<Record<string, string>>;
    readonly deLaPagina: Readonly<Record<string, string>>;
    readonly conHuella: Readonly<Record<string, string>>;
  },
): Readonly<Record<string, string>> {
  const { politica, web, deLaPagina, conHuella } = de;
  if (conHuellaEnElNombre(ruta)) {
    return conHuella;
  }
  const cabeceras = ruta.endsWith('.html') ? deLaPagina : web;
  if (ruta !== '/activar-acceso.html') {
    return cabeceras;
  }
  const privadas: Record<string, string> = { ...cabeceras, 'cache-control': 'no-store', pragma: 'no-cache' };
  for (const nombre of [
    'speculation-rules',
    'reporting-endpoints',
    'report-to',
    'nel',
    'integrity-policy-report-only',
  ]) {
    delete privadas[nombre];
  }
  privadas['content-security-policy'] = politica.replace(`; report-to ${PUNTO_DE_AVISOS}`, '');
  return privadas;
}

/** Las de la web publicada: las huellas de mapa-de-modulos.ts. */
const DE_LA_WEB_PUBLICADA = cabecerasDeLaWeb(HUELLA_DEL_MAPA_DE_MODULOS);

/**
 * Las cabeceras de una ruta de la web publicada; para otra web, `cabecerasDeLaWeb(huella).paraRuta`.
 *
 * @param ruta - La ruta pedida.
 * @returns Sus cabeceras.
 */
export function cabecerasParaRuta(ruta: string): Readonly<Record<string, string>> {
  return DE_LA_WEB_PUBLICADA.paraRuta(ruta);
}

/**
 * El tipo de contenido de una ruta de la web cuando su extensión no lo dice: solo las reglas de preprocesado, que el
 * navegador ignora como application/json. Para las demás, null: vale el de su extensión.
 *
 * @param ruta - La ruta del archivo.
 * @returns Su tipo de contenido, o null.
 */
export function tipoPropioDe(ruta: string): string | null {
  return ruta === RUTA_REGLAS_DE_ESPECULACION ? TIPO_REGLAS_DE_ESPECULACION : null;
}

/**
 * HSTS: el navegador no vuelve a entrar por http durante un año. Solo en el Worker, que se sirve siempre por https (en
 * local, por http, el navegador la ignora). Sin includeSubDomains ni lista de precarga: cada host que la sirve fija
 * su propia vigencia, que no desaparece del navegador por dejar de enviar la cabecera.
 */
export const VALOR_HSTS = `max-age=${VIGENCIA_DEL_HSTS_S}`;

/**
 * CSP de las respuestas JSON de la API (y de MCP), en el Worker y en el servidor local: no cargan nada ni se dejan
 * enmarcar.
 */
export const POLITICA_DE_LA_API = "default-src 'none'; frame-ancestors 'none'";

/**
 * Añade las cabeceras de seguridad a una respuesta del Worker (archivos estáticos y redirecciones), con HSTS y, si es
 * una página (`ruta`), con las de las páginas.
 *
 * @param respuesta - La respuesta del Worker.
 * @param ruta - La ruta, si es una página; vacía si no.
 * @returns Una respuesta nueva con el mismo cuerpo, estado y texto de estado, y las cabeceras añadidas.
 */
export function conCabecerasWeb(respuesta: Response, ruta = ''): Response {
  const cabeceras = new Headers(respuesta.headers);
  if (ruta === '/activar-acceso.html') {
    for (const nombre of [
      'speculation-rules',
      'reporting-endpoints',
      'report-to',
      'nel',
      'integrity-policy-report-only',
    ]) {
      cabeceras.delete(nombre);
    }
  }
  for (const [nombre, valor] of Object.entries(cabecerasParaRuta(ruta))) {
    cabeceras.set(nombre, valor);
  }
  cabeceras.set('strict-transport-security', VALOR_HSTS);
  return new Response(respuesta.body, {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: cabeceras,
  });
}
