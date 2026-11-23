/**
 * Respuestas del portal por formulario y cookie cuando falta la sesión. No hay esquema HTTP con que pedir esa
 * identificación y un 401 exige un desafío (RFC 9110, 15.5.2): la navegación se lleva a la pantalla de acceso con 303 y
 * lo demás recibe un 403 vacío, con x-faro-portal: privado. Ninguna de las dos se guarda.
 */
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { esNavegacion } from '../navegacion.ts';

/** La pantalla de acceso del portal. */
export const PANTALLA_ACCESO = '/acceso-web';
/** El parámetro de la pantalla con la página a la que se vuelve tras entrar. */
export const PARAMETRO_RETORNO = 'volver';
/** La página a la que se vuelve si la pedida no es una ruta interna válida. */
export const RETORNO_POR_DEFECTO = '/inicio.html';
/** Una dirección interna más larga no la produce Faro: se trata como ajena. */
const MAX_RETORNO = 512;
/** Origen ficticio con que se resuelve el retorno para comprobar que no sale del sitio. */
const ORIGEN_PROPIO = 'https://faro.invalid';
const CONTROL = /\p{Cc}/u;
const SIN_GUARDAR = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;
/**
 * Lo que distingue un rechazo de Faro del de un cortafuegos o un proxy: el service worker solo toma por privada una
 * instalación con un 401 o un 403 que lo lleve (src/service-worker/modo.js, evidenciaDe).
 */
export const DEL_PORTAL_PRIVADO = { 'x-faro-portal': 'privado' } as const;

/** Si una ruta empieza por una sola barra y no lleva barra invertida ni caracteres de control. */
function deUnaSolaBarra(ruta: string): boolean {
  return ruta.startsWith('/') && !ruta.startsWith('//') && !ruta.includes('\\') && !CONTROL.test(ruta);
}

/** La ruta con sus secuencias %XX descodificadas, o null si alguna no es UTF-8 válido. */
function descodificada(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return null;
  }
}

/**
 * La ruta interna a la que se puede volver, o la de inicio. Se juzga la ruta ya analizada, no el texto recibido: al
 * analizarla, `.` y `..` se resuelven y `/.//otro` queda en `//otro`, que el navegador lee como otro origen. El valor
 * debe empezar por una barra, sin barra invertida ni caracteres de control y con 512 caracteres como mucho; analizado
 * contra un origen propio, debe conservar ese origen, y su ruta, tal cual y descodificada, debe empezar por una sola
 * barra, sin barra invertida ni caracteres de control. Tampoco se vuelve a la pantalla de acceso, ni escrita con %XX
 * ni con `.` o `..` que aparezcan al descodificarla: el borde puede normalizar la ruta. Se devuelve la ruta con su
 * consulta, nunca el origen ni el fragmento.
 */
export function retornoValido(valor: string | null): string {
  if (
    valor === null ||
    valor.length > MAX_RETORNO ||
    !valor.startsWith('/') ||
    valor.includes('\\') ||
    CONTROL.test(valor)
  ) {
    return RETORNO_POR_DEFECTO;
  }
  const url = new URL(valor, ORIGEN_PROPIO);
  const legible = descodificada(url.pathname);
  const ruta = `${url.pathname}${url.search}`;
  if (
    url.origin !== ORIGEN_PROPIO ||
    !deUnaSolaBarra(url.pathname) ||
    legible === null ||
    !deUnaSolaBarra(legible) ||
    ruta.length > MAX_RETORNO
  ) {
    return RETORNO_POR_DEFECTO;
  }
  const normalizada = new URL(legible, ORIGEN_PROPIO).pathname;
  return [url.pathname, legible, normalizada].some(esPantallaDeAcceso) ? RETORNO_POR_DEFECTO : ruta;
}

/** Si una ruta es la pantalla de acceso o algo bajo ella. */
function esPantallaDeAcceso(ruta: string): boolean {
  return ruta === PANTALLA_ACCESO || ruta.startsWith(`${PANTALLA_ACCESO}/`);
}

/** 403 vacío del portal: sin sesión, a lo que no es una navegación GET o HEAD no se le entrega ninguna página. */
export function rechazoSinSesion(): Response {
  return new Response(null, { status: ESTADO_HTTP.prohibido, headers: { ...SIN_GUARDAR, ...DEL_PORTAL_PRIVADO } });
}

/** Sin sesión del portal: la navegación GET o HEAD va a la pantalla de acceso con la página pedida; lo demás, 403. */
export function respuestaSinSesion(peticion: Request): Response {
  const lectura = peticion.method === 'GET' || peticion.method === 'HEAD';
  if (!(lectura && esNavegacion(peticion))) {
    return rechazoSinSesion();
  }
  const pedida = new URL(peticion.url);
  const retorno = retornoValido(`${pedida.pathname}${pedida.search}`);
  return new Response(null, {
    status: ESTADO_HTTP.verOtra,
    headers: {
      ...SIN_GUARDAR,
      location: `${PANTALLA_ACCESO}?${new URLSearchParams({ [PARAMETRO_RETORNO]: retorno })}`,
    },
  });
}
