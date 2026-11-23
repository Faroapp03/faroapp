import { RUTA_ACTIVACION } from '../../administracion/activacion-http.ts';
import { servirCapacidadesPanel } from './capacidades-panel.ts';
// Servidor local de Faro en Node: sirve la web y la API desde el mismo origen, igual que el Worker de Cloudflare: la
// portada redirige a inicio.html, lo que web/.assetsignore deja fuera no se sirve, el catálogo de las API y el punto de
// avisos técnicos responden como allí, los archivos de la web y del paquete solo admiten GET y HEAD (otro método, 405
// con Allow, como el servicio de archivos de Cloudflare) y todo lleva las cabeceras de seguridad. Lo que no imita:
// aquí todos los clientes cuentan como una sola red («local», api/contexto-api.ts), y no hay tope de CPU por petición.
// El montaje administrativo optativo añade Access y política durable antes de despachar archivos o capacidades.
// Solo atiende las peticiones dirigidas a sí mismo (Host).
// Nunca registra el contenido de las peticiones.

import { createReadStream, existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { RUTA_INICIO_ACTUALIZACION } from '../../administracion/inicio-actualizacion.ts';
import { RUTA_RESULTADO_ACTUALIZACION } from '../../administracion/resultado-actualizacion.ts';
import { RUTA_A2A, RUTA_TARJETA } from '../../api/a2a/tarjeta.ts';
import { caminoDeLaRuta, problemaSinRuta } from '../../api/api.ts';
import { capturarControles } from '../../api/controles-administrativos.ts';
import { registrarErrorOperativo, SolicitudInvalida } from '../../api/errores.ts';
import {
  CABECERA_PETICION,
  type RespuestaDeError,
  registrarErrorInterno,
  respuestaDeError,
  TIPO_PROBLEMA,
} from '../../api/http.ts';
import { RUTA_MCP } from '../../api/mcp/servidor-mcp.ts';
import { esDescubrimientoOAuth } from '../../api/socios/descubrimiento-oauth.ts';
import { RUTA_ACTIVAR_INVITACION, RUTA_CONSULTAR_INVITACION } from '../../api/socios/metadatos.ts';
import { ESTADO_HTTP } from '../../comun/estados-http.ts';
import { ARCHIVO_EXCLUSIONES_WEB, exclusionesDeArchivos } from '../../comun/exclusiones-de-archivos.ts';
import { crearEntradaNode, RUTA_DE_LA_ENCUESTA } from '../../encuesta/entrada-node.ts';
import {
  type AdministracionMontada,
  esRutaAdministrativa,
  esRutaApiAdministrada,
  esRutaMantenimiento,
} from '../administracion.ts';
import {
  type CabecerasDeLaWeb,
  cabecerasDeLaWeb,
  POLITICA_DE_LA_API,
  PORTADA,
  RUTA_CATALOGO_DE_APIS,
  RUTA_DE_AVISOS,
  tipoPropioDe,
} from '../cabeceras-web.ts';
import { respuestaDelCatalogo } from '../catalogo-de-apis.ts';
import { esDescripcionDeConectividad, respuestaDeDescripcion } from '../descripcion-conectividad.ts';
import { PAGINA_NO_EXISTE } from '../pagina-no-existe.ts';
import { archivoDelPaquetePublicado, CACHE_DEL_PAQUETE } from '../paquete-publicado.ts';
import { crearPuntoDeAvisos } from '../punto-de-avisos.ts';
import { type DatosDeSeguridad, datosDeSeguridad, RUTA_SECURITY_TXT, textoDeSecurityTxt } from '../seguridad-txt.ts';
import { type CarpetaExacta, esArchivoExacto } from './archivo-exacto.ts';
import { type DeLaWeb, enviarArchivo, responderTexto } from './envio-de-archivos.ts';
import { servirSinPortal } from './estado-del-portal.ts';
import { enviarPaginaNoExiste, recibeLaPaginaNoExiste } from './pagina-no-existe.ts';
import { paqueteParaPublicar } from './paquete-publicado.ts';
import { materializarRespuesta } from './respuesta-http.ts';
import { esRutaDeSecciones, respuestaWebSegunSecciones } from './secciones-v3.ts';

/** Tipo de contenido de cada extensión que publica la web. */
const TIPOS: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};
/** Un archivo de la web se puede guardar, pero antes de usarlo hay que preguntar al servidor si sigue valiendo. */
const CACHE_DE_LA_WEB = 'no-cache';
/** Una respuesta de la API no se guarda en ninguna parte. */
const CACHE_DE_UN_PROBLEMA = 'no-store';
/** La dirección con que se leen la ruta y la consulta de una petición en forma de origen («/api/salud?q=1»). */
const BASE_DE_RUTAS = 'http://local';
/**
 * El método que Fetch prohíbe y llega al servidor: `new Request` rechaza CONNECT, TRACE y TRACK («forbidden method»
 * del estándar Fetch), así que la API, que recibe un Request, no los puede ver. De los tres, solo TRACE llega aquí:
 * Node atiende CONNECT aparte (evento «connect») y su analizador de HTTP no conoce TRACK. El servidor lo responde como
 * la API a un método que la ruta no admite.
 */
