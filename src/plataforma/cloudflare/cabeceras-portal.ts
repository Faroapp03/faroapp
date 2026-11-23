import { cabecerasAislamiento, VALOR_HSTS } from '../cabeceras-web.ts';
import { varianteDeRuta } from './entrada-recorrido.ts';

/**
 * Única excepción a la política de referencia común: la página del acceso a un recorrido pone same-origin para que su
 * envío nativo lleve «Origin» (acceso-recorrido.ts). Solo se conserva ese valor y solo en una ruta de recorrido.
 */
const REFERENCIA_DEL_RECORRIDO = 'same-origin';

function conservaReferencia(peticion: Request, respuesta: Response): boolean {
  if (respuesta.headers.get('referrer-policy') !== REFERENCIA_DEL_RECORRIDO) {
    return false;
  }
  try {
    return varianteDeRuta(new URL(peticion.url).pathname) !== null;
  } catch {
    return false;
  }
}

/**
 * La puerta privada conserva CSP y cookies de cada respuesta, incluidos errores y redirecciones. Es la última capa del
 * Worker oficial: garantiza VALOR_HSTS y el aislamiento en toda respuesta https (página, robots.txt, rechazo,
 * redirección o error), también en las delegadas a la aplicación, que ya traen la misma cabecera de su propia capa.
 * Las páginas propias no las repiten: se ponen aquí una sola vez.
 */
export function protegerRespuestaPortal(peticion: Request, respuesta: Response): Response {
  const salida = new Response(respuesta.body, respuesta);
  const referencia = conservaReferencia(peticion, respuesta);
  for (const [nombre, valor] of Object.entries(cabecerasAislamiento())) {
    if (!(referencia && nombre === 'referrer-policy')) {
      salida.headers.set(nombre, valor);
    }
  }
  salida.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  if (new URL(peticion.url).protocol === 'https:') {
    salida.headers.set('strict-transport-security', VALOR_HSTS);
  }
  return salida;
}
