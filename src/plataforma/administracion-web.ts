/**
 * Archivos privados del panel: la página y sus dos hojas de estilo (la base y la de su estructura), y los módulos que la construcción emite en su zona
 * (administracion/js/, herramientas/web/empaquetado/zonas.ts), cada uno con la huella de su contenido en el nombre.
 * Access antes del lector; ninguna operación SQL.
 */
import { type ConfiguracionAdministrativa, validarOrigenAdministrativo } from '../administracion/configuracion.ts';
import { PLAZO_PANEL_MS } from '../administracion/http.ts';
import { dentroDelPlazo } from '../api/plazo.ts';
import { ESTADO_HTTP } from '../comun/estados-http.ts';
import { cabecerasIdentidadWeb } from '../comun/identidad-web.ts';
import { type GuardiaAdministrativa, SegundoFactorRequerido } from './acceso-administrativo.ts';

/** El mayor archivo del panel que se materializa: los diccionarios construidos del panel rondan los 340 KB. */
export const MAX_RECURSO_ADMINISTRATIVO_BYTES = 524_288;
const ARCHIVOS = new Map([
  ['/administracion', '/administracion/index.html'],
  ['/administracion/', '/administracion/index.html'],
  ['/administracion/panel.css', '/administracion/panel.css'],
  ['/administracion/panel-estructura.css', '/administracion/panel-estructura.css'],
]);
/**
 * Un módulo emitido por la construcción en la zona del panel: un solo nombre, sin «..», «%» ni subcarpetas, con la
 * huella de su contenido (la entrada de página, 16 cifras hexadecimales; los trozos y diccionarios de esbuild, 8
 * mayúsculas o cifras). Un nombre de las fuentes (panel.js) no la lleva: no se admite.
 */
const MODULO_DEL_PANEL = /^\/administracion\/js\/[a-z][a-z0-9-]*-(?:[0-9a-f]{16}|[A-Z0-9]{8})\.js$/;
export const POLITICA_WEB_ADMINISTRATIVA = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'report-sample'",
  "img-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'none'",
].join('; ');
const CABECERAS = {
  'cache-control': 'no-store',
  'content-security-policy': POLITICA_WEB_ADMINISTRATIVA,
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};
export type LectorRecursoAdministrativo = (ruta: string, peticion: Request) => Promise<Response>;
export type ResponderRecursoAdministrativo = (
  peticion: Request,
  leer: LectorRecursoAdministrativo,
) => Promise<Response>;
function salida(estado: number, tipo?: string, cuerpo: ConstructorParameters<typeof Response>[0] = null): Response {
  return new Response(cuerpo, { status: estado, headers: { ...CABECERAS, ...(tipo ? { 'content-type': tipo } : {}) } });
}
function tipoDe(ruta: string): string {
  if (ruta.endsWith('.html')) {
    return 'text/html';
  }
  return ruta.endsWith('.css') ? 'text/css' : 'text/javascript';
}
function tipoCorrecto(respuesta: Response, tipo: string): boolean {
  const recibido = respuesta.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return recibido === tipo || (tipo === 'text/javascript' && recibido === 'application/javascript');
}
function rutaPermitida(peticion: Request, origen: string): string | undefined {
  const url = new URL(peticion.url);
  if (url.origin !== origen || url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    return undefined;
  }
  return ARCHIVOS.get(url.pathname) ?? (MODULO_DEL_PANEL.test(url.pathname) ? url.pathname : undefined);
}
/** No exige Origin en navegación directa; si existe, debe coincidir con el origen canónico. */
function mismoOrigen(peticion: Request, origen: string, documento: boolean): boolean {
  const origin = peticion.headers.get('origin');
  const sitio = peticion.headers.get('sec-fetch-site');
  const navegacion =
    documento &&
    peticion.headers.get('sec-fetch-mode') === 'navigate' &&
    peticion.headers.get('sec-fetch-dest') === 'document';
  return (
    (origin === null || origin === origen) &&
    (navegacion || sitio === null || sitio === 'none' || sitio === 'same-origin')
  );
}
/** Materializa solo estos archivos pequeños dentro del plazo, cancelando el lector al retirarse la petición. */
async function cuerpoAcotado(respuesta: Response, senal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!respuesta.body) {
    throw new Error('Recurso administrativo vacío');
  }
  const lector = respuesta.body.getReader();
  const cancelar = () => {
    void lector.cancel().catch(() => undefined);
  };
  senal.addEventListener('abort', cancelar, { once: true });
  let total = 0;
  const partes: Uint8Array[] = [];
  try {
    for (;;) {
      senal.throwIfAborted();
      const { value, done } = await lector.read();
      senal.throwIfAborted();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_RECURSO_ADMINISTRATIVO_BYTES) {
        cancelar();
        throw new Error('Recurso administrativo excesivo');
      }
      partes.push(value);
    }
    const bytes = new Uint8Array(total);
    let posicion = 0;
    for (const parte of partes) {
      bytes.set(parte, posicion);
      posicion += parte.byteLength;
    }
    return bytes;
  } finally {
    senal.removeEventListener('abort', cancelar);
    lector.releaseLock();
  }
}