const METODO_QUE_FETCH_PROHIBE = 'TRACE';

/** El puerto por defecto de HTTP: con él, la cabecera Host puede llegar sin puerto (RFC 9110 §7.2). */
const PUERTO_HTTP = 80;

/** La API que se sirve bajo /api/, la carpeta de la web y dónde escucha el servidor. */
export interface OpcionesServidor {
  api: (peticion: Request) => Promise<Response>;
  /** El mismo plazo del perfil que recibe crearApi; no se mantiene una segunda configuración. */
  plazoMs?: number;
  /** Autoridad persistida y enrutador preparados una vez durante la composición, con el almacén de la encuesta. */
  administracion?: AdministracionMontada;
  /** Almacén privado estable de la instalación sin panel; nunca dentro de web/. */
  archivoAutoridadSecciones?: string;
  /** Carpeta de la web (web/). */
  web: string;
  /**
   * Carpeta del paquete de datos (datos/), que se sirve en /paquete/<huella>/ como en el despliegue
   * (paquete-publicado.ts). Sin ella, esas rutas son de la web, donde el despliegue copia el paquete.
   */
  paquete?: string;
  /** Puerto en que escucha; con 0 (un puerto libre, en las pruebas) se usa el que asigne el sistema. */
  puerto: number;
  /** Anfitrión en que escucha (127.0.0.1): con él y el puerto se forma el origen propio de la API. */
  anfitrion: string;
  /** Contacto configurado para /.well-known/security.txt. Sin él, el documento responde 404. */
  seguridad?: DatosDeSeguridad | null;
  /** Las huellas CSP de los mapas de las páginas de `web`; sin ellas, la CSP no admite ningún guion en línea. */
  huellaMapaModulos?: string;
}

/** Un archivo pedido del paquete en su versión. */
type PedidoDelPaquete = Readonly<{ huella: string; archivo: string }>;

/** Las opciones con las cabeceras de la web que se sirve, calculadas una vez al crear el servidor. */
interface Servido extends OpcionesServidor {
  readonly cabeceras: CabecerasDeLaWeb;
}

/** Lo que web/.assetsignore deja fuera de la web publicada; sin ese archivo, nada. */
function exclusionesDe(web: string): RegExp[] {
  const ruta = join(web, ARCHIVO_EXCLUSIONES_WEB);
  if (!existsSync(ruta)) {
    return [];
  }
  return exclusionesDeArchivos(readFileSync(ruta, 'utf8'));
}

/**
 * La ruta y la consulta de una petición, en forma de origen («/api/salud?q=1») o absoluta («http://otro/api/salud»,
 * que admite HTTP/1.1); null si no se puede leer. La forma absoluta solo aporta su ruta: el anfitrión que trae no
 * cuenta, igual que la cabecera Host.
 */
function destinoDe(req: IncomingMessage): URL | null {
  const destino = req.url ?? '/';
  try {
    return destino.startsWith('/') ? new URL(`${BASE_DE_RUTAS}${destino}`) : new URL(destino);
  } catch {
    return null;
  }
}

/**
 * La ruta pedida sin codificar (%20 → espacio), o null si está mal codificada. decodeURIComponent lanza URIError con
 * secuencias como «%E0%A4%A», y sin capturarlo una sola petición tumbaría el servidor.
 */
function decodificarRuta(ruta: string): string | null {
  try {
    return decodeURIComponent(ruta);
  } catch {
    return null;
  }
}

/** La web que se sirve: su carpeta y lo que su .assetsignore deja fuera. */
interface Web extends CarpetaExacta {
  excluidos: RegExp[];
  cabeceras: CabecerasDeLaWeb;
}

/**
 * Sirve un archivo de la web con sus cabeceras de seguridad; 400 si la ruta está mal codificada; 404 si no se sirve
 * (fuera de la carpeta, excluido, inexistente o no exactamente en esa ruta), con la página que lo explica si es la
 * carga de una página (pagina-no-existe.ts); 405 si el método no es GET ni HEAD; 500 si el disco falla de otro modo.
 */
function servirArchivo(web: Web, ruta: string, res: ServerResponse): void {
  const decodificada = decodificarRuta(ruta);
  if (decodificada === null) {
    responderTexto(res, ESTADO_HTTP.solicitudIncorrecta, 'Petición mal formada', web.cabeceras.web);
    return;
  }
  const relativa = normalize(decodificada).replace(/^[/\\]+/, '');
  const archivo = join(web.carpeta, relativa);
  // Una ruta con «..» podría salir de la carpeta de la web: solo se sirve lo que queda dentro.
  const dentro = archivo.startsWith(web.carpeta.endsWith(sep) ? web.carpeta : web.carpeta + sep);
  const rutaWeb = relativa.split(sep).join('/');
  const excluido = web.excluidos.some((patron) => patron.test(rutaWeb));
  let exacto: boolean;
  try {
    exacto = dentro && !excluido && esArchivoExacto(web, relativa);
  } catch {
    responderTexto(res, ESTADO_HTTP.errorInterno, 'Error interno', web.cabeceras.web);
    return;
  }
  const publicada = `/${rutaWeb}`;
  if (recibeLaPaginaNoExiste(res.req, publicada, exacto)) {
    enviarPaginaNoExiste(web, res);
    return;
  }
  // La página de una dirección que no existe no es una dirección propia: por su nombre, fuera de una navegación, 404.
  if (!exacto || publicada === PAGINA_NO_EXISTE) {
    responderTexto(res, ESTADO_HTTP.noEncontrado, 'No encontrado', web.cabeceras.web);
    return;
  }
  enviarArchivo(
    archivo,
    {
      'cache-control': CACHE_DE_LA_WEB,
      ...(publicada === '/inicio.html' ? { 'x-faro-portal': 'publico' } : {}),
      ...web.cabeceras.paraRuta(publicada),
      'content-type': tipoPropioDe(publicada) ?? TIPOS[extname(archivo)] ?? 'application/octet-stream',
    },
    res,
    web.cabeceras.web,
  );
}

/** Consulta la política antes de abrir el documento y descarta lecturas de peticiones canceladas. */
async function servirWebConSecciones(opciones: Servido, web: Web, destino: URL, { req, res }: Recibida): Promise<void> {
  const cancelacion = new AbortController();
  const retirar = () => cancelacion.abort();
  req.once('aborted', retirar);
  res.once('close', retirar);
  try {
    const respuesta = await respuestaWebSegunSecciones(
      destino.pathname,
      { method: req.method ?? 'GET', signal: cancelacion.signal },
      opciones,
    );
    if (res.destroyed || cancelacion.signal.aborted) {
      return;
    }
    if (!respuesta) {
      servirArchivo(web, destino.pathname, res);
      return;
    }
    res.writeHead(respuesta.status, { ...opciones.cabeceras.web, ...Object.fromEntries(respuesta.headers) });
    res.end(await materializarRespuesta(respuesta, cancelacion.signal));
  } finally {
    req.off('aborted', retirar);
    res.off('close', retirar);
    cancelacion.abort();
  }
}

/** Sirve las secciones con su política y los demás recursos como archivos estáticos. */
function servirWebPublica(opciones: Servido, web: Web, destino: URL, peticion: Recibida): void {
  if (esRutaDeSecciones(destino.pathname)) {
    servirWebConSecciones(opciones, web, destino, peticion).catch((error: unknown) =>
      responderFalloInterno(destino, peticion.req, peticion.res, error),
    );
    return;
  }
  servirArchivo(web, destino.pathname, peticion.res);
}

/**
 * Sirve un archivo del paquete publicado, inmutable, como lo sirve Cloudflare tras herramientas/publicar-paquete.ts:
 * solo de la versión actual (la huella del manifiesto, que se lee en cada petición para seguir a una exportación nueva
 * sin reiniciar) y solo lo que nombra el manifiesto; lo demás, 404. Solo con GET y HEAD; otro método, 405. El nombre
 * ya viene limpio (sin «/» ni «..»).
 */