/**
 * El 503 de un archivo del panel que no se ha podido servir, con su motivo en el registro. Una retirada de la persona
 * no es un fallo del panel: no se registra.
 */
function noDisponible(peticion: Request, error: unknown): Response {
  if (!peticion.signal.aborted) {
    const motivo = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`Un archivo del panel no se ha podido servir: ${motivo}`);
  }
  return salida(ESTADO_HTTP.noDisponible);
}
/**
 * La página para quien supera Access sin el segundo factor que la instalación exige: dice qué ha pasado y qué hacer,
 * con las mismas frases que el panel (web/idiomas/{es,ca}/panel-administradores.js), en las dos lenguas porque aún no
 * se sabe cuál ha elegido la persona. Sin estilos ni scripts: la CSP del panel no admite nada en línea.
 */
const PAGINA_SEGUNDO_FACTOR = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Faro · Panel de Control</title></head>
<body>
<main>
<section lang="es">
<h1>No puedes entrar en el Panel de Control</h1>
<p>Para entrar en el Panel de Control tienes que registrar un segundo factor: una app de códigos, una llave de seguridad o la biometría de tu dispositivo. Sal, vuelve a entrar y sigue los pasos que te muestre Cloudflare.</p>
</section>
<section lang="ca">
<h1>No pots entrar al Tauler de Control</h1>
<p>Per entrar al Tauler de Control has de registrar un segon factor: una app de codis, una clau de seguretat o la biometria del teu dispositiu. Surt, torna a entrar i segueix els passos que et mostri Cloudflare.</p>
</section>
</main>
</body>
</html>
`;
/** Al documento, la página que lo explica; a una hoja o un módulo, solo el 403. */
function segundoFactorRequerido(ruta: string): Response {
  return ruta.endsWith('.html')
    ? salida(ESTADO_HTTP.prohibido, 'text/html; charset=utf-8', PAGINA_SEGUNDO_FACTOR)
    : salida(ESTADO_HTTP.prohibido);
}
/** Sin el segundo factor exigido, la respuesta que lo explica; cualquier otro fallo, el 503 con su motivo registrado. */
function respuestaDeFallo(peticion: Request, ruta: string, error: unknown): Response {
  return error instanceof SegundoFactorRequerido ? segundoFactorRequerido(ruta) : noDisponible(peticion, error);
}
/** El lector recibe una petición nueva sin cookies, JWT, token de sesión ni cabeceras controladas por el cliente. */
export function crearServidorWebAdministrativo(opciones: {
  configuracion: ConfiguracionAdministrativa;
  guardiaAdministrativa: GuardiaAdministrativa;
}): ResponderRecursoAdministrativo {
  const origen = validarOrigenAdministrativo(opciones.configuracion.origen, opciones.configuracion.permitirHttpLocal);
  return async (peticion, leer) => {
    const ruta = rutaPermitida(peticion, origen);
    if (!ruta) {
      return salida(ESTADO_HTTP.noEncontrado);
    }
    if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
      const respuesta = salida(ESTADO_HTTP.metodoNoAdmitido);
      respuesta.headers.set('allow', 'GET, HEAD');
      return respuesta;
    }
    if (!mismoOrigen(peticion, origen, ruta.endsWith('.html'))) {
      return salida(ESTADO_HTTP.prohibido);
    }
    try {
      return await dentroDelPlazo(
        async (senal) => {
          if (!(await opciones.guardiaAdministrativa(new Request(peticion, { signal: senal })))) {
            return salida(ESTADO_HTTP.prohibido);
          }
          senal.throwIfAborted();
          const recurso = new Request(`${origen}${ruta}`, {
            signal: senal,
            redirect: 'manual',
            headers: { ...cabecerasIdentidadWeb() },
          });
          const respuesta = await leer(ruta, recurso);
          const tipo = tipoDe(ruta);
          if (
            senal.aborted ||
            respuesta.status !== ESTADO_HTTP.correcto ||
            respuesta.redirected ||
            !tipoCorrecto(respuesta, tipo)
          ) {
            void respuesta.body?.cancel().catch(() => undefined);
            return salida(ESTADO_HTTP.noEncontrado);
          }
          if (peticion.method === 'HEAD') {
            void respuesta.body?.cancel().catch(() => undefined);
            return salida(ESTADO_HTTP.correcto, `${tipo}; charset=utf-8`);
          }
          return salida(ESTADO_HTTP.correcto, `${tipo}; charset=utf-8`, await cuerpoAcotado(respuesta, senal));
        },
        PLAZO_PANEL_MS,
        peticion.signal,
      );
    } catch (error) {
      return respuestaDeFallo(peticion, ruta, error);
    }
  };
}