function servirPaquete(carpeta: string, pedido: PedidoDelPaquete, res: ServerResponse, deLaWeb: DeLaWeb): void {
  const { version, archivos } = paqueteParaPublicar(carpeta);
  if (pedido.huella !== version || !archivos.includes(pedido.archivo)) {
    responderTexto(res, ESTADO_HTTP.noEncontrado, 'No encontrado', deLaWeb);
    return;
  }
  // La misma frontera que los estáticos: un nombre autorizado no permite seguir un enlace fuera del paquete.
  const paquete: CarpetaExacta = { carpeta, carpetaReal: realpathSync.native(carpeta) };
  if (!esArchivoExacto(paquete, pedido.archivo)) {
    responderTexto(res, ESTADO_HTTP.noEncontrado, 'No encontrado', deLaWeb);
    return;
  }
  enviarArchivo(
    join(carpeta, pedido.archivo),
    { ...deLaWeb, 'content-type': TIPOS['.json'], 'cache-control': CACHE_DEL_PAQUETE },
    res,
    deLaWeb,
  );
}

/** Solo rutas de la lista privada llegan aquí, después de Access; sin enlaces ni documentos de sustitución. */
async function leerArchivoAdministrativo(carpeta: string, ruta: string, peticion: Request): Promise<Response> {
  const web: CarpetaExacta = { carpeta, carpetaReal: realpathSync.native(carpeta) };
  const relativa = ruta.slice(1);
  if (!esArchivoExacto(web, relativa)) {
    return new Response(null, { status: ESTADO_HTTP.noEncontrado });
  }
  const cuerpo = Readable.toWeb(
    createReadStream(join(carpeta, relativa), { signal: peticion.signal }),
  ) as ReadableStream;
  return new Response(cuerpo, { headers: { 'content-type': TIPOS[extname(relativa)] ?? 'application/octet-stream' } });
}

/** Todas las cabeceras repetidas se conservan; no se toma ninguna como autoridad del destino. */
function cabecerasDeNode(req: IncomingMessage): Headers {
  const cabeceras = new Headers();
  for (const [nombre, valores] of Object.entries(req.headersDistinct)) {
    for (const valor of valores ?? []) {
      cabeceras.append(nombre, valor);
    }
  }
  return cabeceras;
}
function esRutaPrivada(camino: string): boolean {
  return esRutaAdministrativa(camino) || esRutaMantenimiento(camino);
}
function direccionDeLaApi(opciones: Servido, destino: URL, req: IncomingMessage): string {
  if (opciones.administracion && esRutaPrivada(destino.pathname)) {
    if (destino.username || destino.password) {
      throw new SolicitudInvalida('Petición mal formada');
    }
    const consulta = destino.search || (destino.href.includes('?') ? '?' : '');
    const fragmento = destino.hash || (destino.href.includes('#') ? '#' : '');
    return `${opciones.administracion.configuracion.origen}${destino.pathname}${consulta}${fragmento}`;
  }
  const autoridad = [RUTA_ACTIVAR_INVITACION, RUTA_CONSULTAR_INVITACION].includes(caminoDeLaRuta(destino.pathname))
    ? req.headers.host
    : `${opciones.anfitrion}:${puertoPropio(opciones, req)}`;
  return `http://${autoridad}${destino.pathname}${destino.search}`;
}
function receptorMantenimiento(opciones: Servido, camino: string) {
  if (camino === RUTA_ACTIVACION) {
    return opciones.administracion?.recibirActivacion;
  }
  if (camino === RUTA_RESULTADO_ACTUALIZACION) {
    return opciones.administracion?.recibirResultado;
  }
  if (camino === RUTA_INICIO_ACTUALIZACION) {
    return opciones.administracion?.recibirInicio;
  }
  return undefined;
}
async function proyectarDescripcionNode(opciones: Servido, peticion: Request): Promise<Response> {
  const controles = opciones.administracion
    ? await capturarControles(opciones.administracion, peticion.signal)
    : 'apagado-sin-administracion';
  return respuestaDeDescripcion(
    peticion,
    controles,
    (ruta, signal) =>
      leerArchivoAdministrativo(
        opciones.web,
        ruta,
        new Request(new URL(ruta, peticion.url), { method: 'GET', signal }),
      ),
    {
      diagnosticar: (error) => registrarErrorOperativo('descripcion-conectividad', error),
      ...(opciones.plazoMs !== undefined ? { plazoMs: opciones.plazoMs } : {}),
    },
  );
}
function responderPeticion(opciones: Servido, peticion: Request): Promise<Response> {
  const camino = new URL(peticion.url).pathname;
  if (esDescripcionDeConectividad(camino)) {
    return proyectarDescripcionNode(opciones, peticion);
  }
  if (esRutaMantenimiento(camino)) {
    const recibir = receptorMantenimiento(opciones, camino);
    return (
      recibir?.(peticion) ??
      Promise.resolve(
        new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } }),
      )
    );
  }
  if (esRutaAdministrativa(camino)) {
    const administracion = opciones.administracion;
    const responder = camino.startsWith('/administracion/api/')
      ? administracion?.responder
      : administracion &&
        ((peticion: Request) =>
          administracion.responderRecurso(peticion, (ruta, solicitud) =>
            leerArchivoAdministrativo(opciones.web, ruta, solicitud),
          ));
    return (
      responder?.(peticion) ??
      Promise.resolve(
        new Response(null, { status: ESTADO_HTTP.noEncontrado, headers: { 'cache-control': 'no-store' } }),
      )
    );
  }
  if (opciones.administracion && camino === RUTA_CATALOGO_DE_APIS) {
    return opciones.administracion.catalogo(peticion);
  }
  return opciones.api(peticion);
}

function cuerpoDeMantenimiento(destino: URL, req: IncomingMessage): Readable | undefined {
  if (req.method === 'GET' || req.method === 'HEAD' || !esRutaMantenimiento(destino.pathname)) {
    return undefined;
  }
  // Cancelar el cuerpo Fetch cierra esta lectura, sin destruir IncomingMessage ni su socket.
  return Readable.from(req.iterator({ destroyOnReturn: false }), { objectMode: false });
}
function cerrarConexionPendiente(req: IncomingMessage, res: ServerResponse, cuerpo?: Readable): void {
  if (cuerpo && !req.complete) {
    // Node termina de enviar la respuesta antes de cerrar; no se drena un cuerpo sin fin.
    res.shouldKeepAlive = false;
    res.setHeader('connection', 'close');
  }
}

/**
 * Pasa la petición de Node a la API como un Request estándar, igual que la recibe el Worker. La dirección se arma con
 * el anfitrión configurado y el puerto en que escucha de verdad (con el puerto 0, el que asignó el sistema), nunca con
 * la cabecera Host: así la API compara el Origin con su propio origen, y una página de otro dominio que apunte a
 * 127.0.0.1 (DNS rebinding) no pasa por «mismo origen». La API ignora cf-connecting-ip fuera de Cloudflare
 * (api/api.ts, OpcionesApi.ipDeCloudflare).
 */
async function servirApi(opciones: Servido, destino: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cancelacion = new AbortController();
  const cuerpoMantenimiento = cuerpoDeMantenimiento(destino, req);
  // IncomingMessage.close también ocurre tras leer un cuerpo normal: solo el abandono de la respuesta retira la API.
  const retirar = () => {
    if (!res.writableEnded) {
      cancelacion.abort();
    }
  };
  req.once('aborted', retirar);
  res.once('close', retirar);
  try {
    const conCuerpo = req.method !== 'GET' && req.method !== 'HEAD';
    const inicio: RequestInit & { duplex?: 'half' } = {
      method: req.method ?? 'GET',
      headers: cabecerasDeNode(req),
      signal: cancelacion.signal,
      // El cuerpo se pasa como flujo (que fetch exige declarar con duplex): la API lo lee con su propio límite de
      // bytes. Node tipa el flujo con el ReadableStream de node:stream/web, que es el mismo objeto que el global de
      // fetch.
      ...(conCuerpo ? { body: Readable.toWeb(cuerpoMantenimiento ?? req) as ReadableStream, duplex: 'half' } : {}),
    };
    const peticion = new Request(direccionDeLaApi(opciones, destino, req), inicio);
    const respuesta = await responderPeticion(opciones, peticion);
    cerrarConexionPendiente(req, res, cuerpoMantenimiento);
    if (res.destroyed) {
      await respuesta.body?.cancel();
      return;
    }
    // La tarjeta del agente y su enlace se publican para otros agentes: con las cabeceras de seguridad de la web. El
    // resto, con las de la API en el Worker (salvo HSTS, que por http no vale): un JSON que no carga nada ni se deja
    // enmarcar.
    const deA2a = destino.pathname === RUTA_A2A || destino.pathname === RUTA_TARJETA;
    const propias = Object.fromEntries(respuesta.headers);
    res.writeHead(
      respuesta.status,
      deA2a
        ? { ...opciones.cabeceras.web, ...propias }
        : {
            ...propias,
            'content-security-policy':
              esRutaAdministrativa(destino.pathname) && !destino.pathname.startsWith('/administracion/api/')
                ? (respuesta.headers.get('content-security-policy') ?? POLITICA_DE_LA_API)
                : POLITICA_DE_LA_API,
            'x-content-type-options': 'nosniff',
          },
    );
    // Las rutas actuales tienen respuesta acotada: se conserva su materialización y sus cabeceras de transporte.
    // El abandono del cliente también cierra el cuerpo pendiente de la API, sin retener la petición ni su memoria.
    res.end(await materializarRespuesta(respuesta, cancelacion.signal));
  } finally {
    cuerpoMantenimiento?.destroy();
    req.off('aborted', retirar);
    res.off('close', retirar);
  }
}

/**
 * Lo que responde el servidor si servirApi falla fuera de la API (que responde siempre, también a sus propios
 * errores): un 500 en Problem Details, como los de la API, con su rastro en el registro sin nada de la persona. Si la
 * respuesta ya había empezado, solo se cierra.
 */
function responderFalloInterno(destino: URL, req: IncomingMessage, res: ServerResponse, error: unknown): void {
  if (res.destroyed) {
    return;
  }
  const respuesta = respuestaDeError(error);
  const rastro = { headers: new Headers(), method: req.method ?? 'GET', url: `${BASE_DE_RUTAS}${destino.pathname}` };
  const id = respuesta.estado === ESTADO_HTTP.errorInterno ? registrarErrorInterno(rastro, error) : null;
  if (res.headersSent) {
    res.end();
    return;
  }
  escribirProblema(res, respuesta, id === null ? {} : { [CABECERA_PETICION]: id });
}

/** Escribe un problema de la API (RFC 9457) con sus cabeceras, las `extra` y las de seguridad de la API. */
function escribirProblema(res: ServerResponse, respuesta: RespuestaDeError, extra: Record<string, string> = {}): void {
  res.writeHead(respuesta.estado, {
    ...respuesta.cabeceras,
    'content-type': `${TIPO_PROBLEMA}; charset=utf-8`,
    'cache-control': CACHE_DE_UN_PROBLEMA,
    'content-security-policy': POLITICA_DE_LA_API,
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(JSON.stringify(respuesta.cuerpo));
}

/**
 * Pasa la petición a la API y responde su fallo, si lo hay. TRACE, que no puede llegar a la API, recibe el problema que
 * ella da a un método que la ruta no admite.
 */
function atenderApi(opciones: Servido, destino: URL, req: IncomingMessage, res: ServerResponse): void {
  if (req.method === METODO_QUE_FETCH_PROHIBE) {
    escribirProblema(res, problemaSinRuta(caminoDeLaRuta(destino.pathname)));
    return;
  }
  servirApi(opciones, destino, req, res).catch((error: unknown) => responderFalloInterno(destino, req, res, error));
}

/** /api/* siempre; /mcp solo con FARO_MCP=si; /a2a y la tarjeta del agente solo con FARO_A2A=si. */
function vaALaApi(opciones: Servido, ruta: string): boolean {
  return (
    (opciones.administracion !== undefined && esRutaApiAdministrada(ruta)) ||
    esDescripcionDeConectividad(ruta) ||
    ruta.startsWith('/api/') ||
    esDescubrimientoOAuth(ruta) ||
    ruta === RUTA_MCP ||
    ruta === RUTA_A2A ||
    ruta === RUTA_TARJETA
  );
}

/** Sirve el archivo del paquete publicado si la ruta es una de ellas; dice si lo ha servido. */
function servidoDelPaquete(opciones: Servido, ruta: string, res: ServerResponse): boolean {
  const carpeta = opciones.paquete;
  if (!carpeta) {
    return false;
  }
  const pedido = archivoDelPaquetePublicado(ruta);
  if (!pedido) {
    return false;
  }
  servirPaquete(carpeta, pedido, res, opciones.cabeceras.web);
  return true;
}

/**
 * Responde security.txt con el origen propio (anfitrión y puerto en que escucha), nunca el Host que manda quien pide.
 */
function servirSecurityTxt(
  opciones: Servido,
  seguridad: DatosDeSeguridad | null,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!seguridad) {
    res.writeHead(ESTADO_HTTP.noEncontrado, { ...opciones.cabeceras.web, 'cache-control': 'no-store' });
    res.end();
    return;
  }
  res.writeHead(ESTADO_HTTP.correcto, {
    ...opciones.cabeceras.web,
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': CACHE_DE_LA_WEB,
  });
  res.end(textoDeSecurityTxt(seguridad, origenPropio(opciones, req)));
}

/** El puerto en que escucha de verdad el servidor: el del socket, que con el puerto 0 es el que asignó el sistema. */
function puertoPropio(opciones: Servido, req: IncomingMessage): number {
  return req.socket.localPort ?? opciones.puerto;
}

/** El origen propio del servidor (anfitrión y puerto en que escucha), nunca el Host que manda quien pide. */
function origenPropio(opciones: Servido, req: IncomingMessage): string {
  return `http://${opciones.anfitrion}:${puertoPropio(opciones, req)}`;
}

/**
 * Responde el catálogo de las API (RFC 9727) con el origen propio, los agentes encendidos y la API para socios si lo
 * está, como el Worker.
 */
async function servirCatalogo(opciones: Servido, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const respuesta = respuestaDelCatalogo(req.method ?? 'GET', origenPropio(opciones, req));
  res.writeHead(respuesta.status, { ...opciones.cabeceras.web, ...Object.fromEntries(respuesta.headers) });
  res.end(Buffer.from(await respuesta.arrayBuffer()));
}

/**
 * Si la petición va dirigida a este servidor: su cabecera Host es la del anfitrión en que escucha (o 127.0.0.1,
 * localhost o [::1]) con el puerto en que escucha de verdad. Contra el DNS rebinding: una web ajena que haga
 * apuntar su propio nombre a 127.0.0.1 manda su nombre en Host, y no lee nada, ni siquiera por GET.
 */
function dirigidaAEsteServidor(opciones: Servido, req: IncomingMessage): boolean {
  const pedido = req.headers.host?.toLowerCase();
  if (!pedido) {
    return false;
  }
  const puerto = puertoPropio(opciones, req);
  const nombres = [opciones.anfitrion.toLowerCase(), '127.0.0.1', 'localhost', '[::1]'];
  return nombres.some((nombre) => pedido === `${nombre}:${puerto}` || (puerto === PUERTO_HTTP && pedido === nombre));
}

/**
 * La ruta pedida, si la petición va dirigida a este servidor y está bien formada; si no, responde 421 o 400 y da null.
 */
function destinoAdmitido(opciones: Servido, req: IncomingMessage, res: ServerResponse): URL | null {
  if (!dirigidaAEsteServidor(opciones, req)) {
    responderTexto(res, ESTADO_HTTP.anfitrionNoAtendido, 'Anfitrión no admitido', opciones.cabeceras.web);
    return null;
  }
  const destino = destinoDe(req);
  if (!destino) {
    responderTexto(res, ESTADO_HTTP.solicitudIncorrecta, 'Petición mal formada', opciones.cabeceras.web);
  }
  return destino;
}

/** Lo que responde el propio servidor, sin la web ni la API, leído de las opciones al crearlo. */
interface Propias {
  seguridad: DatosDeSeguridad | null;
}

/** Una petición recibida por Node y su respuesta. */
interface Recibida {
  req: IncomingMessage;
  res: ServerResponse;
}

/**
 * Responde las rutas propias del servidor (la portada, security.txt, la configuración y el catálogo de las API) y dice
 * si la petición era de una de ellas.
 */
function servidaPorElServidor(opciones: Servido, propias: Propias, destino: URL, peticion: Recibida): boolean {
  const { req, res } = peticion;
  switch (destino.pathname) {
    case '/':
      res.writeHead(ESTADO_HTTP.encontradoEnOtraDireccion, { ...opciones.cabeceras.web, location: PORTADA });
      res.end();
      return true;
    case RUTA_SECURITY_TXT:
      servirSecurityTxt(opciones, propias.seguridad, req, res);
      return true;
    case '/modo-recorrido.json': {
      const permitido = req.method === 'GET' || req.method === 'HEAD';
      res.writeHead(permitido ? ESTADO_HTTP.correcto : ESTADO_HTTP.metodoNoAdmitido, {
        ...opciones.cabeceras.web,
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        ...(permitido ? {} : { allow: 'GET, HEAD' }),
      });
      res.end(
        permitido && req.method === 'GET' ? JSON.stringify({ version: 1, revision: 0, modo: 'real' }) : undefined,
      );
      return true;
    }
    case '/capacidades-panel.json':
      return servirCapacidadesPanel(opciones.administracion, res);
    case RUTA_CATALOGO_DE_APIS:
      if (opciones.administracion) {
        atenderApi(opciones, destino, req, res);
        return true;
      }
      servirCatalogo(opciones, req, res).catch((error: unknown) => responderFalloInterno(destino, req, res, error));
      return true;
    default:
      return servirSinPortal(destino, peticion, opciones.cabeceras.web);
  }
}

/**
 * El servidor local: la portada redirige a inicio.html, /.well-known/security.txt dice a quién avisar de un fallo,
 * /.well-known/api-catalog, las API que ofrece, /avisos-del-navegador
 * recibe los avisos técnicos del navegador y /encuesta/responder las respuestas de la encuesta (los dos con las
 * cabeceras de la API, como en el Worker), /paquete/<huella>/ sirve
 * el paquete publicado, /api/* (y /mcp y A2A, si están encendidos) va a la API y el resto son archivos de la web, salvo
 * lo que deja fuera su .assetsignore, que se lee al crearlo.
 *
 * @param opciones - La API, las carpetas de la web y del paquete, el anfitrión y el puerto, y lo que se enciende.
 * @returns El servidor HTTP, sin escuchar todavía: quien lo crea llama a `listen`.
 */
export function crearServidor(pedidas: OpcionesServidor): Server {
  const opciones: Servido = {
    ...pedidas,
    cabeceras: cabecerasDeLaWeb(pedidas.huellaMapaModulos ?? ''),
  };
  const web: Web = {
    cabeceras: opciones.cabeceras,
    carpeta: opciones.web,
    carpetaReal: existsSync(opciones.web) ? realpathSync.native(opciones.web) : opciones.web,
    excluidos: exclusionesDe(opciones.web),
  };
  const propias: Propias = {
    seguridad: opciones.seguridad ?? datosDeSeguridad({}),
  };
  // El punto de avisos de este servidor, con su tope de envíos por minuto; se atiende como una API más.
  const conAvisos: Servido = { ...opciones, api: crearPuntoDeAvisos() };
  // El punto de la encuesta, con su ventana de envíos y el almacén del montaje del panel (entrada-node.ts).
  const conEncuesta: Servido = { ...opciones, api: crearEntradaNode(opciones.administracion) };
  const puntosPropios = new Map([
    [RUTA_DE_AVISOS, conAvisos],
    [RUTA_DE_LA_ENCUESTA, conEncuesta],
  ]);
  const atender = (destino: URL, req: IncomingMessage, res: ServerResponse): void => {
    if (esRutaPrivada(destino.pathname)) {
      atenderApi(opciones, destino, req, res);
      return;
    }
    if (servidaPorElServidor(opciones, propias, destino, { req, res })) {
      return;
    }
    if (servidoDelPaquete(opciones, destino.pathname, res)) {
      return;
    }
    const propio = puntosPropios.get(destino.pathname);
    if (!propio && !vaALaApi(opciones, destino.pathname)) {
      servirWebPublica(opciones, web, destino, { req, res });
      return;
    }
    atenderApi(propio ?? opciones, destino, req, res);
  };
  return createServer((req, res) => {
    const destino = destinoAdmitido(opciones, req, res);
    if (!destino) {
      return;
    }
    // Un error síncrono (el manifiesto del paquete que falta o está a medio escribir, un archivo que deja de poder
    // leerse) saldría del oyente «request» y terminaría el proceso: se responde como los fallos de la API.
    try {
      atender(destino, req, res);
    } catch (error) {
      responderFalloInterno(destino, req, res, error);
    }
  });
}
